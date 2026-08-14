/**
 * rin web-server — session-search routes.
 *
 * Read-only session browse/discover/read endpoints over ctx.sessionSearch.
 * Returns null for any pathname it does not claim.
 *
 * @module @rin/web-server
 */

import type { Config, JsonResponse } from '../types.ts'
import {
  error,
  errorMessage,
  mounted,
  notMounted,
  parsePositiveInt,
  queryParam,
} from '../http.ts'
import type { RinServiceRefs } from '../routes.ts'

/** Dispatch the session-search pathnames; null for anything else. */
export async function handle(
  pathname: string,
  search: string,
  services: RinServiceRefs,
  _config: Config,
): Promise<JsonResponse | null> {
  switch (pathname) {
    case '/api/sessions/browse':
      return sessionsBrowseRoute(search, services)
    case '/api/sessions/discover':
      return sessionsDiscoverRoute(search, services)
    case '/api/sessions/read':
      return sessionsReadRoute(search, services)
    default:
      return null
  }
}

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
  const key = queryParam(search, 'key')
  if (key === undefined) return error(400, 'key is required; pass ?key=<sessionId>')
  try {
    const result = await sessionSearch.read({ sessionId: key })
    if (result === null) return error(404, 'session not found')
    return mounted(result)
  } catch (err) {
    return error(500, errorMessage(err))
  }
}
