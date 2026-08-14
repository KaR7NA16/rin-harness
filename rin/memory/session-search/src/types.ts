/**
 * rin session-search — domain model.
 *
 * @rin/session-search owns the derived, disposable SQLite full-text search index
 * over historical sessions, transcripts, history logs, and project memories.
 * This module owns the schema types only; the runtime supplies the configuration
 * root, path normalization policy, home directory, and filesystem access.
 *
 * Design rules: the index is
 * derived data — session JSONL, history, Prompt Memory, and project-memory
 * Markdown remain owned outside this package, so deleting or rebuilding the
 * index never deletes those sources.
 *
 * @module @rin/session-search
 */

import type { DatabaseSync } from 'node:sqlite'

/** API version of this package's contract. */
export const SESSION_SEARCH_API_VERSION = 'rin.dev/v1' as const

/** SQLite handle owning the derived search index. */
export type SessionSearchDatabase = DatabaseSync

/** Roots the runtime supplies for index placement. */
export interface SessionSearchRoots {
  /** Root directory that owns the derived index directory and database file. */
  configRoot: string
}

/** One normalized, searchable message extracted from a transcript or history log. */
export interface TranscriptSearchMessage {
  messageUuid: string
  role: string
  type: string
  contentText: string
  timestamp: string | null
  model: string | null
  lineNo: number
  isSidechain: boolean
}

/** A parsed session transcript, ready for indexing. */
export interface ParsedSessionTranscript {
  sessionId: string
  projectPath: string
  filePath: string
  workDir: string | null
  isTemporary: boolean
  title: string
  createdAt: string
  modifiedAt: string
  fileMtimeMs: number
  fileSize: number
  messages: TranscriptSearchMessage[]
}

/** Source metadata for a history-log projection. */
export interface SessionHistorySource {
  filePath: string
  birthtime: Date
  mtime: Date
  mtimeMs: number
  size: number
}

/** Normalization policy the history projection needs from the runtime. */
export interface SessionHistoryOptions {
  projectPathForWorkingDirectory: (workDir: string) => string
  projectFilter?: string
}

/** One searchable message shaped for query results. */
export interface SessionSearchMessage {
  id: number
  role: string
  type: string
  content: string
  timestamp: string | null
  model: string | null
  line: number
  anchor?: boolean
}

/** One matched session hit, with an anchored window and bookends. */
export interface SessionSearchHit {
  sessionId: string
  projectPath: string
  workDir: string | null
  title: string
  matchedRole?: string
  matchMessageId?: number
  snippet?: string
  messages: SessionSearchMessage[]
  bookendStart?: SessionSearchMessage[]
  bookendEnd?: SessionSearchMessage[]
  messagesBefore?: number
  messagesAfter?: number
  matchCount: number
  matches: Array<{ line: number; text: string }>
}

/** Result of browsing recent sessions. */
export interface SessionBrowseResult {
  success: true
  mode: 'browse'
  results: SessionSearchHit[]
  count: number
}

/** Result of a keyword search. */
export interface SessionDiscoverResult {
  success: true
  mode: 'discover'
  query: string
  results: SessionSearchHit[]
  count: number
}

/** Result of reading one session with head/tail truncation. */
export interface SessionReadResult {
  success: true
  mode: 'read'
  sessionId: string
  projectPath: string
  title: string
  messages: SessionSearchMessage[]
  messagesBefore: number
  messagesAfter: number
  count: number
}

/** Result of scrolling around one message. */
export interface SessionScrollResult {
  success: true
  mode: 'scroll'
  sessionId: string
  projectPath: string
  title: string
  messages: SessionSearchMessage[]
  messagesBefore: number
  messagesAfter: number
  count: number
}

/** Any query result. */
export type SessionSearchResult =
  | SessionBrowseResult
  | SessionDiscoverResult
  | SessionReadResult
  | SessionScrollResult

/** Browse parameters, excluding the database handle. */
export interface SessionBrowseParams {
  limit?: number
  project?: string
  currentSessionId?: string
}

/** Discover parameters, excluding the database handle. */
export interface SessionDiscoverParams {
  query: string
  limit?: number
  project?: string
  currentSessionId?: string
  roleFilter?: string[]
}

/** Read parameters, excluding the database handle. */
export interface SessionReadParams {
  sessionId: string
  projectPath?: string
  head?: number
  tail?: number
}

/** Scroll parameters, excluding the database handle. */
export interface SessionScrollParams {
  sessionId: string
  aroundMessageId: number
  projectPath?: string
  window?: number
}

/** Unified search parameters, excluding the database handle. */
export interface SessionSearchParams {
  query?: string
  limit?: number
  project?: string
  currentSessionId?: string
  sessionId?: string
  aroundMessageId?: number
  window?: number
  projectPath?: string
}

/** A derived project memory, shaped for consumers. */
export interface ProjectMemoryEntry {
  id: number
  sessionId: string
  projectPath: string
  workDir: string | null
  title: string
  summary: string
  keywords: string
  source: string
  confidence: number
  createdAt: string
  updatedAt: string
}

/** Parameters for searching derived project memories, excluding the handle. */
export interface ProjectMemorySearchParams {
  query?: string
  limit?: number
  currentSessionId?: string
  includeRecentFallback?: boolean
  includePromptMemory?: boolean
}

/** Indexed-file metadata read back for change detection. */
export interface IndexedFileMetadata {
  file_mtime_ms: number
  file_size: number
}

/** Parameters for upserting an external memory file into project memories. */
export interface ProjectMemoryFileUpsertParams {
  filePath: string
  projectPath: string
  workDir: string | null
  title: string
  content: string
  keywords?: string[]
  source: 'auto-memory-file' | 'prompt-memory'
  createdAt: string
  updatedAt: string
}

/** Parameters for indexing an external memory file, with change metadata. */
export interface ProjectMemoryFileIndexInput extends ProjectMemoryFileUpsertParams {
  fileMtimeMs: number
  fileSize: number
}
