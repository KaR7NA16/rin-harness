/**
 * rin knowledge-graph — model-visible tool logic.
 *
 * Pure operations behind the `atlas_search` and `atlas_graph` tools. The
 * snapshot-filtering functions are pure (testable without Cordis); the
 * service-facing functions refresh the graph and delegate. The
 * `KnowledgeGraphService` import is type-only, so the strip-types smoke test
 * can exercise the pure half without the Cordis import graph.
 *
 * @module @rin/knowledge-graph
 */

import type { KnowledgeGraphService } from './index.ts'
import type { GraphNodeKind, GraphSnapshot, GraphSource } from './types.ts'

/** Result count returned by `atlas_search` when the model omits `limit`. */
export const ATLAS_SEARCH_LIMIT_DEFAULT = 10

/** Hard cap on `atlas_search` results. */
export const ATLAS_SEARCH_LIMIT_MAX = 30

/** Hard cap on `atlas_graph` neighborhood depth. */
export const ATLAS_GRAPH_DEPTH_MAX = 3

const QUERY_ERROR = 'query is required and must not be blank'
const NODE_ERROR = 'node is required; pass a graph node id'
const UNAVAILABLE_ERROR = 'the knowledge-graph service is unavailable'

/** One model-facing atlas search hit with its matched neighbors. */
export interface AtlasSearchHit {
  id: string
  kind: string
  label: string
  /** Source path, or an empty string when the entity has no file path. */
  path: string
  source: string
  neighbors: Array<{ id: string; kind: string; label: string }>
}

/** One model-facing graph node. */
export interface AtlasGraphNode {
  id: string
  kind: string
  label: string
  /** Source path, or an empty string when the entity has no file path. */
  path: string
  source: string
}

/** Canonical `atlas_search` value: hits or an explicit error. */
export type AtlasSearchValue =
  | { results: AtlasSearchHit[] }
  | { error: string }

/** Canonical `atlas_graph` value: the node plus its neighbors, or an error. */
export type AtlasGraphValue =
  | { node: AtlasGraphNode; related: Array<AtlasGraphNode & { edgeKind: string }> }
  | { error: string }

/** Clamp a model-supplied result limit into the tool's bounds. */
export function clampSearchLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return ATLAS_SEARCH_LIMIT_DEFAULT
  return Math.min(ATLAS_SEARCH_LIMIT_MAX, Math.max(1, Math.floor(limit)))
}

/** Clamp a model-supplied depth into [1, ATLAS_GRAPH_DEPTH_MAX]. */
export function clampDepth(depth: number | undefined): number {
  if (depth === undefined || !Number.isFinite(depth)) return 1
  return Math.min(ATLAS_GRAPH_DEPTH_MAX, Math.max(1, Math.floor(depth)))
}

/**
 * Filter a graph snapshot by free text (label, path, or id) and attach each
 * hit's matched neighbors.
 * @param snapshot - the graph snapshot.
 * @param query - the free-text query.
 * @param limit - the maximum hit count.
 * @returns the ranked hits, each with up to 8 matched neighbors.
 */
export function searchAtlasNodes(snapshot: GraphSnapshot, query: string, limit: number): AtlasSearchHit[] {
  const normalized = query.trim().toLowerCase()
  if (normalized === '') return []
  const matched = snapshot.nodes
    .filter(node =>
      node.label.toLowerCase().includes(normalized)
      || (node.path !== null && node.path.toLowerCase().includes(normalized))
      || node.id.toLowerCase().includes(normalized))
    .slice(0, limit)
  const matchedIds = new Set(matched.map(node => node.id))
  const nodeById = new Map(snapshot.nodes.map(node => [node.id, node]))
  return matched.map(node => ({
    id: node.id,
    kind: node.kind,
    label: node.label,
    path: node.path ?? '',
    source: node.source,
    neighbors: snapshot.edges
      .filter(edge => edge.from === node.id || edge.to === node.id)
      .map(edge => (edge.from === node.id ? edge.to : edge.from))
      .filter(id => matchedIds.has(id))
      .map(id => nodeById.get(id))
      .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
      .slice(0, 8)
      .map(neighbor => ({ id: neighbor.id, kind: neighbor.kind, label: neighbor.label })),
  }))
}

/**
 * Return one node plus its incident neighbors from a snapshot.
 * @param snapshot - the graph snapshot (already a neighborhood query).
 * @param nodeId - the node id to describe.
 * @returns the node and its neighbors, or an explicit error when unknown.
 */
export function graphNeighborhood(
  snapshot: GraphSnapshot,
  nodeId: string,
): { node: AtlasGraphNode; related: Array<AtlasGraphNode & { edgeKind: string }> } | { error: string } {
  const node = snapshot.nodes.find(candidate => candidate.id === nodeId)
  if (node === undefined) return { error: `graph node not found: ${nodeId}` }
  const nodeById = new Map(snapshot.nodes.map(candidate => [candidate.id, candidate]))
  const related = snapshot.edges
    .filter(edge => edge.from === nodeId || edge.to === nodeId)
    .map(edge => {
      const otherId = edge.from === nodeId ? edge.to : edge.from
      const other = nodeById.get(otherId)
      return other === undefined
        ? null
        : { id: other.id, kind: other.kind, label: other.label, path: other.path ?? '', source: other.source, edgeKind: edge.kind }
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
  return {
    node: { id: node.id, kind: node.kind, label: node.label, path: node.path ?? '', source: node.source },
    related,
  }
}

/** Search the unified graph by free text and return hits with neighbors. */
export async function searchAtlas(
  service: KnowledgeGraphService,
  args: { query: string; sources?: string; kinds?: string; limit?: number },
): Promise<AtlasSearchValue> {
  const query = args.query.trim()
  if (query === '') return { error: QUERY_ERROR }
  const sources = parseFilter(args.sources, VALID_SOURCES)
  const kinds = parseFilter(args.kinds, VALID_KINDS)
  const limit = clampSearchLimit(args.limit)
  const snapshot = await service.graph({
    ...(sources.length > 0 ? { sources } : {}),
    ...(kinds.length > 0 ? { kinds } : {}),
    limit: 2000,
  })
  return { results: searchAtlasNodes(snapshot, query, limit) }
}

/** Return one graph node's neighborhood. */
export async function atlasGraph(
  service: KnowledgeGraphService,
  args: { node: string; depth?: number },
): Promise<AtlasGraphValue> {
  const node = args.node.trim()
  if (node === '') return { error: NODE_ERROR }
  const snapshot = await service.related(node, clampDepth(args.depth))
  return graphNeighborhood(snapshot, node)
}

const VALID_SOURCES = new Set<GraphSource>(['notes', 'knowledge', 'repository', 'codegraph', 'session'])

const VALID_KINDS = new Set<GraphNodeKind>([
  'note', 'tag', 'knowledge_source', 'knowledge_document',
  'repository_agent', 'repository_environment', 'repository_package',
  'code_file', 'code_symbol', 'session',
])

/** Parse a comma-separated filter into known members, or an empty list. */
function parseFilter<T extends string>(raw: string | undefined, allowed: ReadonlySet<T>): T[] {
  if (raw === undefined) return []
  return raw.split(',').map(item => item.trim()).filter((item): item is T => allowed.has(item as T))
}

export { UNAVAILABLE_ERROR }
