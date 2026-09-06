import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { isDeepStrictEqual } from 'node:util'
import {
  MemoryProtocolError,
  assertMemoryEvent,
  assertMemoryTransaction,
  createMemoryEvent,
  createMemoryTransaction,
  type MemoryCandidate,
  type MemoryAuthorizationId,
  type MemoryEvent,
  type MemoryTransaction,
} from './events.ts'
import {
  createMemory,
  createCurrentField,
  assertMemoryLinkSemantics,
  createLinkId,
  type CurrentFieldActionSource,
  createEmptyCurrentField,
  createMemoryLink,
  memoryVersion,
  isCurrentVersionLink,
  isMemoryContextActiveForScene,
  isMemoryValidityActiveAt,
  transitionMemory,
  type CurrentField,
  type MemoryId,
  type MemoryLink,
  type MemoryLinkRelation,
  type MemoryLinkState,
  type RinMemory,
  type MemoryActionRecord,
  type MemoryFeedbackVector,
  type MemoryOutcomeRecord,
  type MemoryPredictionRecord,
  type MemoryPredictionError,
} from './model.ts'
import type {
  MemoryProjection,
  MemoryProjectionCheckpoint,
} from './types.ts'
import {
  hashModelInput,
  type MemoryModelInputRecord,
  type MemoryRecallRecord,
} from './recall.ts'
import { learnDispositionFromFeedback, type MemoryConsolidationResult, type MemoryDecayResult, type MemoryDispositionLearningResult, type MemoryRepresentationFormationResult, type MemoryUseTrace } from './consolidation.ts'
import { MEMORY_COGNITION_STORAGE_VERSION, MEMORY_PROJECTIONS } from './types.ts'

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



type CognitionMetaRow = {
  schema_version: number
  protocol_version: number
}

type CognitionTransactionRow = {
  transaction_id: string
  command_id: string
  transaction_json: string
}

type CognitionProjectionCheckpointRow = {
  projection: MemoryProjection
  last_event_seq: number
  materialized_version: number
  state_hash: string
  status: MemoryProjectionCheckpoint['status']
  dirty_since_event_seq: number | null
  updated_at: string
}

type CognitionModelInputRow = {
  record_id: string
  cycle_id: string
  sequence: number
  session_id: string | null
  created_at: string
  workspace_hash: string | null
  input_hash: string
  input_json: string
}

type CognitionRecallCycleRow = {
  cycle_id: string
  created_at: string
  materialized_version: number
  workspace_hash: string
  trace_json: string
  workspace_json: string
}

type CognitionWorkspaceMemberRow = {
  cycle_id: string
  sequence: number
  item_id: string
  role: string
  score: number
  item_json: string
}

const COGNITION_TABLES = [
  'memory_cognition_meta',
  'memory_cognition_transactions',
  'memory_cognition_events',
  'memory_cognition_projection_checkpoints',
  'memory_cognition_model_inputs',
  'memory_cognition_recall_cycles',
  'memory_cognition_workspace_members',
] as const

function cognitionTableNames(db: DatabaseSync): string[] {
  return db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name IN (${COGNITION_TABLES.map(name => "'" + name + "'").join(', ')})
  `).all().map(row => (row as { name: string }).name)
}

function ensureCognitionWave3Tables(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_cognition_model_inputs (
      record_id TEXT PRIMARY KEY,
      cycle_id TEXT NOT NULL,
      sequence INTEGER NOT NULL CHECK (sequence >= 0),
      session_id TEXT,
      created_at TEXT NOT NULL,
      workspace_hash TEXT,
      input_hash TEXT NOT NULL,
      input_json TEXT NOT NULL,
      UNIQUE (cycle_id, sequence)
    );
    CREATE INDEX IF NOT EXISTS idx_memory_cognition_model_inputs_cycle
      ON memory_cognition_model_inputs(cycle_id, sequence);
    CREATE TABLE IF NOT EXISTS memory_cognition_recall_cycles (
      cycle_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      materialized_version INTEGER NOT NULL CHECK (materialized_version >= 0),
      workspace_hash TEXT NOT NULL,
      trace_json TEXT NOT NULL,
      workspace_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_cognition_recall_cycles_created
      ON memory_cognition_recall_cycles(created_at DESC);
    CREATE TABLE IF NOT EXISTS memory_cognition_workspace_members (
      cycle_id TEXT NOT NULL,
      sequence INTEGER NOT NULL CHECK (sequence >= 0),
      item_id TEXT NOT NULL,
      role TEXT NOT NULL,
      score REAL NOT NULL,
      item_json TEXT NOT NULL,
      PRIMARY KEY (cycle_id, sequence),
      FOREIGN KEY (cycle_id)
        REFERENCES memory_cognition_recall_cycles(cycle_id)
        ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_memory_cognition_workspace_members_cycle
      ON memory_cognition_workspace_members(cycle_id, sequence);
  `)
}
function openCognitionDatabase(dbPath: string): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 })
  const db = new DatabaseSync(dbPath)
  try {
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA busy_timeout = 5000')
    try {
      db.exec('PRAGMA journal_mode = WAL')
      db.exec('PRAGMA synchronous = NORMAL')
    } catch {
      // SQLite remains usable on filesystems without WAL support.
    }

    let names = cognitionTableNames(db)
    const meta = names.includes('memory_cognition_meta')
      ? db.prepare(`
          SELECT schema_version, protocol_version
          FROM memory_cognition_meta
          WHERE id = 1
        `).get() as CognitionMetaRow | undefined
      : undefined

    if (meta === undefined) {
      if (names.length > 0) {
        throw new Error('rin memory cognition: unversioned cognition journal is unsupported')
      }
      db.exec(`
        CREATE TABLE memory_cognition_meta (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          schema_version INTEGER NOT NULL,
          protocol_version INTEGER NOT NULL
        );
        CREATE TABLE memory_cognition_transactions (
          transaction_id TEXT PRIMARY KEY,
          command_id TEXT NOT NULL UNIQUE,
          correlation_id TEXT NOT NULL,
          actor_kind TEXT NOT NULL,
          actor_id TEXT NOT NULL,
          opened_at TEXT NOT NULL,
          committed_at TEXT NOT NULL,
          transaction_json TEXT NOT NULL
        );
        CREATE TABLE memory_cognition_events (
          event_seq INTEGER PRIMARY KEY AUTOINCREMENT,
          transaction_id TEXT NOT NULL,
          position INTEGER NOT NULL CHECK (position >= 0),
          event_id TEXT NOT NULL UNIQUE,
          command_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          occurred_at TEXT NOT NULL,
          event_json TEXT NOT NULL,
          UNIQUE (transaction_id, position),
          FOREIGN KEY (transaction_id)
            REFERENCES memory_cognition_transactions(transaction_id)
            ON DELETE CASCADE
        );
        CREATE TABLE memory_cognition_model_inputs (
          record_id TEXT PRIMARY KEY,
          cycle_id TEXT NOT NULL,
          sequence INTEGER NOT NULL CHECK (sequence >= 0),
          session_id TEXT,
          created_at TEXT NOT NULL,
          workspace_hash TEXT,
          input_hash TEXT NOT NULL,
          input_json TEXT NOT NULL,
          UNIQUE (cycle_id, sequence)
        );
        CREATE INDEX idx_memory_cognition_model_inputs_cycle
          ON memory_cognition_model_inputs(cycle_id, sequence);
        CREATE TABLE memory_cognition_recall_cycles (
          cycle_id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL,
          materialized_version INTEGER NOT NULL CHECK (materialized_version >= 0),
          workspace_hash TEXT NOT NULL,
          trace_json TEXT NOT NULL,
          workspace_json TEXT NOT NULL
        );
        CREATE INDEX idx_memory_cognition_recall_cycles_created
          ON memory_cognition_recall_cycles(created_at DESC);
        CREATE TABLE memory_cognition_workspace_members (
          cycle_id TEXT NOT NULL,
          sequence INTEGER NOT NULL CHECK (sequence >= 0),
          item_id TEXT NOT NULL,
          role TEXT NOT NULL,
          score REAL NOT NULL,
          item_json TEXT NOT NULL,
          PRIMARY KEY (cycle_id, sequence),
          FOREIGN KEY (cycle_id)
            REFERENCES memory_cognition_recall_cycles(cycle_id)
            ON DELETE CASCADE
        );
        CREATE INDEX idx_memory_cognition_workspace_members_cycle
          ON memory_cognition_workspace_members(cycle_id, sequence);
        CREATE TABLE memory_cognition_projection_checkpoints (
          projection TEXT PRIMARY KEY,
          last_event_seq INTEGER NOT NULL CHECK (last_event_seq >= 0),
          materialized_version INTEGER NOT NULL CHECK (materialized_version >= 0),
          state_hash TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('clean', 'dirty')),
          dirty_since_event_seq INTEGER,
          updated_at TEXT NOT NULL,
          CHECK ((status = 'clean' AND dirty_since_event_seq IS NULL) OR (status = 'dirty' AND dirty_since_event_seq IS NOT NULL))
        );
        CREATE INDEX idx_memory_cognition_events_command
          ON memory_cognition_events(command_id);
        CREATE INDEX idx_memory_cognition_events_type_time
          ON memory_cognition_events(event_type, occurred_at);
        INSERT INTO memory_cognition_meta (id, schema_version, protocol_version)
        VALUES (1, ${MEMORY_COGNITION_STORAGE_VERSION}, 1);
      `)
    } else {
      if (meta.schema_version > MEMORY_COGNITION_STORAGE_VERSION) {
        throw new Error('rin memory cognition: database schema is newer than this runtime')
      }
      if (meta.protocol_version !== 1) {
        throw new Error('rin memory cognition: unsupported protocol version ' + meta.protocol_version)
      }
      if (meta.schema_version < MEMORY_COGNITION_STORAGE_VERSION) {
        if (meta.schema_version < 3) {
          throw new Error(
            'rin memory cognition: legacy database schema version ' + meta.schema_version
              + ' is unsupported; expected 3 or newer',
          )
        }
        db.exec('BEGIN IMMEDIATE')
        try {
          ensureCognitionWave3Tables(db)
          db.prepare('UPDATE memory_cognition_meta SET schema_version = ? WHERE id = 1')
            .run(MEMORY_COGNITION_STORAGE_VERSION)
          db.exec('COMMIT')
        } catch (error) {
          try { db.exec('ROLLBACK') } catch { /* preserve original error */ }
          throw error
        }
        names = cognitionTableNames(db)
      }
      const missing = COGNITION_TABLES.filter(name => !names.includes(name))
      if (missing.length > 0) {
        throw new Error('rin memory cognition: schema is incomplete; missing ' + missing.join(', '))
      }
    }
    for (const projection of MEMORY_PROJECTIONS) {
      db.prepare(`
        INSERT OR IGNORE INTO memory_cognition_projection_checkpoints (
          projection, last_event_seq, materialized_version, state_hash,
          status, dirty_since_event_seq, updated_at
        ) VALUES (?, 0, 0, 'empty', 'clean', NULL, ?)
      `).run(projection, '1970-01-01T00:00:00.000Z')
    }
    secureDatabaseFiles(dbPath)
    return db
  } catch (error) {
    try {
      db.close()
    } catch {
      // Preserve the schema error when closing also fails.
    }
    throw error
  }
}

function parseCognitionJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    throw new MemoryProtocolError(label + ' contains invalid JSON')
  }
}

function normalizeCognitionTransaction(value: unknown): MemoryTransaction {
  assertMemoryTransaction(value)
  return createMemoryTransaction({
    transactionId: value.transactionId,
    commandId: value.commandId,
    correlationId: value.correlationId,
    actor: value.actor,
    openedAt: value.openedAt,
    committedAt: value.committedAt,
    command: value.command,
    events: value.events,
  })
}

function normalizeCognitionEvent(value: unknown): MemoryEvent {
  assertMemoryEvent(value)
  return createMemoryEvent(value)
}

export type MemoryCommitFaultStage = 'transaction-row' | 'event-row'
function assertProjection(value: string): asserts value is MemoryProjection {
  if (!MEMORY_PROJECTIONS.includes(value as MemoryProjection)) {
    throw new MemoryProtocolError('unknown memory projection ' + value)
  }
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new MemoryProtocolError(label + ' must be a non-negative integer')
  }
}
function mapProjectionCheckpoint(row: CognitionProjectionCheckpointRow): MemoryProjectionCheckpoint {
  assertProjection(row.projection)
  assertNonNegativeInteger(row.last_event_seq, 'last event sequence')
  assertNonNegativeInteger(row.materialized_version, 'materialized version')
  if (row.dirty_since_event_seq !== null) {
    assertNonNegativeInteger(row.dirty_since_event_seq, 'dirty event sequence')
  }
  if (row.status !== 'clean' && row.status !== 'dirty') {
    throw new MemoryProtocolError('unknown projection checkpoint status ' + row.status)
  }
  if (row.status === 'clean' && row.dirty_since_event_seq !== null) {
    throw new MemoryProtocolError('clean projection checkpoint cannot have a dirty event sequence')
  }
  if (row.status === 'dirty' && row.dirty_since_event_seq === null) {
    throw new MemoryProtocolError('dirty projection checkpoint must have a dirty event sequence')
  }
  const checkpoint: MemoryProjectionCheckpoint = {
    projection: row.projection,
    lastEventSeq: row.last_event_seq,
    materializedVersion: row.materialized_version,
    stateHash: row.state_hash,
    status: row.status,
    updatedAt: row.updated_at,
  }
  if (row.dirty_since_event_seq !== null) checkpoint.dirtySinceEventSeq = row.dirty_since_event_seq
  return Object.freeze(checkpoint)
}
export type MemoryCommitFaultContext = Readonly<{
  stage: MemoryCommitFaultStage
  transactionId: string
  position?: number
}>
export type MemoryCommitFaultInjector = (context: MemoryCommitFaultContext) => void

function readLatestEventSeq(db: DatabaseSync): number {
  return (db.prepare(`
    SELECT COALESCE(MAX(event_seq), 0) AS event_seq
    FROM memory_cognition_events
  `).get() as { event_seq: number }).event_seq
}

function readProjectionCheckpoint(db: DatabaseSync, projection: MemoryProjection): MemoryProjectionCheckpoint {
  const row = db.prepare(`
    SELECT projection, last_event_seq, materialized_version, state_hash,
           status, dirty_since_event_seq, updated_at
    FROM memory_cognition_projection_checkpoints
    WHERE projection = ?
  `).get(projection) as CognitionProjectionCheckpointRow | undefined
  if (row === undefined) throw new MemoryProtocolError('missing projection checkpoint for ' + projection)
  return mapProjectionCheckpoint(row)
}

function assertProjectionCheckpointInput(lastEventSeq: number, materializedVersion: number, stateHash: string, updatedAt: string): void {
  assertNonNegativeInteger(lastEventSeq, 'last event sequence')
  assertNonNegativeInteger(materializedVersion, 'materialized version')
  if (stateHash.trim() === '') throw new MemoryProtocolError('projection state hash must not be empty')
  if (updatedAt.trim() === '') throw new MemoryProtocolError('projection checkpoint timestamp must not be empty')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertRecallRecord(value: MemoryRecallRecord): void {
  const raw = value as unknown
  if (!isRecord(raw) || !isRecord(raw.trace) || !isRecord(raw.workspace)) {
    throw new MemoryProtocolError('recall record is structurally invalid')
  }
  const trace = raw.trace
  const workspace = raw.workspace
  if (
    typeof raw.cycleId !== 'string'
    || typeof raw.createdAt !== 'string'
    || typeof trace.cycleId !== 'string'
    || typeof workspace.cycleId !== 'string'
    || typeof trace.materializedVersion !== 'number'
    || typeof workspace.materializedVersion !== 'number'
    || raw.cycleId.trim() === ''
    || raw.createdAt.trim() === ''
    || trace.cycleId !== raw.cycleId
    || workspace.cycleId !== raw.cycleId
    || trace.materializedVersion !== workspace.materializedVersion
    || typeof workspace.hash !== 'string'
    || workspace.hash.trim() === ''
    || !Array.isArray(workspace.items)
    || !Array.isArray(workspace.links)
    || !Array.isArray(trace.candidates)
    || !Array.isArray(trace.selection)
  ) {
    throw new MemoryProtocolError('recall record is structurally invalid')
  }
  const { hash, ...unsignedWorkspace } = value.workspace
  if (hashModelInput(unsignedWorkspace) !== hash) {
    throw new MemoryProtocolError('recall workspace hash does not match its content')
  }
}

function normalizeRecallRecord(value: unknown): MemoryRecallRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new MemoryProtocolError('recall record must be an object')
  }
  const record = value as MemoryRecallRecord
  if (
    typeof record.cycleId !== 'string'
    || typeof record.createdAt !== 'string'
    || record.trace === undefined
    || record.workspace === undefined
  ) {
    throw new MemoryProtocolError('recall record is structurally invalid')
  }
  assertRecallRecord(record)
  return record
}

function mapRecallCycle(row: CognitionRecallCycleRow): MemoryRecallRecord {
  const record = normalizeRecallRecord({
    cycleId: row.cycle_id,
    createdAt: row.created_at,
    trace: parseCognitionJson(row.trace_json, 'recall trace'),
    workspace: parseCognitionJson(row.workspace_json, 'recall workspace'),
  })
  if (
    record.workspace.materializedVersion !== row.materialized_version
    || record.workspace.hash !== row.workspace_hash
  ) {
    throw new MemoryProtocolError('recall cycle integrity metadata does not match its content')
  }
  return record
}

function assertWorkspaceMembers(db: DatabaseSync, record: MemoryRecallRecord): void {
  const rows = db.prepare(`
    SELECT cycle_id, sequence, item_id, role, score, item_json
    FROM memory_cognition_workspace_members
    WHERE cycle_id = ?
    ORDER BY sequence ASC
  `).all(record.cycleId) as CognitionWorkspaceMemberRow[]
  if (rows.length !== record.workspace.items.length) {
    throw new MemoryProtocolError('recall workspace member count does not match workspace')
  }
  for (const [index, row] of rows.entries()) {
    const item = record.workspace.items[index]
    if (
      item === undefined
      || row.cycle_id !== record.cycleId
      || row.sequence !== index
      || row.item_id !== item.id
      || row.role !== item.role
      || row.score !== item.score
      || !isDeepStrictEqual(parseCognitionJson(row.item_json, 'workspace member'), item)
    ) {
      throw new MemoryProtocolError('recall workspace member does not match workspace serialization')
    }
  }
}

function readRecallRecord(db: DatabaseSync, cycleId: string): MemoryRecallRecord | undefined {
  const row = db.prepare(`
    SELECT cycle_id, created_at, materialized_version, workspace_hash, trace_json, workspace_json
    FROM memory_cognition_recall_cycles
    WHERE cycle_id = ?
  `).get(cycleId) as CognitionRecallCycleRow | undefined
  if (row === undefined) return undefined
  const record = mapRecallCycle(row)
  assertWorkspaceMembers(db, record)
  return record
}
/**
 * Durable event journal for Rin's unified cognition model.
 *
 * The journal owns its schema marker and tables inside the memory database
 * file. It is the canonical write substrate for the unified model;
 * materialization is a later replay step.
 */
export class MemoryCognitionDatabase {
  constructor(private readonly dbPath: string) {}
  getProjectionCheckpoint(projection: MemoryProjection): MemoryProjectionCheckpoint {
    assertProjection(projection)
    const db = openCognitionDatabase(this.dbPath)
    try {
      return readProjectionCheckpoint(db, projection)
    } finally {
      db.close()
    }
  }


  listProjectionCheckpoints(): MemoryProjectionCheckpoint[] {
    const db = openCognitionDatabase(this.dbPath)
    try {
      const rows = db.prepare(`
        SELECT projection, last_event_seq, materialized_version, state_hash,
               status, dirty_since_event_seq, updated_at
        FROM memory_cognition_projection_checkpoints
        ORDER BY projection ASC
      `).all() as CognitionProjectionCheckpointRow[]
      return rows.map(row => mapProjectionCheckpoint(row))
    } finally {
      db.close()
    }
  }

  getLatestEventSeq(): number {
    const db = openCognitionDatabase(this.dbPath)
    try {
      return readLatestEventSeq(db)
    } finally {
      db.close()
    }
  }

  markProjectionCleanAtCurrent(
    projection: MemoryProjection,
    materializedVersion: number,
    stateHash: string,
    updatedAt = new Date().toISOString(),
  ): MemoryProjectionCheckpoint {
    return this.markProjectionClean(projection, this.getLatestEventSeq(), materializedVersion, stateHash, updatedAt)
  }

  markProjectionDirty(projection: MemoryProjection, updatedAt = new Date().toISOString()): MemoryProjectionCheckpoint {
    assertProjection(projection)
    if (updatedAt.trim() === '') throw new MemoryProtocolError('projection checkpoint timestamp must not be empty')
    const db = openCognitionDatabase(this.dbPath)
    try {
      db.exec('BEGIN IMMEDIATE')
      const latestEventSeq = readLatestEventSeq(db)
      db.prepare(`
        UPDATE memory_cognition_projection_checkpoints
        SET status = 'dirty', dirty_since_event_seq = COALESCE(dirty_since_event_seq, ?), updated_at = ?
        WHERE projection = ?
      `).run(latestEventSeq, updatedAt, projection)
      const checkpoint = readProjectionCheckpoint(db, projection)
      db.exec('COMMIT')
      return checkpoint
    } catch (error) {
      try { db.exec('ROLLBACK') } catch { /* preserve original error */ }
      throw error
    } finally {
      db.close()
    }
  }
  markProjectionClean(
    projection: MemoryProjection,
    lastEventSeq: number,
    materializedVersion: number,
    stateHash: string,
    updatedAt = new Date().toISOString(),
  ): MemoryProjectionCheckpoint {
    assertProjection(projection)
    assertProjectionCheckpointInput(lastEventSeq, materializedVersion, stateHash, updatedAt)
    const db = openCognitionDatabase(this.dbPath)
    try {
      db.exec('BEGIN IMMEDIATE')
      const latestEventSeq = readLatestEventSeq(db)
      if (lastEventSeq !== latestEventSeq) {
        throw new MemoryProtocolError('projection checkpoint must reach current journal event sequence')
      }
      const currentMaterializedVersion = (db.prepare(
        'SELECT COUNT(*) AS count FROM memory_cognition_transactions',
      ).get() as { count: number }).count
      if (materializedVersion !== currentMaterializedVersion) {
        throw new MemoryProtocolError('projection checkpoint materialized version is stale')
      }
      db.prepare(`
        UPDATE memory_cognition_projection_checkpoints
        SET last_event_seq = ?, materialized_version = ?, state_hash = ?,
            status = 'clean', dirty_since_event_seq = NULL, updated_at = ?
        WHERE projection = ?
      `).run(lastEventSeq, materializedVersion, stateHash, updatedAt, projection)
      const checkpoint = readProjectionCheckpoint(db, projection)
      db.exec('COMMIT')
      return checkpoint
    } catch (error) {
      try { db.exec('ROLLBACK') } catch { /* preserve original error */ }
      throw error
    } finally {
      db.close()
    }
  }

  requireProjectionReady(projection: MemoryProjection): MemoryProjectionCheckpoint {
    assertProjection(projection)
    const db = openCognitionDatabase(this.dbPath)
    try {
      const checkpoint = readProjectionCheckpoint(db, projection)
      const latestEventSeq = readLatestEventSeq(db)
      if (checkpoint.status !== 'clean') {
        throw new MemoryProtocolError('projection ' + projection + ' is dirty and cannot enter model input')
      }
      if (checkpoint.lastEventSeq !== latestEventSeq) {
        throw new MemoryProtocolError('projection ' + projection + ' is behind the cognition journal')
      }
      return checkpoint
    } finally {
      db.close()
    }
  }
  appendTransaction(value: MemoryTransaction, faultInjector?: MemoryCommitFaultInjector): MemoryTransaction {
    const transaction = normalizeCognitionTransaction(value)
    const transactionJson = JSON.stringify(transaction)
    const db = openCognitionDatabase(this.dbPath)
    try {
      db.exec('BEGIN IMMEDIATE')
      const existing = db.prepare(`
        SELECT transaction_id, command_id, transaction_json
        FROM memory_cognition_transactions
        WHERE transaction_id = ?
      `).get(transaction.transactionId) as CognitionTransactionRow | undefined
      if (existing !== undefined) {
        const eventCount = db.prepare(`
          SELECT COUNT(*) AS count
          FROM memory_cognition_events
          WHERE transaction_id = ?
        `).get(transaction.transactionId) as { count: number }
        if (existing.transaction_json === transactionJson && eventCount.count === transaction.events.length) {
          db.exec('ROLLBACK')
          return transaction
        }
        throw new Error('rin memory cognition: transaction already exists with different content')
      }

      const commandConflict = db.prepare(`
        SELECT transaction_id
        FROM memory_cognition_transactions
        WHERE command_id = ?
      `).get(transaction.commandId) as { transaction_id: string } | undefined
      if (commandConflict !== undefined) {
        throw new Error('rin memory cognition: command is already bound to transaction ' + commandConflict.transaction_id)
      }

      db.prepare(`
        INSERT INTO memory_cognition_transactions (
          transaction_id, command_id, correlation_id, actor_kind, actor_id,
          opened_at, committed_at, transaction_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        transaction.transactionId,
        transaction.commandId,
        transaction.correlationId,
        transaction.actor.kind,
        transaction.actor.id,
        transaction.openedAt,
        transaction.committedAt,
        transactionJson,
      )
      faultInjector?.({ stage: 'transaction-row', transactionId: transaction.transactionId })

      const insertEvent = db.prepare(`
        INSERT INTO memory_cognition_events (
          transaction_id, position, event_id, command_id, event_type, occurred_at, event_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      for (const event of transaction.events) {
        insertEvent.run(
          transaction.transactionId,
          event.position,
          event.eventId,
          event.commandId,
          event.type,
          event.occurredAt,
          JSON.stringify(event),
        )
        faultInjector?.({
          stage: 'event-row',
          transactionId: transaction.transactionId,
          position: event.position,
        })
      }
      const latestEventSeq = (db.prepare(`
        SELECT COALESCE(MAX(event_seq), 0) AS event_seq
        FROM memory_cognition_events
      `).get() as { event_seq: number }).event_seq
      db.prepare(`
        UPDATE memory_cognition_projection_checkpoints
        SET status = 'dirty', dirty_since_event_seq = COALESCE(dirty_since_event_seq, ?), updated_at = ?
      `).run(latestEventSeq, transaction.committedAt)
      db.exec('COMMIT')
      return transaction
    } catch (error) {
      try {
        db.exec('ROLLBACK')
      } catch {
        // Preserve the original commit error.
      }
      throw error
    } finally {
      db.close()
      secureDatabaseFiles(this.dbPath)
    }
  }

  getTransaction(transactionId: string): MemoryTransaction | undefined {
    const db = openCognitionDatabase(this.dbPath)
    try {
      const row = db.prepare(`
        SELECT transaction_json
        FROM memory_cognition_transactions
        WHERE transaction_id = ?
      `).get(transactionId) as { transaction_json: string } | undefined
      return row === undefined
        ? undefined
        : normalizeCognitionTransaction(parseCognitionJson(row.transaction_json, 'transaction'))
    } finally {
      db.close()
    }
  }

  listTransactions(limit = 1000): MemoryTransaction[] {
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 10000)
    const db = openCognitionDatabase(this.dbPath)
    try {
      const rows = db.prepare(`
        SELECT transaction_json
        FROM memory_cognition_transactions AS transactions
        JOIN (
          SELECT transaction_id, MIN(event_seq) AS first_event_seq
          FROM memory_cognition_events
          GROUP BY transaction_id
        ) AS sequence ON sequence.transaction_id = transactions.transaction_id
        ORDER BY sequence.first_event_seq ASC
        LIMIT ?
      `).all(boundedLimit) as Array<{ transaction_json: string }>
      return rows.map(row => normalizeCognitionTransaction(parseCognitionJson(row.transaction_json, 'transaction')))
    } finally {
      db.close()
    }
  }
  readMaterializedState(): MemoryMaterializedState {
    return new MemoryMaterializer().replayFrom(this)
  }


  listEvents(transactionId: string): MemoryEvent[] {
    const db = openCognitionDatabase(this.dbPath)
    try {
      const rows = db.prepare(`
        SELECT event_json
        FROM memory_cognition_events
        WHERE transaction_id = ?
        ORDER BY position ASC
      `).all(transactionId) as Array<{ event_json: string }>
      return rows.map(row => normalizeCognitionEvent(parseCognitionJson(row.event_json, 'event')))
    } finally {
      db.close()
    }
  }
  listMemoryUseTraces(memoryId?: MemoryId, cycleId?: string, limit = 1000): MemoryUseTrace[] {
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 10000)
    const conditions = ["event_type = 'memory-used'"]
    const params: Array<string | number> = []
    if (memoryId !== undefined) {
      conditions.push("json_extract(event_json, '$.payload.use.memoryId') = ?")
      params.push(memoryId)
    }
    if (cycleId !== undefined) {
      conditions.push("json_extract(event_json, '$.payload.use.cycleId') = ?")
      params.push(cycleId)
    }
    const db = openCognitionDatabase(this.dbPath)
    try {
      const rows = db.prepare(`
        SELECT event_json
        FROM memory_cognition_events
        WHERE ${conditions.join(' AND ')}
        ORDER BY event_seq ASC
        LIMIT ?
      `).all(...params, boundedLimit) as Array<{ event_json: string }>
      return rows.map(row => {
        const event = normalizeCognitionEvent(parseCognitionJson(row.event_json, 'memory use event'))
        if (event.type !== 'memory-used') throw new MemoryProtocolError('memory use query returned an unexpected event')
        return event.payload.use
      })
    } finally {
      db.close()
    }
  }

  getRecallRecord(cycleId: string): MemoryRecallRecord | undefined {
    if (cycleId.trim() === '') return undefined
    const db = openCognitionDatabase(this.dbPath)
    try {
      return readRecallRecord(db, cycleId)
    } finally {
      db.close()
    }
  }

  listRecallRecords(limit = 1000): MemoryRecallRecord[] {
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 10000)
    const db = openCognitionDatabase(this.dbPath)
    try {
      const rows = db.prepare(`
        SELECT cycle_id, created_at, materialized_version, workspace_hash, trace_json, workspace_json
        FROM memory_cognition_recall_cycles
        ORDER BY created_at DESC, cycle_id ASC
        LIMIT ?
      `).all(boundedLimit) as CognitionRecallCycleRow[]
      return rows.map(row => {
        const record = mapRecallCycle(row)
        assertWorkspaceMembers(db, record)
        return record
      })
    } finally {
      db.close()
    }
  }

  appendRecallRecord(value: MemoryRecallRecord): MemoryRecallRecord {
    assertRecallRecord(value)
    const traceJson = JSON.stringify(value.trace)
    const workspaceJson = JSON.stringify(value.workspace)
    const db = openCognitionDatabase(this.dbPath)
    try {
      db.exec('BEGIN IMMEDIATE')
      const existing = db.prepare(`
        SELECT trace_json, workspace_json, created_at, materialized_version, workspace_hash
        FROM memory_cognition_recall_cycles
        WHERE cycle_id = ?
      `).get(value.cycleId) as Pick<CognitionRecallCycleRow, 'trace_json' | 'workspace_json' | 'created_at' | 'materialized_version' | 'workspace_hash'> | undefined
      if (existing !== undefined) {
        if (
          existing.trace_json === traceJson
          && existing.workspace_json === workspaceJson
          && existing.created_at === value.createdAt
          && existing.materialized_version === value.workspace.materializedVersion
          && existing.workspace_hash === value.workspace.hash
        ) {
          db.exec('ROLLBACK')
          return value
        }
        throw new Error('rin memory cognition: recall cycle already exists with different content')
      }
      db.prepare(`
        INSERT INTO memory_cognition_recall_cycles (
          cycle_id, created_at, materialized_version, workspace_hash, trace_json, workspace_json
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        value.cycleId,
        value.createdAt,
        value.workspace.materializedVersion,
        value.workspace.hash,
        traceJson,
        workspaceJson,
      )
      const insertMember = db.prepare(`
        INSERT INTO memory_cognition_workspace_members (
          cycle_id, sequence, item_id, role, score, item_json
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      value.workspace.items.forEach((item, sequence) => {
        insertMember.run(
          value.cycleId,
          sequence,
          item.id,
          item.role,
          item.score,
          JSON.stringify(item),
        )
      })
      db.exec('COMMIT')
      return value
    } catch (error) {
      try { db.exec('ROLLBACK') } catch { /* preserve original error */ }
      throw error
    } finally {
      db.close()
      secureDatabaseFiles(this.dbPath)
    }
  }


  appendModelInput(value: MemoryModelInputRecord): MemoryModelInputRecord {
    if (value.id.trim() === '' || value.cycleId.trim() === '') {
      throw new MemoryProtocolError('model input record id and cycle id are required')
    }
    if (value.inputHash.trim() === '') throw new MemoryProtocolError('model input hash is required')
    if (hashModelInput(value.input) !== value.inputHash) throw new MemoryProtocolError('model input hash does not match its snapshot')
    if (value.createdAt.trim() === '') throw new MemoryProtocolError('model input timestamp is required')
    const db = openCognitionDatabase(this.dbPath)
    try {
      db.exec('BEGIN IMMEDIATE')
      const row = db.prepare(
        'SELECT COALESCE(MAX(sequence), -1) AS sequence FROM memory_cognition_model_inputs WHERE cycle_id = ?',
      ).get(value.cycleId) as { sequence: number }
      const sequence = row.sequence + 1
      const record: MemoryModelInputRecord = {
        ...value,
        sequence,
        input: { ...value.input },
      }
      db.prepare(
        'INSERT INTO memory_cognition_model_inputs (record_id, cycle_id, sequence, session_id, created_at, workspace_hash, input_hash, input_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(
        record.id,
        record.cycleId,
        record.sequence,
        record.sessionId ?? null,
        record.createdAt,
        record.workspaceHash ?? null,
        record.inputHash,
        JSON.stringify(record.input),
      )
      db.exec('COMMIT')
      return Object.freeze({ ...record, input: Object.freeze({ ...record.input }) })
    } catch (error) {
      try { db.exec('ROLLBACK') } catch { /* preserve original error */ }
      throw error
    } finally {
      db.close()
      secureDatabaseFiles(this.dbPath)
    }
  }

  listModelInputs(cycleId?: string, limit = 1000): MemoryModelInputRecord[] {
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 10000)
    const db = openCognitionDatabase(this.dbPath)
    try {
      const rows = cycleId === undefined
        ? db.prepare('SELECT record_id, cycle_id, sequence, session_id, created_at, workspace_hash, input_hash, input_json FROM memory_cognition_model_inputs ORDER BY cycle_id ASC, sequence ASC LIMIT ?').all(boundedLimit)
        : db.prepare('SELECT record_id, cycle_id, sequence, session_id, created_at, workspace_hash, input_hash, input_json FROM memory_cognition_model_inputs WHERE cycle_id = ? ORDER BY sequence ASC LIMIT ?').all(cycleId, boundedLimit)
      return (rows as CognitionModelInputRow[]).map(row => {
        const parsed = parseCognitionJson(row.input_json, 'model input')
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new MemoryProtocolError('model input must contain an object snapshot')
        }
        if (hashModelInput(parsed) !== row.input_hash) {
          throw new MemoryProtocolError('model input hash does not match its stored snapshot')
        }
        const record: MemoryModelInputRecord = {
          id: row.record_id,
          cycleId: row.cycle_id,
          sequence: row.sequence,
          createdAt: row.created_at,
          inputHash: row.input_hash,
          input: parsed as Record<string, unknown>,
        }
        if (row.session_id !== null) record.sessionId = row.session_id
        if (row.workspace_hash !== null) record.workspaceHash = row.workspace_hash
        return Object.freeze({ ...record, input: Object.freeze({ ...record.input }) })
      })
    } finally {
      db.close()
    }
  }

  /**
   * Reads the authorization ids that already have a committed erase in the
   * journal. Erase authorizations stay in materialized state after their
   * commit, so consumption must be answered from the event stream.
   */
  listEraseCommittedAuthorizationIds(): string[] {
    const db = openCognitionDatabase(this.dbPath)
    try {
      const rows = db.prepare(`
        SELECT event_json
        FROM memory_cognition_events
        WHERE event_type = 'erase-committed'
        ORDER BY event_seq ASC
      `).all() as Array<{ event_json: string }>
      return rows.map(row => {
        const parsed = parseCognitionJson(row.event_json, 'erase commit event')
        const payload = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>).payload
          : undefined
        if (payload === undefined || typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
          throw new MemoryProtocolError('erase commit event must contain a payload object')
        }
        const authorizationId = (payload as Record<string, unknown>).authorizationId
        if (typeof authorizationId !== 'string' || authorizationId.trim() === '') {
          throw new MemoryProtocolError('erase commit event must name its authorization id')
        }
        return authorizationId
      })
    } finally {
      db.close()
    }
  }


  prepareForArchive(): void {
    const db = openCognitionDatabase(this.dbPath)
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    } finally {
      db.close()
      secureDatabaseFiles(this.dbPath)
    }
  }
}
export type MemoryEraseAuthorization = Readonly<{
  authorizationId: MemoryAuthorizationId
  memoryIds: readonly MemoryId[]
  expiresAt: string
  scopeHash: string
}>

export type MemoryMaterializedState = Readonly<{
  version: number
  eventCount: number
  currentField: CurrentField
  lastTransactionId?: string
  memories: readonly RinMemory[]
  links: readonly MemoryLink[]
  predictions: readonly MemoryPredictionRecord[]
  actions: readonly MemoryActionRecord[]
  outcomes: readonly MemoryOutcomeRecord[]
  feedback: readonly MemoryFeedbackVector[]
  erasedMemoryIds: readonly MemoryId[]
  eraseAuthorizations: readonly MemoryEraseAuthorization[]
  appliedTransactionIds: readonly string[]
}>

function freezeMaterializedState(value: {
  version: number
  eventCount: number
  currentField: CurrentField
  lastTransactionId?: string
  memories: readonly RinMemory[]
  links: readonly MemoryLink[]
  predictions: readonly MemoryPredictionRecord[]
  actions: readonly MemoryActionRecord[]
  outcomes: readonly MemoryOutcomeRecord[]
  feedback: readonly MemoryFeedbackVector[]
  erasedMemoryIds: readonly MemoryId[]
  eraseAuthorizations: readonly MemoryEraseAuthorization[]
  appliedTransactionIds: readonly string[]
}): MemoryMaterializedState {
  const state: {
    version: number
    eventCount: number
    currentField: CurrentField
    lastTransactionId?: string
    memories: readonly RinMemory[]
    links: readonly MemoryLink[]
    erasedMemoryIds: readonly MemoryId[]
    predictions: readonly MemoryPredictionRecord[]
    actions: readonly MemoryActionRecord[]
    outcomes: readonly MemoryOutcomeRecord[]
    feedback: readonly MemoryFeedbackVector[]
    eraseAuthorizations: readonly MemoryEraseAuthorization[]
    appliedTransactionIds: readonly string[]
  } = {
    version: value.version,
    eventCount: value.eventCount,
    currentField: value.currentField,
    memories: Object.freeze([...value.memories]),
    links: Object.freeze([...value.links]),
    predictions: Object.freeze([...value.predictions]),
    actions: Object.freeze([...value.actions]),
    outcomes: Object.freeze([...value.outcomes]),
    feedback: Object.freeze([...value.feedback]),
    erasedMemoryIds: Object.freeze([...value.erasedMemoryIds]),
    eraseAuthorizations: Object.freeze(value.eraseAuthorizations.map(authorization => Object.freeze({
      ...authorization,
      memoryIds: Object.freeze([...authorization.memoryIds]),
    }))),
    appliedTransactionIds: Object.freeze([...value.appliedTransactionIds]),
  }
  if (value.lastTransactionId !== undefined) state.lastTransactionId = value.lastTransactionId
  return Object.freeze(state)
}

export function createEmptyMaterializedState(): MemoryMaterializedState {
  return freezeMaterializedState({
    version: 0,
    eventCount: 0,
    currentField: createEmptyCurrentField(),
    memories: [],
    links: [],
    predictions: [],
    actions: [],
    outcomes: [],
    feedback: [],
    erasedMemoryIds: [],
    eraseAuthorizations: [],
    appliedTransactionIds: [],
  })
}

function requireMaterializedMemory(memories: ReadonlyMap<string, RinMemory>, memoryId: string, eventType: string): RinMemory {
  const memory = memories.get(memoryId)
  if (memory === undefined) {
    throw new MemoryProtocolError(eventType + ' references a memory that has not been materialized')
  }
  return memory
}

function addMaterializedMemory(memories: Map<string, RinMemory>, erasedMemoryIds: ReadonlySet<string>, memory: RinMemory): void {
  if (erasedMemoryIds.has(memory.id)) {
    throw new MemoryProtocolError('erased memory cannot re-enter materialized state')
  }
  const existing = memories.get(memory.id)
  if (existing !== undefined && !isDeepStrictEqual(existing, memory)) {
    throw new MemoryProtocolError('root event conflicts with existing memory ' + memory.id)
  }
  memories.set(memory.id, memory)
}

function assertMaterializedTransition(actual: RinMemory, expected: RinMemory, eventType: string): void {
  if (!isDeepStrictEqual(actual, expected)) {
    throw new MemoryProtocolError(eventType + ' result does not match deterministic transition')
  }
}
function sameRuntimeEventRef(left: unknown, right: unknown): boolean {
  return isDeepStrictEqual(left, right)
}

function applyMaterializedSceneRevision(
  memories: Map<string, RinMemory>,
  eventType: 'scene-extended' | 'scene-closed',
  memoryId: string,
  previousVersion: string,
  nextMemory: RinMemory,
): void {
  const previous = requireMaterializedMemory(memories, memoryId, eventType)
  if (previous.form !== 'scene' || nextMemory.form !== 'scene') {
    throw new MemoryProtocolError(eventType + ' can only revise scene memories')
  }
  if (nextMemory.id !== memoryId) {
    throw new MemoryProtocolError(eventType + ' memory id does not match revision id')
  }
  if (memoryVersion(previous) !== previousVersion) {
    throw new MemoryProtocolError(eventType + ' previous version does not match materialized scene')
  }
  if (Date.parse(nextMemory.updatedAt) < Date.parse(previous.updatedAt)) {
    throw new MemoryProtocolError(eventType + ' cannot move scene backwards in time')
  }
  const previousLifecycle = previous.data.lifecycle
  const nextLifecycle = nextMemory.data.lifecycle
  if (previousLifecycle === undefined || nextLifecycle === undefined) {
    throw new MemoryProtocolError(eventType + ' requires scene lifecycle data')
  }
  if (
    previousLifecycle.continuityKey !== nextLifecycle.continuityKey
    || previousLifecycle.startedAt !== nextLifecycle.startedAt
  ) {
    throw new MemoryProtocolError(eventType + ' cannot change scene continuity or start time')
  }
  if (previousLifecycle.status !== 'open') {
    throw new MemoryProtocolError(eventType + ' cannot revise a closed scene')
  }
  if (eventType === 'scene-extended' && nextLifecycle.status !== 'open') {
    throw new MemoryProtocolError('scene-extended must keep the scene open')
  }
  if (eventType === 'scene-closed') {
    if (nextLifecycle.status !== 'closed' || nextLifecycle.endedAt !== nextMemory.updatedAt) {
      throw new MemoryProtocolError('scene-closed must close at its resulting version')
    }
  }
  const previousRefs = previous.data.runtimeEventRefs ?? []
  const nextRefs = nextMemory.data.runtimeEventRefs ?? []
  if (nextRefs.length < previousRefs.length) {
    throw new MemoryProtocolError(eventType + ' cannot remove runtime event references')
  }
  for (const previousRef of previousRefs) {
    if (!nextRefs.some(nextRef => sameRuntimeEventRef(previousRef, nextRef))) {
      throw new MemoryProtocolError(eventType + ' cannot remove a runtime event reference')
    }
  }
  if (eventType === 'scene-extended' && nextRefs.length <= previousRefs.length) {
    throw new MemoryProtocolError('scene-extended must append a runtime event reference')
  }
  memories.set(memoryId, nextMemory)
}
function applyMaterializedOpenLoopResolution(
  memories: Map<string, RinMemory>,
  sceneId: MemoryId,
  memoryId: MemoryId,
  previousVersion: string,
  nextMemory: RinMemory,
  eventType: string,
): void {
  const previous = requireMaterializedMemory(memories, memoryId, eventType)
  const scene = requireMaterializedMemory(memories, sceneId, eventType)
  if (scene.form !== 'scene') {
    throw new MemoryProtocolError(eventType + ' scene reference must target a scene memory')
  }
  if (previous.form !== 'open-loop' || nextMemory.form !== 'open-loop') {
    throw new MemoryProtocolError(eventType + ' can only resolve open-loop memories')
  }
  if (nextMemory.id !== memoryId) {
    throw new MemoryProtocolError(eventType + ' memory id does not match resolution id')
  }
  if (memoryVersion(previous) !== previousVersion) {
    throw new MemoryProtocolError(eventType + ' previous version does not match materialized open loop')
  }
  if (previous.data.status !== 'open') {
    throw new MemoryProtocolError(eventType + ' cannot resolve a non-open loop')
  }
  if (nextMemory.data.status !== 'resolved' || nextMemory.data.resolution === undefined) {
    throw new MemoryProtocolError(eventType + ' must resolve the loop with a resolution')
  }
  if (
    !previous.data.relatedMemoryIds.includes(sceneId)
    || !nextMemory.data.relatedMemoryIds.includes(sceneId)
  ) {
    throw new MemoryProtocolError(eventType + ' loop must remain related to its scene')
  }
  if (
    previous.data.goal !== nextMemory.data.goal
    || previous.data.description !== nextMemory.data.description
    || !isDeepStrictEqual(previous.data.relatedMemoryIds, nextMemory.data.relatedMemoryIds)
    || !isDeepStrictEqual(previous.data.origin, nextMemory.data.origin)
  ) {
    throw new MemoryProtocolError(eventType + ' cannot rewrite open-loop identity or origin')
  }
  if (Date.parse(nextMemory.updatedAt) < Date.parse(previous.updatedAt)) {
    throw new MemoryProtocolError(eventType + ' cannot move open-loop backwards in time')
  }
  memories.set(memoryId, nextMemory)
}


function sceneFromCurrentFieldEvents(events: readonly MemoryEvent[]): RinMemory | undefined {
  let scene: RinMemory | undefined
  for (const event of events) {
    switch (event.type) {
      case 'scene-opened':
        scene = event.payload.memory
        break
      case 'scene-extended':
      case 'scene-closed':
        scene = event.payload.memory
        break
      default:
        break
    }
  }
  return scene
}

function memoryRelatesToScene(
  memory: RinMemory,
  scene: Extract<RinMemory, { form: 'scene' }>,
  memories: readonly RinMemory[],
  links: readonly MemoryLink[],
  at: string,
): boolean {
  if (memory.form === 'open-loop' || memory.form === 'prospect') {
    return memory.data.relatedMemoryIds.some(id => String(id) === String(scene.id))
  }
  if (!isMemoryContextActiveForScene(memory, scene)) return false
  return links.some(link => {
    if (
      link.state !== 'active'
      || !isCurrentVersionLink(link, memories)
      || !isMemoryValidityActiveAt(link.validity, at)
    ) return false
    const from = String(link.from)
    const to = String(link.to)
    return (from === String(scene.id) && to === String(memory.id))
      || (from === String(memory.id) && to === String(scene.id))
  })
}
function canInfluenceAction(memory: RinMemory, at: string): boolean {
  return memory.state.persistence === 'durable'
    && memory.state.integration !== 'raw'
    && memory.state.influence === 'permitted'
    && memory.state.epistemic !== 'hypothesized'
    && memory.state.epistemic !== 'superseded'
    && memory.state.epistemic !== 'rejected'
    && isMemoryValidityActiveAt(memory.dynamics.validity, at)
    && memory.dynamics.influenceSurfaces.includes('model-input')
    && memory.dynamics.influenceSurfaces.includes('action-selection')
}
function matchesActionContext(candidate: string, context: readonly string[]): boolean {
  const normalizedCandidate = candidate.normalize('NFKC').toLocaleLowerCase().trim()
  if (normalizedCandidate === '') return false
  return context.some(value => {
    const normalizedContext = value.normalize('NFKC').toLocaleLowerCase().trim()
    return normalizedContext.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedContext)
  })
}
function deriveCandidateActionSources(
  scene: RinMemory,
  related: readonly RinMemory[],
  memories: readonly RinMemory[],
  links: readonly MemoryLink[],
  at: string,
): CurrentFieldActionSource[] {
  if (scene.form !== 'scene') return []
  const context = [scene.data.environment, ...scene.data.observations, ...scene.data.interpretations]
  const linkedMemoryIds = new Set<string>()
  for (const link of links) {
    if (
      link.state !== 'active'
      || !isCurrentVersionLink(link, memories)
      || !isMemoryValidityActiveAt(link.validity, at)
    ) continue
    // Only evidential edges may activate a disposition; conflict/context edges remain coalition evidence.
    if (link.relation !== 'supports' && link.relation !== 'derives') continue
    const from = String(link.from)
    const to = String(link.to)
    if (from !== String(scene.id) && to !== String(scene.id)) continue
    const otherId = from === String(scene.id) ? to : from
    linkedMemoryIds.add(otherId)
  }
  const candidateSources = new Map<string, Set<MemoryId>>()
  const addCandidate = (action: string, memoryId: MemoryId): void => {
    const sourceMemoryIds = candidateSources.get(action) ?? new Set<MemoryId>()
    sourceMemoryIds.add(memoryId)
    candidateSources.set(action, sourceMemoryIds)
  }
  for (const memory of memories) {
    if (memory.form !== 'disposition' || !canInfluenceAction(memory, at)) continue
    const applicable = scene.data.goals.includes(memory.data.intendedGoal)
      || memory.data.triggeringContexts.some(condition => matchesActionContext(condition, context))
      || linkedMemoryIds.has(String(memory.id))
    if (!applicable) continue
    for (const action of memory.data.actionPattern) addCandidate(action, memory.id)
  }
  for (const memory of related) {
    if (memory.form !== 'open-loop' || memory.data.status !== 'open' || !canInfluenceAction(memory, at)) continue
    addCandidate('address open loop: ' + memory.data.description, memory.id)
  }
  return [...candidateSources.entries()]
    .flatMap(([action, sourceMemoryIds]) => {
      const scored = [...sourceMemoryIds]
        .map(sourceId => memories.find(memory => String(memory.id) === String(sourceId)))
        .filter((memory): memory is RinMemory => memory !== undefined)
        .map(memory => ({ memory, metrics: actionCandidateMetrics(memory, scene) }))
      const leader = scored
        .slice()
        .sort((left, right) =>
          right.metrics.selectionValue - left.metrics.selectionValue
          || String(left.memory.id).localeCompare(String(right.memory.id)),
        )[0]
      if (leader === undefined) return []
      const corroboration = Math.min(0.12, Math.max(0, scored.length - 1) * 0.04)
      return [{
        action,
        sourceMemoryIds: [...sourceMemoryIds].sort(),
        utility: Math.max(...scored.map(item => item.metrics.utility)),
        inhibition: Math.max(...scored.map(item => item.metrics.inhibition)),
        selectionValue: clampActionValue(leader.metrics.selectionValue + corroboration, -1, 1),
        reasons: [...new Set([
          ...leader.metrics.reasons,
          ...(scored.length > 1 ? [scored.length + ' permitted memories support this action'] : []),
        ])],
      }]
    })
    .sort((left, right) =>
      right.selectionValue - left.selectionValue
      || right.utility - left.utility
      || left.action.localeCompare(right.action),
    )
}
function buildCurrentField(
  previous: CurrentField,
  memories: readonly RinMemory[],
  links: readonly MemoryLink[],
  events: readonly MemoryEvent[],
  version: number,
  committedAt: string,
): CurrentField {
  const eventScene = sceneFromCurrentFieldEvents(events)
  const previousScene = previous.sceneId === undefined
    ? undefined
    : memories.find(memory => memory.id === previous.sceneId)
  const sceneCandidate = eventScene ?? previousScene
  const scene = sceneCandidate === undefined
    ? undefined
    : memories.find(memory => memory.id === sceneCandidate.id)
  const updatedAt = Date.parse(committedAt) < Date.parse(previous.updatedAt)
    ? previous.updatedAt
    : committedAt
  if (scene?.form !== 'scene' || scene.data.lifecycle === undefined) {
    return createCurrentField({
      ownerId: previous.ownerId,
      version,
      updatedAt,
      participants: [],
      goals: [],
      affect: { valence: 0, arousal: 0, control: 0.5 },
      predictions: [],
      predictionErrors: [],
      activeOpenLoops: [],
      candidateActions: [],
      candidateActionSources: [],
      activeMemoryCoalition: [],
      uncertainty: [],
    })
  }
  const related = memories
    .filter(memory =>
      memory.id !== scene.id
      && memory.state.persistence !== 'archived'
      && memory.state.persistence !== 'erased'
      && isMemoryValidityActiveAt(memory.dynamics.validity, updatedAt)
      && memoryRelatesToScene(memory, scene, memories, links, updatedAt),
    )
    .sort((left, right) => left.id.localeCompare(right.id))
  const activeOpenLoops = related
    .filter(memory =>
      memory.form === 'open-loop'
      && memory.data.status === 'open'
      && memory.state.influence !== 'revoked'
      && memory.state.epistemic !== 'superseded'
      && memory.state.epistemic !== 'rejected',
    )
    .map(memory => memory.id)
  const predictions = related
    .filter(memory =>
      memory.form === 'prospect'
      && memory.data.kind === 'prediction'
      && memory.state.epistemic !== 'superseded'
      && memory.state.epistemic !== 'rejected',
    )
    .map(memory => memory.id)
  const uncertainty = related
    .filter(memory => memory.state.epistemic !== 'observed')
    .map(memory => memory.id + ':' + memory.state.epistemic)
  const candidateActionSources = deriveCandidateActionSources(scene, related, memories, links, updatedAt)
  return createCurrentField({
    ownerId: previous.ownerId,
    version,
    updatedAt,
    sceneId: scene.id,
    sceneVersion: memoryVersion(scene),
    sceneStatus: scene.data.lifecycle.status,
    participants: [...scene.data.participants],
    goals: [...scene.data.goals],
    affect: { ...scene.data.affect },
    predictions,
    predictionErrors: scene.data.predictionErrors.map(error => ({ ...error })),
    activeOpenLoops,
    candidateActions: candidateActionSources.map(source => source.action),
    candidateActionSources,
    activeMemoryCoalition: [scene.id, ...related.map(memory => memory.id)],
    uncertainty,
  })
}

function addMaterializedLinks(
  links: Map<string, MemoryLink>,
  memories: ReadonlyMap<string, RinMemory>,
  values: readonly MemoryLink[],
  eventType: string,
): void {
  for (const value of values) {
    const link = createMemoryLink(value)
    const existing = links.get(link.id)
    if (existing !== undefined) {
      if (!isDeepStrictEqual(existing, link)) {
        throw new MemoryProtocolError(eventType + ' conflicts with existing link ' + link.id)
      }
      continue
    }
    const from = requireMaterializedMemory(memories, link.from, eventType)
    const to = requireMaterializedMemory(memories, link.to, eventType)
    assertMemoryLinkSemantics(link, from, to)
    if (link.fromVersion !== memoryVersion(from)) {
      throw new MemoryProtocolError(eventType + ' source version does not match link ' + link.id)
    }
    if (link.toVersion !== memoryVersion(to)) {
      throw new MemoryProtocolError(eventType + ' target version does not match link ' + link.id)
    }
    links.set(link.id, link)
  }
}

function addProposalSupportLinks(
  links: Map<string, MemoryLink>,
  memories: ReadonlyMap<string, RinMemory>,
  candidate: MemoryCandidate,
  eventType: string,
): void {
  for (const sourceMemoryId of candidate.sourceMemoryIds ?? []) {
    const source = requireMaterializedMemory(memories, sourceMemoryId, eventType)
    const target = requireMaterializedMemory(memories, candidate.memory.id, eventType)
    const link = createMemoryLink({
      id: createLinkId(
        'proposal-support-' + createHash('sha256')
          .update(String(source.id) + '\u0000' + String(target.id) + '\u0000' + source.updatedAt + '\u0000' + target.updatedAt)
          .digest('hex')
          .slice(0, 32),
      ),
      from: source.id,
      relation: 'supports',
      to: target.id,
      fromVersion: memoryVersion(source),
      toVersion: memoryVersion(target),
      strength: 1,
      validity: { startsAt: target.updatedAt },
      state: 'active',
      createdAt: target.updatedAt,
      updatedAt: target.updatedAt,
    })
    addMaterializedLinks(links, memories, [link], eventType)
  }
}
function applyMaterializedRepresentationFormation(
  result: MemoryRepresentationFormationResult,
  memories: Map<string, RinMemory>,
  links: Map<string, MemoryLink>,
  erasedMemoryIds: ReadonlySet<string>,
  eventType: string,
  occurredAt: string,
): void {
  const previous = requireMaterializedMemory(memories, result.memoryId, eventType)
  const next = createMemory(result.memory)
  if (previous.updatedAt !== result.previousVersion) {
    throw new MemoryProtocolError(eventType + ' previous version does not match materialized memory')
  }
  if (next.id !== result.memoryId || next.updatedAt !== occurredAt) {
    throw new MemoryProtocolError(eventType + ' resulting memory identity or timestamp is invalid')
  }
  if (
    previous.state.persistence !== 'transient'
    || previous.state.integration !== 'raw'
    || previous.state.influence !== 'blocked'
  ) {
    throw new MemoryProtocolError(eventType + ' source must be transient, raw, and blocked')
  }
  let expected = previous
  for (const type of ['encode', 'durable', 'link', 'consolidate', 'integrate'] as const) {
    expected = transitionMemory(expected, { type, at: next.updatedAt })
  }
  if (!isDeepStrictEqual(next, expected)) {
    throw new MemoryProtocolError(eventType + ' must follow the canonical formation state sequence')
  }
  if (
    next.state.persistence !== 'durable'
    || next.state.integration !== 'integrated'
    || next.state.influence !== 'blocked'
    || next.dynamics.influenceSurfaces.length !== 0
  ) {
    throw new MemoryProtocolError(eventType + ' cannot cross the influence boundary')
  }
  const sourceIds = result.sourceSceneIds.map(String)
  if (new Set(sourceIds).size !== sourceIds.length || sourceIds.some(id => id === String(result.memoryId))) {
    throw new MemoryProtocolError(eventType + ' source scenes must be unique and cannot include the target')
  }
  for (const sourceId of sourceIds) {
    if (erasedMemoryIds.has(sourceId)) {
      throw new MemoryProtocolError(eventType + ' cannot use an erased source scene')
    }
    const source = requireMaterializedMemory(memories, sourceId, eventType)
    if (source.form !== 'scene') {
      throw new MemoryProtocolError(eventType + ' source must be a scene memory')
    }
    if (source.state.persistence === 'archived' || source.state.persistence === 'erased') {
      throw new MemoryProtocolError(eventType + ' archived or erased scene cannot support a representation')
    }
  }
  for (const [linkId, link] of links) {
    if (link.state === 'active' && (String(link.from) === String(result.memoryId) || String(link.to) === String(result.memoryId))) {
      links.set(linkId, createMemoryLink({
        ...link,
        state: 'retracted',
        updatedAt: occurredAt,
      }))
    }
  }
  memories.set(String(result.memoryId), next)
  for (const sourceId of sourceIds) {
    const source = memories.get(sourceId)
    if (source === undefined) throw new MemoryProtocolError(eventType + ' source disappeared during formation')
    const link = createMemoryLink({
      id: createLinkId(
        'formation-support-' + createHash('sha256')
          .update(sourceId + '\u0000' + String(next.id) + '\u0000' + source.updatedAt + '\u0000' + next.updatedAt)
          .digest('hex')
          .slice(0, 32),
      ),
      from: source.id,
      relation: 'supports',
      to: next.id,
      fromVersion: source.updatedAt,
      toVersion: next.updatedAt,
      strength: 1,
      validity: { startsAt: next.updatedAt },
      state: 'active',
      createdAt: next.updatedAt,
      updatedAt: next.updatedAt,
    })
    addMaterializedLinks(links, memories, [link], eventType)
  }
}

function assertSupportDependencies(
  links: ReadonlyMap<string, MemoryLink>,
  memories: ReadonlyMap<string, RinMemory>,
  target: RinMemory,
  eventType: string,
  erasedMemoryIds: ReadonlySet<string>,
): void {
  const supportLinks = [...links.values()].filter((link) => link.relation === 'supports' && link.to === target.id)
  if (supportLinks.length === 0) return
  for (const link of supportLinks) {
    if (link.state !== 'active') {
      if (!erasedMemoryIds.has(String(link.from))) continue
      throw new MemoryProtocolError(eventType + ' has a retracted support dependency for ' + target.id)
    }
    const source = memories.get(String(link.from))
    if (source === undefined || link.fromVersion !== memoryVersion(source) || link.toVersion !== memoryVersion(target)) {
      throw new MemoryProtocolError(eventType + ' has a stale support dependency for ' + target.id)
    }
  }
}
function applyMaterializedConsolidation(
  result: MemoryConsolidationResult,
  memories: Map<string, RinMemory>,
  links: Map<string, MemoryLink>,
  erasedMemoryIds: ReadonlySet<string>,
  eventType: string,
  occurredAt: string,
): void {
  const previous = requireMaterializedMemory(memories, result.memoryId, eventType)
  if (result.resultingMemories.some((memory) => memory.state.influence === 'permitted')) {
    assertSupportDependencies(links, memories, previous, eventType, erasedMemoryIds)
  }
  if (previous.updatedAt !== result.previousVersion) {
    throw new MemoryProtocolError(eventType + ' previous version does not match materialized memory')
  }
  if (result.labile.memoryId !== result.memoryId || result.labile.memoryVersion !== result.previousVersion) {
    throw new MemoryProtocolError(eventType + ' labile window does not match its source version')
  }
  const source = result.resultingMemories[0]
  if (source === undefined || source.id !== result.memoryId) {
    throw new MemoryProtocolError(eventType + ' must return the source identity first')
  }
  if (source.updatedAt === previous.updatedAt) {
    throw new MemoryProtocolError(eventType + ' must create a new source version')
  }
  if (
    (result.operation === 'reinforce' || result.operation === 'revise' || result.operation === 'contest' || result.operation === 'reject')
    && result.resultingMemories.length !== 1
  ) {
    throw new MemoryProtocolError(eventType + ' operation has an invalid result count')
  }
  if (result.operation === 'supersede' && result.resultingMemories.length !== 2) {
    throw new MemoryProtocolError(eventType + ' supersede must return one replacement')
  }
  if (result.operation === 'split' && result.resultingMemories.length < 3) {
    throw new MemoryProtocolError(eventType + ' split must return at least two parts')
  }
  if (result.operation === 'contest' && source.state.epistemic !== 'contested') {
    throw new MemoryProtocolError(eventType + ' contest must produce a contested source')
  }
  if ((result.operation === 'supersede' || result.operation === 'split') && source.state.epistemic !== 'superseded') {
    throw new MemoryProtocolError(eventType + ' must supersede its source')
  }
  if (result.operation === 'reject' && (source.state.epistemic !== 'rejected' || source.state.influence !== 'blocked')) {
    throw new MemoryProtocolError(eventType + ' reject must block the source')
  }
  const resultingIds = new Set<string>()
  for (const [index, memory] of result.resultingMemories.entries()) {
    if (resultingIds.has(memory.id)) {
      throw new MemoryProtocolError(eventType + ' result contains duplicate memory identity')
    }
    resultingIds.add(memory.id)
    if (index > 0 && memories.has(memory.id)) {
      throw new MemoryProtocolError(eventType + ' replacement identity already exists')
    }
    if (erasedMemoryIds.has(memory.id)) {
      throw new MemoryProtocolError(eventType + ' result reintroduces erased memory')
    }
  }
  for (const [linkId, link] of links) {
    if (link.state === 'active' && (link.from === result.memoryId || link.to === result.memoryId)) {
      links.set(linkId, createMemoryLink({
        ...link,
        state: 'retracted',
        updatedAt: occurredAt,
      }))
    }
  }
  memories.set(result.memoryId, source)
  for (const memory of result.resultingMemories.slice(1)) memories.set(memory.id, memory)
}

function applyMaterializedDecay(
  result: MemoryDecayResult,
  memories: Map<string, RinMemory>,
  links: Map<string, MemoryLink>,
  erasedMemoryIds: ReadonlySet<string>,
  eventType: string,
  occurredAt: string,
): void {
  const previous = requireMaterializedMemory(memories, result.memoryId, eventType)
  if (erasedMemoryIds.has(result.memoryId)) {
    throw new MemoryProtocolError(eventType + ' cannot reintroduce erased memory')
  }
  if (previous.updatedAt !== result.previousVersion) {
    throw new MemoryProtocolError(eventType + ' previous version does not match materialized memory')
  }
  const next = createMemory(result.memory)
  if (next.id !== result.memoryId || next.updatedAt !== occurredAt) {
    throw new MemoryProtocolError(eventType + ' resulting memory identity or timestamp is invalid')
  }
  if (result.elapsedMs !== Date.parse(next.updatedAt) - Date.parse(previous.updatedAt)) {
    throw new MemoryProtocolError(eventType + ' elapsedMs does not match the version time delta')
  }
  if (next.dynamics.accessibility > previous.dynamics.accessibility) {
    throw new MemoryProtocolError(eventType + ' cannot increase accessibility')
  }
  const expectedMemory = createMemory({
    ...previous,
    updatedAt: next.updatedAt,
    dynamics: {
      ...previous.dynamics,
      accessibility: next.dynamics.accessibility,
    },
  })
  if (!isDeepStrictEqual(next, expectedMemory)) {
    throw new MemoryProtocolError(eventType + ' may change only accessibility and version')
  }
  const activeIncident = [...links.values()]
    .filter(link => link.state === 'active' && (link.from === result.memoryId || link.to === result.memoryId))
  const resultLinks = new Map<string, MemoryLink>()
  for (const link of result.links) {
    const nextLink = createMemoryLink(link)
    if (resultLinks.has(nextLink.id)) throw new MemoryProtocolError(eventType + ' contains duplicate link identity')
    resultLinks.set(nextLink.id, nextLink)
  }
  if (resultLinks.size !== activeIncident.length) {
    throw new MemoryProtocolError(eventType + ' must return every active incident link exactly once')
  }
  for (const previousLink of activeIncident) {
    const nextLink = resultLinks.get(previousLink.id)
    if (nextLink === undefined) throw new MemoryProtocolError(eventType + ' omits active incident link ' + previousLink.id)
    if (nextLink.strength > previousLink.strength || nextLink.updatedAt !== occurredAt) {
      throw new MemoryProtocolError(eventType + ' link decay is not monotonic or timestamped')
    }
    const expectedLink = createMemoryLink({
      ...previousLink,
      fromVersion: previousLink.from === result.memoryId ? next.updatedAt : previousLink.fromVersion,
      toVersion: previousLink.to === result.memoryId ? next.updatedAt : previousLink.toVersion,
      strength: nextLink.strength,
      updatedAt: occurredAt,
    })
    if (!isDeepStrictEqual(nextLink, expectedLink)) {
      throw new MemoryProtocolError(eventType + ' may change only incident endpoint versions, strength, and updatedAt')
    }
    links.set(previousLink.id, nextLink)
  }
  memories.set(result.memoryId, next)
}


function addBehaviorRecord<T extends { id: string }>(records: Map<string, T>, record: T, eventType: string): void {
  const existing = records.get(record.id)
  if (existing !== undefined && !isDeepStrictEqual(existing, record)) {
    throw new MemoryProtocolError(eventType + ' conflicts with existing record ' + record.id)
  }
  records.set(record.id, record)
}

function requireBehaviorRecord<T extends { id: string }>(records: ReadonlyMap<string, T>, id: string, eventType: string): T {
  const record = records.get(id)
  if (record === undefined) {
    throw new MemoryProtocolError(eventType + ' references a behavior record that has not been materialized: ' + id)
  }
  return record
}

function assertBehaviorMemoryReference(
  memories: ReadonlyMap<string, RinMemory>,
  erasedMemoryIds: ReadonlySet<string>,
  memoryId: string,
  eventType: string,
  form?: RinMemory['form'],
): RinMemory {
  if (erasedMemoryIds.has(memoryId)) {
    throw new MemoryProtocolError(eventType + ' references an erased memory: ' + memoryId)
  }
  const memory = requireMaterializedMemory(memories, memoryId, eventType)
  if (form !== undefined && memory.form !== form) {
    throw new MemoryProtocolError(eventType + ' memory reference must target ' + form)
  }
  return memory
}

function eraseBehaviorReferences(
  memoryIds: ReadonlySet<string>,
  predictions: Map<string, MemoryPredictionRecord>,
  actions: Map<string, MemoryActionRecord>,
  outcomes: Map<string, MemoryOutcomeRecord>,
  feedback: Map<string, MemoryFeedbackVector>,
): void {
  const removedPredictions = new Set<string>()
  for (const [id, prediction] of predictions) {
    if (prediction.sourceMemoryIds.some(memoryId => memoryIds.has(memoryId))) {
      removedPredictions.add(id)
      predictions.delete(id)
    }
  }
  const removedActions = new Set<string>()
  for (const [id, action] of actions) {
    if (
      action.sourceMemoryIds.some(memoryId => memoryIds.has(memoryId))
      || action.predictionIds.some(predictionId => removedPredictions.has(predictionId))
    ) {
      removedActions.add(id)
      actions.delete(id)
    }
  }
  const removedOutcomes = new Set<string>()
  for (const [id, outcome] of outcomes) {
    if (removedActions.has(outcome.actionId) || (outcome.predictionId !== undefined && removedPredictions.has(outcome.predictionId))) {
      removedOutcomes.add(id)
      outcomes.delete(id)
    }
  }
  for (const [id, vector] of feedback) {
    if (
      (vector.sceneId !== undefined && memoryIds.has(vector.sceneId))
      || (vector.dispositionId !== undefined && memoryIds.has(vector.dispositionId))
      || (vector.predictionId !== undefined && removedPredictions.has(vector.predictionId))
      || (vector.actionId !== undefined && removedActions.has(vector.actionId))
      || (vector.outcomeId !== undefined && removedOutcomes.has(vector.outcomeId))
    ) {
      feedback.delete(id)
    }
  }
}


function normalizePredictionText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim()
}

/** Derives a deterministic coarse signal; it is not a semantic truth scorer. */
function predictionErrorMagnitude(outcome: MemoryOutcomeRecord, prediction: MemoryPredictionRecord): number {
  if (outcome.status === 'failed') return 1
  if (outcome.status === 'partial') return 0.5
  if (outcome.status === 'unknown') return 0.75
  return normalizePredictionText(outcome.description) === normalizePredictionText(prediction.expectedOutcome) ? 0 : 0.5
}

function reconcilePredictionErrors(
  memories: Map<string, RinMemory>,
  predictions: ReadonlyMap<string, MemoryPredictionRecord>,
  actions: ReadonlyMap<string, MemoryActionRecord>,
  outcomes: ReadonlyMap<string, MemoryOutcomeRecord>,
  feedback: ReadonlyMap<string, MemoryFeedbackVector>,
): void {
  const derived = new Map<string, MemoryPredictionError[]>()
  const add = (sceneId: string, error: MemoryPredictionError): void => {
    const errors = derived.get(sceneId) ?? []
    const key = error.expected + '\u0000' + error.actual + '\u0000' + error.magnitude
    if (!errors.some(item => item.expected + '\u0000' + item.actual + '\u0000' + item.magnitude === key)) errors.push(error)
    derived.set(sceneId, errors)
  }
  for (const outcome of outcomes.values()) {
    const action = actions.get(String(outcome.actionId))
    const predictionId = outcome.predictionId
      ?? (action?.predictionIds.length === 1 ? action.predictionIds[0] : undefined)
    const prediction = predictionId === undefined ? undefined : predictions.get(String(predictionId))
    if (action === undefined || prediction === undefined) continue
    const error: MemoryPredictionError = {
      expected: prediction.expectedOutcome,
      actual: outcome.description,
      magnitude: predictionErrorMagnitude(outcome, prediction),
    }
    const sceneIds = new Set([
      ...prediction.sourceMemoryIds.map(String),
      ...action.sourceMemoryIds.map(String),
    ])
    for (const sceneId of sceneIds) {
      if (memories.get(sceneId)?.form === 'scene') add(sceneId, error)
    }
  }
  for (const vector of feedback.values()) {
    if (vector.factualCorrection === undefined) continue
    const linkedOutcome = vector.outcomeId === undefined
      ? undefined
      : outcomes.get(String(vector.outcomeId))
    const actionId = vector.actionId ?? linkedOutcome?.actionId
    const action = actionId === undefined ? undefined : actions.get(String(actionId))
    const predictionId = vector.predictionId
      ?? linkedOutcome?.predictionId
      ?? (action?.predictionIds.length === 1 ? action.predictionIds[0] : undefined)
    const prediction = predictionId === undefined ? undefined : predictions.get(String(predictionId))
    if (prediction === undefined) continue
    const error: MemoryPredictionError = {
      expected: prediction.expectedOutcome,
      actual: vector.factualCorrection,
      magnitude: 1,
    }
    const sceneIds = new Set([
      ...(vector.sceneId === undefined ? [] : [String(vector.sceneId)]),
      ...prediction.sourceMemoryIds.map(String),
      ...(action?.sourceMemoryIds.map(String) ?? []),
    ])
    for (const sceneId of sceneIds) {
      if (memories.get(sceneId)?.form === 'scene') add(sceneId, error)
    }
  }
  for (const [id, memory] of memories) {
    if (memory.form !== 'scene') continue
    const errors = derived.get(String(id)) ?? []
    if (!isDeepStrictEqual(memory.data.predictionErrors, errors)) {
      memories.set(id, createMemory({
        ...memory,
        data: { ...memory.data, predictionErrors: errors },
      }))
    }
  }
}
function applyBehaviorEvent(
  event: MemoryEvent,
  memories: Map<string, RinMemory>,
  erasedMemoryIds: Set<string>,
  predictions: Map<string, MemoryPredictionRecord>,
  actions: Map<string, MemoryActionRecord>,
  outcomes: Map<string, MemoryOutcomeRecord>,
  feedback: Map<string, MemoryFeedbackVector>,
): void {
  switch (event.type) {
    case 'prediction-recorded': {
      const prediction = event.payload.prediction
      for (const memoryId of prediction.sourceMemoryIds) {
        assertBehaviorMemoryReference(memories, erasedMemoryIds, memoryId, event.type)
      }
      addBehaviorRecord(predictions, prediction, event.type)
      return
    }
    case 'action-recorded': {
      const action = event.payload.action
      for (const memoryId of action.sourceMemoryIds) {
        assertBehaviorMemoryReference(memories, erasedMemoryIds, memoryId, event.type)
      }
      for (const predictionId of action.predictionIds) {
        const prediction = requireBehaviorRecord(predictions, predictionId, event.type)
        if (prediction.cycleId !== action.cycleId) throw new MemoryProtocolError(event.type + ' prediction cycle does not match action cycle')
      }
      addBehaviorRecord(actions, action, event.type)
      return
    }
    case 'outcome-recorded': {
      const outcome = event.payload.outcome
      const action = requireBehaviorRecord(actions, outcome.actionId, event.type)
      if (action.cycleId !== outcome.cycleId) throw new MemoryProtocolError(event.type + ' action cycle does not match outcome cycle')
      if (outcome.predictionId !== undefined) {
        requireBehaviorRecord(predictions, outcome.predictionId, event.type)
        if (!action.predictionIds.includes(outcome.predictionId)) {
          throw new MemoryProtocolError(event.type + ' prediction is not one of the action predictions')
        }
      }
      addBehaviorRecord(outcomes, outcome, event.type)
      return
    }
    case 'feedback-recorded': {
      const vector = event.payload.feedback
      let boundAction: MemoryActionRecord | undefined
      let boundPrediction: MemoryPredictionRecord | undefined
      let boundOutcome: MemoryOutcomeRecord | undefined
      if (vector.actionId !== undefined) {
        const action = requireBehaviorRecord(actions, vector.actionId, event.type)
        boundAction = action
        if (action.cycleId !== vector.cycleId) throw new MemoryProtocolError(event.type + ' action cycle does not match feedback cycle')
      }
      if (vector.predictionId !== undefined) {
        const prediction = requireBehaviorRecord(predictions, vector.predictionId, event.type)
        boundPrediction = prediction
        if (prediction.cycleId !== vector.cycleId) throw new MemoryProtocolError(event.type + ' prediction cycle does not match feedback cycle')
      }
      if (vector.outcomeId !== undefined) {
        const outcome = requireBehaviorRecord(outcomes, vector.outcomeId, event.type)
        boundOutcome = outcome
        if (outcome.cycleId !== vector.cycleId) throw new MemoryProtocolError(event.type + ' outcome cycle does not match feedback cycle')
      }
      if (boundAction !== undefined && boundPrediction !== undefined && !boundAction.predictionIds.includes(boundPrediction.id)) {
        throw new MemoryProtocolError(event.type + ' prediction is not one of the action predictions')
      }
      if (boundAction !== undefined && boundOutcome !== undefined && boundOutcome.actionId !== boundAction.id) {
        throw new MemoryProtocolError(event.type + ' outcome does not belong to the action')
      }
      if (
        boundPrediction !== undefined
        && boundOutcome?.predictionId !== undefined
        && boundOutcome.predictionId !== boundPrediction.id
      ) {
        throw new MemoryProtocolError(event.type + ' prediction does not match the outcome')
      }
      if (vector.sceneId !== undefined) assertBehaviorMemoryReference(memories, erasedMemoryIds, vector.sceneId, event.type, 'scene')
      if (vector.dispositionId !== undefined) assertBehaviorMemoryReference(memories, erasedMemoryIds, vector.dispositionId, event.type, 'disposition')
      addBehaviorRecord(feedback, vector, event.type)
      return
    }
    default:
      return
  }
}
function applyDispositionLearning(
  result: MemoryDispositionLearningResult,
  memories: Map<string, RinMemory>,
  predictions: ReadonlyMap<string, MemoryPredictionRecord>,
  actions: ReadonlyMap<string, MemoryActionRecord>,
  outcomes: ReadonlyMap<string, MemoryOutcomeRecord>,
  feedback: ReadonlyMap<string, MemoryFeedbackVector>,
  eventType: string,
): void {
  const previous = requireMaterializedMemory(memories, String(result.dispositionId), eventType)
  if (previous.form !== 'disposition') throw new MemoryProtocolError(eventType + ' target must be a disposition')
  if (previous.updatedAt !== result.previousVersion) {
    throw new MemoryProtocolError(eventType + ' previous version does not match the disposition')
  }
  const action = requireBehaviorRecord(actions, String(result.actionId), eventType)
  const expected = learnDispositionFromFeedback({
    disposition: previous,
    action,
    outcomes: [...outcomes.values()],
    feedback: [...feedback.values()],
    predictions: [...predictions.values()],
    at: result.memory.updatedAt,
    explanation: result.explanation,
  })
  if (!isDeepStrictEqual(expected, result)) {
    throw new MemoryProtocolError(eventType + ' result does not match deterministic disposition learning')
  }
  memories.set(previous.id, createMemory(result.memory))
}
function applyMaterializedEvent(
  event: MemoryEvent,
  memories: Map<string, RinMemory>,
  links: Map<string, MemoryLink>,
  erasedMemoryIds: Set<string>,
  eraseAuthorizations: Map<string, MemoryEraseAuthorization>,
  predictions: Map<string, MemoryPredictionRecord>,
  actions: Map<string, MemoryActionRecord>,
  outcomes: Map<string, MemoryOutcomeRecord>,
  feedback: Map<string, MemoryFeedbackVector>,
): void {
  applyBehaviorEvent(event, memories, erasedMemoryIds, predictions, actions, outcomes, feedback)
  switch (event.type) {
    case 'memory-observed':
      addMaterializedMemory(memories, erasedMemoryIds, event.payload.memory)
      return
    case 'disposition-learned':
      applyDispositionLearning(
        event.payload.result,
        memories,
        predictions,
        actions,
        outcomes,
        feedback,
        event.type,
      )
      return
    case 'memory-used':
      return
    case 'memory-consolidated':
      applyMaterializedConsolidation(
        event.payload.result,
        memories,
        links,
        erasedMemoryIds,
        event.type,
        event.occurredAt,
      )
      return
    case 'memory-decayed':
      applyMaterializedDecay(event.payload.result, memories, links, erasedMemoryIds, event.type, event.occurredAt)
      return
    case 'scene-opened':
      addMaterializedMemory(memories, erasedMemoryIds, event.payload.memory)
      return
    case 'scene-extended':
    case 'scene-closed':
      applyMaterializedSceneRevision(
        memories,
        event.type,
        event.payload.memoryId,
        event.payload.previousVersion,
        event.payload.memory,
      )
      return
    case 'open-loop-opened':
      if (requireMaterializedMemory(memories, event.payload.sceneId, event.type).form !== 'scene') throw new MemoryProtocolError(event.type + ' scene reference must target a scene memory')
      addMaterializedMemory(memories, erasedMemoryIds, event.payload.memory)
      return
    case 'open-loop-resolved':
      applyMaterializedOpenLoopResolution(
        memories,
        event.payload.sceneId,
        event.payload.memoryId,
        event.payload.previousVersion,
        event.payload.memory,
        event.type,
      )
      return
    case 'memory-proposed':
      addMaterializedMemory(memories, erasedMemoryIds, event.payload.candidate.memory)
      addProposalSupportLinks(links, memories, event.payload.candidate, event.type)
      return
    case 'memory-formed':
      applyMaterializedRepresentationFormation(
        event.payload.result,
        memories,
        links,
        erasedMemoryIds,
        event.type,
        event.occurredAt,
      )
      return
    case 'memory-linked':
      addMaterializedLinks(links, memories, event.payload.links, event.type)
      return
    case 'memory-transitioned': {
      const previous = requireMaterializedMemory(memories, event.payload.memoryId, event.type)
      const actual = transitionMemory(previous, event.payload.transition)
      const expected = createMemory(event.payload.memory)
      assertMaterializedTransition(actual, expected, event.type)
      memories.set(event.payload.memoryId, expected)
      return
    }
    case 'memory-corrected': {
      requireMaterializedMemory(memories, event.payload.memoryId, event.type)
      memories.set(event.payload.memoryId, createMemory(event.payload.memory))
      return
    }
    case 'influence-permitted': {
      const previous = requireMaterializedMemory(memories, event.payload.memoryId, event.type)
      if (memoryVersion(previous) !== event.payload.previousVersion) {
        throw new MemoryProtocolError(event.type + ' previous version does not match materialized memory')
      }
      assertSupportDependencies(links, memories, previous, event.type, erasedMemoryIds)
      const actual = transitionMemory(previous, {
        type: 'influence',
        to: 'permitted',
        surfaces: event.payload.surfaces,
        at: event.occurredAt,
      })
      const expected = createMemory(event.payload.memory)
      assertMaterializedTransition(actual, expected, event.type)
      memories.set(event.payload.memoryId, expected)
      return
    }
    case 'influence-restricted':
    case 'influence-revoked': {
      const previous = requireMaterializedMemory(memories, event.payload.memoryId, event.type)
      const actual = transitionMemory(previous, {
        type: 'influence',
        to: event.payload.state,
        surfaces: event.type === 'influence-restricted' ? event.payload.surfaces : [],
        at: event.occurredAt,
      })
      memories.set(event.payload.memoryId, actual)
      return
    }
    case 'erase-authorized': {
      const authorization: MemoryEraseAuthorization = {
        authorizationId: event.payload.authorizationId,
        memoryIds: [...event.payload.memoryIds],
        expiresAt: event.payload.expiresAt,
        scopeHash: event.payload.scopeHash,
      }
      const existing = eraseAuthorizations.get(authorization.authorizationId)
      if (existing !== undefined && !isDeepStrictEqual(existing, authorization)) {
        throw new MemoryProtocolError('erase authorization conflicts with existing authorization')
      }
      eraseAuthorizations.set(authorization.authorizationId, authorization)
      return
    }
    case 'erase-committed': {
      const authorization = eraseAuthorizations.get(event.payload.authorizationId)
      if (authorization === undefined) {
        throw new MemoryProtocolError('erase commit references an unknown authorization')
      }
      for (const memoryId of event.payload.memoryIds) {
        if (!authorization.memoryIds.includes(memoryId)) {
          throw new MemoryProtocolError('erase commit exceeds its authorized scope')
        }
        erasedMemoryIds.add(memoryId)
        memories.delete(memoryId)
      }
      for (const [linkId, link] of links) {
        if (link.state === 'active' && (event.payload.memoryIds.includes(link.from) || event.payload.memoryIds.includes(link.to))) {
          links.set(linkId, createMemoryLink({
            ...link,
            state: 'retracted',
            updatedAt: event.occurredAt,
          }))
        }
      }
      eraseBehaviorReferences(new Set(event.payload.memoryIds), predictions, actions, outcomes, feedback)
      return
    }
  }
}

export class MemoryMaterializer {
  apply(transaction: MemoryTransaction, previous = createEmptyMaterializedState()): MemoryMaterializedState {
    const normalized = normalizeCognitionTransaction(transaction)
    if (previous.appliedTransactionIds.includes(normalized.transactionId)) return previous
    const memories = new Map(previous.memories.map(memory => [memory.id, memory]))
    const erasedMemoryIds = new Set(previous.erasedMemoryIds)
    const links = new Map(previous.links.map(link => [link.id, link]))
    const eraseAuthorizations = new Map(previous.eraseAuthorizations.map(authorization => [authorization.authorizationId, authorization]))
    const predictions = new Map(previous.predictions.map(prediction => [prediction.id, prediction]))
    const actions = new Map(previous.actions.map(action => [action.id, action]))
    const outcomes = new Map(previous.outcomes.map(outcome => [outcome.id, outcome]))
    const feedback = new Map(previous.feedback.map(vector => [vector.id, vector]))
    for (const event of normalized.events) {
      applyMaterializedEvent(event, memories, links, erasedMemoryIds, eraseAuthorizations, predictions, actions, outcomes, feedback)
    }
    reconcilePredictionErrors(memories, predictions, actions, outcomes, feedback)
    const version = previous.version + 1
    const materializedMemories = [...memories.values()].sort((left, right) => left.id.localeCompare(right.id))
    const currentField = buildCurrentField(previous.currentField, materializedMemories, [...links.values()], normalized.events, version, normalized.committedAt)
    return freezeMaterializedState({
      version,
      eventCount: previous.eventCount + normalized.events.length,
      currentField,
      lastTransactionId: normalized.transactionId,
      memories: materializedMemories,
      predictions: [...predictions.values()].sort((left, right) => left.id.localeCompare(right.id)),
      actions: [...actions.values()].sort((left, right) => left.id.localeCompare(right.id)),
      outcomes: [...outcomes.values()].sort((left, right) => left.id.localeCompare(right.id)),
      feedback: [...feedback.values()].sort((left, right) => left.id.localeCompare(right.id)),
      links: [...links.values()].sort((left, right) => left.id.localeCompare(right.id)),
      erasedMemoryIds: [...erasedMemoryIds].sort((left, right) => left.localeCompare(right)) as MemoryId[],
      eraseAuthorizations: [...eraseAuthorizations.values()].sort((left, right) => left.authorizationId.localeCompare(right.authorizationId)),
      appliedTransactionIds: [...previous.appliedTransactionIds, normalized.transactionId],
    })
  }

  replay(transactions: readonly MemoryTransaction[]): MemoryMaterializedState {
    let state = createEmptyMaterializedState()
    for (const transaction of transactions) state = this.apply(transaction, state)
    return state
  }

  replayFrom(database: MemoryCognitionDatabase): MemoryMaterializedState {
    return this.replay(database.listTransactions())
  }
}

export function hashMaterializedState(state: MemoryMaterializedState): string {
  return createHash('sha256')
    .update(JSON.stringify({
      version: state.version,
      eventCount: state.eventCount,
      lastTransactionId: state.lastTransactionId ?? null,
      currentField: state.currentField,
      memories: state.memories,
      predictions: state.predictions,
      actions: state.actions,
      outcomes: state.outcomes,
      feedback: state.feedback,
      links: state.links,
      erasedMemoryIds: state.erasedMemoryIds,
      eraseAuthorizations: state.eraseAuthorizations,
      appliedTransactionIds: state.appliedTransactionIds,
    }))
    .digest('hex')
}

export type MemoryLinkQuery = Readonly<{
  from?: MemoryId
  to?: MemoryId
  relation?: MemoryLinkRelation
  state?: MemoryLinkState
}>

export function queryMaterializedLinks(
  state: MemoryMaterializedState,
  query: MemoryLinkQuery = {},
): readonly MemoryLink[] {
  return state.links.filter(link =>
    (query.from === undefined || link.from === query.from)
    && (query.to === undefined || link.to === query.to)
    && (query.relation === undefined || link.relation === query.relation)
    && (query.state === undefined || link.state === query.state),
  )
}

export type MemoryErasePreview = Readonly<{
  rootMemoryIds: readonly MemoryId[]
  erasedMemoryIds: readonly MemoryId[]
  retractedLinkIds: readonly string[]
  dependentMemoryIds: readonly MemoryId[]
  unaffectedMemoryIds: readonly MemoryId[]
  scopeHash: string
}>

/**
 * Computes the deterministic owner erase scope for one preview request.
 *
 * Erasure removes exactly the root memories. Derived impact is limited to the
 * active links their removal retracts and the support/derive dependents that
 * lose evidence; unrelated memories stay unaffected. The scope hash binds the
 * whole computed scope so a later authorization commit can reject drift.
 */
export function computeEraseScope(
  state: MemoryMaterializedState,
  rootMemoryIds: readonly MemoryId[],
): MemoryErasePreview {
  if (rootMemoryIds.length === 0) {
    throw new Error('rin memory: erase preview requires at least one root memory')
  }
  const knownMemories = new Set(state.memories.map(memory => String(memory.id)))
  const erased = new Set(state.erasedMemoryIds.map(memoryId => String(memoryId)))
  const rootSet = new Set<string>()
  for (const id of rootMemoryIds) {
    const key = String(id)
    if (erased.has(key)) {
      throw new Error('rin memory: erase preview references an already erased memory ' + key)
    }
    if (!knownMemories.has(key)) {
      throw new Error('rin memory: erase preview references an unknown memory ' + key)
    }
    rootSet.add(key)
  }
  const retractedLinkIds: string[] = []
  const dependents = new Set<string>()
  for (const link of state.links) {
    if (link.state !== 'active') continue
    const fromErased = rootSet.has(String(link.from))
    const toErased = rootSet.has(String(link.to))
    if (!fromErased && !toErased) continue
    retractedLinkIds.push(String(link.id))
    if (
      fromErased
      && !toErased
      && (link.relation === 'supports' || link.relation === 'derives')
    ) {
      dependents.add(String(link.to))
    }
  }
  const sortedRoots = [...rootSet].sort((left, right) => left.localeCompare(right))
  const sortedRetractedLinks = [...retractedLinkIds].sort((left, right) => left.localeCompare(right))
  const dependentMemoryIds = [...dependents].sort((left, right) => left.localeCompare(right)) as MemoryId[]
  const dependentSet = dependents
  const unaffectedMemoryIds = state.memories
    .map(memory => String(memory.id))
    .filter(id => !rootSet.has(id) && !dependentSet.has(id))
    .sort((left, right) => left.localeCompare(right)) as MemoryId[]
  const scopeHash = createHash('sha256')
    .update(JSON.stringify({
      roots: sortedRoots,
      retractedLinkIds: sortedRetractedLinks,
      dependentMemoryIds,
    }))
    .digest('hex')
  return {
    rootMemoryIds: sortedRoots as MemoryId[],
    erasedMemoryIds: sortedRoots as MemoryId[],
    retractedLinkIds: sortedRetractedLinks,
    dependentMemoryIds,
    unaffectedMemoryIds,
    scopeHash,
  }
}
export function assertMemoryInfluenceDependencies(
  state: MemoryMaterializedState,
  target: RinMemory,
  eventType = 'influence-permitted',
): void {
  const links = new Map<string, MemoryLink>(state.links.map(link => [String(link.id), link]))
  const memories = new Map<string, RinMemory>(state.memories.map(memory => [String(memory.id), memory]))
  assertSupportDependencies(links, memories, target, eventType, new Set(state.erasedMemoryIds.map(memoryId => String(memoryId))))
}
function clampActionValue(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : 0))
}
type ActionCandidateMetrics = Readonly<{
  utility: number
  inhibition: number
  selectionValue: number
  reasons: readonly string[]
}>
function actionCandidateMetrics(
  memory: RinMemory,
  scene: Extract<RinMemory, { form: 'scene' }>,
): ActionCandidateMetrics {
  const dispositionUtilities = memory.form === 'disposition'
    ? memory.data.utilityByGoal.filter(item =>
      scene.data.goals.length === 0 || scene.data.goals.includes(item.goalId),
    )
    : []
  const utility = dispositionUtilities.length === 0
    ? 0
    : Math.max(...dispositionUtilities.map(item => item.value))
  const inhibition = clampActionValue(memory.dynamics.inhibition, 0, 1)
  const accessibility = clampActionValue(memory.dynamics.accessibility, 0, 1)
  const salience = clampActionValue(memory.dynamics.salience, 0, 1)
  const openLoopPressure = memory.form === 'open-loop'
    ? clampActionValue(0.35 + 0.25 * salience + 0.2 * memory.dynamics.surprise + 0.2 * memory.dynamics.affect.arousal, 0, 1)
    : 0
  const selectionValue = clampActionValue(
    memory.form === 'open-loop'
      ? openLoopPressure + 0.15 * accessibility - 0.45 * inhibition
      : 0.55 * utility + 0.25 * accessibility + 0.2 * salience - 0.45 * inhibition,
    -1,
    1,
  )
  const reasons = [
    ...(memory.form === 'disposition'
      ? [(scene.data.goals.length === 0 ? 'contextual utility=' : 'goal utility=') + utility.toFixed(2)]
      : []),
    'accessibility=' + accessibility.toFixed(2),
    'salience=' + salience.toFixed(2),
    ...(inhibition === 0 ? [] : ['inhibition=' + inhibition.toFixed(2)]),
    ...(memory.form === 'open-loop' ? ['open-loop pressure=' + openLoopPressure.toFixed(2)] : []),
  ]
  return { utility, inhibition, selectionValue, reasons }
}
