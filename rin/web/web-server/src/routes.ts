/**
 * rin web-server — JSON API routes.
 *
 * Implements the v1 JSON API over the optional @rin services. Handlers read
 * services through thunks so a request always reflects the current composition
 * (services can appear and disappear under HMR).
 *
 * @module @rin/web-server
 */

import type { RepositoryStore, ResolverCapabilities } from '@rin/repository'
import type { EnvironmentStore } from '@rin/environment'
import type {
  Config,
  JsonResponse,
  SmartPruningRef,
  SmartPruningStatusBody,
} from './types.ts'
import {
  error,
  errorMessage,
  healthResponse,
  json,
  parseEnvironmentPlanQuery,
  parseRepositoryQuery,
  smartPruningStatusResponse,
} from './http.ts'

/** Lazily-read optional @rin services, resolved at request time. */
export interface RinServiceRefs {
  repository(): RepositoryStore | undefined
  environment(): EnvironmentStore | undefined
  smartPruning(): SmartPruningRef | undefined
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
    default:
      return null
  }
}

function healthRoute(services: RinServiceRefs): JsonResponse {
  return healthResponse({
    repository: services.repository() !== undefined,
    environment: services.environment() !== undefined,
    smartPruning: services.smartPruning() !== undefined,
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
