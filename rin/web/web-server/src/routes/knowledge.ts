/**
 * rin web-server — knowledge routes.
 *
 * Read and write knowledge endpoints: list/register/remove/reindex sources,
 * list documents, search, and aggregate stats. Each request opens the database,
 * runs, and closes it afterwards. Returns null for any pathname it does not
 * claim.
 *
 * @module @rin/web-server
 */

import { dirname } from 'node:path'
import type { KnowledgeService } from '@rin/knowledge'
import type { Config, JsonResponse } from '../types.ts'
import {
  asRecord,
  error,
  errorMessage,
  isPathWithin,
  json,
  mounted,
  mountedValue,
  notMounted,
  parsePositiveInt,
  queryParam,
} from '../http.ts'
import type { RinServiceRefs } from '../routes.ts'

/** Dispatch the knowledge pathnames; null for anything else. */
export async function handle(
  pathname: string,
  search: string,
  method: string,
  body: unknown,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse | null> {
  const reindexMatch = /^\/api\/knowledge\/sources\/([^/]+)\/reindex$/.exec(pathname)
  if (reindexMatch !== null && reindexMatch[1] !== undefined) {
    return knowledgeReindexSourceRoute(reindexMatch[1], method, search, services, config)
  }
  const sourceMatch = /^\/api\/knowledge\/sources\/([^/]+)$/.exec(pathname)
  if (sourceMatch !== null && sourceMatch[1] !== undefined) {
    return knowledgeRemoveSourceRoute(sourceMatch[1], method, search, services, config)
  }

  switch (pathname) {
    case '/api/knowledge/sources':
      if (method === 'POST') return knowledgeAddSourcesRoute(method, body, search, services, config)
      if (method === 'GET' || method === 'HEAD') return knowledgeSourcesRoute(search, services, config)
      return error(405, 'method not allowed; GET or POST /api/knowledge/sources')
    case '/api/knowledge/documents':
      return knowledgeDocumentsRoute(search, services, config)
    case '/api/knowledge/search':
      return knowledgeSearchRoute(search, services, config)
    case '/api/knowledge/stats':
      return knowledgeStatsRoute(search, services, config)
    default:
      return null
  }
}

async function withKnowledge(
  search: string,
  services: RinServiceRefs,
  config: Config,
  shape: (service: KnowledgeService) => JsonResponse | Promise<JsonResponse>,
): Promise<JsonResponse> {
  const knowledge = services.knowledge()
  if (knowledge === undefined) return notMounted()
  const resolved = resolveKnowledgeDbPath(search, config)
  if (!resolved.ok) return error(400, resolved.message)
  let service: KnowledgeService
  try {
    service = knowledge.open(resolved.dbPath)
  } catch (err) {
    return error(500, errorMessage(err))
  }
  try {
    return await shape(service)
  } finally {
    try {
      service.close()
    } catch {
      // the database handle is already closed; nothing further to release
    }
  }
}

/**
 * Resolve the knowledge database path for one request, containing a ?db=
 * override within the configured knowledge database directory.
 * @param search - the URL query string.
 * @param config - the resolved web-server configuration.
 * @returns the resolved path, or an error message to reject the request.
 */
function resolveKnowledgeDbPath(
  search: string,
  config: Config,
): { ok: true; dbPath: string } | { ok: false; message: string } {
  const override = queryParam(search, 'db')
  if (override === undefined) {
    if (config.knowledgeDbPath === undefined) {
      return { ok: false, message: 'knowledge database path not configured; pass ?db=' }
    }
    return { ok: true, dbPath: config.knowledgeDbPath }
  }
  if (config.knowledgeDbPath === undefined) {
    return { ok: false, message: 'knowledge database path override requires a configured knowledgeDbPath' }
  }
  if (!isPathWithin(dirname(config.knowledgeDbPath), override)) {
    return { ok: false, message: 'knowledge database path must stay within the configured knowledge directory' }
  }
  return { ok: true, dbPath: override }
}

function knowledgeSourcesRoute(
  search: string,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse> {
  return withKnowledge(search, services, config, (service) =>
    mountedValue('sources', service.listSources()))
}

function knowledgeDocumentsRoute(
  search: string,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse> {
  return withKnowledge(search, services, config, (service) => {
    const sourceId = queryParam(search, 'sourceId')
    const limit = parsePositiveInt(search, 'limit')
    return mountedValue('documents', service.listDocuments({
      ...(sourceId === undefined ? {} : { sourceId }),
      ...(limit === undefined ? {} : { limit }),
    }))
  })
}

function knowledgeSearchRoute(
  search: string,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse> {
  return withKnowledge(search, services, config, (service) => {
    const query = queryParam(search, 'query')
    if (query === undefined) return error(400, 'query is required; pass ?query=')
    const limit = parsePositiveInt(search, 'limit')
    return mountedValue('results', service.search(query, {
      ...(limit === undefined ? {} : { limit }),
    }))
  })
}

function knowledgeStatsRoute(
  search: string,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse> {
  return withKnowledge(search, services, config, (service) =>
    mounted(service.getStats()))
}

async function knowledgeAddSourcesRoute(
  method: string,
  body: unknown,
  search: string,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse> {
  if (method !== 'POST') return error(405, 'method not allowed; POST /api/knowledge/sources')
  const fields = asRecord(body)
  if (fields === undefined) return error(400, 'request body must be a JSON object')
  const paths = parseSourcePaths(fields.paths)
  if (paths === undefined) return error(400, 'paths is required and must be a non-empty array of strings')
  const allowedRoots = config.knowledgeSourcesRoots
  if (allowedRoots === undefined || allowedRoots.length === 0) {
    return error(400, 'knowledge sources root is not configured; set Config.knowledgeSourcesRoots')
  }
  return withKnowledge(search, services, config, async (service) => {
    try {
      return json(200, await service.addSources(paths, { allowedRoots }))
    } catch (err) {
      return error(500, errorMessage(err))
    }
  })
}

async function knowledgeRemoveSourceRoute(
  rawId: string,
  method: string,
  search: string,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse> {
  if (method !== 'DELETE') return error(405, 'method not allowed; DELETE /api/knowledge/sources/{id}')
  const id = decodeSourceId(rawId)
  if (id === undefined) return error(400, 'invalid knowledge source id')
  return withKnowledge(search, services, config, (service) =>
    json(200, { removed: service.removeSource(id) }))
}

async function knowledgeReindexSourceRoute(
  rawId: string,
  method: string,
  search: string,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse> {
  if (method !== 'POST') return error(405, 'method not allowed; POST /api/knowledge/sources/{id}/reindex')
  const id = decodeSourceId(rawId)
  if (id === undefined) return error(400, 'invalid knowledge source id')
  return withKnowledge(search, services, config, async (service) => {
    try {
      return json(200, await service.reindexSource(id))
    } catch (err) {
      return error(500, errorMessage(err))
    }
  })
}

/** Decode a URL-encoded knowledge source id, or undefined when malformed. */
function decodeSourceId(rawId: string): string | undefined {
  try {
    return decodeURIComponent(rawId)
  } catch {
    return undefined
  }
}

/** Read a non-empty array of non-empty strings, or undefined when invalid. */
function parseSourcePaths(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const paths: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '') return undefined
    paths.push(item)
  }
  return paths
}
