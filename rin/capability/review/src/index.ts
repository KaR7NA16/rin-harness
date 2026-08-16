/**
 * rin review — Cordis plugin entry.
 *
 * Registers the model-visible `review_artifact` tool and the `/review` /
 * `/security-review` slash commands, each reviewing a provided artifact
 * (code, diff, or text) through the dsh llm seam. Re-exports the standalone
 * core functions for product-independent use.
 *
 * @module @rin/review
 */

import { Context } from '@deepseek-ai/cordis'
import { registerSeam } from './seam.ts'
import type { Config } from './seam.ts'

export const name = 'review'
/** Required services: the tools and commands registries (llm is read via ctx.get). */
export const inject = ['tools', 'commands']

/**
 * Install the review capability: the `review_artifact` tool and the
 * `/review` / `/security-review` commands.
 * @param ctx - the plugin context (must inject tools and commands).
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  registerSeam(ctx, config)
}

export { registerSeam, type Config } from './seam.ts'
export { resolveReviewConfig, ReviewCore } from './core.ts'
export {
  DEFAULT_REVIEW_MAX_INPUT_BYTES,
  DEFAULT_REVIEW_MAX_OUTPUT_TOKENS,
  DEFAULT_REVIEW_MAX_RESULT_BYTES,
  DEFAULT_REVIEW_MODEL,
  REVIEW_ARTIFACT_TRUNCATION_MARKER,
  REVIEW_RESULT_TRUNCATION_MARKER,
  REVIEW_SYSTEM_PROMPT_GENERAL,
  REVIEW_SYSTEM_PROMPT_SECURITY,
  boundUtf8Bytes,
  buildReviewPrompt,
  generateReview,
  normalizeReviewKind,
  resolveReviewLlmRoute,
  reviewCommandDescriptor,
  reviewSystemPrompt,
  reviewToolDescriptor,
  shapeReviewResult,
} from './core.ts'
export type { ReviewGenerationOptions } from './core.ts'
export type * from './types.ts'
