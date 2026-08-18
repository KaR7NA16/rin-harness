import { api } from './client'

export type GraphNodeKind =
  | 'note'
  | 'tag'
  | 'knowledge_source'
  | 'knowledge_document'
  | 'repository_agent'
  | 'repository_environment'
  | 'repository_package'
  | 'code_file'
  | 'code_symbol'
  | 'session'
  | 'file'
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
export type GraphSource = 'notes' | 'knowledge' | 'repository' | 'codegraph' | 'session' | 'filesystem'

export type GraphNode = {
  id: string
  kind: GraphNodeKind
  label: string
  path: string | null
  source: GraphSource
  metadata: Record<string, unknown>
  modifiedAt: string | null
}

export type GraphEdge = {
  from: string
  to: string
  kind: GraphEdgeKind
  confidence: number
  provenance: string
}

export type GraphSnapshot = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  refreshedAt: string
}

export type GraphQuery = {
  sources?: GraphSource[]
  kinds?: GraphNodeKind[]
  pathPrefix?: string
  limit?: number
}

export const knowledgeGraphApi = {
  graph: (query: GraphQuery = {}) => {
    const params = new URLSearchParams()
    if (query.sources?.length) params.set('sources', query.sources.join(','))
    if (query.kinds?.length) params.set('kinds', query.kinds.join(','))
    if (query.pathPrefix) params.set('pathPrefix', query.pathPrefix)
    if (query.limit) params.set('limit', String(query.limit))
    const qs = params.toString()
    return api.get<{ mounted: true; graph: GraphSnapshot }>(
      `/api/knowledge-graph/graph${qs ? `?${qs}` : ''}`,
    )
  },

  related: (node: string, depth?: number) => {
    const params = new URLSearchParams({ node })
    if (depth) params.set('depth', String(depth))
    return api.get<{ mounted: true; graph: GraphSnapshot }>(
      `/api/knowledge-graph/related?${params.toString()}`,
    )
  },
}
