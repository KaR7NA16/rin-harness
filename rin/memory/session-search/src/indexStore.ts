/**
 * Maintain the derived index: write sessions and external memory files,
 * delete sessions, and reconcile stale files against the live source set.
 *
 * @module @rin/session-search
 */

import type { SessionSearchDatabase } from './types.ts'
import { sessionKey } from './db.ts'
import {
  deleteProjectMemoryBySessionKey,
  projectMemoryFileSessionKey,
  upsertProjectMemoryFile,
  upsertProjectMemoryForParsedSession,
} from './projectMemory.ts'
import type {
  IndexedFileMetadata,
  ParsedSessionTranscript,
  ProjectMemoryFileIndexInput,
} from './types.ts'

/** Run a write operation inside one BEGIN/COMMIT transaction. */
function runTransaction<T>(db: SessionSearchDatabase, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error: unknown) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // A failed rollback leaves the original failure as the actionable cause.
    }
    throw error
  }
}

export function readIndexedFileMetadata(
  db: SessionSearchDatabase,
  filePath: string,
): IndexedFileMetadata | null {
  const row = db
    .prepare(
      'SELECT file_mtime_ms, file_size FROM indexed_files WHERE file_path = ?',
    )
    .get(filePath) as IndexedFileMetadata | undefined
  return row ?? null
}

export function readIndexedSessionFilePath(
  db: SessionSearchDatabase,
  key: string,
): string | null {
  const row = db
    .prepare('SELECT file_path FROM sessions WHERE session_key = ?')
    .get(key) as { file_path: string } | undefined
  return row?.file_path ?? null
}

export function isProjectMemoryFileIndexCurrent(
  db: SessionSearchDatabase,
  params: Pick<ProjectMemoryFileIndexInput, 'filePath' | 'projectPath' | 'fileMtimeMs' | 'fileSize'>,
): boolean {
  const indexed = readIndexedFileMetadata(db, params.filePath)
  if (!indexed || indexed.file_mtime_ms !== params.fileMtimeMs || indexed.file_size !== params.fileSize) {
    return false
  }
  const key = projectMemoryFileSessionKey(params)
  return Boolean(
    db.prepare('SELECT 1 FROM project_memories WHERE session_key = ?').get(key),
  )
}

export function writeProjectMemoryFileToSearchIndex(
  db: SessionSearchDatabase,
  params: ProjectMemoryFileIndexInput,
): boolean {
  return runTransaction(db, () => {
    const upsert = upsertProjectMemoryFile(db, params)
    if (!upsert) {
      deleteProjectMemoryBySessionKey(
        db,
        projectMemoryFileSessionKey(params),
      )
      db.prepare('DELETE FROM indexed_files WHERE file_path = ?').run(params.filePath)
      return false
    }

    db.prepare(
      `INSERT INTO indexed_files (
        file_path, session_key, session_id, project_path,
        file_mtime_ms, file_size, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        session_key = excluded.session_key,
        session_id = excluded.session_id,
        project_path = excluded.project_path,
        file_mtime_ms = excluded.file_mtime_ms,
        file_size = excluded.file_size,
        indexed_at = excluded.indexed_at`,
    ).run(
      params.filePath,
      upsert.sessionKey,
      upsert.sessionId,
      params.projectPath,
      params.fileMtimeMs,
      params.fileSize,
      new Date().toISOString(),
    )
    return true
  })
}

function deleteSessionMessageRows(db: SessionSearchDatabase, key: string): void {
  const ids = db
    .prepare('SELECT id FROM messages WHERE session_key = ?')
    .all(key) as Array<{ id: number }>
  const deleteFts = db.prepare('DELETE FROM messages_fts WHERE rowid = ?')
  const deleteTrigram = db.prepare(
    'DELETE FROM messages_fts_trigram WHERE rowid = ?',
  )
  for (const row of ids) {
    deleteFts.run(row.id)
    deleteTrigram.run(row.id)
  }
  db.prepare('DELETE FROM messages WHERE session_key = ?').run(key)
}

export function deleteSessionFromSearchIndexByKey(
  db: SessionSearchDatabase,
  key: string,
): void {
  runTransaction(db, () => {
    deleteSessionMessageRows(db, key)
    deleteProjectMemoryBySessionKey(db, key)
    db.prepare('DELETE FROM sessions WHERE session_key = ?').run(key)
    db.prepare('DELETE FROM indexed_files WHERE session_key = ?').run(key)
  })
}

export function deleteSessionsFromSearchIndex(
  db: SessionSearchDatabase,
  params: { sessionId: string; projectPath?: string },
): void {
  const rows = params.projectPath
    ? (db
        .prepare('SELECT session_key FROM sessions WHERE session_id = ? AND project_path = ?')
        .all(params.sessionId, params.projectPath) as Array<{ session_key: string }>)
    : (db
        .prepare('SELECT session_key FROM sessions WHERE session_id = ?')
        .all(params.sessionId) as Array<{ session_key: string }>)
  for (const row of rows) deleteSessionFromSearchIndexByKey(db, row.session_key)
}

export function reconcileSearchIndexFiles(
  db: SessionSearchDatabase,
  liveFilePaths: ReadonlySet<string>,
  projectPath?: string,
): void {
  const indexedFiles = projectPath
    ? (db
        .prepare('SELECT file_path, session_key FROM indexed_files WHERE project_path = ?')
        .all(projectPath) as Array<{ file_path: string; session_key: string }>)
    : (db
        .prepare('SELECT file_path, session_key FROM indexed_files')
        .all() as Array<{ file_path: string; session_key: string }>)

  for (const row of indexedFiles) {
    if (liveFilePaths.has(row.file_path)) continue
    const replacements = db
      .prepare('SELECT file_path FROM indexed_files WHERE session_key = ? AND file_path <> ?')
      .all(row.session_key, row.file_path) as Array<{ file_path: string }>
    if (replacements.some(candidate => liveFilePaths.has(candidate.file_path))) {
      db.prepare('DELETE FROM indexed_files WHERE file_path = ?').run(row.file_path)
      continue
    }
    deleteSessionFromSearchIndexByKey(db, row.session_key)
  }
}

export function writeSessionToSearchIndex(
  db: SessionSearchDatabase,
  parsed: ParsedSessionTranscript,
  options: { homeDir: string },
): void {
  const key = sessionKey(parsed.projectPath, parsed.sessionId)
  const now = new Date().toISOString()
  runTransaction(db, () => {
    db.prepare(
      'DELETE FROM indexed_files WHERE session_key = ? AND file_path <> ?',
    ).run(key, parsed.filePath)
    deleteSessionMessageRows(db, key)
    db.prepare(
      `INSERT INTO sessions (
        session_key, session_id, project_path, work_dir, title,
        created_at, modified_at, file_path, file_mtime_ms, file_size,
        message_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_key) DO UPDATE SET
        work_dir = excluded.work_dir,
        title = excluded.title,
        created_at = excluded.created_at,
        modified_at = excluded.modified_at,
        file_path = excluded.file_path,
        file_mtime_ms = excluded.file_mtime_ms,
        file_size = excluded.file_size,
        message_count = excluded.message_count`,
    ).run(
      key,
      parsed.sessionId,
      parsed.projectPath,
      parsed.workDir,
      parsed.title,
      parsed.createdAt,
      parsed.modifiedAt,
      parsed.filePath,
      parsed.fileMtimeMs,
      parsed.fileSize,
      parsed.messages.length,
    )

    const insertMessage = db.prepare(
      `INSERT INTO messages (
        session_key, session_id, project_path, message_uuid, role, type,
        content_text, timestamp, model, line_no, is_sidechain
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const insertFts = db.prepare(
      'INSERT INTO messages_fts(rowid, content_text) VALUES (?, ?)',
    )
    const insertTrigram = db.prepare(
      'INSERT INTO messages_fts_trigram(rowid, content_text) VALUES (?, ?)',
    )

    for (const message of parsed.messages) {
      const result = insertMessage.run(
        key,
        parsed.sessionId,
        parsed.projectPath,
        message.messageUuid,
        message.role,
        message.type,
        message.contentText,
        message.timestamp,
        message.model,
        message.lineNo,
        message.isSidechain ? 1 : 0,
      )
      const id = Number(result.lastInsertRowid)
      insertFts.run(id, message.contentText)
      insertTrigram.run(id, message.contentText)
    }

    upsertProjectMemoryForParsedSession(db, parsed, {
      homeDir: options.homeDir,
    })

    db.prepare(
      `INSERT INTO indexed_files (
        file_path, session_key, session_id, project_path,
        file_mtime_ms, file_size, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        session_key = excluded.session_key,
        session_id = excluded.session_id,
        project_path = excluded.project_path,
        file_mtime_ms = excluded.file_mtime_ms,
        file_size = excluded.file_size,
        indexed_at = excluded.indexed_at`,
    ).run(
      parsed.filePath,
      key,
      parsed.sessionId,
      parsed.projectPath,
      parsed.fileMtimeMs,
      parsed.fileSize,
      now,
    )
  })
}
