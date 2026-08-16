import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { indexProject } from '../src/indexer.ts'
import { getCodeGraphVisualization, getCodeGraphArchitecture } from '../src/analysis.ts'

const root = await mkdtemp(join(tmpdir(), 'rin-codegraph-'))
try {
  const aSource = 'export function helper(x: string): string {\n  return x + "!"\n}\n'
  const bSource = 'import { helper } from "./a"\nexport function main(): string {\n  return helper("hi")\n}\n'
  await writeFile(join(root, 'a.ts'), aSource, 'utf8')
  await writeFile(join(root, 'b.ts'), bSource, 'utf8')

  const result = await indexProject(root)
  if (result.fileCount !== 2) throw new Error(`expected 2 indexed files, got ${result.fileCount}`)
  if (result.nodeCount < 2) throw new Error(`expected definition nodes, got ${result.nodeCount}`)
  if (result.edgeCount < 1) throw new Error(`expected at least one call edge, got ${result.edgeCount}`)

  const dbPath = join(root, '.codegraph', 'codegraph.db')
  const vis = getCodeGraphVisualization(dbPath, 120)
  if (vis.nodes.length < 2) throw new Error(`expected visible graph nodes, got ${vis.nodes.length}`)
  if (vis.edges.length < 1) throw new Error(`expected visible graph edges, got ${vis.edges.length}`)
  if (vis.architecture.availableNodeCount < 2) throw new Error('architecture should report nodes')

  const arch = getCodeGraphArchitecture(dbPath)
  if (arch.architecture.analyzedEdgeCount < 1) throw new Error('architecture should analyze edges')

  console.log('CODEGRAPH-SMOKE-OK', JSON.stringify({ fileCount: result.fileCount, nodeCount: result.nodeCount, edgeCount: result.edgeCount, errorFileCount: result.errorFileCount, visNodes: vis.nodes.length, visEdges: vis.edges.length }))
} finally {
  await rm(root, { recursive: true, force: true })
}
