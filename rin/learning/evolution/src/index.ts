/**
 * rin evolution — Cordis plugin entry.
 *
 * Exposes a ctx.evolution service (the skill self-evolution loop) plus the
 * domain model: types, store, approval, reviewer, secret scanning, and the
 * prompt-memory insight projection. Model access, catalog refresh, and user
 * notices arrive as injected adapters from the installing runtime.
 *
 * @module @rin/evolution
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { createEvolution } from './evolution.ts'
import type { Evolution } from './evolution.ts'
import { registerSeam, type EvolutionSeam } from './seam.ts'
import type { EvolutionAdapters, EvolutionRoots, EvolutionReviewModel } from './types.ts'

export * from './types.ts'
export { createEvolution, projectPromptMemoryInsights } from './evolution.ts'
export type { Evolution } from './evolution.ts'
export { createEvolutionStore } from './store.ts'
export type { EvolutionStore } from './store.ts'
export { createEvolutionApproval } from './approval.ts'
export type { EvolutionApproval } from './approval.ts'
export {
  buildSkillLearningPrompt,
  createEvolutionReviewer,
  evaluateSkillReviewEligibility,
  parseSkillCandidateResponse,
  shouldAutoApproveSkillCandidate,
} from './reviewer.ts'
export type { EvolutionReviewer, SkillReviewEligibility } from './reviewer.ts'
export { redactSecrets, scanForSecrets } from './secrets.ts'
export type { SecretMatch } from './secrets.ts'
export {
  SKILLS_DIRNAME,
  SKILL_LEARNING_CONFIG_FILENAME,
  SKILL_LEARNING_DIRNAME,
  SKILL_LEARNING_STATE_FILENAME,
  getGlobalSkillsRoot,
  getProjectSkillsRoot,
  getSkillLearningBackupsRoot,
  getSkillLearningConfigPath,
  getSkillLearningRoot,
  getSkillLearningStatePath,
} from './paths.ts'
export {
  EVOLUTION_TRIGGER_EVENT,
  registerEvolutionTriggers,
  registerSeam,
} from './seam.ts'
export type { EvolutionSeam, EvolutionTriggerConfig } from './seam.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    evolution: EvolutionService
  }
}

/** Configuration required to install the evolution service. */
export interface EvolutionPluginConfig {
  /** The global configuration root (skill learning store + global skills). */
  globalConfigRoot: string
  /** The project configuration root (required for project-scoped skills). */
  projectConfigRoot?: string
  /** Injected model adapter for the review and merge prompts. */
  reviewModel: EvolutionReviewModel
  /** Optional adapter refreshing the runtime skill catalog after approval. */
  clearCatalog?: () => void | Promise<void>
  /** Optional adapter surfacing a review notice to the user. */
  appendNotice?: (text: string) => void
  /** Optional adapter for non-durable debug logging. */
  logDebug?: (message: string) => void
  /**
   * Opt-in automatic review trigger. Defaults to off: the review loop is
   * entered manually through the web-server route. When true,
   * {@link registerEvolutionTriggers} subscribes to a session lifecycle event;
   * the session→review mapping is a wiring point only, not yet implemented.
   */
  autoTrigger?: boolean
}

/** The skill self-evolution service exposed on the shared context. */
export abstract class EvolutionService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'evolution')
  }

  abstract readConfig(): ReturnType<Evolution['readConfig']>
  abstract updateConfig(...args: Parameters<Evolution['updateConfig']>): ReturnType<Evolution['updateConfig']>
  abstract readState(): ReturnType<Evolution['readState']>
  abstract getCandidate(...args: Parameters<Evolution['getCandidate']>): ReturnType<Evolution['getCandidate']>
  abstract approveCandidate(...args: Parameters<Evolution['approveCandidate']>): ReturnType<Evolution['approveCandidate']>
  abstract rejectCandidate(...args: Parameters<Evolution['rejectCandidate']>): ReturnType<Evolution['rejectCandidate']>
  abstract executeReview(...args: Parameters<Evolution['executeReview']>): ReturnType<Evolution['executeReview']>
  abstract projectPromptMemoryInsights(...args: Parameters<Evolution['projectPromptMemoryInsights']>): ReturnType<Evolution['projectPromptMemoryInsights']>
}

/** File-backed implementation delegating to createEvolution. */
export class FileEvolutionService extends EvolutionService {
  private readonly evolution: Evolution

  constructor(ctx: Context, config: EvolutionPluginConfig) {
    super(ctx)
    this.evolution = createEvolution(resolvePluginConfig(config))
  }

  override readConfig() {
    return this.evolution.readConfig()
  }

  override updateConfig(...args: Parameters<Evolution['updateConfig']>) {
    return this.evolution.updateConfig(...args)
  }

  override readState() {
    return this.evolution.readState()
  }

  override getCandidate(...args: Parameters<Evolution['getCandidate']>) {
    return this.evolution.getCandidate(...args)
  }

  override approveCandidate(...args: Parameters<Evolution['approveCandidate']>) {
    return this.evolution.approveCandidate(...args)
  }

  override rejectCandidate(...args: Parameters<Evolution['rejectCandidate']>) {
    return this.evolution.rejectCandidate(...args)
  }

  override executeReview(...args: Parameters<Evolution['executeReview']>) {
    return this.evolution.executeReview(...args)
  }

  override projectPromptMemoryInsights(...args: Parameters<Evolution['projectPromptMemoryInsights']>) {
    return this.evolution.projectPromptMemoryInsights(...args)
  }
}

export const name = 'evolution'
export const inject = []

/** Install the file-backed evolution service and its seam projections. */
export function apply(ctx: Context, config: EvolutionPluginConfig): void {
  ctx.plugin(FileEvolutionService, config)
  registerSeam(ctx as unknown as EvolutionSeam, config)
}

/** Validate the plugin config and split it into roots and adapters. */
function resolvePluginConfig(config: unknown): {
  roots: EvolutionRoots
  adapters: EvolutionAdapters
} {
  if (config === null || typeof config !== 'object') {
    throw new Error(
      'rin evolution: plugin requires a config object with globalConfigRoot and reviewModel',
    )
  }
  const candidate = config as Partial<EvolutionPluginConfig>
  const globalConfigRoot = candidate.globalConfigRoot
  const reviewModel = candidate.reviewModel
  if (typeof globalConfigRoot !== 'string' || globalConfigRoot.trim() === '') {
    throw new Error('rin evolution: config.globalConfigRoot must be a non-empty string')
  }
  if (typeof reviewModel !== 'function') {
    throw new Error('rin evolution: config.reviewModel must be a function')
  }
  return {
    roots: {
      globalConfigRoot,
      ...(typeof candidate.projectConfigRoot === 'string' && candidate.projectConfigRoot.trim() !== ''
        ? { projectConfigRoot: candidate.projectConfigRoot }
        : {}),
    },
    adapters: {
      reviewModel,
      ...(typeof candidate.clearCatalog === 'function' ? { clearCatalog: candidate.clearCatalog } : {}),
      ...(typeof candidate.appendNotice === 'function' ? { appendNotice: candidate.appendNotice } : {}),
      ...(typeof candidate.logDebug === 'function' ? { logDebug: candidate.logDebug } : {}),
    },
  }
}
