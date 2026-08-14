/**
 * rin web-server — prompt-memory routes.
 *
 * Read-only prompt-memory status/file/review-logs endpoints over
 * ctx.promptMemory. Returns null for any pathname it does not claim.
 *
 * @module @rin/web-server
 */

import type { Config, JsonResponse } from '../types.ts'
import {
  error,
  errorMessage,
  mounted,
  mountedValue,
  notMounted,
  parsePositiveInt,
  parsePromptMemoryTarget,
} from '../http.ts'
import type { RinServiceRefs } from '../routes.ts'

/** Dispatch the prompt-memory pathnames; null for anything else. */
export async function handle(
  pathname: string,
  search: string,
  _method: string,
  _body: unknown,
  services: RinServiceRefs,
  _config: Config,
): Promise<JsonResponse | null> {
  switch (pathname) {
    case '/api/prompt-memory/status':
      return promptMemoryStatusRoute(services)
    case '/api/prompt-memory/file':
      return promptMemoryFileRoute(search, services)
    case '/api/prompt-memory/review-logs':
      return promptMemoryReviewLogsRoute(search, services)
    default:
      return null
  }
}

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
