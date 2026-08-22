/**
 * rin knowledge-graph — domain model.
 *
 * Graph nodes and edges are stable projections of local entities. Every
 * provider owns its node-id namespace and never writes back to source stores.
 *
 * @module @rin/knowledge-graph
 */

export const GRAPH_SOURCES = ['notes', 'knowledge', 'repository', 'codegraph', 'session', 'filesystem'] as const
export type GraphSource = typeof GRAPH_SOURCES[number]

export const GRAPH_NODE_KINDS = [
  'note',
  'tag',
  'knowledge_source',
  'knowledge_document',
  'repository_agent',
  'repository_environment',
  'repository_package',
  'code_file',
  'code_symbol',
  'session',
  'file',
] as const
export type GraphNodeKind = typeof GRAPH_NODE_KINDS[number]

export type GraphEdgeKind =
  | 'wikilink'
  | 'tag'
  | 'contains'
  | 'cites'
  | 'uses'
  | 'depends_on'
  | 'defined_in'
  | 'code_ref'
  | 'mentions'
  | 'derived_from'
  | 'child'

export interface GraphNode {
  id: string
  kind: GraphNodeKind
  label: string
  path: string | null
  source: GraphSource
  metadata: Record<string, unknown>
  modifiedAt: string | null
}

export interface GraphEdge {
  from: string
  to: string
  kind: GraphEdgeKind
  confidence: number
  provenance: string
}

export interface GraphQuery {
  sources?: GraphSource[]
  kinds?: GraphNodeKind[]
  pathPrefix?: string
  limit?: number
}

export interface GraphSnapshot {
  nodes: GraphNode[]
  edges: GraphEdge[]
  refreshedAt: string
}
