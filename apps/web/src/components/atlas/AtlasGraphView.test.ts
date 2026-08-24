import { describe, expect, it } from 'vitest'
import type { GraphEdge, GraphNode } from '../../api/knowledgeGraph'
import { layoutAtlasGraph } from './AtlasGraphView'

function node(overrides: Partial<GraphNode> & Pick<GraphNode, 'id' | 'kind'>): GraphNode {
  return {
    label: overrides.id,
    path: null,
    source: 'notes',
    metadata: {},
    modifiedAt: null,
    ...overrides,
  }
}

describe('layoutAtlasGraph', () => {
  it('returns an empty layout for an empty node set', () => {
    expect(layoutAtlasGraph([], [])).toEqual([])
  })

  it('places one cluster per kind and keeps every node', () => {
    const nodes = [
      node({ id: 'note:a', kind: 'note' }),
      node({ id: 'note:b', kind: 'note' }),
      node({ id: 'tag:project', kind: 'tag' }),
      node({ id: 'knowledge_source:s1', kind: 'knowledge_source' }),
    ]
    const layout = layoutAtlasGraph(nodes, [], 900, 620)
    expect(layout).toHaveLength(4)
    expect(layout.map((n) => n.id).sort()).toEqual(['note:a', 'note:b', 'tag:project', 'knowledge_source:s1'].sort())
  })

  it('scales node radius with degree', () => {
    const nodes = [
      node({ id: 'hub', kind: 'note' }),
      node({ id: 'a', kind: 'note' }),
      node({ id: 'b', kind: 'note' }),
      node({ id: 'c', kind: 'note' }),
    ]
    const edges: GraphEdge[] = [
      { from: 'hub', to: 'a', kind: 'wikilink', confidence: 1, provenance: 't' },
      { from: 'hub', to: 'b', kind: 'wikilink', confidence: 1, provenance: 't' },
      { from: 'hub', to: 'c', kind: 'wikilink', confidence: 1, provenance: 't' },
    ]
    const layout = layoutAtlasGraph(nodes, edges, 900, 620)
    const hub = layout.find((n) => n.id === 'hub')!
    const leaf = layout.find((n) => n.id === 'a')!
    expect(hub.radius).toBeGreaterThan(leaf.radius)
  })
  it('supports a stable grid layout', () => {
    const layout = layoutAtlasGraph([
      node({ id: 'a', kind: 'note' }),
      node({ id: 'b', kind: 'note' }),
      node({ id: 'c', kind: 'note' }),
      node({ id: 'd', kind: 'note' }),
    ], [], 400, 200, 'grid')
    expect(layout.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 100, y: 50 }, { x: 300, y: 50 }, { x: 100, y: 150 }, { x: 300, y: 150 },
    ])
  })
})
