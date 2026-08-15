/**
 * rin smart pruning — deterministic tool-result optimization.
 *
 * Scans a message list from newest to oldest, fingerprints every text-only
 * tool result, and rewrites older redundant or over-budget results to a short
 * omission marker or a head/tail truncation. The algorithm is pure and
 * deterministic: no model calls, no randomness, no wall-clock.
 *
 * @module @rin/smart-pruning
 */

import { createHash } from 'node:crypto'
import type {
  SmartPruningConfig,
  SmartPruningLevel,
  SmartPruningStats,
  SmartPruningStatus,
} from './types.ts'

/** Structural minimum for a message this module can optimize. */
export type OptimizationMessage = {
  type: string
  message: {
    content: unknown
  }
}

/** Tool-call metadata attached to a tool result, used to describe its omission marker. */
export type ToolMetadata = {
  name: string
  path: string | null
  isRead: boolean
}

type PruningPolicy = {
  recentMessageCount: number
  maxToolResultChars: number
  retainedChars: number
}

type ResolvedConfig = {
  enabled: boolean
  level: SmartPruningLevel
}

const DEFAULT_CONFIG: ResolvedConfig = {
  enabled: false,
  level: 'balanced',
}

/** Per-level budgets and the recent-message protection window. */
const PRUNING_POLICIES: Record<SmartPruningLevel, PruningPolicy> = {
  conservative: {
    recentMessageCount: 20,
    maxToolResultChars: 32_000,
    retainedChars: 16_000,
  },
  balanced: {
    recentMessageCount: 14,
    maxToolResultChars: 16_000,
    retainedChars: 8_000,
  },
  aggressive: {
    recentMessageCount: 8,
    maxToolResultChars: 6_000,
    retainedChars: 2_400,
  },
}

/**
 * Resolve the recent-message protection window for a pruning level.
 * @param level - the pruning level.
 * @returns the number of most-recent messages never touched by pruning.
 */
export function recentMessageCountForLevel(level: SmartPruningLevel): number {
  return PRUNING_POLICIES[level].recentMessageCount
}

/** Validate and normalize plugin configuration, failing loud on invalid input. */
function resolveConfig(config: SmartPruningConfig = {}): ResolvedConfig {
  const enabled = config.enabled ?? DEFAULT_CONFIG.enabled
  const level = config.level ?? DEFAULT_CONFIG.level
  if (typeof enabled !== 'boolean') {
    throw new Error('rin smart-pruning: enabled must be a boolean')
  }
  if (!isSmartPruningLevel(level)) {
    throw new Error(`rin smart-pruning: unknown level ${String(level)}`)
  }
  return { enabled, level }
}

/**
 * The stateful pruning service: enabled/level state plus one optimization
 * pass. Configured at construction and mutable via setEnabled/setLevel.
 */
export class SmartPruningService {
  private readonly initial: ResolvedConfig
  private config: ResolvedConfig

  constructor(config: SmartPruningConfig = {}) {
    this.initial = resolveConfig(config)
    this.config = this.initial
  }

  /** @returns the current enabled/level state. */
  getStatus(): SmartPruningStatus {
    return {
      enabled: this.config.enabled,
      level: this.config.level,
      mode: 'deterministic',
    }
  }

  /** Enable or disable pruning for subsequent optimizeMessages calls. */
  setEnabled(enabled: boolean): SmartPruningStatus {
    this.config = { ...this.config, enabled }
    return this.getStatus()
  }

  /**
   * Change the pruning policy level.
   * @throws when the level is not one of conservative/balanced/aggressive.
   */
  setLevel(level: SmartPruningLevel): SmartPruningStatus {
    if (!isSmartPruningLevel(level)) {
      throw new Error(`rin smart-pruning: unknown level ${String(level)}`)
    }
    this.config = { ...this.config, level }
    return this.getStatus()
  }

  /**
   * Optimize one message list in place (newest-first).
   * @param messages - the message list to optimize.
   * @returns the rewritten messages and aggregate stats, or a shallow copy
   * with zero stats when pruning is disabled.
   */
  optimizeMessages<T extends OptimizationMessage>(messages: readonly T[]) {
    if (!this.config.enabled) {
      return {
        messages: [...messages],
        stats: createEmptyStats(),
      }
    }
    return pruneMessagesForAPI(messages, this.config.level)
  }

  /** Restore the constructor configuration; test hook. */
  resetForTesting() {
    this.config = this.initial
  }
}

/**
 * Rewrite redundant or over-budget tool results in place, newest first.
 * @param messages - the message list to optimize.
 * @param level - which pruning policy to apply.
 * @returns the rewritten messages and aggregate pruning stats.
 */
export function pruneMessagesForAPI<T extends OptimizationMessage>(
  messages: readonly T[],
  level: SmartPruningLevel,
): { messages: T[]; stats: SmartPruningStats } {
  const policy = PRUNING_POLICIES[level]
  const recentBoundary = Math.max(0, messages.length - policy.recentMessageCount)
  const toolMetadata = collectToolMetadata(messages)
  const seenResults = new Set<string>()
  const seenReadPaths = new Set<string>()
  const stats = createEmptyStats()
  const nextMessages = [...messages]

  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const message = messages[messageIndex]
    if (!message || message.type !== 'user' || !Array.isArray(message.message.content)) continue

    const content = message.message.content as Array<Record<string, unknown>>
    let nextContent: Array<Record<string, unknown>> | null = null

    for (let blockIndex = content.length - 1; blockIndex >= 0; blockIndex--) {
      const block = content[blockIndex]
      if (!isToolResultBlock(block)) continue

      const originalText = getTextOnlyToolResult(block.content)
      if (!originalText) continue

      const fingerprint = fingerprintText(originalText)
      const metadata = toolMetadata.get(block.tool_use_id)
      const normalizedPath = metadata?.path ? normalizePathKey(metadata.path) : null
      const isDuplicate = seenResults.has(fingerprint)
      const isSupersededRead = Boolean(
        metadata?.isRead
        && normalizedPath
        && seenReadPaths.has(normalizedPath),
      )
      const isOld = messageIndex < recentBoundary

      seenResults.add(fingerprint)
      if (metadata?.isRead && normalizedPath) seenReadPaths.add(normalizedPath)

      if (!isOld || block.is_error === true || looksLikeFailure(originalText)) continue

      let replacement: string | null = null
      let reason: 'duplicate' | 'superseded' | 'truncated' | null = null
      if (isDuplicate) {
        replacement = createOmissionMarker('duplicate', metadata, fingerprint)
        reason = 'duplicate'
      } else if (isSupersededRead) {
        replacement = createOmissionMarker('superseded', metadata, fingerprint)
        reason = 'superseded'
      } else if (originalText.length > policy.maxToolResultChars) {
        replacement = truncateToolResult(originalText, policy.retainedChars, fingerprint)
        reason = 'truncated'
      }

      if (!replacement || replacement.length >= originalText.length) continue
      if (!nextContent) nextContent = [...content]
      nextContent[blockIndex] = { ...block, content: replacement }
      if (reason === 'duplicate') stats.duplicateResults += 1
      if (reason === 'superseded') stats.supersededReads += 1
      if (reason === 'truncated') stats.truncatedResults += 1
      stats.prunedToolResults += 1
      stats.savedCharacters += originalText.length - replacement.length
    }

    if (!nextContent) continue
    // Only the content array changed, so the rewritten message is still a T.
    nextMessages[messageIndex] = {
      ...message,
      message: {
        ...message.message,
        content: nextContent,
      },
    } as T
  }

  return { messages: nextMessages, stats }
}

/** Type guard for the three supported pruning levels. */
export function isSmartPruningLevel(value: unknown): value is SmartPruningLevel {
  return value === 'conservative' || value === 'balanced' || value === 'aggressive'
}

function collectToolMetadata(messages: readonly OptimizationMessage[]) {
  const metadata = new Map<string, ToolMetadata>()
  for (const message of messages) {
    if (message.type !== 'assistant' || !Array.isArray(message.message.content)) continue
    for (const block of message.message.content) {
      if (!isRecord(block) || block.type !== 'tool_use' || typeof block.id !== 'string') continue
      const name = typeof block.name === 'string' ? block.name : 'tool'
      metadata.set(block.id, {
        name,
        path: extractPath(block.input),
        isRead: isReadTool(name),
      })
    }
  }
  return metadata
}

/**
 * Extract a filesystem path from a tool's parsed arguments object.
 * @param input - the parsed tool arguments (or a non-object value).
 * @returns the first non-blank path-like field, or null when none exists.
 */
export function extractPath(input: unknown): string | null {
  if (!isRecord(input)) return null
  for (const key of ['file_path', 'path', 'file', 'filename']) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

/**
 * Whether a tool name denotes a file read (the superseded-read fast path).
 * @param name - the tool name.
 * @returns true for read-like tool names.
 */
export function isReadTool(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '')
  return normalized === 'read'
    || normalized === 'fileread'
    || normalized === 'readfile'
    || normalized === 'readtextfile'
    || normalized.endsWith('fileread')
}

function isToolResultBlock(value: unknown): value is Record<string, unknown> & {
  type: 'tool_result'
  tool_use_id: string
} {
  return isRecord(value)
    && value.type === 'tool_result'
    && typeof value.tool_use_id === 'string'
}

/**
 * Join a tool result's content into one text string, or null when it is not
 * text-only (an image or structured block cannot be fingerprint-narrowed).
 * @param content - the tool-result content (a string or a content-block array).
 * @returns the joined text, or null for empty or non-text content.
 */
export function getTextOnlyToolResult(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (!Array.isArray(content) || content.length === 0) return null
  const text: string[] = []
  for (const item of content) {
    if (!isRecord(item) || item.type !== 'text' || typeof item.text !== 'string') return null
    text.push(item.text)
  }
  return text.join('\n')
}

/**
 * Build the one-line omission marker replacing a pruned result.
 * @param reason - why the result was pruned.
 * @param metadata - the result's tool metadata, for the marker's tool/path detail.
 * @param fingerprint - the pruned content's fingerprint, cited for replay.
 * @returns the marker text.
 */
export function createOmissionMarker(
  reason: 'duplicate' | 'superseded',
  metadata: ToolMetadata | undefined,
  fingerprint: string,
): string {
  const detail = reason === 'duplicate' ? 'duplicate output' : 'superseded file read'
  const tool = metadata?.name ? `; tool=${sanitizeMarkerValue(metadata.name)}` : ''
  const filePath = metadata?.path ? `; path=${sanitizeMarkerValue(metadata.path)}` : ''
  return `[Smart pruning: omitted older ${detail}${tool}${filePath}; ref=${fingerprint.slice(0, 10)}]`
}

function truncateToolResult(text: string, retainedChars: number, fingerprint: string) {
  const marker = `\n...[Smart pruning: older tool output shortened; ref=${fingerprint.slice(0, 10)}]...\n`
  const available = Math.max(200, retainedChars - marker.length)
  const headLength = Math.ceil(available * 0.58)
  const tailLength = Math.floor(available * 0.42)
  return `${text.slice(0, headLength)}${marker}${text.slice(-tailLength)}`
}

/**
 * Whether a result's leading text looks like a failure that must stay intact.
 * @param text - the tool-result text.
 * @returns true when the prefix reads as an error/panic/traceback.
 */
export function looksLikeFailure(text: string): boolean {
  const sample = text.slice(0, 2_000)
  return /(^|\n)\s*(error|fatal|panic|exception|traceback)\b/i.test(sample)
    || /(^|\n)\s*(错误|失败|异常|致命错误)[:：]/.test(sample)
}

/**
 * Fingerprint result text for duplicate detection, normalizing line endings.
 * @param text - the tool-result text.
 * @returns the hex SHA-256 digest.
 */
export function fingerprintText(text: string): string {
  return createHash('sha256').update(text.replace(/\r\n?/g, '\n')).digest('hex')
}

/**
 * Normalize a path for superseded-read comparison (slashes, case on Windows).
 * @param value - the raw path.
 * @returns the comparison key.
 */
export function normalizePathKey(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function sanitizeMarkerValue(value: string) {
  return value.replace(/[\r\n;]+/g, ' ').slice(0, 160)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Create a zeroed aggregate pruning-stats value.
 * @returns the empty stats record.
 */
export function createEmptyStats(): SmartPruningStats {
  return {
    prunedToolResults: 0,
    duplicateResults: 0,
    supersededReads: 0,
    truncatedResults: 0,
    savedCharacters: 0,
  }
}
