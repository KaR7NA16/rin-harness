/**
 * rin smart pruning — domain model.
 *
 * Owns the values crossing the smart-pruning seam: pruning levels, service
 * status, aggregate pruning stats, and the plugin configuration. The core
 * module (core.ts) owns the pruning policy and the deterministic rewrite;
 * this module owns the schema only.
 *
 * @module @rin/smart-pruning
 */

/** Reserved API version for the smart-pruning config format (future persistence). */
export const SMART_PRUNING_API_VERSION = 'rin.dev/v1' as const

/** How aggressively older tool results are deduplicated and shortened. */
export type SmartPruningLevel = 'conservative' | 'balanced' | 'aggressive'

/** Current pruning service state. */
export type SmartPruningStatus = {
  enabled: boolean
  level: SmartPruningLevel
  mode: 'deterministic'
}

/** Aggregate accounting for one optimizeMessages pass. */
export type SmartPruningStats = {
  prunedToolResults: number
  duplicateResults: number
  supersededReads: number
  truncatedResults: number
  savedCharacters: number
}

/** Plugin configuration: whether pruning runs and how aggressively. */
export type SmartPruningConfig = {
  enabled?: boolean
  level?: SmartPruningLevel
}
