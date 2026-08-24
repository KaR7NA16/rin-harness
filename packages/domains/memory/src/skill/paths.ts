/**
 * rin skill memory — storage identities and layout.
 *
 * Derives stable skill-memory ids and on-disk paths from the injected config
 * roots. Runtime products inject global and project roots; environment lookup
 * and legacy-directory migration remain in the runtime path adapter.
 *
 * @module @rin/memory/skill
 */

import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { SkillMemoryRef, SkillMemoryRoots, SkillMemoryScope } from './types.ts'

export const SKILL_MEMORY_DIRNAME = 'skill-memory'
export const SKILL_USAGE_FILENAME = '.usage.json'
export const SKILL_MEMORY_SUMMARY_FILENAME = 'SUMMARY.md'
export const SKILL_MEMORY_PENDING_FILENAME = 'PENDING.jsonl'
export const SKILL_MEMORY_EVIDENCE_FILENAME = 'EVIDENCE.jsonl'
export const SKILL_MEMORY_STATS_FILENAME = 'STATS.json'

/**
 * The raw identity key for a skill: its source (or load site) plus its name.
 *
 * @param ref - the skill reference.
 */
export function getSkillMemoryRawKey(ref: SkillMemoryRef): string {
  const source = ref.source || ref.loadedFrom || 'unknown'
  return `${source}:${ref.skillName}`
}

/**
 * Derive a stable, filesystem-safe id from a reference or a raw key.
 *
 * @param refOrKey - the skill reference or its raw key.
 */
export function getSkillMemoryId(refOrKey: SkillMemoryRef | string): string {
  const rawKey =
    typeof refOrKey === 'string' ? refOrKey : getSkillMemoryRawKey(refOrKey)
  const slug = rawKey
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  const hash = createHash('sha1').update(rawKey).digest('hex').slice(0, 8)
  return slug ? `${slug}-${hash}` : hash
}

/**
 * The global skill memory root directory.
 *
 * @param globalConfigRoot - the injected global config root.
 */
export function getGlobalSkillMemoryRoot(globalConfigRoot: string): string {
  return join(globalConfigRoot, SKILL_MEMORY_DIRNAME).normalize('NFC')
}

/**
 * The project skill memory root directory.
 *
 * @param projectConfigRoot - the injected project config root.
 */
export function getProjectSkillMemoryRoot(projectConfigRoot: string): string {
  return join(projectConfigRoot, SKILL_MEMORY_DIRNAME).normalize('NFC')
}

/**
 * The skill memory root for a scope.
 *
 * @param scope - global or project.
 * @param roots - the injected config roots.
 */
export function getSkillMemoryRoot(
  scope: SkillMemoryScope,
  roots: SkillMemoryRoots,
): string {
  if (scope === 'project') {
    if (!roots.projectConfigRoot) {
      throw new Error('rin skill-memory: project scope requires a project config root')
    }
    return getProjectSkillMemoryRoot(roots.projectConfigRoot)
  }
  return getGlobalSkillMemoryRoot(roots.globalConfigRoot)
}

/**
 * The directory holding one skill's memory files.
 *
 * @param ref - the skill reference.
 * @param scope - global or project.
 * @param roots - the injected config roots.
 */
export function getSkillMemoryDir(
  ref: SkillMemoryRef,
  scope: SkillMemoryScope,
  roots: SkillMemoryRoots,
): string {
  return join(getSkillMemoryRoot(scope, roots), getSkillMemoryId(ref))
}

/**
 * The usage sidecar path for a scope.
 *
 * The reference is kept in the signature for call-shape symmetry with
 * getSkillMemoryDir; the sidecar is shared across skills within a scope.
 *
 * @param _ref - the skill reference (unused; sidecars are per-scope).
 * @param scope - global or project.
 * @param roots - the injected config roots.
 */
export function getSkillUsageSidecarPath(
  _ref: SkillMemoryRef,
  scope: SkillMemoryScope,
  roots: SkillMemoryRoots,
): string {
  if (scope === 'project') {
    if (!roots.projectConfigRoot) {
      throw new Error('rin skill-memory: project skill usage sidecar requires a project config root')
    }
    return join(roots.projectConfigRoot, 'skills', SKILL_USAGE_FILENAME).normalize('NFC')
  }
  return join(roots.globalConfigRoot, 'skills', SKILL_USAGE_FILENAME).normalize('NFC')
}
