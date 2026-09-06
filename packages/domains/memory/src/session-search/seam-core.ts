/**
 * rin session-search — dsh seam projection core, dependency-free.
 *
 * Holds the structural seam (session lifecycle listeners plus the tool
 * registration face) and the indexing/search logic, so the projection is
 * strip-types-testable without importing @deepseek-ai/cordis or
 * @deepseek-ai/dsh-tools. The plugin entry (seam.ts) adapts the real Context
 * to this seam and constructs the core.
 *
 * @module @rin/memory/session-search
 */

import { homedir } from 'node:os'
import { openSessionSearchDb } from './db.ts'
import { buildSessionHistoryTranscripts } from './history.ts'
import { writeSessionToSearchIndex } from './indexStore.ts'
import { getSessionSearchDbPath } from './paths.ts'
import { projectSessionToTranscript, type SeamSession } from './projectSession.ts'
import {
  scrollSessionIndex,
  searchSessionIndex,
  sessionIndexStats,
  type SessionSearchScrollResult,
  type SessionSearchStatsResult,
  type SessionSearchToolResult,
} from './tools-core.ts'
import { parseSessionTranscriptContent } from './transcript.ts'
import type { ParsedSessionTranscript, SessionHistoryOptions, SessionHistorySource } from './types.ts'

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
  'Search the rin cross-workspace session index as a candidate source for the Rin memory workspace. '
  + 'Return matching sessions with project path, title, stable session key, and relevance score for coalition evaluation; '
  + 'transcript text remains outside the model-visible result. '
  + 'history logs, and derived project memories across every workspace, complementing the per-workspace '
  + 'event-level dsh session_search tool. To page within one already-found session, pass sessionId plus '
  + 'aroundMessageId to scroll a window around that message instead.'

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
  async search(args: Record<string, unknown>): Promise<SessionSearchToolResult> {
    const query = typeof args.query === 'string' ? args.query : ''
    const result = await searchSessionIndex({
      dbPath: this.config.dbPath,
      query,
      ...(typeof args.limit === 'number' ? { limit: args.limit } : {}),
      ...(typeof args.scope === 'string' ? { scope: args.scope } : {}),
    })
    if ('error' in result) return result
    return {
      ...result,
      candidateOnly: true,
      query,
      results: result.results.map(({ snippet: _snippet, ...hit }) => hit),
    }
  }

  /** Scroll around one message (the rin_session_search execute body in scroll mode). */
  scroll(args: Record<string, unknown>): Promise<SessionSearchScrollResult> {
    const sessionId = typeof args.sessionId === 'string' ? args.sessionId : ''
    const aroundMessageId =
      typeof args.aroundMessageId === 'number' ? args.aroundMessageId : Number.NaN
    if (!sessionId || !Number.isFinite(aroundMessageId)) {
      return Promise.resolve({
        error: 'sessionId (string) and aroundMessageId (number) are required to scroll',
      })
    }
    return scrollSessionIndex({
      dbPath: this.config.dbPath,
      sessionId,
      aroundMessageId,
      ...(typeof args.window === 'number' ? { window: args.window } : {}),
      ...(typeof args.projectPath === 'string' ? { projectPath: args.projectPath } : {}),
    }).then(result => {
      if ('error' in result) return result
      return {
        scroll: {
          ...result.scroll,
          candidateOnly: true,
          messages: result.scroll.messages.map(({ content: _content, ...message }) => message),
        },
      }
    })
  }

  /** Aggregate index stats (the rin_session_stats execute body). */
  stats(): SessionSearchStatsResult {
    return sessionIndexStats(this.config.dbPath)
  }

  /**
   * Write an already-parsed transcript into the derived index. Temporary
   * transcripts (isTemporary: true) derive a project memory on write; full
   * transcripts index only their session and message rows.
   * @param parsed - the normalized transcript to index.
   */
  indexTranscript(parsed: ParsedSessionTranscript): void {
    this.writeParsedTranscript(parsed)
  }

  /**
   * Parse one raw session transcript JSONL string and index it. This is the
   * only index input that can mark a session isTemporary: true (from its
   * `session-meta` entry), which is what turns project-memory derivation on
   * instead of leaving it a no-op delete.
   * @param params - raw content and source file metadata.
   * @returns the parsed transcript that was indexed.
   */
  indexTranscriptContent(params: {
    raw: string
    filePath: string
    projectPath: string
    sessionId: string
    fileBirthtime: Date
    fileMtime: Date
    fileMtimeMs: number
    fileSize: number
  }): ParsedSessionTranscript {
    const parsed = parseSessionTranscriptContent(params)
    this.writeParsedTranscript(parsed)
    return parsed
  }

  /**
   * Project one append-only history log into searchable sessions and index each.
   * @param raw - the history.jsonl content.
   * @param source - source file metadata for timestamps and path keys.
   * @param options - working-directory normalization policy.
   * @returns the projected transcripts that were indexed.
   */
  indexHistoryLog(
    raw: string,
    source: SessionHistorySource,
    options: SessionHistoryOptions,
  ): ParsedSessionTranscript[] {
    const transcripts = buildSessionHistoryTranscripts(raw, source, options)
    for (const transcript of transcripts) this.writeParsedTranscript(transcript)
    return transcripts
  }

  /** Write one parsed transcript into the derived index under a fresh handle. */
  private writeParsedTranscript(parsed: ParsedSessionTranscript): void {
    const db = openSessionSearchDb(this.config.dbPath)
    try {
      writeSessionToSearchIndex(db, parsed, { homeDir: this.config.homeDir })
    } finally {
      db.close()
    }
  }

  /** Project one live session and write it into the derived index, fail-loud but non-blocking. */
  private indexSession(session: SeamSession): void {
    try {
      const workDir = session.header.cwd ?? ''
      const parsed = projectSessionToTranscript(session, {
        projectPath: this.config.projectPathForWorkingDirectory(workDir),
        filePath: `live:${session.id}`,
      })
      this.writeParsedTranscript(parsed)
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
        query: { type: 'string', description: 'Free-text search query over indexed session messages.' },
        limit: { type: 'number', description: 'Maximum sessions to return. Defaults to 3, capped at 10.' },
        scope: { type: 'string', description: 'Restrict to one workspace by its normalized project path.' },
        sessionId: { type: 'string', description: 'Scroll mode: the session to scroll within.' },
        aroundMessageId: { type: 'number', description: 'Scroll mode: the message id to center the window on.' },
        window: { type: 'number', description: 'Scroll mode: messages on each side of the anchor. Defaults to 5.' },
        projectPath: { type: 'string', description: 'Scroll mode: restrict to one project path.' },
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
                      score: { type: 'number', required: true },
                    },
                  },
                },
                candidateOnly: { type: 'boolean' },
                query: { type: 'string' },
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                scroll: {
                  type: 'object',
                  required: true,
                  additionalProperties: false,
                  properties: {
                    sessionId: { type: 'string', required: true },
                    projectPath: { type: 'string', required: true },
                    title: { type: 'string', required: true },
                    candidateOnly: { type: 'boolean' },
                    messages: {
                      type: 'array',
                      required: true,
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          id: { type: 'integer', required: true },
                          role: { type: 'string', required: true },
                          type: { type: 'string', required: true },
                          line: { type: 'integer', required: true },
                          timestamp: { type: 'string' },
                          model: { type: 'string' },
                          anchor: { type: 'boolean' },
                        },
                      },
                    },
                    messagesBefore: { type: 'integer', required: true },
                    messagesAfter: { type: 'integer', required: true },
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
          const result = value as SessionSearchToolResult | SessionSearchScrollResult
          if ('error' in result) return [{ type: 'text', text: result.error }]
          if ('scroll' in result) {
            const scroll = result.scroll
            if (scroll.messages.length === 0) {
              return [{ type: 'text', text: 'No messages around that point.' }]
            }
            const lines = scroll.messages.map(
              message => `${message.role} (line ${message.line}): message=${message.id}${message.anchor ? ' [anchor]' : ''}`,
            )
            return [{
              type: 'text',
              text: `${scroll.title} — ${scroll.messagesBefore} earlier, ${scroll.messagesAfter} later:\n\n${lines.join('\n\n')}`,
            }]
          }
          if (result.candidateOnly === true) {
            if (result.results.length === 0) {
              return [{ type: 'text', text: 'No matching candidates in the rin session index.' }]
            }
            const candidates = result.results.map(
              (hit, index) => index + 1 + '. ' + hit.title + ' [' + hit.path + '] (score ' + hit.score + ')',
            )
            return [{
              type: 'text',
              text: 'Candidate index returned ' + result.results.length
                + ' result(s) for coalition evaluation; raw transcript text remains outside model input.\n\n'
                + candidates.join('\n'),
            }]
          }
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
      execute: args => {
        if (typeof args.sessionId === 'string' && typeof args.aroundMessageId === 'number') {
          return this.scroll(args)
        }
        return this.search(args)
      },
      presentCall: args => typeof args.aroundMessageId === 'number'
        ? { card: 'generic', title: 'Scroll rin session index', kind: 'search', rawInput: '' }
        : {
            card: 'generic',
            title: 'Search rin session index',
            kind: 'search',
            rawInput: typeof args.query === 'string' ? args.query : '',
          },
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
