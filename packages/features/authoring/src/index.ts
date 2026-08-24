/**
 * @rin/authoring — aggregate entry for brief and review capabilities.
 *
 * The two capability implementations retain independent internal modules and
 * seams while sharing one package lifecycle and public export surface.
 *
 * @module @rin/authoring
 */

import { Context } from '@deepseek-ai/cordis'
import { apply as applyBriefPlugin } from './brief/plugin.ts'
import { apply as applyReviewPlugin } from './review/plugin.ts'
import type { Config as BriefConfig } from './brief/seam.ts'
import type { Config as ReviewConfig } from './review/seam.ts'

export type * from './brief/types.ts'
export type * from './review/types.ts'

export {
  BRIEF_RESULT_TRUNCATION_MARKER,
  BRIEF_SYSTEM_PROMPT,
  BRIEF_TRANSCRIPT_TRUNCATION_MARKER,
  DEFAULT_BRIEF_MAX_EVENTS,
  DEFAULT_BRIEF_MAX_INPUT_BYTES,
  DEFAULT_BRIEF_MAX_OUTPUT_TOKENS,
  DEFAULT_BRIEF_MAX_RESULT_BYTES,
  DEFAULT_BRIEF_MODEL,
  BriefCore,
  boundUtf8Bytes as boundBriefUtf8Bytes,
  briefCommandDescriptor,
  briefToolDescriptor,
  buildBriefPrompt,
  generateBrief,
  renderSessionEvents,
  resolveBriefConfig,
  resolveBriefLlmRoute,
  shapeBriefResult,
  trimSessionEvents,
} from './brief/core.ts'
export type { BriefGenerationOptions, TrimmedBriefEvents } from './brief/core.ts'
export { registerSeam as registerBriefSeam } from './brief/seam.ts'

export {
  DEFAULT_REVIEW_MAX_INPUT_BYTES,
  DEFAULT_REVIEW_MAX_OUTPUT_TOKENS,
  DEFAULT_REVIEW_MAX_RESULT_BYTES,
  DEFAULT_REVIEW_MODEL,
  REVIEW_ARTIFACT_TRUNCATION_MARKER,
  REVIEW_RESULT_TRUNCATION_MARKER,
  REVIEW_SYSTEM_PROMPT_GENERAL,
  REVIEW_SYSTEM_PROMPT_SECURITY,
  ReviewCore,
  boundUtf8Bytes as boundReviewUtf8Bytes,
  buildReviewPrompt,
  generateReview,
  normalizeReviewKind,
  resolveReviewConfig,
  resolveReviewLlmRoute,
  reviewCommandDescriptor,
  reviewSystemPrompt,
  reviewToolDescriptor,
  shapeReviewResult,
} from './review/core.ts'
export type { ReviewGenerationOptions } from './review/core.ts'
export { registerSeam as registerReviewSeam } from './review/seam.ts'

/** Cordis loader name for the aggregate authoring package. */
export const name = 'authoring'
/** Shared registries required by both authoring capabilities. */
export const inject = ['tools', 'commands']

/** Configuration for the two independent authoring capability modules. */
export interface Config {
  brief?: BriefConfig
  review?: ReviewConfig
}

/**
 * Install both authoring capability modules.
 *
 * @param ctx - the shared Cordis context.
 * @param config - optional per-capability policies.
 */
export function apply(ctx: Context, config: Config = {}): void {
  applyBriefPlugin(ctx, config.brief ?? {})
  applyReviewPlugin(ctx, config.review ?? {})
}
