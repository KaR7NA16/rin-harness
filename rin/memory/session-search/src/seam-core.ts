/**
 * rin session-search — dsh seam projection core, dependency-free.
 *
 * Holds the structural seam (session lifecycle listeners plus the tool
 * registration face) and the indexing/search logic, so the projection is
 * strip-types-testable without importing @deepseek-ai/cordis or
 * @deepseek-ai/dsh-tools. The plugin entry (seam.ts) adapts the real Context
 * to this seam and constructs the core.
 *
 * @module @rin/session-search
 */

import { homedir } from 'node:os'
import { openSessionSearchDb } from './db.ts'
import { writeSessionToSearchIndex } from './indexStore.ts'
import { getSessionSearchDbPath } from './paths.ts'
import { projectSessionToTranscript, type SeamSession } from './projectSession.ts'
import {
  searchSessionIndex,
  sessionIndexStats,
  type SessionSearchStatsResult,
  type SessionSearchToolResult,
} from './tools-core.ts'

/** Structural projection of a dsh tool definition (the defineTool input). */
export interface SessionSearchTool {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render(args: unknown, value: unknown): Array<{ type: 'text'; text: string }>
  }
  execute(args: Record<string, unknown>): Promise<unknown> | unknown
  presentCall?(args: Record<string, unknown>): {
    card: string
    title: string
    kind: string
    rawInput?: string
  }
}

/** The minimal context surface the core consumes (structural subset of Context). */
export interface SessionSearchSeam {
  tools: {
    /** Register a model-visible tool; returns its disposer. */
    register(tool: SessionSearchTool): () => void
  }
  /** Register a session lifecycle listener; returns its disposer. */
  on(
    event: 'session/created' | 'session/disposed',
    listener: (session: SeamSession) => void,
    options?: { global?: boolean },
  ): () => void
  /** Register a disposal callback for the owning context. */
  effect(disposer: () => void): void
  /** Optional error sink used to fail loud without throwing. */
  logger?: { error(message: string): void }
}

/** Resolved configuration the core operates on. */
export interface SessionSearchConfig {
  /** Absolute path to the SQLite index database file. */
  dbPath: string
  /** Home directory used to classify temporary sessions for memory derivation. */
  homeDir: string
  /** Normalize a session working directory into a project-path key. */
  projectPathForWorkingDirectory: (workDir: string) => string
}

/** Plugin configuration input before default resolution. */
export interface SessionSearchConfigInput {
  /** Configuration root that owns the derived index. */
  configRoot: string
  /** Optional explicit database path overriding the configRoot-derived default. */
  dbPath?: string
  /** Optional home directory; defaults to the OS home. */
  homeDir?: string
  /** Optional project-path normalization; defaults to separator-to-dash. */
  projectPathForWorkingDirectory?: (workDir: string) => string
}

/** Default project-path normalization: separators become dashes. */
function defaultProjectPath(workDir: string): string {
  return workDir.replaceAll('\\', '/').replaceAll('/', '-')
}

/**
 * Materialize deployment defaults into a resolved configuration.
 * @param input - plugin configuration input.
 * @returns the resolved configuration.
 */
export function resolveSessionSearchConfig(
  input: SessionSearchConfigInput,
): SessionSearchConfig {
  return {
    dbPath: input.dbPath ?? getSessionSearchDbPath({ configRoot: input.configRoot }),
    homeDir: input.homeDir ?? homedir(),
    projectPathForWorkingDirectory:
      input.projectPathForWorkingDirectory ?? defaultProjectPath,
  }
}

/** Human-readable error message from an unknown throw. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error'
}

const SEARCH_DESCRIPTION =
  'Search the rin cross-workspace session index by free text and return the strongest matching sessions '
  + 'with their project path, title, snippet, and relevance score. This index covers full transcripts, '
  + 'history logs, and derived project memories across every workspace, complementing the per-workspace '
  + 'event-level dsh session_search tool. Use it to recall past work from any project.'

const STATS_DESCRIPTION =
  'Report aggregate counts for the rin session index: indexed sessions, messages, derived project memories, '
  + 'and indexed source files. Use this to check whether prior work has been indexed before searching.'

const SEARCH_TOOL_NAME = 'rin_session_search'
const STATS_TOOL_NAME = 'rin_session_stats'

/**
 * The seam projection: indexes sessions on their lifecycle edges and registers
 * the model-visible search/stats tools over the derived index.
 */
export class SessionSearchCore {
  private readonly config: SessionSearchConfig
  private readonly seam: SessionSearchSeam
  private readonly disposers: Array<() => void> = []

  constructor(seam: SessionSearchSeam, config: SessionSearchConfig) {
    this.seam = seam
    this.config = config
    this.disposers.push(
      seam.on('session/created', session => this.indexSession(session), { global: true }),
      seam.on('session/disposed', session => this.indexSession(session), { global: true }),
      seam.tools.register(this.searchTool()),
      seam.tools.register(this.statsTool()),
    )
    seam.effect(() => this.dispose())
  }

  /** Remove every listener and tool registration. Idempotent. */
  dispose(): void {
    for (const disposer of this.disposers.splice(0)) {
      try {
        disposer()
      } catch {
        // One failed cleanup must not block the remaining disposers.
      }
    }
  }

  /** Keyword search over the derived index (the rin_session_search execute body). */
  search(args: Record<string, unknown>): Promise<SessionSearchToolResult> {
    return searchSessionIndex({
      dbPath: this.config.dbPath,
      query: typeof args.query === 'string' ? args.query : '',
      ...(typeof args.limit === 'number' ? { limit: args.limit } : {}),
      ...(typeof args.scope === 'string' ? { scope: args.scope } : {}),
    })
  }

  /** Aggregate index stats (the rin_session_stats execute body). */
  stats(): SessionSearchStatsResult {
    return sessionIndexStats(this.config.dbPath)
  }

  /** Project one live session and write it into the derived index, fail-loud but non-blocking. */
  private indexSession(session: SeamSession): void {
    try {
      const workDir = session.header.cwd ?? ''
      const parsed = projectSessionToTranscript(session, {
        projectPath: this.config.projectPathForWorkingDirectory(workDir),
        filePath: `live:${session.id}`,
      })
      const db = openSessionSearchDb(this.config.dbPath)
      try {
        writeSessionToSearchIndex(db, parsed, { homeDir: this.config.homeDir })
      } finally {
        db.close()
      }
    } catch (error: unknown) {
      // Fail loud, but never throw from a session/created listener: a
      // synchronous throw would veto and roll back session creation.
      this.seam.logger?.error(
        `rin session-search: failed to index session ${session.id}: ${errorMessage(error)}`,
      )
    }
  }

  /** The rin_session_search tool descriptor. */
  private searchTool(): SessionSearchTool {
    return {
      name: SEARCH_TOOL_NAME,
      description: SEARCH_DESCRIPTION,
      parameters: {
        query: { type: 'string', required: true, description: 'Free-text search query over indexed session messages.' },
        limit: { type: 'number', description: 'Maximum sessions to return. Defaults to 3, capped at 10.' },
        scope: { type: 'string', description: 'Restrict to one workspace by its normalized project path.' },
      },
      output: {
        schema: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                results: {
                  type: 'array',
                  required: true,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      sessionKey: { type: 'string', required: true },
                      path: { type: 'string', required: true },
                      title: { type: 'string', required: true },
                      snippet: { type: 'string', required: true },
                      score: { type: 'number', required: true },
                    },
                  },
                },
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              properties: { error: { type: 'string', required: true } },
            },
          ],
        },
        render: (_args, value) => {
          const result = value as SessionSearchToolResult
          if ('error' in result) return [{ type: 'text', text: result.error }]
          const hits = result.results
          if (hits.length === 0) {
            return [{ type: 'text', text: 'No matching sessions found in the rin session index.' }]
          }
          const lines = hits.map(
            (hit, index) => `${index + 1}. ${hit.title} [${hit.path}] (score ${hit.score})\n   ${hit.snippet}`,
          )
          return [{ type: 'text', text: `Found ${hits.length} session(s):\n\n${lines.join('\n\n')}` }]
        },
      },
      execute: args => this.search(args),
      presentCall: args => ({
        card: 'generic',
        title: 'Search rin session index',
        kind: 'search',
        rawInput: typeof args.query === 'string' ? args.query : '',
      }),
    }
  }

  /** The rin_session_stats tool descriptor. */
  private statsTool(): SessionSearchTool {
    return {
      name: STATS_TOOL_NAME,
      description: STATS_DESCRIPTION,
      parameters: {},
      output: {
        schema: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                stats: {
                  type: 'object',
                  required: true,
                  additionalProperties: false,
                  properties: {
                    sessionCount: { type: 'integer', required: true },
                    messageCount: { type: 'integer', required: true },
                    projectMemoryCount: { type: 'integer', required: true },
                    indexedFileCount: { type: 'integer', required: true },
                  },
                },
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              properties: { error: { type: 'string', required: true } },
            },
          ],
        },
        render: (_args, value) => {
          const result = value as SessionSearchStatsResult
          if ('error' in result) return [{ type: 'text', text: result.error }]
          const s = result.stats
          return [{
            type: 'text',
            text: `${s.sessionCount} session(s), ${s.messageCount} message(s), ${s.projectMemoryCount} project memor(y/ies), ${s.indexedFileCount} indexed file(s)`,
          }]
        },
      },
      execute: () => this.stats(),
      presentCall: () => ({ card: 'generic', title: 'Read rin session index stats', kind: 'read' }),
    }
  }
}
