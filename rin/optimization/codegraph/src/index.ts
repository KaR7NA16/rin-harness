/**
 * rin codegraph — Cordis plugin entry.
 *
 * Exposes a ctx.codegraph service that reads a per-project SQLite code graph
 * and derives ranked visualization, architecture summary, and aggregate stats.
 * The indexer that BUILDS the graph is a separate concern (web-tree-sitter);
 * this package owns the read/analysis side, ported from cyberpsychosis.
 *
 * @module @rin/codegraph
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { getCodeGraphArchitecture, getCodeGraphVisualization, formatCodeGraphArchitecture } from './analysis.ts'
import type { CodeGraphArchitecture, CodeGraphVisualization } from './analysis.ts'
import { openCodeGraphDatabaseForRead } from './db.ts'

export type * from './analysis.ts'
export { confidenceForProvenance, formatCodeGraphArchitecture, getCodeGraphArchitecture, getCodeGraphVisualization } from './analysis.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    codegraph: CodeGraphService
  }
}

/** Aggregate graph stats read from the SQLite database. */
export interface CodeGraphStats {
  fileCount: number
  nodeCount: number
  edgeCount: number
  lastUpdated: number | null
  state: 'ready' | 'empty' | 'missing'
}

/** The code-graph service exposed on the shared context. */
export abstract class CodeGraphService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'codegraph')
  }

  abstract visualization(projectPath: string, limit?: number): CodeGraphVisualization
  abstract architecture(projectPath: string): { architecture: CodeGraphArchitecture; text: string }
  abstract status(projectPath: string): CodeGraphStats
}

/** File-backed implementation reading a project's .codegraph/codegraph.db. */
export class FileCodeGraphService extends CodeGraphService {
  private dbPath(projectPath: string): string {
    return join(projectPath, '.codegraph', 'codegraph.db')
  }

  override visualization(projectPath: string, limit = 120) {
    return getCodeGraphVisualization(this.dbPath(projectPath), limit)
  }

  override architecture(projectPath: string) {
    const graph = getCodeGraphArchitecture(this.dbPath(projectPath))
    return { architecture: graph.architecture, text: formatCodeGraphArchitecture(graph) }
  }

  override status(projectPath: string): CodeGraphStats {
    const dbPath = this.dbPath(projectPath)
    if (!existsSync(dbPath)) return { fileCount: 0, nodeCount: 0, edgeCount: 0, lastUpdated: null, state: 'missing' }
    try {
      const db = openCodeGraphDatabaseForRead(dbPath)
      try {
        const row = db.query('SELECT (SELECT COUNT(*) FROM files) AS file_count, (SELECT COUNT(*) FROM nodes) AS node_count, (SELECT COUNT(*) FROM edges) AS edge_count, (SELECT MAX(indexed_at) FROM files) AS last_updated').get() as { file_count?: unknown; node_count?: unknown; edge_count?: unknown; last_updated?: unknown } | undefined
        const nodeCount = Number(row?.node_count ?? 0)
        return { fileCount: Number(row?.file_count ?? 0), nodeCount, edgeCount: Number(row?.edge_count ?? 0), lastUpdated: row?.last_updated == null ? null : Number(row.last_updated), state: nodeCount > 0 ? 'ready' : 'empty' }
      } finally {
        db.close()
      }
    } catch {
      return { fileCount: 0, nodeCount: 0, edgeCount: 0, lastUpdated: null, state: 'empty' }
    }
  }
}

export const name = 'codegraph'
export const inject: string[] = []

/** Install the file-backed code-graph service into the shared context. */
export function apply(ctx: Context): void {
  ctx.plugin(FileCodeGraphService)
}
