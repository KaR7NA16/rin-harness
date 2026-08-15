/**
 * rin web-server — prompt-memory routes.
 *
 * Read + write prompt-memory endpoints over ctx.promptMemory: the legacy
 * status/file/review-logs surface plus the write paths the desktop frontend
 * calls (config PATCH and entry mutations). Returns null for any pathname it
 * does not claim.
 *
 * @module @rin/web-server
 */

import type { Config, JsonResponse } from '../types.ts'
import {
  asRecord,
  booleanField,
  error,
  errorMessage,
  json,
  mounted,
  mountedValue,
  notMounted,
  parsePositiveInt,
  parsePromptMemoryTarget,
  stringField,
} from '../http.ts'
import type { RinServiceRefs } from '../routes.ts'

/**
 * Entry-mutation path. The target is brief or user only: SOUL.md is an
 * identity file written explicitly, never mutated as entries.
 */
const PROMPT_MEMORY_ENTRIES_RE = /^\/api\/prompt-memory\/(brief|user)\/entries$/

/** Dispatch the prompt-memory pathnames; null for anything else. */
export async function handle(
  pathname: string,
  search: string,
  method: string,
  body: unknown,
  services: RinServiceRefs,
  _config: Config,
): Promise<JsonResponse | null> {
  if (pathname === '/api/prompt-memory/config') {
    return promptMemoryConfigRoute(method, body, services)
  }
  const entriesMatch = PROMPT_MEMORY_ENTRIES_RE.exec(pathname)
  if (entriesMatch !== null && entriesMatch[1] !== undefined) {
    return promptMemoryEntriesRoute(entriesMatch[1], method, body, services)
  }
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

/** PATCH /api/prompt-memory/config — update injectEvolutionMemory and echo the config. */
async function promptMemoryConfigRoute(
  method: string,
  body: unknown,
  services: RinServiceRefs,
): Promise<JsonResponse> {
  const promptMemory = services.promptMemory()
  if (promptMemory === undefined) return notMounted()
  if (method !== 'PATCH') return error(405, 'method not allowed')
  const fields = asRecord(body)
  const injectEvolutionMemory = fields === undefined
    ? undefined
    : booleanField(fields, 'injectEvolutionMemory')
  if (injectEvolutionMemory === undefined) {
    return error(400, 'injectEvolutionMemory is required and must be a boolean')
  }
  try {
    return json(200, await promptMemory.updateConfig({ injectEvolutionMemory }))
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

/** POST /api/prompt-memory/:target/entries — add/replace/remove one entry by action. */
async function promptMemoryEntriesRoute(
  target: string,
  method: string,
  body: unknown,
  services: RinServiceRefs,
): Promise<JsonResponse> {
  const promptMemory = services.promptMemory()
  if (promptMemory === undefined) return notMounted()
  if (method !== 'POST') return error(405, 'method not allowed')
  const entryTarget = target as 'brief' | 'user'
  const fields = asRecord(body)
  const action = fields === undefined ? undefined : stringField(fields, 'action')
  const oldText = fields === undefined ? undefined : stringField(fields, 'oldText')
  const content = fields === undefined ? undefined : stringField(fields, 'content')

  if (action === 'add') {
    if (content === undefined) return error(400, 'content is required for add')
    try {
      return json(200, await promptMemory.addEntry(entryTarget, content))
    } catch (err) {
      return error(500, errorMessage(err))
    }
  }
  if (action === 'replace') {
    if (oldText === undefined) return error(400, 'oldText is required for replace')
    if (content === undefined) return error(400, 'content is required for replace')
    try {
      return json(200, await promptMemory.replaceEntry(entryTarget, oldText, content))
    } catch (err) {
      return error(500, errorMessage(err))
    }
  }
  if (action === 'remove') {
    if (oldText === undefined) return error(400, 'oldText is required for remove')
    try {
      return json(200, await promptMemory.removeEntry(entryTarget, oldText))
    } catch (err) {
      return error(500, errorMessage(err))
    }
  }
  return error(400, "action must be 'add', 'replace', or 'remove'")
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
