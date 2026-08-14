/**
 * rin session-search — Cordis plugin entry.
 *
 * Exposes a ctx.sessionSearch service that owns the derived SQLite full-text
 * search index over historical sessions, transcripts, history logs, and
 * project memories. The package also re-exports the standalone core functions
 * for product-independent use. Projection of this index into dsh tool seams is
 * the NEXT milestone.
 *
 * @module @rin/session-search
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { openSessionSearchDb } from './db.ts'
import { getSessionSearchDbPath } from './paths.ts'
import {
  browseSessionSearch,
  discoverSessionSearch,
  readSessionSearch,
  scrollSessionSearch,
  sessionSearch,
} from './query.ts'
import {
  deleteSessionFromSearchIndexByKey,
  deleteSessionsFromSearchIndex,
  isProjectMemoryFileIndexCurrent,
  readIndexedFileMetadata,
  readIndexedSessionFilePath,
  reconcileSearchIndexFiles,
  writeProjectMemoryFileToSearchIndex,
  writeSessionToSearchIndex,
} from './indexStore.ts'
import {
  deleteProjectMemoryBySessionKey,
  searchProjectMemories,
  upsertProjectMemoryFile,
} from './projectMemory.ts'
import type {
  IndexedFileMetadata,
  ParsedSessionTranscript,
  ProjectMemoryEntry,
  ProjectMemoryFileIndexInput,
  ProjectMemoryFileUpsertParams,
  ProjectMemorySearchParams,
  SessionBrowseParams,
  SessionBrowseResult,
  SessionDiscoverParams,
  SessionDiscoverResult,
  SessionReadParams,
  SessionReadResult,
  SessionScrollParams,
  SessionScrollResult,
  SessionSearchDatabase,
  SessionSearchParams,
  SessionSearchResult,
  SessionSearchRoots,
} from './types.ts'

export type * from './types.ts'
export { SESSION_SEARCH_API_VERSION } from './types.ts'
export {
  PROJECT_MEMORY_CONTEXT_TAG,
  appendProjectMemoryContext,
  hasProjectMemoryContext,
  stripProjectMemoryContext,
} from './contextTag.ts'
export { ensureSessionSearchSchema, openSessionSearchDb, sessionKey } from './db.ts'
export {
  SESSION_SEARCH_DB_FILENAME,
  SESSION_SEARCH_INDEX_DIRNAME,
  getSessionSearchDbPath,
  getSessionSearchIndexDir,
} from './paths.ts'
export { parseSessionTranscriptContent } from './transcript.ts'
export { buildSessionHistoryTranscripts, isSessionHistoryFilePath } from './history.ts'
export {
  deleteSessionFromSearchIndexByKey,
  deleteSessionsFromSearchIndex,
  isProjectMemoryFileIndexCurrent,
  readIndexedFileMetadata,
  readIndexedSessionFilePath,
  reconcileSearchIndexFiles,
  writeProjectMemoryFileToSearchIndex,
  writeSessionToSearchIndex,
} from './indexStore.ts'
export {
  browseSessionSearch,
  discoverSessionSearch,
  readSessionSearch,
  scrollSessionSearch,
} from './query.ts'
export {
  deleteProjectMemoryBySessionKey,
  projectMemoryFileSessionId,
  projectMemoryFileSessionKey,
  redactProjectMemoryText,
  searchProjectMemories,
  upsertProjectMemoryFile,
} from './projectMemory.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionSearch: SessionSearchStore
  }
}

/** The session-search service exposed on the shared context. */
export abstract class SessionSearchStore extends Service {
  constructor(ctx: Context) {
    super(ctx, 'sessionSearch')
  }

  /** Browse recent indexed sessions, newest first. */
  abstract browse(params: SessionBrowseParams): Promise<SessionBrowseResult>
  /** Keyword search over indexed message text (FTS with LIKE fallback). */
  abstract discover(params: SessionDiscoverParams): Promise<SessionDiscoverResult>
  /** Read one session with head/tail truncation. */
  abstract read(params: SessionReadParams): Promise<SessionReadResult | null>
  /** Scroll around one message in a session. */
  abstract scroll(params: SessionScrollParams): Promise<SessionScrollResult | null>
  /** Unified dispatch: scroll, read, discover, or browse by parameters. */
  abstract search(params: SessionSearchParams): Promise<SessionSearchResult | null>

  /** Atomically replace a session's indexed messages and project memory. */
  abstract writeSession(parsed: ParsedSessionTranscript, options: { homeDir: string }): void
  /** Index (or clear) an external memory file, tracking file metadata. */
  abstract writeProjectMemoryFile(params: ProjectMemoryFileIndexInput): boolean
  /** Delete one session and its messages/project memory by session key. */
  abstract deleteSessionByKey(key: string): void
  /** Delete every index entry for a session id, optionally within one project. */
  abstract deleteSessions(params: { sessionId: string; projectPath?: string }): void
  /** Remove index entries whose source files are no longer live. */
  abstract reconcileFiles(liveFilePaths: ReadonlySet<string>, projectPath?: string): void
  /** Read back change-detection metadata for one indexed file. */
  abstract readIndexedFileMetadata(filePath: string): IndexedFileMetadata | null
  /** Read the indexed source path for one session key. */
  abstract readIndexedSessionFilePath(key: string): string | null
  /** Whether an external memory file's index entry is still current. */
  abstract isProjectMemoryFileIndexCurrent(
    params: Pick<ProjectMemoryFileIndexInput, 'filePath' | 'projectPath' | 'fileMtimeMs' | 'fileSize'>,
  ): boolean

  /** Search derived project memories (FTS with LIKE and recent fallback). */
  abstract searchProjectMemories(params: ProjectMemorySearchParams): ProjectMemoryEntry[]
  /** Upsert one external memory file into project memories. */
  abstract upsertProjectMemoryFile(params: ProjectMemoryFileUpsertParams): { sessionKey: string; sessionId: string } | null
  /** Delete one project memory by session key. */
  abstract deleteProjectMemoryBySessionKey(key: string): void
}

/** SQLite-backed implementation owning the derived index at configRoot. */
export class FileSessionSearchStore extends SessionSearchStore {
  private readonly db: SessionSearchDatabase

  constructor(ctx: Context, roots: SessionSearchRoots) {
    super(ctx)
    this.db = openSessionSearchDb(getSessionSearchDbPath(roots))
    ctx.effect(() => () => this.db.close())
  }

  override browse(params: SessionBrowseParams) {
    return browseSessionSearch({ ...params, db: this.db })
  }

  override discover(params: SessionDiscoverParams) {
    return discoverSessionSearch({ ...params, db: this.db })
  }

  override read(params: SessionReadParams) {
    return readSessionSearch({ ...params, db: this.db })
  }

  override scroll(params: SessionScrollParams) {
    return scrollSessionSearch({ ...params, db: this.db })
  }

  override search(params: SessionSearchParams) {
    return sessionSearch({ ...params, db: this.db })
  }

  override writeSession(parsed: ParsedSessionTranscript, options: { homeDir: string }) {
    writeSessionToSearchIndex(this.db, parsed, options)
  }

  override writeProjectMemoryFile(params: ProjectMemoryFileIndexInput) {
    return writeProjectMemoryFileToSearchIndex(this.db, params)
  }

  override deleteSessionByKey(key: string) {
    deleteSessionFromSearchIndexByKey(this.db, key)
  }

  override deleteSessions(params: { sessionId: string; projectPath?: string }) {
    deleteSessionsFromSearchIndex(this.db, params)
  }

  override reconcileFiles(liveFilePaths: ReadonlySet<string>, projectPath?: string) {
    reconcileSearchIndexFiles(this.db, liveFilePaths, projectPath)
  }

  override readIndexedFileMetadata(filePath: string) {
    return readIndexedFileMetadata(this.db, filePath)
  }

  override readIndexedSessionFilePath(key: string) {
    return readIndexedSessionFilePath(this.db, key)
  }

  override isProjectMemoryFileIndexCurrent(
    params: Pick<ProjectMemoryFileIndexInput, 'filePath' | 'projectPath' | 'fileMtimeMs' | 'fileSize'>,
  ) {
    return isProjectMemoryFileIndexCurrent(this.db, params)
  }

  override searchProjectMemories(params: ProjectMemorySearchParams) {
    return searchProjectMemories({ ...params, db: this.db })
  }

  override upsertProjectMemoryFile(params: ProjectMemoryFileUpsertParams) {
    return upsertProjectMemoryFile(this.db, params)
  }

  override deleteProjectMemoryBySessionKey(key: string) {
    deleteProjectMemoryBySessionKey(this.db, key)
  }
}

export const name = 'session-search'
export const inject = []

/** Install the file-backed session-search service into the shared context. */
export function apply(ctx: Context, roots: SessionSearchRoots): void {
  ctx.plugin(FileSessionSearchStore, roots)
}
