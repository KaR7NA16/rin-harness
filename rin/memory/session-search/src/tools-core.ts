/**
 * Model-visible tool logic over the derived index: keyword search and
 * aggregate stats. Each entry point opens a fresh SQLite handle and closes it
 * before returning (use-then-close), so a tool call never holds a connection
 * across turns.
 *
 * @module @rin/session-search
 */

import { openSessionSearchDb, sessionKey } from './db.ts'
import { discoverSessionSearch } from './query.ts'
import type { SessionSearchDatabase } from './types.ts'

/** One search result exposed to the model. */
export interface SessionSearchToolHit {
  /** Stable `projectPath:sessionId` key. */
  sessionKey: string
  /** Working directory or normalized project path of the match. */
  path: string
  /** Session title. */
  title: string
  /** Best-matching text excerpt. */
  snippet: string
  /** Relevance rank in descending result order (higher is better). */
  score: number
}

/** Search result, or an explicit error when the index is unavailable. */
export type SessionSearchToolResult =
  | { results: SessionSearchToolHit[] }
  | { error: string }

/** Aggregate index counts. */
export interface SessionSearchStats {
  /** Indexed sessions. */
  sessionCount: number
  /** Indexed messages. */
  messageCount: number
  /** Derived project memories. */
  projectMemoryCount: number
  /** Indexed source files. */
  indexedFileCount: number
}

/** Stats result, or an explicit error when the index is unavailable. */
export type SessionSearchStatsResult =
  | { stats: SessionSearchStats }
  | { error: string }

/** Human-readable error message from an unknown throw. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error'
}

/** Count rows in a fixed schema table. */
function countRows(db: SessionSearchDatabase, table: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
    .get() as { count: number }
  return row.count
}

/**
 * Keyword-search the derived index and return per-session hits with snippets.
 * @param params - index path and search arguments (query, optional limit/scope).
 * @returns the shaped search result or an explicit error.
 */
export async function searchSessionIndex(params: {
  dbPath: string
  query: string
  limit?: number
  scope?: string
}): Promise<SessionSearchToolResult> {
  const query = params.query.trim()
  if (!query) return { error: 'query must not be empty' }
  let db: SessionSearchDatabase
  try {
    db = openSessionSearchDb(params.dbPath)
  } catch (error: unknown) {
    return { error: `session-search index unavailable: ${errorMessage(error)}` }
  }
  try {
    const discovered = await discoverSessionSearch({
      query,
      ...(params.limit !== undefined ? { limit: params.limit } : {}),
      ...(params.scope !== undefined ? { project: params.scope } : {}),
      db,
    })
    const total = discovered.results.length
    const results = discovered.results.map((hit, index) => ({
      sessionKey: sessionKey(hit.projectPath, hit.sessionId),
      path: hit.workDir ?? hit.projectPath,
      title: hit.title,
      snippet: hit.snippet ?? hit.matches.map(match => match.text).join(' '),
      score: total - index,
    }))
    return { results }
  } finally {
    db.close()
  }
}

/**
 * Read aggregate counts from the derived index.
 * @param dbPath - index database path.
 * @returns the shaped stats or an explicit error.
 */
export function sessionIndexStats(dbPath: string): SessionSearchStatsResult {
  let db: SessionSearchDatabase
  try {
    db = openSessionSearchDb(dbPath)
  } catch (error: unknown) {
    return { error: `session-search index unavailable: ${errorMessage(error)}` }
  }
  try {
    return {
      stats: {
        sessionCount: countRows(db, 'sessions'),
        messageCount: countRows(db, 'messages'),
        projectMemoryCount: countRows(db, 'project_memories'),
        indexedFileCount: countRows(db, 'indexed_files'),
      },
    }
  } finally {
    db.close()
  }
}
