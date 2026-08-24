/**
 * rin evolution — storage identities and layout.
 *
 * Derives the skill learning state/config paths and the skills output
 * directories from the injected configuration roots. Never inspects product
 * environment variables.
 *
 * @module @rin/evolution
 */

import { join } from 'node:path'
import type { EvolutionRoots } from './types.ts'

export const SKILL_LEARNING_DIRNAME = 'skill-learning'
export const SKILL_LEARNING_STATE_FILENAME = 'state.json'
export const SKILL_LEARNING_CONFIG_FILENAME = 'config.json'
export const SKILLS_DIRNAME = 'skills'

/** The skill learning store directory (candidates, events, backups). */
export function getSkillLearningRoot(roots: EvolutionRoots): string {
  return join(roots.globalConfigRoot, SKILL_LEARNING_DIRNAME).normalize('NFC')
}

export function getSkillLearningStatePath(roots: EvolutionRoots): string {
  return join(getSkillLearningRoot(roots), SKILL_LEARNING_STATE_FILENAME)
}

export function getSkillLearningConfigPath(roots: EvolutionRoots): string {
  return join(getSkillLearningRoot(roots), SKILL_LEARNING_CONFIG_FILENAME)
}

export function getSkillLearningBackupsRoot(roots: EvolutionRoots): string {
  return join(getSkillLearningRoot(roots), 'backups')
}

/** The global skills output directory (approved SKILL.md files). */
export function getGlobalSkillsRoot(roots: EvolutionRoots): string {
  return join(roots.globalConfigRoot, SKILLS_DIRNAME).normalize('NFC')
}

/** The project skills output directory for a project configuration root. */
export function getProjectSkillsRoot(projectConfigRoot: string): string {
  return join(projectConfigRoot, SKILLS_DIRNAME).normalize('NFC')
}
