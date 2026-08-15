/**
 * rin smart pruning — session-surface pruning core.
 *
 * The deterministic session-level companion to core.ts's message-list pass:
 * it walks a dsh session's model-visible surface (newest first), detects older
 * duplicate tool results and superseded reads, and lands single-node
 * `tool/result` surface replacements following the dsh shadow-price protocol.
 * This module is pure and structural — it imports no Cordis types, only the
 * package's own core.ts and types.ts — so it is strip-types smoke-testable.
 *
 * Truncation is deliberately out of scope: the dsh compaction tool-result
 * pruner already owns over-budget truncation, and this seam adds the
 * differentiated dedup + superseded-read policy on top of it.
 *
 * @module @rin/smart-pruning
 */

import {
  createEmptyStats,
  createOmissionMarker,
  extractPath,
  fingerprintText,
  getTextOnlyToolResult,
  isReadTool,
  looksLikeFailure,
  normalizePathKey,
  recentMessageCountForLevel,
  type ToolMetadata,
} from './core.ts'
import type { SmartPruningLevel, SmartPruningStats } from './types.ts'

/** A text content block inside a tool result's content array. */
export type PruneTextBlock = { type: 'text'; text: string }

/** A structural tool-result content block; text is the only fingerprinted kind. */
export type PruneContentBlock =
  | PruneTextBlock
  | { type: string; [key: string]: unknown }

/** Structural subset of the nested tool-result block inside a ToolResultMessage. */
export type PruneToolResultBlock = {
  type: string
  content: readonly PruneContentBlock[]
  isError?: boolean
  [key: string]: unknown
}

/** Structural subset of a dsh ToolResultMessage. */
export type PruneToolResultMessage = {
  role: string
  content: readonly PruneToolResultBlock[]
  source?: { callId?: unknown }
  [key: string]: unknown
}

/** Structural subset of a dsh SessionEvent (only the fields the seam reads). */
export type PruneSessionEvent = {
  type: string
  seq: number
  data: {
    /** tool/call: the call identity pairing a result with its tool metadata. */
    callId?: unknown
    /** tool/call: the tool name. */
    name?: string
    /** tool/call: the raw JSON arguments string. */
    arguments?: string
    /** tool/result: the model-facing result message. */
    message?: PruneToolResultMessage
    /** tool/result: an internal failure identity, when the call failed. */
    error?: unknown
    [key: string]: unknown
  }
}

/** Structural subset of the session's ordered surface view. */
export type PruneSurface = { readonly nodes: readonly number[] }

/** Structural subset of the dsh Session the seam rewrites. */
export interface PruneSession {
  /** Current surface event sequences in model-visible order. */
  readonly surface: PruneSurface
  /** Contiguous append-only event log, indexed by seq. */
  readonly events: readonly PruneSessionEvent[]
  /** Append an event; `opts.surfaceOp.replace` lands a surface rewrite. */
  append(type: string, data: Record<string, unknown>, opts?: Record<string, unknown>): { seq: number }
}

/** Why one surface node is being rewritten. */
export type PruneReason = 'duplicate' | 'superseded'

/** One planned single-node surface replacement. */
export interface PruneOperation {
  /** Seq of the surface tool/result node to shadow. */
  seq: number
  /** Why the node is pruned. */
  reason: PruneReason
  /** The omission-marker text replacing the node's content. */
  marker: string
  /** Characters removed (original text length minus marker length). */
  savedCharacters: number
}

/**
 * Collect tool metadata (name, path, read-ness) from the session's tool/call
 * events, keyed by call id for the surface tool/result nodes to look up.
 * @param session - the session whose events are scanned.
 * @returns a call-id → metadata map.
 */
function collectSessionToolMetadata(session: PruneSession): Map<unknown, ToolMetadata> {
  const metadata = new Map<unknown, ToolMetadata>()
  for (const event of session.events) {
    if (event.type !== 'tool/call') continue
    const callId = event.data.callId
    if (callId === undefined) continue
    const name = typeof event.data.name === 'string' ? event.data.name : 'tool'
    metadata.set(callId, {
      name,
      path: extractPath(parseArguments(event.data.arguments)),
      isRead: isReadTool(name),
    })
  }
  return metadata
}

/** Parse a tool-call arguments string; null when absent or malformed. */
function parseArguments(raw: string | undefined): unknown {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

/**
 * Plan dedup + superseded-read replacements over one session surface.
 *
 * Walks the surface newest-first so the newer of two colliding results is
 * always the survivor, and targets only nodes older than the level's
 * recent-message window. Failed results (isError, an internal error identity,
 * or an error-looking prefix) are never pruned. The plan is detached from the
 * session; {@link applyPruneOperations} lands it.
 * @param session - the session whose surface is planned against.
 * @param level - the pruning level (drives the recent-message window).
 * @returns the ordered single-node replacements to land.
 */
export function planSessionPruning(session: PruneSession, level: SmartPruningLevel): PruneOperation[] {
  const recentCount = recentMessageCountForLevel(level)
  const nodes = session.surface.nodes
  const recentBoundary = Math.max(0, nodes.length - recentCount)
  const metadata = collectSessionToolMetadata(session)
  const seenResults = new Set<string>()
  const seenReadPaths = new Set<string>()
  const operations: PruneOperation[] = []

  for (let index = nodes.length - 1; index >= 0; index--) {
    const seq = nodes[index]
    if (seq === undefined) continue
    const event = session.events[seq]
    if (!event || event.type !== 'tool/result') continue

    const message = event.data.message
    const resultBlock = message?.content?.[0]
    if (!message || !resultBlock) continue

    const text = getTextOnlyToolResult(resultBlock.content)
    if (!text) continue

    const fingerprint = fingerprintText(text)
    const tool = metadata.get(message.source?.callId)
    const normalizedPath = tool?.path ? normalizePathKey(tool.path) : null
    const isDuplicate = seenResults.has(fingerprint)
    const isSupersededRead = Boolean(tool?.isRead && normalizedPath && seenReadPaths.has(normalizedPath))
    const isOld = index < recentBoundary

    seenResults.add(fingerprint)
    if (tool?.isRead && normalizedPath) seenReadPaths.add(normalizedPath)

    if (!isOld || resultBlock.isError === true || event.data.error !== undefined) continue
    if (looksLikeFailure(text)) continue

    let reason: PruneReason | null = null
    if (isDuplicate) reason = 'duplicate'
    else if (isSupersededRead) reason = 'superseded'
    if (reason === null) continue

    const marker = createOmissionMarker(reason, tool, fingerprint)
    // A marker no shorter than the source would grow the surface: skip.
    if (marker.length >= text.length) continue

    operations.push({ seq, reason, marker, savedCharacters: text.length - marker.length })
  }

  return operations
}

/**
 * Land planned replacements on the session, one single-node surface rewrite
 * per operation. Each rewrite preserves the complete event data except for
 * the result's content, and is preceded by a `compaction/prune` shadow-price
 * event when an estimator is supplied (the dsh shadow-price protocol).
 * @param session - the session rewritten in place.
 * @param operations - the planned replacements to land.
 * @param estimate - optional message pricer for the shadow-price event.
 * @returns aggregate pruning stats for the landed replacements.
 */
export function applyPruneOperations(
  session: PruneSession,
  operations: readonly PruneOperation[],
  estimate?: (message: unknown) => number | undefined,
): SmartPruningStats {
  const stats = createEmptyStats()
  for (const operation of operations) {
    const event = session.events[operation.seq]
    if (!event || event.type !== 'tool/result') continue
    const message = event.data.message
    const resultBlock = message?.content?.[0]
    if (!message || !resultBlock) continue

    const shadowedTokenCount = estimate?.(message)
    if (shadowedTokenCount !== undefined) {
      session.append('compaction/prune', {
        shadowedRange: { start: operation.seq, end: operation.seq },
        shadowedSeqs: [operation.seq],
        shadowedTokenCount,
      })
    }

    const replacement: Record<string, unknown> = {
      ...(event.data as Record<string, unknown>),
      message: {
        ...(message as Record<string, unknown>),
        content: [{
          ...(resultBlock as Record<string, unknown>),
          content: [{ type: 'text', text: operation.marker }],
        }],
      },
    }
    session.append('tool/result', replacement, {
      surfaceOp: { op: 'replace', start: operation.seq, end: operation.seq },
      sourceEventSeqs: [operation.seq],
    })

    if (operation.reason === 'duplicate') stats.duplicateResults += 1
    else stats.supersededReads += 1
    stats.prunedToolResults += 1
    stats.savedCharacters += operation.savedCharacters
  }
  return stats
}

/**
 * Plan and land one session-surface pruning pass in a single step.
 * @param session - the session rewritten in place.
 * @param level - the pruning level (drives the recent-message window).
 * @param estimate - optional message pricer for the shadow-price event.
 * @returns aggregate pruning stats for the landed replacements.
 */
export function pruneSessionSurface(
  session: PruneSession,
  level: SmartPruningLevel,
  estimate?: (message: unknown) => number | undefined,
): SmartPruningStats {
  return applyPruneOperations(session, planSessionPruning(session, level), estimate)
}
