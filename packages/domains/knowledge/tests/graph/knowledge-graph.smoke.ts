/**
 * knowledge-graph strip-types smoke: no Cordis imports.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { notesGraphRows } from '../../src/graph/providers.ts'
import { KnowledgeGraphStore } from '../../src/graph/store.ts'

const root = mkdtempSync(join(tmpdir(), 'rin-kgraph-smoke-'))
try {
  const rows = notesGraphRows([{
    path: 'a.md',
    name: 'a',
    folder: '',
    title: 'A',
    sizeBytes: 1,
    modifiedAt: '2026-01-01T00:00:00.000Z',
    tags: ['smoke'],
    links: [],
  }], { nodes: [], edges: [] })

  const store = new KnowledgeGraphStore(join(root, 'graph.db'))
  store.replaceProvider('notes', rows.nodes, rows.edges)
  const graph = store.query({ sources: ['notes'] })
  if (graph.nodes.length !== 2 || graph.edges.length !== 1) {
    throw new Error(`unexpected graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges`)
  }
  console.log('KNOWLEDGE-GRAPH-SMOKE-OK', graph.nodes.length, graph.edges.length)
} finally {
  rmSync(root, { recursive: true, force: true })
}
