/**
 * rin brief — Cordis plugin entry.
 *
 * Registers the model-visible `brief` tool and the `/brief` slash command,
 * both producing a structured markdown session brief from the invoking
 * agent's session log via the dsh llm seam. Re-exports the standalone core
 * functions for product-independent use.
 *
 * @module @rin/brief
 */

import { Context } from '@deepseek-ai/cordis'
import { registerSeam } from './seam.ts'
import type { Config } from './seam.ts'

export const name = 'brief'
/** Required services: the tools and commands registries (llm is read via ctx.get). */
export const inject = ['tools', 'commands']

/**
 * Install the brief capability: the `brief` tool and the `/brief` command.
 * @param ctx - the plugin context (must inject tools and commands).
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  registerSeam(ctx, config)
}

export { registerSeam, type Config } from './seam.ts'
export { resolveBriefConfig, BriefCore } from './core.ts'
export {
  BRIEF_RESULT_TRUNCATION_MARKER,
  BRIEF_SYSTEM_PROMPT,
  BRIEF_TRANSCRIPT_TRUNCATION_MARKER,
  DEFAULT_BRIEF_MAX_EVENTS,
  DEFAULT_BRIEF_MAX_INPUT_BYTES,
  DEFAULT_BRIEF_MAX_OUTPUT_TOKENS,
  DEFAULT_BRIEF_MAX_RESULT_BYTES,
  DEFAULT_BRIEF_MODEL,
  boundUtf8Bytes,
  briefCommandDescriptor,
  briefToolDescriptor,
  buildBriefPrompt,
  generateBrief,
  renderSessionEvents,
  resolveBriefLlmRoute,
  shapeBriefResult,
  trimSessionEvents,
} from './core.ts'
export type { BriefGenerationOptions, TrimmedBriefEvents } from './core.ts'
export type * from './types.ts'
