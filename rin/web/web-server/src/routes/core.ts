/**
 * rin web-server — core (v1) routes.
 *
 * Health, smart-pruning status, repository read, and environment plan. Returns
 * null for any pathname it does not claim.
 *
 * @module @rin/web-server
 */

import type { ResolverCapabilities } from '@rin/repository'
import type { Config, JsonResponse, SmartPruningStatusBody } from '../types.ts'
import {
  error,
  errorMessage,
  healthResponse,
  json,
  parseEnvironmentPlanQuery,
  parseRepositoryQuery,
  smartPruningStatusResponse,
} from '../http.ts'
import type { RinServiceRefs } from '../routes.ts'

/** Dispatch the core v1 pathnames; null for anything else. */
export async function handle(
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
