/**
 * rin web-server — skill-memory routes.
 *
 * Read-only skill-memory overview. Creates the store via
 * ctx['skill-memory'].createStore(roots), then enumerates the skill-memory
 * directory and reads each skill's STATS.json + SUMMARY.md. The three layout
 * constants and the two root helpers are inlined here so this module carries
 * no runtime dependency on @rin/skill-memory (web-server stays zero-runtime-dep;
 * the skill-memory service type is imported type-only via routes.ts). Returns
 * null for any pathname it does not claim.
 *
 * @module @rin/web-server
 */

import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Config, JsonResponse, SkillMemoryRootsConfig } from '../types.ts'
import {
  error,
  errorMessage,
  mountedValue,
  notMounted,
} from '../http.ts'
import type { RinServiceRefs } from '../routes.ts'

/** The skill-memory directory name under a config root (mirrors @rin/skill-memory). */
const SKILL_MEMORY_DIRNAME = 'skill-memory'
/** The per-skill stats sidecar file name (mirrors @rin/skill-memory). */
const SKILL_MEMORY_STATS_FILENAME = 'STATS.json'
/** The per-skill summary file name (mirrors @rin/skill-memory). */
const SKILL_MEMORY_SUMMARY_FILENAME = 'SUMMARY.md'

/** Resolve a config root to its skill-memory directory. */
function skillMemoryRoot(configRoot: string): string {
  return join(configRoot, SKILL_MEMORY_DIRNAME).normalize('NFC')
}

/** Dispatch the skill-memory pathnames; null for anything else. */
export async function handle(
  pathname: string,
  _search: string,
  _method: string,
  _body: unknown,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse | null> {
  switch (pathname) {
    case '/api/skill-memory/overview':
      return skillMemoryOverviewRoute(services, config)
    default:
      return null
  }
}

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
  const scopes = [
    { root: skillMemoryRoot(roots.globalConfigRoot), scope: 'global' as const },
    ...(roots.projectConfigRoot
      ? [{ root: skillMemoryRoot(roots.projectConfigRoot), scope: 'project' as const }]
      : []),
  ]
  const records: SkillMemoryOverviewRecord[] = []
  for (const { root, scope } of scopes) {
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
