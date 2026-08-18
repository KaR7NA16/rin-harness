import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { KnowledgeGraphStore } from '../src/store.ts'
import type { GraphNode } from '../src/types.ts'

const cleanups: string[] = []
afterEach(() => {
  for (const path of cleanups.splice(0)) rmSync(path, { recursive: true, force: true })
})

function makeStore(): KnowledgeGraphStore {
  const root = mkdtempSync(join(tmpdir(), 'rin-kgraph-'))
  cleanups.push(root)
  return new KnowledgeGraphStore(join(root, 'graph.db'))
}

const nodes: GraphNode[] = [
  { id: 'note:a.md', kind: 'note', label: 'A', path: 'a.md', source: 'notes', metadata: {}, modifiedAt: null },
  { id: 'note:b.md', kind: 'note', label: 'B', path: 'b.md', source: 'notes', metadata: {}, modifiedAt: null },
]

describe('KnowledgeGraphStore', () => {
  test('replaces provider rows and queries filtered graphs', () => {
    const store = makeStore()
    store.replaceProvider('notes', nodes, [{ from: 'note:a.md', to: 'note:b.md', kind: 'wikilink', confidence: 1, provenance: 'test' }])

    const graph = store.query({ sources: ['notes'] })
    expect(graph.nodes.map(node => node.id)).toEqual(['note:a.md', 'note:b.md'])
    expect(graph.edges).toHaveLength(1)

    store.replaceProvider('notes', [nodes[0]!], [])
    expect(store.query({ sources: ['notes'] }).nodes).toEqual([nodes[0]])
  })

  test('related expands neighbours by depth', () => {
    const store = makeStore()
    store.replaceProvider('notes', nodes, [
      { from: 'note:a.md', to: 'note:b.md', kind: 'wikilink', confidence: 1, provenance: 'test' },
    ])

    const related = store.related('note:a.md', 1)
    expect(related.nodes.map(node => node.id).sort()).toEqual(['note:a.md', 'note:b.md'])
    expect(related.edges).toHaveLength(1)
  })
})
