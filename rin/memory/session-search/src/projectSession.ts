/**
 * Project a live dsh session (event-sourced) into the normalized searchable
 * transcript the derived index consumes. Pure and dependency-free: callers
 * supply a structural subset of the session, so the projection is
 * strip-types-testable without importing @deepseek-ai/dsh-session.
 *
 * @module @rin/session-search
 */

import type { ParsedSessionTranscript, TranscriptSearchMessage } from './types.ts'

/** Structural subset of a dsh session header the seam consumes. */
export interface SeamSessionHeader {
  /** Unix epoch milliseconds when the session was created. */
  createdAt: number
  /** Absolute working directory the session was created in (if any). */
  cwd?: string
}

/** Structural subset of one dsh session event. */
export interface SeamSessionEvent {
  /** Event type key, e.g. `user/message` or `tool/result`. */
  type: string
  /** Monotonic sequence number within the session. */
  seq: number
  /** Unix epoch milliseconds. */
  time: number
  /** Event payload. */
  data: Record<string, unknown>
}

/** Structural subset of a dsh session the seam consumes. */
export interface SeamSession {
  /** Session id. */
  id: string
  /** Storage metadata. */
  header: SeamSessionHeader
  /** Complete contiguous event log. */
  events: readonly SeamSessionEvent[]
}

interface ContentBlock {
  type?: unknown
  text?: unknown
  name?: unknown
  arguments?: unknown
  content?: unknown
}

/** Extract searchable text from one message content block, mirroring the dsh session-query projection. */
function blockText(block: unknown): string[] {
  if (block === null || typeof block !== 'object' || Array.isArray(block)) return []
  const record = block as ContentBlock
  switch (record.type) {
    case 'text':
      return typeof record.text === 'string' ? [record.text] : []
    case 'reasoning':
      return []
    case 'tool-call':
      return [record.name, record.arguments].filter(
        (part): part is string => typeof part === 'string',
      )
    case 'tool-result':
      return Array.isArray(record.content)
        ? record.content.flatMap(blockText)
        : []
    default:
      return []
  }
}

/** Join an array of content blocks into one searchable text string. */
function contentText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .flatMap(blockText)
    .map(part => part.trim())
    .filter(Boolean)
    .join('\n')
}

/** Read an object field from a payload, or undefined when absent or not an object. */
function payloadObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Extract searchable text from one message-bearing session event. */
function eventText(event: SeamSessionEvent): string {
  switch (event.type) {
    case 'user/message':
      return contentText(event.data.content)
    case 'assistant/message':
      return contentText(payloadObject(event.data.message)?.content)
    case 'tool/call': {
      const name = typeof event.data.name === 'string' ? event.data.name : ''
      const args = typeof event.data.arguments === 'string' ? event.data.arguments : ''
      return [name, args].filter(Boolean).join('\n')
    }
    case 'tool/result':
      return contentText(payloadObject(event.data.message)?.content)
    default:
      return ''
  }
}

/** Map a message-bearing event to its index role/type pair, or null when non-searchable. */
function eventRoleType(type: string): { role: string; type: string } | null {
  switch (type) {
    case 'user/message':
      return { role: 'user', type: 'user' }
    case 'assistant/message':
      return { role: 'assistant', type: 'assistant' }
    case 'tool/call':
      return { role: 'assistant', type: 'tool_use' }
    case 'tool/result':
      return { role: 'user', type: 'tool_result' }
    default:
      return null
  }
}

/** Derive a short title from the first user message, falling back to the session id. */
function extractTitle(session: SeamSession): string {
  for (const event of session.events) {
    if (event.type !== 'user/message') continue
    const text = contentText(event.data.content).trim()
    if (text) return text.length > 80 ? `${text.slice(0, 80)}...` : text
  }
  return session.id
}

/**
 * Project a live session into a normalized, searchable transcript.
 * @param session - the structural session to index.
 * @param options - project-path key and synthetic source file path.
 * @returns a transcript ready for {@link writeSessionToSearchIndex}.
 */
export function projectSessionToTranscript(
  session: SeamSession,
  options: { projectPath: string; filePath: string },
): ParsedSessionTranscript {
  const messages: TranscriptSearchMessage[] = []
  for (const event of session.events) {
    const content = eventText(event).trim()
    const roleType = eventRoleType(event.type)
    if (!content || roleType === null) continue
    messages.push({
      messageUuid: `${session.id}:${event.seq}`,
      role: roleType.role,
      type: roleType.type,
      contentText: content,
      timestamp: new Date(event.time).toISOString(),
      model: null,
      lineNo: event.seq,
      isSidechain: false,
    })
  }
  const lastEventTime = session.events.length > 0
    ? session.events[session.events.length - 1]!.time
    : session.header.createdAt
  const contentLength = messages.reduce(
    (total, message) => total + message.contentText.length,
    0,
  )
  return {
    sessionId: session.id,
    projectPath: options.projectPath,
    filePath: options.filePath,
    workDir: session.header.cwd ?? null,
    // Live dsh sessions are full transcripts, not the ad-hoc "temporary"
    // sessions the project-memory derivation targets, so memory derivation
    // stays off and the transcript itself is the searchable corpus.
    isTemporary: false,
    title: extractTitle(session),
    createdAt: new Date(session.header.createdAt).toISOString(),
    modifiedAt: new Date(lastEventTime).toISOString(),
    fileMtimeMs: lastEventTime,
    fileSize: contentLength,
    messages,
  }
}
