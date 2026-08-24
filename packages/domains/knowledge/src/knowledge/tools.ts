/**
 * rin knowledge — model-visible tool logic.
 *
 * Pure operations behind the `knowledge_search` and `knowledge_stats` tools.
 * This module imports only `node:` builtins and the package's own
 * service/paths/types modules, so the strip-types smoke test can exercise the
 * behavior without pulling in the Cordis or dsh-tools import graph. The Cordis
 * plugin entry (index.ts) owns registration and wires the opened
 * KnowledgeService into these functions.
 *
 * @module @rin/knowledge
 */

import { getKnowledgeDbPath } from './paths.ts'
import { KnowledgeService } from './service.ts'
import type { KnowledgeSearchResult } from './types.ts'

/** Result count returned by `knowledge_search` when the model omits `limit`. */
export const SEARCH_LIMIT_DEFAULT = 10

/**
 * Hard cap on `knowledge_search` results. Deliberately below the service's own
 * SEARCH_LIMIT_MAX (100) so the model-facing payload stays bounded.
 */
export const SEARCH_LIMIT_MAX = 50

/** One model-facing search hit. */
export interface KnowledgeSearchHit {
  path: string
  title: string
  snippet: string
  score: number
}

/** Aggregate counts surfaced by `knowledge_stats`. */
export interface KnowledgeToolStats {
  sourceCount: number
  documentCount: number
  chunkCount: number
  sizeBytes: number
}

/** Canonical `knowledge_search` value: hits or an explicit error. */
export type KnowledgeSearchValue =
  | { results: KnowledgeSearchHit[] }
  | { error: string }

/** Canonical `knowledge_stats` value: counts or an explicit error. */
export type KnowledgeStatsValue =
  | { stats: KnowledgeToolStats }
  | { error: string }

const UNAVAILABLE_ERROR =
  'the knowledge service is unavailable (not mounted, or no database path configured)'
const EMPTY_ERROR =
  'the knowledge base is empty: no sources have been indexed yet'
const QUERY_ERROR = 'query is required and must not be blank'

/**
 * Resolve the database path the tools open.
 *
 * @param configHome - configuration home used to derive the default path when
 *   `dbPath` is absent.
 * @param dbPath - explicit database path; wins over the derived default.
 * @returns the resolved path, or undefined when neither is available.
 */
export function resolveKnowledgeDbPath(
  configHome: string | undefined,
  dbPath: string | undefined,
): string | undefined {
  if (dbPath !== undefined && dbPath.trim() !== '') return dbPath
  if (configHome !== undefined && configHome.trim() !== '') return getKnowledgeDbPath(configHome)
  return undefined
}

/**
 * Clamp a model-supplied result limit into the tool's bounds.
 *
 * @param limit - raw limit argument; defaults to SEARCH_LIMIT_DEFAULT.
 * @returns an integer in [1, SEARCH_LIMIT_MAX].
 */
export function clampSearchLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return SEARCH_LIMIT_DEFAULT
  return Math.min(SEARCH_LIMIT_MAX, Math.max(1, Math.floor(limit)))
}

/**
 * Search an opened knowledge service.
 *
 * @param service - the opened service, or null when the service is unavailable.
 * @param args - the search query plus optional limit and source filter.
 * @returns hits ordered by relevance, or an explicit error.
 */
export function searchKnowledge(
  service: KnowledgeService | null,
  args: { query: string; limit?: number; sourceId?: string },
): KnowledgeSearchValue {
  if (service === null) return { error: UNAVAILABLE_ERROR }
  const query = args.query.trim()
  if (query === '') return { error: QUERY_ERROR }
  if (service.getStats().sourceCount === 0) return { error: EMPTY_ERROR }
  const options: { sourceId?: string; limit: number } = { limit: clampSearchLimit(args.limit) }
  if (args.sourceId !== undefined && args.sourceId !== '') options.sourceId = args.sourceId
  return { results: service.search(query, options).map(toHit) }
}

/**
 * Read aggregate stats from an opened knowledge service.
 *
 * @param service - the opened service, or null when the service is unavailable.
 * @returns the counts, or an explicit error.
 */
export function knowledgeStats(service: KnowledgeService | null): KnowledgeStatsValue {
  if (service === null) return { error: UNAVAILABLE_ERROR }
  const stats = service.getStats()
  return {
    stats: {
      sourceCount: stats.sourceCount,
      documentCount: stats.documentCount,
      chunkCount: stats.chunkCount,
      sizeBytes: stats.sizeBytes,
    },
  }
}

/** Project one service search result onto the model-facing hit fields. */
function toHit(result: KnowledgeSearchResult): KnowledgeSearchHit {
  return {
    path: result.path,
    title: result.title,
    snippet: result.excerpt,
    score: result.score,
  }
}
