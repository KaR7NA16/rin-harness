/**
 * rin web-server — JSON API routes.
 *
 * Implements the v1/v2 JSON API over the optional @rin services. Handlers read
 * services through thunks so a request always reflects the current composition
 * (services can appear and disappear under HMR).
 *
 * @module @rin/web-server
 */

import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { RepositoryStore, ResolverCapabilities } from '@rin/repository'
import type { EnvironmentStore } from '@rin/environment'
import type { KnowledgeService, KnowledgeStore } from '@rin/knowledge'
import type { SessionSearchStore } from '@rin/session-search'
import type { PromptMemoryService } from '@rin/prompt-memory'
import type { EvolutionService } from '@rin/evolution'
import {
  getGlobalSkillMemoryRoot,
  getProjectSkillMemoryRoot,
  SKILL_MEMORY_STATS_FILENAME,
  SKILL_MEMORY_SUMMARY_FILENAME,
  type SkillMemoryService,
} from '@rin/skill-memory'
import type {
  Config,
  JsonResponse,
  SkillMemoryRootsConfig,
  SmartPruningRef,
  SmartPruningStatusBody,
} from './types.ts'
import {
  error,
  errorMessage,
  healthResponse,
  json,
  mounted,
  mountedValue,
  notMounted,
  parseEnvironmentPlanQuery,
  parsePositiveInt,
  parsePromptMemoryTarget,
  parseRepositoryQuery,
  queryParam,
  smartPruningStatusResponse,
} from './http.ts'

/** Lazily-read optional @rin services, resolved at request time. */
export interface RinServiceRefs {
  repository(): RepositoryStore | undefined
  environment(): EnvironmentStore | undefined
  smartPruning(): SmartPruningRef | undefined
  knowledge(): KnowledgeStore | undefined
  sessionSearch(): SessionSearchStore | undefined
  promptMemory(): PromptMemoryService | undefined
  evolution(): EvolutionService | undefined
  skillMemory(): SkillMemoryService | undefined
}

/**
 * Dispatch one API pathname to its handler.
 * @param pathname - the URL pathname (no query string).
 * @param search - the URL query string (including the leading "?").
 * @param services - thunks that read the optional @rin services.
 * @param config - the resolved plugin configuration.
 * @returns the shaped response, or null when the pathname is not an API route.
 */
export async function routeApi(
  pathname: string,
  search: string,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse | null> {
  switch (pathname) {
    case '/api/health':
      return healthRoute(services)
    case '/api/repository':
      return repositoryRoute(search, services, config)
    case '/api/environment/plan':
      return environmentPlanRoute(search, services, config)
    case '/api/smart-pruning/status':
      return smartPruningRoute(services)
    case '/api/knowledge/sources':
      return knowledgeSourcesRoute(search, services, config)
    case '/api/knowledge/documents':
      return knowledgeDocumentsRoute(search, services, config)
    case '/api/knowledge/search':
      return knowledgeSearchRoute(search, services, config)
    case '/api/knowledge/stats':
      return knowledgeStatsRoute(search, services, config)
    case '/api/sessions/browse':
      return sessionsBrowseRoute(search, services)
    case '/api/sessions/discover':
      return sessionsDiscoverRoute(search, services)
    case '/api/sessions/read':
      return sessionsReadRoute(search, services)
    case '/api/prompt-memory/status':
      return promptMemoryStatusRoute(services)
    case '/api/prompt-memory/file':
      return promptMemoryFileRoute(search, services)
    case '/api/prompt-memory/review-logs':
      return promptMemoryReviewLogsRoute(search, services)
    case '/api/evolution/overview':
      return evolutionOverviewRoute(services)
    case '/api/skill-memory/overview':
      return skillMemoryOverviewRoute(services, config)
    default:
      return null
  }
}

function healthRoute(services: RinServiceRefs): JsonResponse {
  return healthResponse({
    repository: services.repository() !== undefined,
    environment: services.environment() !== undefined,
    smartPruning: services.smartPruning() !== undefined,
    knowledge: services.knowledge() !== undefined,
    sessionSearch: services.sessionSearch() !== undefined,
    promptMemory: services.promptMemory() !== undefined,
    evolution: services.evolution() !== undefined,
    skillMemory: services.skillMemory() !== undefined,
  })
}

function smartPruningRoute(services: RinServiceRefs): JsonResponse {
  const smartPruning = services.smartPruning()
  const body: SmartPruningStatusBody = smartPruning === undefined
    ? { mounted: false }
    : { mounted: true, ...smartPruning.getStatus() }
  return smartPruningStatusResponse(body)
}

async function repositoryRoute(
  search: string,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse> {
  const repository = services.repository()
  if (repository === undefined) {
    return error(500, 'repository service is not mounted')
  }
  const root = parseRepositoryQuery(search).root ?? config.repositoryRoot
  if (root === undefined) {
    return error(400, 'repository root not configured; pass ?root=')
  }
  try {
    return json(200, await repository.read(root))
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function environmentPlanRoute(
  search: string,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse> {
  const environment = services.environment()
  if (environment === undefined) {
    return error(500, 'environment service is not mounted')
  }
  const query = parseEnvironmentPlanQuery(search, process.platform)
  if (query.profile === undefined) {
    return error(400, 'profile is required; pass ?profile=<id>')
  }
  const root = query.root ?? config.repositoryRoot
  if (root === undefined) {
    return error(400, 'repository root not configured; pass ?root=')
  }
  const capabilities: ResolverCapabilities = {
    platform: query.platform,
    runtimes: {
      apt: query.apt,
      python: query.python,
      pip: query.pip,
      r: query.r,
      npm: query.npm,
      tlmgr: query.tlmgr,
    },
  }
  try {
    return json(200, await environment.plan(root, query.profile, capabilities))
  } catch (err) {
    if (isUnknownProfileError(err)) {
      return error(400, errorMessage(err))
    }
    return error(500, errorMessage(err))
  }
}

/** The environment store's "unknown profile" failure maps to HTTP 400. */
function isUnknownProfileError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('unknown profile')
}

// ---------------------------------------------------------------------------
// knowledge (open per request, close afterwards)
// ---------------------------------------------------------------------------

async function withKnowledge(
  search: string,
  services: RinServiceRefs,
  config: Config,
  shape: (service: KnowledgeService) => JsonResponse,
): Promise<JsonResponse> {
  const knowledge = services.knowledge()
  if (knowledge === undefined) return notMounted()
  const dbPath = queryParam(search, 'db') ?? config.knowledgeDbPath
  if (dbPath === undefined) {
    return error(400, 'knowledge database path not configured; pass ?db=')
  }
  let service: KnowledgeService
  try {
    service = knowledge.open(dbPath)
  } catch (err) {
    return error(500, errorMessage(err))
  }
  try {
    return shape(service)
  } finally {
    try {
      service.close()
    } catch {
      // the database handle is already closed; nothing further to release
    }
  }
}

function knowledgeSourcesRoute(
  search: string,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse> {
  return withKnowledge(search, services, config, (service) =>
    mountedValue('sources', service.listSources()))
}

function knowledgeDocumentsRoute(
  search: string,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse> {
  return withKnowledge(search, services, config, (service) => {
    const sourceId = queryParam(search, 'sourceId')
    const limit = parsePositiveInt(search, 'limit')
    return mountedValue('documents', service.listDocuments({
      ...(sourceId === undefined ? {} : { sourceId }),
      ...(limit === undefined ? {} : { limit }),
    }))
  })
}

function knowledgeSearchRoute(
  search: string,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse> {
  return withKnowledge(search, services, config, (service) => {
    const query = queryParam(search, 'query')
    if (query === undefined) return error(400, 'query is required; pass ?query=')
    const limit = parsePositiveInt(search, 'limit')
    return mountedValue('results', service.search(query, {
      ...(limit === undefined ? {} : { limit }),
    }))
  })
}

function knowledgeStatsRoute(
  search: string,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse> {
  return withKnowledge(search, services, config, (service) =>
    mounted(service.getStats()))
}

// ---------------------------------------------------------------------------
// session-search
// ---------------------------------------------------------------------------

async function sessionsBrowseRoute(search: string, services: RinServiceRefs): Promise<JsonResponse> {
  const sessionSearch = services.sessionSearch()
  if (sessionSearch === undefined) return notMounted()
  const limit = parsePositiveInt(search, 'limit')
  try {
    return mounted(await sessionSearch.browse({ ...(limit === undefined ? {} : { limit }) }))
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function sessionsDiscoverRoute(search: string, services: RinServiceRefs): Promise<JsonResponse> {
  const sessionSearch = services.sessionSearch()
  if (sessionSearch === undefined) return notMounted()
  const query = queryParam(search, 'query')
  if (query === undefined) return error(400, 'query is required; pass ?query=')
  const limit = parsePositiveInt(search, 'limit')
  try {
    return mounted(await sessionSearch.discover({ query, ...(limit === undefined ? {} : { limit }) }))
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function sessionsReadRoute(search: string, services: RinServiceRefs): Promise<JsonResponse> {
  const sessionSearch = services.sessionSearch()
  if (sessionSearch === undefined) return notMounted()
  const sessionId = queryParam(search, 'sessionId')
  if (sessionId === undefined) return error(400, 'sessionId is required; pass ?sessionId=<id>')
  const projectPath = queryParam(search, 'projectPath')
  try {
    const result = await sessionSearch.read({ sessionId, ...(projectPath === undefined ? {} : { projectPath }) })
    if (result === null) return error(404, 'session not found')
    return mounted(result)
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

// ---------------------------------------------------------------------------
// prompt-memory
// ---------------------------------------------------------------------------

async function promptMemoryStatusRoute(services: RinServiceRefs): Promise<JsonResponse> {
  const promptMemory = services.promptMemory()
  if (promptMemory === undefined) return notMounted()
  try {
    return mounted(await promptMemory.getStatus())
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function promptMemoryFileRoute(search: string, services: RinServiceRefs): Promise<JsonResponse> {
  const promptMemory = services.promptMemory()
  if (promptMemory === undefined) return notMounted()
  const target = parsePromptMemoryTarget(search)
  if (target === undefined) return error(400, 'target is required; pass ?target=user|brief')
  try {
    return mounted(await promptMemory.readFile(target))
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function promptMemoryReviewLogsRoute(search: string, services: RinServiceRefs): Promise<JsonResponse> {
  const promptMemory = services.promptMemory()
  if (promptMemory === undefined) return notMounted()
  const limit = parsePositiveInt(search, 'limit')
  try {
    return mountedValue('logs', await promptMemory.readReviewLogs(limit))
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

// ---------------------------------------------------------------------------
// evolution
// ---------------------------------------------------------------------------

async function evolutionOverviewRoute(services: RinServiceRefs): Promise<JsonResponse> {
  const evolution = services.evolution()
  if (evolution === undefined) return notMounted()
  try {
    const [config, state] = await Promise.all([evolution.readConfig(), evolution.readState()])
    const pending = state.candidates.filter(candidate => candidate.status === 'pending')
    const recent = [...state.candidates]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 10)
    return mounted({
      config,
      pendingCandidates: pending,
      recentCandidates: recent,
      events: state.events,
    })
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

// ---------------------------------------------------------------------------
// skill-memory
// ---------------------------------------------------------------------------

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
    { root: getGlobalSkillMemoryRoot(roots.globalConfigRoot), scope: 'global' as const },
    ...(roots.projectConfigRoot
      ? [{ root: getProjectSkillMemoryRoot(roots.projectConfigRoot), scope: 'project' as const }]
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
