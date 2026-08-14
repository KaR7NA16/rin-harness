/**
 * rin web-server — token-optimization routes.
 *
 * Read/write the two token-optimization knobs (response style + prompt
 * cleaner) over ctx.tokenOptimization. The service is referenced through the
 * local TokenOptimizationRef interface, so this module carries no @rin
 * runtime dependency. Returns null for any pathname it does not claim.
 *
 * @module @rin/web-server
 */

import type { Config, JsonResponse } from '../types.ts'
import {
  asRecord,
  error,
  errorMessage,
  isResponseStyle,
  mounted,
  notMounted,
} from '../http.ts'
import type { RinServiceRefs } from '../routes.ts'

/** Dispatch the token-optimization pathnames; null for anything else. */
export async function handle(
  pathname: string,
  _search: string,
  method: string,
  body: unknown,
  services: RinServiceRefs,
  _config: Config,
): Promise<JsonResponse | null> {
  switch (pathname) {
    case '/api/token-optimization/status':
      return tokenStatusRoute(services)
    case '/api/token-optimization/set':
      return tokenSetRoute(method, body, services)
    default:
      return null
  }
}

function tokenStatusRoute(services: RinServiceRefs): JsonResponse {
  const token = services.tokenOptimization()
  if (token === undefined) return notMounted()
  try {
    return mounted(token.getStatus())
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

function tokenSetRoute(method: string, body: unknown, services: RinServiceRefs): JsonResponse {
  const token = services.tokenOptimization()
  if (token === undefined) return notMounted()
  if (method !== 'POST') return error(405, 'method not allowed; POST /api/token-optimization/set')
  const fields = asRecord(body)
  if (fields === undefined) return error(400, 'request body must be a JSON object')
  const hasStyle = 'responseStyle' in fields
  const hasClean = 'cleanPrompt' in fields
  if (!hasStyle && !hasClean) return error(400, 'at least one of responseStyle or cleanPrompt is required')
  try {
    let status = token.getStatus()
    if (hasStyle) {
      if (!isResponseStyle(fields.responseStyle)) {
        return error(400, 'responseStyle must be off, caveman, or ponytail')
      }
      status = token.setResponseStyle(fields.responseStyle)
    }
    if (hasClean) {
      if (typeof fields.cleanPrompt !== 'boolean') {
        return error(400, 'cleanPrompt must be a boolean')
      }
      status = token.setCleanPrompt(fields.cleanPrompt)
    }
    return mounted(status)
  } catch (err) {
    return error(500, errorMessage(err))
  }
}
