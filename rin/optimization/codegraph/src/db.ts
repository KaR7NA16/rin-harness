/**
 * rin codegraph — read-only SQLite access.
 *
 * Opens the code graph database for read (WAL-tolerant), exposing a
 * bun:sqlite-compatible query surface over node:sqlite so the ported analysis
 * layer needs no query-API changes.
 *
 * @module @rin/codegraph
 */

import { DatabaseSync } from 'node:sqlite'

/** A node:sqlite statement with bun:sqlite-compatible get/all/run methods. */
interface ReadableStatement {
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

/** A read-only code-graph database handle. */
export class CodeGraphReadDb {
  private readonly db: DatabaseSync

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath, { readOnly: true })
  }

  /** Prepare a read statement (bun:sqlite's db.query). */
  query(sql: string): ReadableStatement {
    const statement = this.db.prepare(sql)
    return {
      get: (...params: unknown[]) => statement.get(...params as never[]),
      all: (...params: unknown[]) => statement.all(...params as never[]) as unknown[]
    }
  }

  close(): void {
    this.db.close()
  }
}

/** Open the code-graph database for read, or throw when it cannot be opened. */
export function openCodeGraphDatabaseForRead(dbPath: string): CodeGraphReadDb {
  return new CodeGraphReadDb(dbPath)
}
