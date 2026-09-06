/**
 * rin session-search — Cordis plugin entry.
 *
 * Exposes a ctx.sessionSearch service that owns the derived SQLite full-text
 * search index over historical sessions, transcripts, history logs, and
 * project memories. The package also re-exports the standalone core functions
 * for product-independent use and registers the dsh seam projection: session
 * lifecycle indexing plus the rin_session_search / rin_session_stats tools.
 *
 * @module @rin/memory/session-search
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { registerSeam } from './seam.ts'
import type { MemoryRecallSource, MemoryStore } from '@rin/memory'
import type { Config } from './seam.ts'
import { openSessionSearchDb, sessionKey } from './db.ts'
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
  private readonly memory: MemoryStore | undefined

  constructor(ctx: Context, roots: SessionSearchRoots) {
    super(ctx)
    this.memory = ctx.get('memory') as MemoryStore | undefined
    this.db = openSessionSearchDb(getSessionSearchDbPath(roots))
    const disposeRecallSource = this.memory?.registerRecallSource({
      id: 'session-search',
      kind: 'session-search',
      query: async ({ query }) => {
        const text = query.text?.trim()
        if (!text) return []
        const discovered = await discoverSessionSearch({
          query: text,
          limit: 10,
          ...(query.sessionId === undefined ? {} : { currentSessionId: query.sessionId }),
          db: this.db,
        })
        return discovered.results.map((hit, index) => ({
          id: 'session-search:' + sessionKey(hit.projectPath, hit.sessionId),
          source: 'session-search' as const,
          title: hit.title,
          content: [
            'session candidate',
            'title: ' + hit.title,
            'project: ' + hit.projectPath,
            'session: ' + hit.sessionId,
          ].filter(Boolean).join('\n'),
          confidence: 0.65,
          scoreHint: discovered.count > 0 ? (discovered.count - index) / discovered.count : 0,
          reference: {
            sessionId: hit.sessionId,
            projectPath: hit.projectPath,
            sessionKey: sessionKey(hit.projectPath, hit.sessionId),
          },
        }))
      },
    } satisfies MemoryRecallSource)
    ctx.effect(() => () => {
      disposeRecallSource?.()
      this.db.close()
    })
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
export const inject = ['tools', 'memory']

/**
 * Install the file-backed session-search service and register its seam
 * projection (session lifecycle indexing plus model-visible search tools).
 * @param ctx - the plugin context (must inject tools).
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.plugin(FileSessionSearchStore, config)
  registerSeam(ctx, config)
}

export { registerSeam, type Config } from './seam.ts'
export { resolveSessionSearchConfig, SessionSearchCore } from './seam-core.ts'
export type { SessionSearchConfig, SessionSearchConfigInput, SessionSearchSeam, SessionSearchTool } from './seam-core.ts'
export { projectSessionToTranscript } from './projectSession.ts'
export type { SeamSession, SeamSessionEvent, SeamSessionHeader } from './projectSession.ts'
export { scrollSessionIndex, searchSessionIndex, sessionIndexStats } from './tools-core.ts'
export type {
  SessionSearchScrollResult,
  SessionSearchScrollToolMessage,
  SessionSearchScrollToolResult,
  SessionSearchStats,
  SessionSearchStatsResult,
  SessionSearchToolHit,
  SessionSearchToolResult,
} from './tools-core.ts'
