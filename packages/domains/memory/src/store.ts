import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type {
  MemoryExport,
  MemoryInjectionRecord,
  MemoryItem,
  MemoryItemInput,
  MemoryListOptions,
  MemorySource,
  MemoryStatus,
} from './types.ts'
import { MEMORY_SCHEMA_VERSION } from './types.ts'

type ItemRow = {
  id: string
  projection: MemoryItem['projection']
  kind: MemoryItem['kind']
  content: string
  version: string
  status: MemoryStatus
  visibility: MemoryItem['visibility']
  confidence: number | null
  source_json: string
  metadata_json: string
  created_at: string
  updated_at: string
  revoked_at: string | null
  deleted_at: string | null
}

type InjectionRow = {
  id: string
  surface: string
  memory_ids_json: string
  memory_versions_json: string
  session_id: string | null
  metadata_json: string
  created_at: string
}

function restrictFileMode(path: string): void {
  if (path === ':memory:') return
  try {
    chmodSync(path, 0o600)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

function secureDatabaseFiles(dbPath: string): void {
  restrictFileMode(dbPath)
  restrictFileMode(`${dbPath}-wal`)
  restrictFileMode(`${dbPath}-shm`)
}

function openDatabase(dbPath: string): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 })
  const db = new DatabaseSync(dbPath)
  secureDatabaseFiles(dbPath)
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  try {
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = NORMAL')
  } catch {
    // SQLite remains usable on filesystems without WAL support.
  }
  secureDatabaseFiles(dbPath)
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_items (
      id TEXT PRIMARY KEY,
      projection TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      version TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active', 'revoked', 'deleted')),
      visibility TEXT NOT NULL CHECK(visibility IN ('private', 'model')),
      confidence REAL,
      source_json TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      revoked_at TEXT,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_memory_items_projection_status
      ON memory_items(projection, status, updated_at DESC);
    CREATE TABLE IF NOT EXISTS memory_injections (
      id TEXT PRIMARY KEY,
      surface TEXT NOT NULL,
      memory_ids_json TEXT NOT NULL,
      memory_versions_json TEXT NOT NULL,
      session_id TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_injections_created
      ON memory_injections(created_at DESC);
  `)
  const schema = db.prepare('PRAGMA user_version').get() as { user_version?: number }
  const schemaVersion = schema.user_version
  if (typeof schemaVersion === 'number' && schemaVersion > MEMORY_SCHEMA_VERSION) {
    db.close()
    throw new Error('rin memory: database schema is newer than this runtime')
  }
  db.exec('PRAGMA user_version = ' + MEMORY_SCHEMA_VERSION)
  return db
}

function contentVersion(input: MemoryItemInput): string {
  return createHash('sha256')
    .update(JSON.stringify({
      projection: input.projection,
      kind: input.kind,
      content: input.content,
      source: input.source,
      visibility: input.visibility ?? 'model',
      confidence: input.confidence ?? null,
      metadata: input.metadata ?? {},
    }))
    .digest('hex')
    .slice(0, 24)
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function mapItem(row: ItemRow): MemoryItem {
  const item: MemoryItem = {
    id: row.id,
    projection: row.projection,
    kind: row.kind,
    content: row.content,
    version: row.version,
    status: row.status,
    visibility: row.visibility,
    source: parseJson<MemorySource>(row.source_json, { id: 'unknown', kind: 'external', uri: 'unknown' }),
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
  if (row.confidence !== null) item.confidence = row.confidence
  if (row.revoked_at !== null) item.revokedAt = row.revoked_at
  if (row.deleted_at !== null) item.deletedAt = row.deleted_at
  return item
}

function mapInjection(row: InjectionRow): MemoryInjectionRecord {
  const record: MemoryInjectionRecord = {
    id: row.id,
    surface: row.surface,
    memoryIds: parseJson<string[]>(row.memory_ids_json, []),
    memoryVersions: parseJson<Record<string, string>>(row.memory_versions_json, {}),
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
    createdAt: row.created_at,
  }
  if (row.session_id !== null) record.sessionId = row.session_id
  return record
}

export class MemoryDatabase {
  constructor(private readonly dbPath: string) {}

  /** Flush the WAL so a portable archive can copy the catalog at a checkpoint. */
  prepareForArchive(): void {
    const db = openDatabase(this.dbPath)
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    } finally {
      db.close()
      secureDatabaseFiles(this.dbPath)
    }
  }

  upsert(input: MemoryItemInput): MemoryItem {
    if (input.content.trim() === '') throw new Error('memory content must not be empty')
    const now = new Date().toISOString()
    const id = input.id ?? `memory-${randomUUID()}`
    const version = input.version ?? contentVersion(input)
    const db = openDatabase(this.dbPath)
    try {
      const existing = db.prepare('SELECT * FROM memory_items WHERE id = ?').get(id) as ItemRow | undefined
      if (existing?.status === 'revoked' || existing?.status === 'deleted') return mapItem(existing)
      const item: MemoryItem = {
        id,
        projection: input.projection,
        kind: input.kind,
        content: input.content,
        version,
        status: 'active',
        visibility: input.visibility ?? 'model',
        source: input.source,
        metadata: input.metadata ?? {},
        createdAt: existing?.created_at ?? now,
        updatedAt: now,
      }
      if (input.confidence !== undefined) item.confidence = Math.min(1, Math.max(0, input.confidence))
      db.prepare(`
        INSERT INTO memory_items (
          id, projection, kind, content, version, status, visibility, confidence,
          source_json, metadata_json, created_at, updated_at, revoked_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, NULL, NULL)
        ON CONFLICT(id) DO UPDATE SET
          projection = excluded.projection,
          kind = excluded.kind,
          content = excluded.content,
          version = excluded.version,
          status = 'active',
          visibility = excluded.visibility,
          confidence = excluded.confidence,
          source_json = excluded.source_json,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at,
          revoked_at = NULL,
          deleted_at = NULL
      `).run(
        item.id,
        item.projection,
        item.kind,
        item.content,
        item.version,
        item.visibility,
        item.confidence ?? null,
        JSON.stringify(item.source),
        JSON.stringify(item.metadata ?? {}),
        item.createdAt,
        item.updatedAt,
      )
      return item
    } finally {
      db.close()
    }
  }

  list(options: MemoryListOptions = {}): MemoryItem[] {
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 200), 1), 1000)
    return this.queryItems(options, limit)
  }

  private queryItems(options: MemoryListOptions, limit: number | undefined): MemoryItem[] {
    const conditions: string[] = []
    const params: Array<string | number> = []
    if (options.projection !== undefined) {
      conditions.push('projection = ?')
      params.push(options.projection)
    }
    if (options.status !== undefined) {
      conditions.push('status = ?')
      params.push(options.status)
    } else {
      conditions.push("status <> 'deleted'")
    }
    if (options.sourceId !== undefined) {
      conditions.push("json_extract(source_json, '$.id') = ?")
      params.push(options.sourceId)
    }
    const limitClause = limit === undefined ? '' : ' LIMIT ?'
    const queryParams = limit === undefined ? params : [...params, limit]
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const db = openDatabase(this.dbPath)
    try {
      const items = db.prepare(`SELECT * FROM memory_items ${where} ORDER BY updated_at DESC${limitClause}`)
        .all(...queryParams)
        .map(row => mapItem(row as ItemRow))
      return items
    } finally {
      db.close()
    }
  }

  get(id: string): MemoryItem | undefined {
    const db = openDatabase(this.dbPath)
    try {
      const row = db.prepare('SELECT * FROM memory_items WHERE id = ?').get(id) as ItemRow | undefined
      return row === undefined ? undefined : mapItem(row)
    } finally {
      db.close()
    }
  }

  revoke(id: string, reason?: string): MemoryItem | undefined {
    const item = this.get(id)
    if (item === undefined) return undefined
    if (item.status !== 'active') return item
    const now = new Date().toISOString()
    const metadata = { ...(item.metadata ?? {}), ...(reason === undefined ? {} : { revocationReason: reason }) }
    const db = openDatabase(this.dbPath)
    try {
      db.prepare(`
        UPDATE memory_items
        SET status = 'revoked', metadata_json = ?, revoked_at = ?, updated_at = ?
        WHERE id = ? AND status = 'active'
      `).run(JSON.stringify(metadata), now, now, id)
    } finally {
      db.close()
    }
    return this.get(id)
  }

  delete(id: string): boolean {
    const now = new Date().toISOString()
    const db = openDatabase(this.dbPath)
    try {
      const result = db.prepare(`
        UPDATE memory_items
        SET status = 'deleted', deleted_at = ?, updated_at = ?
        WHERE id = ? AND status <> 'deleted'
      `).run(now, now, id)
      return result.changes > 0
    } finally {
      db.close()
    }
  }

  recordInjection(input: MemoryInjectionRecord): MemoryInjectionRecord {
    const id = input.id ?? `injection-${randomUUID()}`
    const createdAt = input.createdAt ?? new Date().toISOString()
    const record = {
      ...input,
      id,
      memoryIds: [...input.memoryIds],
      memoryVersions: { ...input.memoryVersions },
      createdAt,
      metadata: input.metadata ?? {},
    }
    const db = openDatabase(this.dbPath)
    try {
      for (const memoryId of record.memoryIds) {
        const version = record.memoryVersions[memoryId]
        if (typeof version !== 'string' || version === '') {
          throw new Error('memory injection is missing a version for ' + memoryId)
        }
        const item = db.prepare('SELECT version, status, visibility FROM memory_items WHERE id = ?').get(memoryId) as { version: string; status: MemoryStatus; visibility: MemoryItem['visibility'] } | undefined
        if (item === undefined) throw new Error('memory injection references an unknown item: ' + memoryId)
        if (item.status !== 'active' || item.visibility !== 'model') throw new Error('memory injection references a non-model-visible item: ' + memoryId)
        if (item.version !== version) throw new Error('memory injection version does not match item: ' + memoryId)
      }
      db.prepare(`
        INSERT INTO memory_injections (
          id, surface, memory_ids_json, memory_versions_json, session_id, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.id,
        record.surface,
        JSON.stringify(record.memoryIds),
        JSON.stringify(record.memoryVersions),
        record.sessionId ?? null,
        JSON.stringify(record.metadata),
        record.createdAt,
      )
      return record
    } finally {
      db.close()
    }
  }

  listInjections(limit = 100): MemoryInjectionRecord[] {
    return this.queryInjections(Math.min(Math.max(Math.trunc(limit), 1), 1000))
  }

  private queryInjections(limit: number | undefined): MemoryInjectionRecord[] {
    const db = openDatabase(this.dbPath)
    try {
      const limitClause = limit === undefined ? '' : ' LIMIT ?'
      const rows = limit === undefined
        ? db.prepare(`SELECT * FROM memory_injections ORDER BY created_at DESC${limitClause}`).all()
        : db.prepare(`SELECT * FROM memory_injections ORDER BY created_at DESC${limitClause}`).all(limit)
      return rows
        .map(row => mapInjection(row as InjectionRow))
    } finally {
      db.close()
    }
  }

  exportData(): MemoryExport {
    return {
      schemaVersion: MEMORY_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      items: [
        ...this.queryItems({ status: 'active' }, undefined),
        ...this.queryItems({ status: 'revoked' }, undefined),
        ...this.queryItems({ status: 'deleted' }, undefined),
      ],
      injections: this.queryInjections(undefined),
    }
  }
}
