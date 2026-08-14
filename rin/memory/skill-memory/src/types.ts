/**
 * rin skill memory — domain model.
 *
 * Skill memory owns the deterministic decisions and durable storage for agent
 * skills: whether a proposed skill reuses, merges with, or stays distinct from
 * an existing one (gate), when a skill ages out of use (lifecycle), and the
 * file-backed store that records usage, summaries, and pending/evidence
 * observations (store). This module owns the shared identity schema only; each
 * capability module owns its own records and constants.
 *
 * Design rules: runtime
 * products inject global and project configuration roots; environment lookup
 * and legacy-directory migration stay in the runtime path adapter. Command
 * mapping, prompt formatting, logging, scheduling, and model-driven review
 * remain adapters outside this package.
 *
 * @module @rin/skill-memory
 */

export const SKILL_MEMORY_API_VERSION = 'rin.dev/v1' as const

/** Which configuration scope a skill memory entry lives under. */
export type SkillMemoryScope = 'global' | 'project'

/** Stable identity of a skill, independent of how the runtime loaded it. */
export interface SkillMemoryRef {
  skillName: string
  source?: string
  loadedFrom?: string
  projectRoot?: string
}

/** Configuration roots the runtime injects to locate skill memory. */
export interface SkillMemoryRoots {
  globalConfigRoot: string
  projectConfigRoot?: string
}
