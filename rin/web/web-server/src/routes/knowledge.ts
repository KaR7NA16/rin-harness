/**
 * rin web-server — knowledge routes.
 *
 * Read-only knowledge endpoints (sources/documents/search/stats). Each request
 * opens the database, reads, and closes it afterwards. Returns null for any
 * pathname it does not claim.
 *
 * @module @rin/web-server
 */

import type { KnowledgeService } from '@rin/knowledge'
import type { Config, JsonResponse } from '../types.ts'
import {
  error,
  errorMessage,
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
  _method: string,
  _body: unknown,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse | null> {
  switch (pathname) {
    case '/api/knowledge/sources':
      return knowledgeSourcesRoute(search, services, config)
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
  shape: (service: KnowledgeService) => JsonResponse,
): Promise<JsonResponse> {
  const knowledge = services.knowledge()
  if (knowledge === undefined) return notMounted()
  const dbPath = queryParam(search, 'db') ?? config.knowledgeDbPath
  if (dbPath === undefined) {
    return error(400, 'knowledge database path not configured; pass ?db=')
  }
  let service: KnowledgeService
  try {
    service = knowledge.open(dbPath)
  } catch (err) {
    return error(500, errorMessage(err))
  }
  try {
    return shape(service)
  } finally {
    try {
      service.close()
    } catch {
      // the database handle is already closed; nothing further to release
    }
  }
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
