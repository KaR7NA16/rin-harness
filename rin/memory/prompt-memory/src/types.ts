/**
 * rin prompt memory — domain model and contract.
 *
 * Prompt memory is rin's file-backed persistence for model-visible memory:
 * a SOUL identity file plus BRIEF/USER prompt memory under a prompt-memory
 * directory. This module owns the schema, budgets, file-layout constants, and
 * the entry delimiter; the store, budget, insight, review-log, config, and seed
 * modules own behavior.
 *
 * Design rules: every path
 * derives only from an injected configuration root; the package never inspects
 * product environment variables; identity (SOUL) is written explicitly and is
 * never mutated as entries; entry mutations are serialized and atomic.
 *
 * @module @rin/prompt-memory
 */

export const PROMPT_MEMORY_API_VERSION = 'rin.dev/v1' as const

export const SOUL_FILENAME = 'SOUL.md' as const
export const PROMPT_MEMORY_DIRNAME = 'prompt-memory' as const
export const BRIEF_FILENAME = 'BRIEF.md' as const
export const USER_PROMPT_MEMORY_FILENAME = 'USER.md' as const
export const PROMPT_MEMORY_CONFIG_FILENAME = 'config.json' as const
export const PROMPT_MEMORY_REVIEW_LOG_FILENAME = 'AUTO_REVIEW_LOG.jsonl' as const

export const SOUL_CHAR_LIMIT = 3000
export const BRIEF_CHAR_LIMIT = 2200
export const USER_PROMPT_MEMORY_CHAR_LIMIT = 1375
export const PROMPT_MEMORY_TOTAL_CHAR_LIMIT =
  BRIEF_CHAR_LIMIT + USER_PROMPT_MEMORY_CHAR_LIMIT

export const PROMPT_MEMORY_ENTRY_DELIMITER = '\n§\n' as const

export const PROMPT_MEMORY_INSIGHT_CATEGORIES = [
  'identity',
  'communication',
  'collaboration',
  'workflow',
  'quality',
  'boundaries',
  'expertise',
  'meta-method',
  'environment',
  'lesson',
  'other',
] as const

export type PromptMemoryTarget = 'soul' | 'brief' | 'user'
export type PromptMemoryEntryTarget = Exclude<PromptMemoryTarget, 'soul'>
export type PromptMemoryAction = 'add' | 'replace' | 'remove'
export type PromptMemoryFormat = 'empty' | 'plain' | 'entries'

/** The configuration root every prompt-memory path derives from. */
export type PromptMemoryRoots = {
  configRoot: string
}

export type BoundedText = {
  content: string
  originalLength: number
  limit: number
  truncated: boolean
}

export type PromptMemoryFile = {
  target: PromptMemoryTarget
  filename: string
  path: string
  exists: boolean
  content: string
  entries: string[]
  format: PromptMemoryFormat
  charCount: number
  limit: number
  overLimit: boolean
}

export type PromptMemoryMutationResult = {
  target: PromptMemoryEntryTarget
  path: string
  action: PromptMemoryAction
  changed: boolean
  message: string
  entries: string[]
  entryCount: number
  charCount: number
  limit: number
  overLimit: boolean
}

export type PromptMemoryStatus = {
  files: Record<PromptMemoryTarget, PromptMemoryFile>
}

export type PromptMemoryConfig = {
  version: 1
  injectEvolutionMemory: boolean
  updatedAt?: string
}

export type PromptMemoryInsightCategory =
  (typeof PROMPT_MEMORY_INSIGHT_CATEGORIES)[number]

export type PromptMemoryInsightSource = 'explicit' | 'observed' | 'manual'

export type PromptMemoryInsight = {
  id: string
  target: 'user' | 'brief'
  category: PromptMemoryInsightCategory
  content: string
  raw: string
  source: PromptMemoryInsightSource
  updatedAt?: string
}

export type PromptMemoryInsights = {
  insights: PromptMemoryInsight[]
  stats: {
    total: number
    user: number
    methods: number
    dimensions: number
    automaticUpdates: number
  }
}

export type PromptMemoryReviewTrigger = 'explicit' | 'interval'

export type PromptMemoryAutoReviewLogEntry = {
  id: string
  timestamp: string
  sessionId: string
  trigger: PromptMemoryReviewTrigger
  target: PromptMemoryEntryTarget
  action: PromptMemoryAction
  changed: boolean
  content?: string
  oldText?: string
  message: string
}
