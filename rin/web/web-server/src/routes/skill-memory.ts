/**
 * rin web-server — skill-memory routes.
 *
 * Read + write skill-memory endpoints. Reads reuse the file-backed store's
 * domain methods (createStore(...) from ctx['skill-memory']) and the shared
 * overview enumeration; writes route the store's create/review/lifecycle
 * methods so the skill learning UI (list/detail/enabled/learning/approve/
 * reject) reads and mutates real @rin/skill-memory data instead of 404/empty
 * stubs. Returns null for any pathname it does not claim.
 *
 * This module carries no runtime dependency on @rin/skill-memory (web-server
 * stays zero-runtime-dep); the skill-memory service and store types are
 * imported type-only via routes.ts, and the layout constants are inlined.
 *
 * @module @rin/web-server
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type {
  SkillMemoryPendingEntry,
  SkillMemoryRef,
  SkillMemoryScope,
  SkillMemoryStats,
  SkillMemoryStore,
  SkillMemorySummary,
} from '@rin/skill-memory'
import type { Config, JsonResponse, SkillMemoryRootsConfig } from '../types.ts'
import {
  asRecord,
  booleanField,
  error,
  errorMessage,
  json,
  mountedValue,
  notMounted,
  queryParam,
  stringField,
} from '../http.ts'
import type { RinServiceRefs } from '../routes.ts'

/** The skill-memory directory name under a config root (mirrors @rin/skill-memory). */
const SKILL_MEMORY_DIRNAME = 'skill-memory'
/** The per-skill stats sidecar file name (mirrors @rin/skill-memory). */
const SKILL_MEMORY_STATS_FILENAME = 'STATS.json'
/** The per-skill summary file name (mirrors @rin/skill-memory). */
const SKILL_MEMORY_SUMMARY_FILENAME = 'SUMMARY.md'
/** The skill learning config file name under the global memory root. */
const SKILL_MEMORY_LEARNING_CONFIG_FILENAME = 'learning-config.json'

/** Matches POST /api/skills/learning/:id/(approve|reject). */
const LEARNING_ACTION_RE = /^\/api\/skills\/learning\/([^/]+)\/(approve|reject)$/

/** Resolve a config root to its skill-memory directory. */
function skillMemoryRoot(configRoot: string): string {
  return join(configRoot, SKILL_MEMORY_DIRNAME).normalize('NFC')
}

/** The memory roots (global + optional project) as scope/root pairs. */
function skillMemoryScopes(roots: SkillMemoryRootsConfig): Array<{ root: string; scope: SkillMemoryScope }> {
  const scopes: Array<{ root: string; scope: SkillMemoryScope }> = [
    { root: skillMemoryRoot(roots.globalConfigRoot), scope: 'global' },
  ]
  if (roots.projectConfigRoot) {
    scopes.push({ root: skillMemoryRoot(roots.projectConfigRoot), scope: 'project' })
  }
  return scopes
}

/** Dispatch the skill-memory pathnames; null for anything else. */
export async function handle(
  pathname: string,
  search: string,
  method: string,
  body: unknown,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse | null> {
  if (pathname === '/api/skills/detail') return skillDetailRoute(search, services, config)
  if (pathname === '/api/skills/enabled') return skillEnabledRoute(method, body, services, config)
  if (pathname === '/api/skills/learning') return skillLearningRoute(method, body, services, config)
  const learningAction = LEARNING_ACTION_RE.exec(pathname)
  if (learningAction !== null && learningAction[1] !== undefined && learningAction[2] !== undefined) {
    return skillLearningActionRoute(learningAction[1], learningAction[2], method, services, config)
  }
  switch (pathname) {
    case '/api/skill-memory/overview':
      return skillMemoryOverviewRoute(services, config)
    default:
      return null
  }
}

/** A resolved store handle carrying the created store and its config roots. */
interface SkillMemoryStoreHandle {
  store: SkillMemoryStore
  roots: SkillMemoryRootsConfig
}

/** Open the skill-memory store for a request, or return a shaped response when unavailable. */
function openStore(services: RinServiceRefs, config: Config): SkillMemoryStoreHandle | JsonResponse {
  const skillMemory = services.skillMemory()
  if (skillMemory === undefined) return notMounted()
  const roots = config.skillMemoryRoots
  if (roots === undefined) {
    return error(400, 'skill memory roots not configured; set Config.skillMemoryRoots')
  }
  return { store: skillMemory.createStore(roots), roots }
}

/** Narrow a store-or-response union to the store handle. */
function isStoreHandle(value: SkillMemoryStoreHandle | JsonResponse): value is SkillMemoryStoreHandle {
  return 'store' in value
}

/** Map a frontend skill source to the skill-memory scope it lives under. */
function scopeForSource(source: string | undefined): SkillMemoryScope {
  return source === 'project' ? 'project' : 'global'
}

/** Build a skill memory reference from the frontend source/name locator. */
function skillRef(name: string, source: string | undefined, projectRoot?: string): SkillMemoryRef {
  return {
    skillName: name,
    ...(source === undefined ? {} : { source }),
    ...(projectRoot === undefined ? {} : { projectRoot }),
  }
}

/** One skill-memory directory locator: its ref and scope. */
interface SkillMemoryLocator {
  ref: SkillMemoryRef
  scope: SkillMemoryScope
}

/** Enumerate skill-memory directories, reading each STATS.json for identity. */
async function listSkillMemoryLocators(roots: SkillMemoryRootsConfig): Promise<SkillMemoryLocator[]> {
  const locators: SkillMemoryLocator[] = []
  for (const { root, scope } of skillMemoryScopes(roots)) {
    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const dir = resolve(root, entry.name)
      const stats = await readJsonRecord(resolve(dir, SKILL_MEMORY_STATS_FILENAME))
      if (stats === null || typeof stats.skillName !== 'string') continue
      const source = typeof stats.source === 'string' ? stats.source : undefined
      locators.push({
        ref: { skillName: stats.skillName, ...(source === undefined ? {} : { source }) },
        scope,
      })
    }
  }
  return locators
}

/* ------------------------------- detail -------------------------------- */

/** GET /api/skills/detail?source&name&cwd → { detail }. */
async function skillDetailRoute(
  search: string,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse> {
  const opened = openStore(services, config)
  if (!isStoreHandle(opened)) return opened
  const { store } = opened
  const source = queryParam(search, 'source')
  const name = queryParam(search, 'name')
  if (name === undefined) return error(400, 'name is required; pass ?name=')
  const cwd = queryParam(search, 'cwd')
  const ref = skillRef(name, source, cwd)
  try {
    const summaries = await store.readSkillMemorySummaries(ref)
    if (summaries.length === 0) return error(404, 'skill memory not found')
    const preferredScope = scopeForSource(source)
    const summary = summaries.find(item => item.scope === preferredScope) ?? summaries[0]
    if (summary === undefined) return error(404, 'skill memory not found')
    const stats = await store.readSkillMemoryStats(ref, summary.scope)
    return json(200, { detail: buildSkillDetail(ref, summary, stats) })
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

/** Project one memory summary + stats into the web UI's SkillDetail body. */
function buildSkillDetail(
  ref: SkillMemoryRef,
  summary: SkillMemorySummary,
  stats: SkillMemoryStats,
): Record<string, unknown> {
  const skillRoot = dirname(summary.path)
  const description =
    summary.content
      .split('\n')
      .map(line => line.trim())
      .find(line => line !== '')
      ?.replace(/^#+\s*/, '') ?? ref.skillName
  return {
    meta: {
      name: ref.skillName,
      description,
      source: ref.source ?? 'user',
      userInvocable: true,
      contentLength: summary.content.length,
      hasDirectory: true,
      enabled: stats.status !== 'archived',
    },
    tree: [{ name: SKILL_MEMORY_SUMMARY_FILENAME, path: summary.path, type: 'file' }],
    files: [{
      path: summary.path,
      content: summary.content,
      language: 'markdown',
      isEntry: true,
    }],
    skillRoot,
  }
}

/* ------------------------------- enabled ------------------------------- */

/** PATCH /api/skills/enabled {source,name,enabled} → { ok, disabledSkills }. */
async function skillEnabledRoute(
  method: string,
  body: unknown,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse> {
  if (method !== 'PATCH') return error(405, 'method not allowed')
  const opened = openStore(services, config)
  if (!isStoreHandle(opened)) return opened
  const { store, roots } = opened
  const fields = asRecord(body)
  const source = fields === undefined ? undefined : stringField(fields, 'source')
  const name = fields === undefined ? undefined : stringField(fields, 'name')
  const enabled = fields === undefined ? undefined : booleanField(fields, 'enabled')
  if (name === undefined || enabled === undefined) return error(400, 'name and enabled are required')
  const ref = skillRef(name, source)
  const scope = scopeForSource(source)
  try {
    await store.setSkillLifecycleStatus({ ref, scope, status: enabled ? 'active' : 'archived' })
    const disabledSkills = await listDisabledSkills(store, roots)
    return json(200, { ok: true, disabledSkills })
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

/** Enumerate archived (disabled) skill names via the store's per-skill stats. */
async function listDisabledSkills(store: SkillMemoryStore, roots: SkillMemoryRootsConfig): Promise<string[]> {
  const disabled: string[] = []
  for (const locator of await listSkillMemoryLocators(roots)) {
    const stats = await store.readSkillMemoryStats(locator.ref, locator.scope)
    if (stats.status === 'archived') disabled.push(locator.ref.skillName)
  }
  return disabled
}

/* ------------------------------- learning ------------------------------ */

/** The learning config persisted under the global memory root. */
interface SkillLearningConfig {
  version: 1
  mode: 'off' | 'suggest' | 'auto'
  minToolUses: number
  minConfidence: number
  autoApproveConfidence: number
  updatedAt?: string
}

const DEFAULT_LEARNING_CONFIG: SkillLearningConfig = {
  version: 1,
  mode: 'off',
  minToolUses: 3,
  minConfidence: 0.6,
  autoApproveConfidence: 0.9,
}

/** GET/PATCH/POST /api/skills/learning — overview, config update, candidate create. */
async function skillLearningRoute(
  method: string,
  body: unknown,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse> {
  const opened = openStore(services, config)
  if (!isStoreHandle(opened)) return opened
  const { store, roots } = opened
  if (method === 'GET') return skillLearningOverviewRoute(store, roots)
  if (method === 'PATCH') return skillLearningConfigRoute(body, roots)
  if (method === 'POST') return skillLearningCreateRoute(body, store)
  return error(405, 'method not allowed')
}

/** GET /api/skills/learning → { overview }. */
async function skillLearningOverviewRoute(
  store: SkillMemoryStore,
  roots: SkillMemoryRootsConfig,
): Promise<JsonResponse> {
  try {
    const config = await readLearningConfig(roots)
    const pendingCandidates = await listPendingCandidates(store, roots)
    const memories = await listSkillMemoryOverview(roots)
    return json(200, {
      overview: {
        config,
        pendingCandidates,
        recentCandidates: [],
        events: [],
        memories,
      },
    })
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

/** Read every pending observation and project it as a learning candidate. */
async function listPendingCandidates(
  store: SkillMemoryStore,
  roots: SkillMemoryRootsConfig,
): Promise<LearningCandidate[]> {
  const candidates: LearningCandidate[] = []
  for (const locator of await listSkillMemoryLocators(roots)) {
    const pending = await store.readSkillMemoryPending(locator.ref, locator.scope)
    for (const entry of pending) {
      candidates.push(pendingEntryToCandidate(entry, locator.scope))
    }
  }
  return candidates
}

/** PATCH /api/skills/learning → { ok, config }. */
async function skillLearningConfigRoute(
  body: unknown,
  roots: SkillMemoryRootsConfig,
): Promise<JsonResponse> {
  const fields = asRecord(body)
  if (fields === undefined) return error(400, 'request body must be a JSON object')
  const mode = fields['mode']
  if (mode !== undefined && mode !== 'off' && mode !== 'suggest' && mode !== 'auto') {
    return error(400, 'mode must be off, suggest, or auto')
  }
  try {
    const current = await readLearningConfig(roots)
    const next: SkillLearningConfig = {
      ...current,
      ...(mode === undefined ? {} : { mode }),
      ...(typeof fields['minToolUses'] === 'number' ? { minToolUses: fields['minToolUses'] } : {}),
      ...(typeof fields['minConfidence'] === 'number' ? { minConfidence: fields['minConfidence'] } : {}),
      ...(typeof fields['autoApproveConfidence'] === 'number'
        ? { autoApproveConfidence: fields['autoApproveConfidence'] }
        : {}),
      updatedAt: new Date().toISOString(),
    }
    await writeLearningConfig(roots, next)
    return json(200, { ok: true, config: next })
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

/** POST /api/skills/learning → append a pending observation (create candidate). */
async function skillLearningCreateRoute(
  body: unknown,
  store: SkillMemoryStore,
): Promise<JsonResponse> {
  const fields = asRecord(body)
  const name = fields === undefined ? undefined : stringField(fields, 'name')
  if (name === undefined) return error(400, 'name is required')
  const source = fields === undefined ? undefined : stringField(fields, 'source')
  const excerpt = fields === undefined ? undefined : stringField(fields, 'excerpt')
  const sessionId = fields === undefined ? undefined : stringField(fields, 'sessionId')
  const trigger = fields?.['trigger']
  const ref = skillRef(name, source)
  const scope = scopeForSource(source)
  try {
    const entry = await store.appendSkillMemoryPending(ref, scope, {
      id: randomUUID(),
      ...(excerpt === undefined ? {} : { excerpt }),
      ...(sessionId === undefined ? {} : { sessionId }),
      observedAt: new Date().toISOString(),
      trigger: trigger === 'invoked' || trigger === 'review' || trigger === 'manual' ? trigger : 'manual',
    })
    return json(200, { ok: true, candidate: pendingEntryToCandidate(entry, scope) })
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

/* --------------------------- learning review --------------------------- */

/** POST /api/skills/learning/:id/approve|reject → { ok, candidate }. */
async function skillLearningActionRoute(
  rawId: string,
  action: string,
  method: string,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse> {
  if (method !== 'POST') return error(405, 'method not allowed')
  let id: string
  try {
    id = decodeURIComponent(rawId)
  } catch {
    return error(400, 'invalid learning candidate id')
  }
  const opened = openStore(services, config)
  if (!isStoreHandle(opened)) return opened
  const { store, roots } = opened
  try {
    const found = await findPendingEntry(store, roots, id)
    if (found === undefined) return error(404, 'learning candidate not found')
    const consumedCount = found.index + 1
    if (action === 'approve') {
      // approve = distill the observation into the skill summary, then consume it
      await store.completeReview({
        ref: found.ref,
        scope: found.scope,
        consumedCount,
        ...(found.entry.excerpt === undefined ? {} : { summary: found.entry.excerpt }),
      })
      return json(200, { ok: true, candidate: pendingEntryToCandidate(found.entry, found.scope, 'approved') })
    }
    // reject = consume the observation without distilling a summary
    await store.movePendingToEvidence({ ref: found.ref, scope: found.scope, consumedCount })
    return json(200, { ok: true, candidate: pendingEntryToCandidate(found.entry, found.scope, 'rejected') })
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

/** A pending entry located by candidate id, with its ref/scope and queue index. */
interface FoundPendingEntry {
  entry: SkillMemoryPendingEntry
  ref: SkillMemoryRef
  scope: SkillMemoryScope
  index: number
}

/** Locate a pending observation by its candidate id across every memory dir. */
async function findPendingEntry(
  store: SkillMemoryStore,
  roots: SkillMemoryRootsConfig,
  id: string,
): Promise<FoundPendingEntry | undefined> {
  for (const locator of await listSkillMemoryLocators(roots)) {
    const pending = await store.readSkillMemoryPending(locator.ref, locator.scope)
    const index = pending.findIndex(entry => entry.id === id)
    if (index >= 0) {
      const entry = pending[index]
      if (entry !== undefined) return { entry, ref: locator.ref, scope: locator.scope, index }
    }
  }
  return undefined
}

/* --------------------------- candidate projection ---------------------- */

/** Projected learning candidate returned to the web UI. */
interface LearningCandidate {
  version: 1
  id: string
  status: 'pending' | 'approved' | 'rejected' | 'failed'
  action: 'create' | 'update'
  scope: SkillMemoryScope
  name: string
  description: string
  whenToUse: string
  reason: string
  evidence: string[]
  confidence: number
  markdown: string
  sourceSessionId?: string
  sourceFingerprint: string
  sourceToolUses: number
  createdAt: string
  updatedAt: string
}

/** Project a store pending observation into the web UI's SkillCandidate body. */
function pendingEntryToCandidate(
  entry: SkillMemoryPendingEntry,
  scope: SkillMemoryScope,
  status: LearningCandidate['status'] = 'pending',
): LearningCandidate {
  const excerpt = entry.excerpt ?? ''
  return {
    version: 1,
    id: entry.id,
    status,
    action: 'create',
    scope,
    name: entry.skillName,
    description:
      excerpt
        .split('\n')
        .map(line => line.trim())
        .find(line => line !== '') ?? entry.skillName,
    whenToUse: '',
    reason: entry.trigger,
    evidence: excerpt === '' ? [] : [excerpt],
    confidence: 0,
    markdown: excerpt,
    ...(entry.sessionId === undefined ? {} : { sourceSessionId: entry.sessionId }),
    sourceFingerprint: entry.rawKey,
    sourceToolUses: 0,
    createdAt: entry.observedAt,
    updatedAt: entry.observedAt,
  }
}

/* --------------------------- learning config --------------------------- */

function learningConfigPath(roots: SkillMemoryRootsConfig): string {
  return join(skillMemoryRoot(roots.globalConfigRoot), SKILL_MEMORY_LEARNING_CONFIG_FILENAME)
}

async function readLearningConfig(roots: SkillMemoryRootsConfig): Promise<SkillLearningConfig> {
  const record = await readJsonRecord(learningConfigPath(roots))
  if (record === null) return { ...DEFAULT_LEARNING_CONFIG }
  return {
    version: 1,
    mode: record['mode'] === 'suggest' || record['mode'] === 'auto' ? record['mode'] : 'off',
    minToolUses: typeof record['minToolUses'] === 'number' ? record['minToolUses'] : DEFAULT_LEARNING_CONFIG.minToolUses,
    minConfidence: typeof record['minConfidence'] === 'number' ? record['minConfidence'] : DEFAULT_LEARNING_CONFIG.minConfidence,
    autoApproveConfidence: typeof record['autoApproveConfidence'] === 'number'
      ? record['autoApproveConfidence']
      : DEFAULT_LEARNING_CONFIG.autoApproveConfidence,
    ...(typeof record['updatedAt'] === 'string' ? { updatedAt: record['updatedAt'] } : {}),
  }
}

async function writeLearningConfig(roots: SkillMemoryRootsConfig, config: SkillLearningConfig): Promise<void> {
  const path = learningConfigPath(roots)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, 'utf-8')
}

/* ------------------------------- overview ------------------------------ */

/** One skill's memory overview, projected from its STATS.json + SUMMARY.md. */
interface SkillMemoryOverviewRecord {
  id: string
  skillName: string
  scope: 'global' | 'project'
  status: string
  useCount: number
  pendingCount: number
  evidenceCount: number
  lastUsedAt?: string
  summaryUpdatedAt?: string
  summary?: string
}

async function skillMemoryOverviewRoute(services: RinServiceRefs, config: Config): Promise<JsonResponse> {
  const skillMemory = services.skillMemory()
  if (skillMemory === undefined) return notMounted()
  const roots = config.skillMemoryRoots
  if (roots === undefined) {
    return error(400, 'skill memory roots not configured; set Config.skillMemoryRoots')
  }
  skillMemory.createStore(roots)
  try {
    return mountedValue('skills', await listSkillMemoryOverview(roots))
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function listSkillMemoryOverview(roots: SkillMemoryRootsConfig): Promise<SkillMemoryOverviewRecord[]> {
  const records: SkillMemoryOverviewRecord[] = []
  for (const { root, scope } of skillMemoryScopes(roots)) {
    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const dir = resolve(root, entry.name)
      const stats = await readJsonRecord(resolve(dir, SKILL_MEMORY_STATS_FILENAME))
      if (stats === null || typeof stats.skillName !== 'string') continue
      const summary = await readSummary(resolve(dir, SKILL_MEMORY_SUMMARY_FILENAME))
      records.push({
        id: scope + ':' + entry.name,
        skillName: stats.skillName,
        scope,
        status: overviewStatus(stats.status),
        useCount: typeof stats.useCount === 'number' ? stats.useCount : 0,
        pendingCount: typeof stats.pendingCount === 'number' ? stats.pendingCount : 0,
        evidenceCount: typeof stats.evidenceCount === 'number' ? stats.evidenceCount : 0,
        ...(typeof stats.lastUsedAt === 'string' ? { lastUsedAt: stats.lastUsedAt } : {}),
        ...(typeof stats.summaryUpdatedAt === 'string' ? { summaryUpdatedAt: stats.summaryUpdatedAt } : {}),
        ...(summary === undefined ? {} : { summary }),
      })
    }
  }
  return records.sort((a, b) =>
    (b.summaryUpdatedAt ?? b.lastUsedAt ?? '').localeCompare(a.summaryUpdatedAt ?? a.lastUsedAt ?? ''))
}

async function readJsonRecord(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf-8')) as Record<string, unknown>
  } catch {
    return null
  }
}

async function readSummary(filePath: string): Promise<string | undefined> {
  try {
    const content = (await readFile(filePath, 'utf-8')).trim()
    return content === '' ? undefined : content
  } catch {
    return undefined
  }
}

function overviewStatus(value: unknown): string {
  return value === 'stale' || value === 'archived' || value === 'pinned' ? value : 'active'
}
