/**
 * rin web-server — pure HTTP helpers.
 *
 * Query-string parsing and JSON response shaping, with no framework or
 * node:http dependency, so the smoke script can exercise them under
 * node --experimental-strip-types.
 *
 * @module @rin/web-server
 */

import type {
  EnvironmentPlanQuery,
  ErrorBody,
  HealthBody,
  HealthServices,
  JsonResponse,
  RepositoryQuery,
  SmartPruningStatusBody,
} from './types.ts'

/** Fixed product identity reported by the health endpoint. */
export const RIN_WEB_NAME = 'rin-web' as const

/** Fixed version reported by the health endpoint (kept in sync with package.json). */
export const RIN_WEB_VERSION = '0.1.0' as const

/** Interpret a query value as a boolean; anything not truthy-looking is false. */
export function parseBoolean(value: string | null): boolean {
  if (value === null) return false
  switch (value.toLowerCase()) {
    case 'true':
    case '1':
    case 'yes':
    case 'on':
      return true
    default:
      return false
  }
}

/** Return the first non-empty value for a query key, or undefined. */
function first(params: URLSearchParams, key: string): string | undefined {
  const value = params.get(key)
  return value === null || value === '' ? undefined : value
}

/**
 * Parse the /api/repository query string.
 * @param search - the URL query string, e.g. "?root=/abs/path".
 * @returns the parsed root, or undefined when absent or empty.
 */
export function parseRepositoryQuery(search: string): RepositoryQuery {
  const params = new URLSearchParams(search)
  return { root: first(params, 'root') }
}

/**
 * Parse the /api/environment/plan query string.
 * @param search - the URL query string.
 * @param defaultPlatform - platform used when the query omits platform.
 * @returns the parsed profile, root, platform, and runtime booleans.
 */
export function parseEnvironmentPlanQuery(
  search: string,
  defaultPlatform: string,
): EnvironmentPlanQuery {
  const params = new URLSearchParams(search)
  return {
    profile: first(params, 'profile'),
    root: first(params, 'root'),
    platform: first(params, 'platform') ?? defaultPlatform,
    apt: parseBoolean(params.get('apt')),
    python: parseBoolean(params.get('python')),
    pip: parseBoolean(params.get('pip')),
    r: parseBoolean(params.get('r')),
    npm: parseBoolean(params.get('npm')),
    tlmgr: parseBoolean(params.get('tlmgr')),
  }
}

/** Shape a JSON response with an explicit status. */
export function json(status: number, body: unknown): JsonResponse {
  return { status, body }
}

/** Shape an error response with the standard {"error": ...} envelope. */
export function error(status: number, message: string): JsonResponse {
  const body: ErrorBody = { error: message }
  return { status, body }
}

/** Shape the /api/health response. */
export function healthResponse(services: HealthServices): JsonResponse {
  const body: HealthBody = {
    ok: true,
    name: RIN_WEB_NAME,
    version: RIN_WEB_VERSION,
    services,
  }
  return json(200, body)
}

/** Shape the /api/smart-pruning/status response. */
export function smartPruningStatusResponse(body: SmartPruningStatusBody): JsonResponse {
  return json(200, body)
}

/** Coerce an unknown thrown value to a readable message. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
