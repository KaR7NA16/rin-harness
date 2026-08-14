/**
 * rin skill memory — Cordis plugin entry.
 *
 * Exposes a ctx['skill-memory'] service that creates file-backed skill memory
 * stores, plus the deterministic domain model: the skill creation gate, the
 * lifecycle policy, storage identities, and the store itself. Runtime command
 * mapping, prompt formatting, fire-and-forget logging, lifecycle scheduling,
 * and model-driven review remain adapters outside this package.
 *
 * @module @rin/skill-memory
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { createSkillMemoryStore } from './store.ts'
import type { SkillMemoryStore, SkillMemoryStoreOptions } from './store.ts'
import type { SkillMemoryRoots } from './types.ts'

export { SKILL_MEMORY_API_VERSION } from './types.ts'
export type * from './types.ts'
export {
  evaluateSkillCreationCandidate,
  rankSkillGateMatches,
  scoreSkillSimilarity,
  SKILL_GATE_MERGE_THRESHOLD,
  SKILL_GATE_REUSE_THRESHOLD,
} from './gate.ts'
export type {
  SkillGateCandidate,
  SkillGateComparable,
  SkillGateDecision,
  SkillGateMatch,
  SkillGateResult,
} from './gate.ts'
export {
  evaluateSkillLifecycleStatus,
  SKILL_ARCHIVE_AFTER_DAYS,
  SKILL_HIGH_USE_COUNT,
  SKILL_LOW_USE_COUNT,
  SKILL_STALE_AFTER_DAYS,
} from './lifecycle.ts'
export type { SkillLifecycleRecord, SkillLifecycleStatus } from './lifecycle.ts'
export {
  getGlobalSkillMemoryRoot,
  getProjectSkillMemoryRoot,
  getSkillMemoryDir,
  getSkillMemoryId,
  getSkillMemoryRawKey,
  getSkillMemoryRoot,
  getSkillUsageSidecarPath,
  SKILL_MEMORY_DIRNAME,
  SKILL_MEMORY_EVIDENCE_FILENAME,
  SKILL_MEMORY_PENDING_FILENAME,
  SKILL_MEMORY_STATS_FILENAME,
  SKILL_MEMORY_SUMMARY_FILENAME,
  SKILL_USAGE_FILENAME,
} from './paths.ts'
export {
  createSkillMemoryStore,
  SKILL_MEMORY_EVIDENCE_LINE_LIMIT,
  SKILL_MEMORY_PENDING_LINE_LIMIT,
  SKILL_MEMORY_SUMMARY_CHAR_LIMIT,
} from './store.ts'
export type {
  SkillMemoryPendingEntry,
  SkillMemoryStats,
  SkillMemoryStore,
  SkillMemoryStoreOptions,
  SkillMemorySummary,
  SkillUsageRecord,
  SkillUsageSidecar,
} from './store.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    'skill-memory': SkillMemoryService
  }
}

/** The skill memory service exposed on the shared context. */
export abstract class SkillMemoryService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'skill-memory')
  }

  /** Create a file-backed skill memory store for the given roots. */
  abstract createStore(roots: SkillMemoryRoots, options?: SkillMemoryStoreOptions): SkillMemoryStore
}

/** File-backed implementation delegating to createSkillMemoryStore. */
export class FileSkillMemoryService extends SkillMemoryService {
  constructor(ctx: Context) {
    super(ctx)
  }

  override createStore(roots: SkillMemoryRoots, options?: SkillMemoryStoreOptions): SkillMemoryStore {
    return createSkillMemoryStore(roots, options)
  }
}

export const name = 'skill-memory'
export const inject = []

/** Install the file-backed skill memory service into the shared context. */
export function apply(ctx: Context): void {
  ctx.plugin(FileSkillMemoryService)
}
