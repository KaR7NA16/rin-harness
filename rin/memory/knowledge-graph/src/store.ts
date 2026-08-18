/**
 * rin knowledge-graph — SQLite projection store.
 *
 * The store is a derived cache: providers replace their own node/edge set
 * atomically and queries never write back to source stores.
 *
 * @module @rin/knowledge-graph
 */

import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { GraphEdge, GraphNode, GraphQuery, GraphSnapshot } from './types.ts'

type NodeRow = {
  id: string
  kind: GraphNode['kind']
  label: string
  path: string | null
  source: GraphNode['source']
  metadata_json: string
  modified_at: string | null
}

type EdgeRow = {
  from_id: string
  to_id: string
  kind: GraphEdge['kind']
  confidence: number
  provenance: string
}

/** SQLite-backed graph projection. */
export class KnowledgeGraphStore {
  private readonly dbPath: string

  /** @param dbPath - absolute database path, created on demand. */
  constructor(dbPath: string) {
    this.dbPath = dbPath
  }

  private openDb(): DatabaseSync {
    mkdirSync(dirname(this.dbPath), { recursive: true })
    const db = new DatabaseSync(this.dbPath)
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = NORMAL')
    ensureGraphSchema(db)
    return db
  }

  /** Replace one provider's projection atomically. */
  replaceProvider(source: GraphNode['source'], nodes: readonly GraphNode[], edges: readonly GraphEdge[]): void {
    const db = this.openDb()
    try {
      db.exec('BEGIN')
      try {
        const oldIds = db.prepare('SELECT id FROM graph_nodes WHERE source = ?').all(source) as Array<{ id: string }>
        const ids = oldIds.map(row => row.id)
        if (ids.length > 0) {
          const placeholders = ids.map(() => '?').join(',')
          db.prepare(`DELETE FROM graph_edges WHERE from_id IN (${placeholders}) OR to_id IN (${placeholders})`).run(...ids, ...ids)
          db.prepare(`DELETE FROM graph_nodes WHERE source = ?`).run(source)
        }
        const insertNode = db.prepare(`
          INSERT INTO graph_nodes(id, kind, label, path, source, metadata_json, modified_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        const insertEdge = db.prepare(`
          INSERT INTO graph_edges(from_id, to_id, kind, confidence, provenance)
          VALUES (?, ?, ?, ?, ?)
        `)
        for (const node of nodes) {
          insertNode.run(node.id, node.kind, node.label, node.path, node.source, JSON.stringify(node.metadata), node.modifiedAt)
        }
        for (const edge of edges) insertEdge.run(edge.from, edge.to, edge.kind, edge.confidence, edge.provenance)
        db.exec('COMMIT')
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
    } finally {
      db.close()
    }
  }

  /** Return filtered nodes and their incident edges. */
  query(query: GraphQuery = {}): GraphSnapshot {
    const db = this.openDb()
    try {
      const conditions: string[] = []
      const params: string[] = []
      if (query.sources && query.sources.length > 0) {
        conditions.push(`source IN (${query.sources.map(() => '?').join(',')})`)
        params.push(...query.sources)
      }
      if (query.kinds && query.kinds.length > 0) {
        conditions.push(`kind IN (${query.kinds.map(() => '?').join(',')})`)
        params.push(...query.kinds)
      }
      if (query.pathPrefix) {
        conditions.push(`path LIKE ?`)
        params.push(`${query.pathPrefix}%`)
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
      const limit = Math.min(Math.max(Math.trunc(query.limit ?? 500), 1), 2000)
      const rows = db.prepare(`
        SELECT * FROM graph_nodes ${where} ORDER BY kind, label COLLATE NOCASE LIMIT ?
      `).all(...params, limit) as NodeRow[]
      const ids = new Set(rows.map(row => row.id))
      const edgeRows = db.prepare(`
        SELECT * FROM graph_edges
        WHERE from_id IN (${rows.length > 0 ? rows.map(() => '?').join(',') : "''"})
           OR to_id IN (${rows.length > 0 ? rows.map(() => '?').join(',') : "''"})
      `).all(...rows.map(row => row.id), ...rows.map(row => row.id)) as EdgeRow[]
      return {
        nodes: rows.map(mapNode),
        edges: edgeRows.filter(edge => ids.has(edge.from_id) && ids.has(edge.to_id)).map(mapEdge),
        refreshedAt: new Date().toISOString(),
      }
    } finally {
      db.close()
    }
  }

  /** Return one node plus its neighbours up to `depth`. */
  related(nodeId: string, depth = 1): GraphSnapshot {
    const db = this.openDb()
    try {
      const seen = new Set<string>([nodeId])
      let frontier = [nodeId]
      for (let level = 0; level < depth; level += 1) {
        if (frontier.length === 0) break
        const placeholders = frontier.map(() => '?').join(',')
        const rows = db.prepare(`
          SELECT from_id, to_id FROM graph_edges
          WHERE from_id IN (${placeholders}) OR to_id IN (${placeholders})
        `).all(...frontier, ...frontier) as Array<{ from_id: string; to_id: string }>
        const next: string[] = []
        for (const row of rows) {
          for (const id of [row.from_id, row.to_id]) {
            if (!seen.has(id)) { seen.add(id); next.push(id) }
          }
        }
        frontier = next
      }
      const ids = [...seen]
      const nodeRows = ids.length > 0
        ? db.prepare(`SELECT * FROM graph_nodes WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as NodeRow[]
        : []
      const edgeRows = ids.length > 0
        ? db.prepare(`SELECT * FROM graph_edges WHERE from_id IN (${ids.map(() => '?').join(',')}) OR to_id IN (${ids.map(() => '?').join(',')})`).all(...ids, ...ids) as EdgeRow[]
        : []
      const idSet = new Set(ids)
      return {
        nodes: nodeRows.map(mapNode),
        edges: edgeRows.filter(edge => idSet.has(edge.from_id) && idSet.has(edge.to_id)).map(mapEdge),
        refreshedAt: new Date().toISOString(),
      }
    } finally {
      db.close()
    }
  }
}

function ensureGraphSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS graph_nodes (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      path TEXT,
      source TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      modified_at TEXT
    );

    CREATE TABLE IF NOT EXISTS graph_edges (
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1,
      provenance TEXT NOT NULL,
      PRIMARY KEY(from_id, to_id, kind)
    );

    CREATE INDEX IF NOT EXISTS idx_graph_edges_from ON graph_edges(from_id);
    CREATE INDEX IF NOT EXISTS idx_graph_edges_to ON graph_edges(to_id);
    CREATE INDEX IF NOT EXISTS idx_graph_nodes_source ON graph_nodes(source);
  `)
}

function mapNode(row: NodeRow): GraphNode {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    path: row.path,
    source: row.source,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    modifiedAt: row.modified_at,
  }
}

function mapEdge(row: EdgeRow): GraphEdge {
  return {
    from: row.from_id,
    to: row.to_id,
    kind: row.kind,
    confidence: row.confidence,
    provenance: row.provenance,
  }
}
