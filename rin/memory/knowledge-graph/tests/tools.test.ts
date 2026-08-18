import { describe, expect, test } from 'vitest'
import { clampDepth, clampSearchLimit, graphNeighborhood, searchAtlasNodes } from '../src/tools.ts'
import type { GraphSnapshot } from '../src/types.ts'

const snapshot: GraphSnapshot = {
  refreshedAt: '2026-01-01T00:00:00.000Z',
  nodes: [
    { id: 'note:a.md', kind: 'note', label: 'Alpha', path: 'a.md', source: 'notes', metadata: {}, modifiedAt: null },
    { id: 'note:b.md', kind: 'note', label: 'Beta', path: 'b.md', source: 'notes', metadata: {}, modifiedAt: null },
    { id: 'tag:alpha', kind: 'tag', label: 'alpha', path: null, source: 'notes', metadata: {}, modifiedAt: null },
    { id: 'repository_agent:rin-base', kind: 'repository_agent', label: 'rin-base', path: 'agents/rin-base.agent.yaml', source: 'repository', metadata: {}, modifiedAt: null },
  ],
  edges: [
    { from: 'note:a.md', to: 'note:b.md', kind: 'wikilink', confidence: 1, provenance: 't' },
    { from: 'note:a.md', to: 'tag:alpha', kind: 'tag', confidence: 1, provenance: 't' },
  ],
}

describe('atlas tool limits', () => {
  test('clamps the search limit into [1, 30] with a default of 10', () => {
    expect(clampSearchLimit(undefined)).toBe(10)
    expect(clampSearchLimit(0)).toBe(1)
    expect(clampSearchLimit(999)).toBe(30)
    expect(clampSearchLimit(5.9)).toBe(5)
  })

  test('clamps the graph depth into [1, 3] with a default of 1', () => {
    expect(clampDepth(undefined)).toBe(1)
    expect(clampDepth(0)).toBe(1)
    expect(clampDepth(9)).toBe(3)
  })
})

describe('searchAtlasNodes', () => {
  test('matches by label, path, or id and attaches matched neighbors', () => {
    const hits = searchAtlasNodes(snapshot, 'alpha', 10)
    expect(hits.map(hit => hit.id)).toEqual(['note:a.md', 'tag:alpha'])
    const noteHit = hits.find(hit => hit.id === 'note:a.md')!
    // Only neighbors inside the matched set are attached (tag:alpha, not note:b.md).
    expect(noteHit.neighbors.map(neighbor => neighbor.id)).toEqual(['tag:alpha'])
    expect(noteHit.path).toBe('a.md')
  })

  test('limits hits and returns an empty list for a blank query', () => {
    expect(searchAtlasNodes(snapshot, 'a', 1)).toHaveLength(1)
    expect(searchAtlasNodes(snapshot, '   ', 10)).toEqual([])
  })
})

describe('graphNeighborhood', () => {
  test('returns a node with its incident neighbors and edge kinds', () => {
    const value = graphNeighborhood(snapshot, 'note:a.md')
    if ('error' in value) throw new Error(value.error)
    expect(value.node.label).toBe('Alpha')
    expect(value.related).toEqual([
      { id: 'note:b.md', kind: 'note', label: 'Beta', path: 'b.md', source: 'notes', edgeKind: 'wikilink' },
      { id: 'tag:alpha', kind: 'tag', label: 'alpha', path: '', source: 'notes', edgeKind: 'tag' },
    ])
  })

  test('reports an explicit error for an unknown node', () => {
    const value = graphNeighborhood(snapshot, 'note:missing.md')
    expect(value).toEqual({ error: 'graph node not found: note:missing.md' })
  })
})
