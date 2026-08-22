/**
 * rin web-server — knowledge-graph routes.
 *
 * Read-only unified graph projection over mounted local providers. All
 * @rin/knowledge-graph imports are type-only, so this module stays
 * runtime-dependency-free. Returns null for any pathname it does not claim.
 *
 * @module @rin/web-server
 */

import type { GraphNodeKind, GraphSource, KnowledgeGraphService } from '@rin/knowledge-graph'
import type { Config, JsonResponse } from '../types.ts'
import { error, errorMessage, mountedValue, notMounted, parsePositiveInt, queryParam } from '../http.ts'
import type { RinServiceRefs } from '../routes.ts'

/** Graph sources accepted by the ?sources= filter. */
const GRAPH_SOURCES: ReadonlySet<GraphSource> = new Set(['notes', 'knowledge', 'repository', 'codegraph', 'session', 'filesystem'])

/** Graph node kinds accepted by the ?kinds= filter. */
const GRAPH_KINDS: ReadonlySet<GraphNodeKind> = new Set(['note', 'tag', 'knowledge_source', 'knowledge_document', 'repository_agent', 'repository_environment', 'repository_package', 'code_file', 'code_symbol', 'session', 'file'])

/** Dispatch the knowledge-graph pathnames; null for anything else. */
export async function handle(
  pathname: string,
  search: string,
  _method: string,
  _body: unknown,
  services: RinServiceRefs,
  _config: Config,
): Promise<JsonResponse | null> {
  switch (pathname) {
    case '/api/knowledge-graph/graph':
      return graphRoute(search, services)
    case '/api/knowledge-graph/related':
      return relatedRoute(search, services)
    default:
      return null
  }
}

/** Resolve the graph service, or the shared notMounted envelope. */
function service(services: RinServiceRefs): KnowledgeGraphService | undefined {
  return services.knowledgeGraph()
}

async function graphRoute(search: string, services: RinServiceRefs): Promise<JsonResponse> {
  const graph = service(services)
  if (graph === undefined) return notMounted()
  const sources = parseList(queryParam(search, 'sources'), GRAPH_SOURCES)
  const kinds = parseList(queryParam(search, 'kinds'), GRAPH_KINDS)
  const pathPrefix = queryParam(search, 'pathPrefix')
  const limit = parsePositiveInt(search, 'limit')
  try {
    return mountedValue('graph', await graph.graph({
      ...(sources === undefined ? {} : { sources }),
      ...(kinds === undefined ? {} : { kinds }),
      ...(pathPrefix === undefined ? {} : { pathPrefix }),
      ...(limit === undefined ? {} : { limit }),
    }))
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function relatedRoute(search: string, services: RinServiceRefs): Promise<JsonResponse> {
  const graph = service(services)
  if (graph === undefined) return notMounted()
  const node = queryParam(search, 'node')
  if (node === undefined) return error(400, 'node is required; pass ?node=<id>')
  const depth = parsePositiveInt(search, 'depth')
  try {
    return mountedValue('graph', await graph.related(node, depth))
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

/** Split a comma-separated query value into known list members, or undefined. */
function parseList<T extends string>(raw: string | undefined, allowed: ReadonlySet<T>): T[] | undefined {
  if (raw === undefined) return undefined
  const items = raw.split(',').map(item => item.trim()).filter(item => item !== '')
  if (items.length === 0) return undefined
  const result: T[] = []
  for (const item of items) {
    if (allowed.has(item as T)) result.push(item as T)
  }
  return result.length === 0 ? undefined : result
}
