/**
 * Typed fetch wrapper for the @rin/web-server JSON API.
 *
 * Every endpoint returns application/json. A non-2xx response carries the
 * {"error": "<message>"} envelope; a network failure surfaces as ApiError with
 * status 0. Callers see exactly one failure shape. GET and POST share one
 * response parser.
 */

export class ApiError extends Error {
  /** HTTP status, or 0 when the request never reached a server. */
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/**
 * Fetch a JSON endpoint and parse its body.
 * @param path - the absolute-path URL, e.g. "/api/repository".
 * @returns the parsed JSON body.
 * @throws ApiError on a non-2xx status or a network failure.
 */
export async function apiGet<T>(path: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, { headers: { Accept: 'application/json' } })
  } catch (cause) {
    throw new ApiError(0, 'network error: ' + networkMessage(cause))
  }
  return parseJsonResponse<T>(response)
}

/**
 * POST a JSON body to an endpoint and parse its response.
 * @param path - the absolute-path URL, e.g. "/api/notes/write".
 * @param body - the JSON-serializable request body.
 * @returns the parsed JSON body.
 * @throws ApiError on a non-2xx status or a network failure.
 */
export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (cause) {
    throw new ApiError(0, 'network error: ' + networkMessage(cause))
  }
  return parseJsonResponse<T>(response)
}

/** Parse a JSON response, throwing ApiError on non-2xx with the error envelope. */
async function parseJsonResponse<T>(response: Response): Promise<T> {
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  if (!response.ok) {
    throw new ApiError(response.status, errorMessage(body, response))
  }
  return body as T
}

function networkMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function errorMessage(body: unknown, response: Response): string {
  if (body !== null && typeof body === 'object' && 'error' in body) {
    const error = (body as { error?: unknown }).error
    if (typeof error === 'string' && error.length > 0) return error
  }
  return 'HTTP ' + response.status + ' ' + response.statusText
}

/**
 * The v2 endpoint envelope: a service that is not mounted reports
 * {"mounted": false}; when mounted, the result fields are spread alongside
 * {"mounted": true}.
 */
export interface MountedFalse {
  mounted: false
}

export type MountedTrue<T> = { mounted: true } & T

export type Mounted<T> = MountedFalse | MountedTrue<T>

/** Narrow a Mounted payload to its mounted branch. */
export function isMounted<T>(data: Mounted<T> | null | undefined): data is MountedTrue<T> {
  return data != null && data.mounted === true
}
