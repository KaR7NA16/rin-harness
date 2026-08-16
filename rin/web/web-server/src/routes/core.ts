/**
 * rin web-server — core (v1) routes.
 *
 * Health, smart-pruning status/write, repository read, and environment plan.
 * Returns null for any pathname it does not claim.
 *
 * @module @rin/web-server
 */

import type { ResolverCapabilities } from '@rin/repository'
import type { Config, JsonResponse, SmartPruningLevel, SmartPruningStatusBody } from '../types.ts'
import {
  asRecord,
  error,
  errorMessage,
  healthResponse,
  isPathWithin,
  isSmartPruningLevel,
  json,
  mounted,
  notMounted,
  parseEnvironmentPlanQuery,
  parseRepositoryQuery,
  smartPruningStatusResponse,
} from '../http.ts'
import type { RinServiceRefs } from '../routes.ts'

/** Dispatch the core v1 pathnames; null for anything else. */
export async function handle(
  pathname: string,
  search: string,
  method: string,
  body: unknown,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse | null> {
  switch (pathname) {
    case '/health':
      return json(200, { status: 'ok', version: '0.1.0', uptime: process.uptime() })
    case '/api/status':
      return json(200, { status: 'ok', version: '0.1.0', uptime: process.uptime() })
    case '/api/health':
      return healthRoute(services)
    case '/api/repository':
      return repositoryRoute(search, services, config)
    case '/api/environment/plan':
      return environmentPlanRoute(search, services, config)
    case '/api/smart-pruning/status':
      return smartPruningRoute(services)
    case '/api/smart-pruning/set':
      return smartPruningSetRoute(method, body, services)
    default:
      return null
  }
}

function healthRoute(services: RinServiceRefs): JsonResponse {
  return healthResponse({
    repository: services.repository() !== undefined,
    environment: services.environment() !== undefined,
    filesystem: services.filesystem() !== undefined,
    sessionBackup: services.sessionBackup() !== undefined,
    smartPruning: services.smartPruning() !== undefined,
    knowledge: services.knowledge() !== undefined,
    sessionSearch: services.sessionSearch() !== undefined,
    promptMemory: services.promptMemory() !== undefined,
    evolution: services.evolution() !== undefined,
    skillMemory: services.skillMemory() !== undefined,
    agents: services.agents() !== undefined,
    notes: services.notes() !== undefined,
    sandboxes: services.sandboxes() !== undefined,
    tokenOptimization: services.tokenOptimization() !== undefined,
    codegraph: services.codegraph() !== undefined,
    plugins: services.plugins() !== undefined,
    providerProbe: services.providerProbe() !== undefined,
    teams: services.teams() !== undefined,
    tasks: services.tasks() !== undefined,
    mcp: services.mcp() !== undefined,
    computerUse: services.computerUse() !== undefined,
    agentMigration: services.agentMigration() !== undefined,
    doctor: services.doctor() !== undefined,
  })
}

function smartPruningRoute(services: RinServiceRefs): JsonResponse {
  const smartPruning = services.smartPruning()
  const body: SmartPruningStatusBody = smartPruning === undefined
    ? { mounted: false }
    : { mounted: true, ...smartPruning.getStatus() }
  return smartPruningStatusResponse(body)
}

function smartPruningSetRoute(method: string, body: unknown, services: RinServiceRefs): JsonResponse {
  const smartPruning = services.smartPruning()
  if (smartPruning === undefined) return notMounted()
  if (method !== 'POST') return error(405, 'method not allowed; POST /api/smart-pruning/set')
  const fields = asRecord(body)
  if (fields === undefined) return error(400, 'request body must be a JSON object')
  const hasEnabled = 'enabled' in fields
  const hasLevel = 'level' in fields
  if (!hasEnabled && !hasLevel) return error(400, 'at least one of enabled or level is required')

  // Validate the field types before reading service state, so a malformed body
  // is a 400 rather than a 500 surfaced from getStatus().
  let enabled: boolean | undefined
  if (hasEnabled) {
    if (typeof fields.enabled !== 'boolean') return error(400, 'enabled must be a boolean')
    enabled = fields.enabled
  }
  let level: SmartPruningLevel | undefined
  if (hasLevel) {
    if (!isSmartPruningLevel(fields.level)) {
      return error(400, 'level must be conservative, balanced, or aggressive')
    }
    level = fields.level
  }

  let status = smartPruning.getStatus()
  if (enabled !== undefined) status = smartPruning.setEnabled(enabled)
  if (level !== undefined) status = smartPruning.setLevel(level)
  return mounted(status)
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
  const queryRoot = parseRepositoryQuery(search).root
  if (queryRoot !== undefined) {
    if (config.repositoryRoot === undefined) {
      return error(400, 'repository root override requires a configured repositoryRoot')
    }
    if (!isPathWithin(config.repositoryRoot, queryRoot)) {
      return error(400, 'repository root must resolve within the configured repository root')
    }
  }
  const root = queryRoot ?? config.repositoryRoot
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
