/**
 * rin web-server — pure HTTP helpers.
 *
 * Query-string parsing and JSON response shaping, with no framework or
 * node:http dependency, so the smoke script can exercise them under
 * node --experimental-strip-types.
 *
 * @module @rin/web-server
 */

import { isAbsolute, relative, resolve } from 'node:path'
import type {
  EnvironmentPlanQuery,
  ErrorBody,
  HealthBody,
  HealthServices,
  JsonResponse,
  PromptMemoryTarget,
  RepositoryQuery,
  SmartPruningLevel,
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
 * True when `candidate` resolves to `root` or a path beneath it. The check is
 * lexical (no symlink resolution), so it is safe to use before a path exists.
 * @param root - the allowed root directory.
 * @param candidate - the path to test.
 * @returns true only when the candidate stays within the root.
 */
export function isPathWithin(root: string, candidate: string): boolean {
  const relation = relative(resolve(root), resolve(candidate))
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation))
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

/** Read one query parameter, or undefined when absent or empty. */
export function queryParam(search: string, key: string): string | undefined {
  return first(new URLSearchParams(search), key)
}

/** Parse a positive-integer query parameter, or undefined when absent or invalid. */
export function parsePositiveInt(search: string, key: string): number | undefined {
  const raw = queryParam(search, key)
  if (raw === undefined || !/^\d+$/.test(raw)) return undefined
  const value = Number(raw)
  return Number.isSafeInteger(value) && value > 0 ? value : undefined
}

/** Parse the /api/prompt-memory/file target, or undefined when absent or invalid. */
export function parsePromptMemoryTarget(search: string): PromptMemoryTarget | undefined {
  const value = queryParam(search, 'target')
  return value === 'soul' || value === 'brief' || value === 'user' ? value : undefined
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

/** 200 {"mounted":false} envelope for an unmounted optional service. */
export function notMounted(): JsonResponse {
  return json(200, { mounted: false })
}

/** 200 {"mounted":true, ...body} envelope for an object service result. */
export function mounted<T extends object>(body: T): JsonResponse {
  return json(200, { mounted: true, ...body })
}

/** 200 {"mounted":true, [key]: value} envelope for an array or scalar result. */
export function mountedValue(key: string, value: unknown): JsonResponse {
  return json(200, { mounted: true, [key]: value })
}

/** Coerce an unknown thrown value to a readable message. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

/** Narrow a value to one of the three smart-pruning levels. */
export function isSmartPruningLevel(value: unknown): value is SmartPruningLevel {
  return value === 'conservative' || value === 'balanced' || value === 'aggressive'
}

/** Narrow an unknown JSON body to a plain object, or undefined when not an object. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** Read a string field, or undefined when absent or not a string. */
export function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

/** Read a boolean field, or undefined when absent or not a boolean. */
export function booleanField(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key]
  return typeof value === 'boolean' ? value : undefined
}

/** Loopback host names accepted by Host/Origin validation (anti DNS-rebinding). */
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '::1'])

/** Return a header value only when it is a single string, else undefined. */
function headerValue(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * Parse a Host header into its hostname and optional port.
 * @param host - the Host header value (e.g. "127.0.0.1:8320" or "[::1]").
 * @returns the hostname (IPv6 brackets stripped) and port, or null when malformed.
 */
export function splitHostHeader(host: string): { hostname: string; port: number | null } | null {
  if (host === '') return null
  if (host.startsWith('[')) {
    const close = host.indexOf(']')
    if (close === -1) return null
    const hostname = host.slice(1, close)
    if (hostname === '') return null
    const rest = host.slice(close + 1)
    if (rest === '') return { hostname, port: null }
    if (!rest.startsWith(':')) return null
    const port = parsePort(rest.slice(1))
    if (port === undefined) return null
    return { hostname, port }
  }
  const firstColon = host.indexOf(':')
  if (firstColon === -1) return { hostname: host, port: null }
  // A second colon means a bare IPv6 literal without brackets: reject it.
  if (host.indexOf(':', firstColon + 1) !== -1) return null
  const hostname = host.slice(0, firstColon)
  if (hostname === '') return null
  const port = parsePort(host.slice(firstColon + 1))
  if (port === undefined) return null
  return { hostname, port }
}

/** Parse a port string into a valid TCP port, or undefined when invalid. */
function parsePort(raw: string): number | undefined {
  if (!/^\d{1,5}$/.test(raw)) return undefined
  const port = Number(raw)
  return port >= 1 && port <= 65535 ? port : undefined
}

/**
 * True when a Host header names a loopback host on the expected port.
 * @param hostHeader - the request Host header, possibly absent or an array.
 * @param port - the actual bound server port.
 * @returns true only for loopback host names with a matching port or no port.
 */
export function isAllowedHostHeader(
  hostHeader: string | readonly string[] | undefined,
  port: number,
): boolean {
  const host = headerValue(hostHeader)
  if (host === undefined) return false
  const parsed = splitHostHeader(host)
  if (parsed === null) return false
  if (!LOOPBACK_HOSTNAMES.has(parsed.hostname.toLowerCase())) return false
  return parsed.port === null || parsed.port === port
}

/** Strip IPv6 brackets so URL hostnames and Host headers compare equally. */
function normalizeHostname(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

/**
 * True when an Origin header is same-origin with the request's Host.
 *
 * The server is plain HTTP on loopback, so the origin scheme must be http and
 * its hostname plus port must match the Host header's hostname plus port.
 * @param origin - the Origin header value (or an array; the caller only invokes this when present).
 * @param hostHeader - the request Host header.
 * @param port - the actual bound server port, used when Host omits a port.
 * @returns true for a matching origin; false for cross-origin, "null", or malformed values.
 */
export function isSameOrigin(
  origin: string | readonly string[] | undefined,
  hostHeader: string | readonly string[] | undefined,
  port: number,
): boolean {
  const originValue = headerValue(origin)
  const hostValue = headerValue(hostHeader)
  if (originValue === undefined || hostValue === undefined) return false
  const host = splitHostHeader(hostValue)
  if (host === null) return false
  let parsed: URL
  try {
    parsed = new URL(originValue)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:') return false
  if (normalizeHostname(parsed.hostname).toLowerCase() !== host.hostname.toLowerCase()) return false
  const originPort = parsed.port !== '' ? Number(parsed.port) : 80
  const hostPort = host.port ?? port
  return originPort === hostPort
}

/**
 * Extract the bearer token from an Authorization header or a ?token= query.
 * @param authorization - the Authorization header value, possibly absent or an array.
 * @param search - the URL query string (including the leading "?").
 * @returns the token, or undefined when absent.
 */
export function extractBearerToken(
  authorization: string | readonly string[] | undefined,
  search: string,
): string | undefined {
  const header = headerValue(authorization)
  if (header !== undefined) {
    const match = /^Bearer[ \t]+(.+)$/i.exec(header.trim())
    if (match !== null && match[1] !== undefined) return match[1]
  }
  return queryParam(search, 'token')
}
