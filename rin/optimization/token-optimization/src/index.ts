/**
 * rin token-optimization — the slim knob set for the token-saving family.
 *
 * Two switches today, both live-switchable at runtime: a response-compression
 * style (caveman/ponytail) installed as a system-prompt section, and a
 * deterministic prompt cleaner on the assemble waterfall. Neither touches tool
 * schemas, tool results, or the session log. The TokenOptimizationStore
 * exposes the knob state; store-core.ts owns the effect swapping.
 *
 * @module @rin/token-optimization
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  TokenOptimizationCore,
  type PromptAssembly,
  type ResponseStyle,
  type TokenOptimizationSeam,
  type TokenOptimizationStatus,
} from './store-core.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    systemPrompt: TokenOptimizationSeam['systemPrompt']
  }

  interface Events {
    /**
     * Expert waterfall over the assembled sections, contexts, tools, and
     * variables. The returned value is authoritative.
     * @param assembly - the mutable assembly built from registered providers.
     * @param context - the caller's per-assembly context.
     * @mode waterfall
     */
    'system-prompt/assemble'(
      assembly: PromptAssembly,
      context: unknown,
      next: () => Promise<PromptAssembly>,
    ): Promise<PromptAssembly>
  }
}

export { CAVEMAN_PROMPT, PONYTAIL_PROMPT } from './prompts.ts'
export { cleanPromptText, cleanSystemPromptParts } from './clean.ts'
export {
  SECTION_NAME,
  SECTION_ORDER,
  TokenOptimizationCore,
  validateResponseStyle,
  type PromptAssembly,
  type ResponseStyle,
  type TokenKnobConfig,
  type TokenOptimizationSeam,
  type TokenOptimizationStatus,
} from './store-core.ts'

export const name = 'token-optimization'
export const inject = ['systemPrompt']

/** Plugin configuration: the two knobs of the token-saving family. */
export interface Config {
  responseStyle?: ResponseStyle
  cleanPrompt?: boolean
}

export const Config: z<Config> = z.object({
  responseStyle: z.union(['off', 'caveman', 'ponytail'] as const).default('off'),
  cleanPrompt: z.boolean().default(false),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    tokenOptimization: TokenOptimizationStore
  }
}

/**
 * The token-optimization service: holds the current knob values and keeps the
 * registered system-prompt effects in sync, so a change applies without a
 * restart.
 */
export class TokenOptimizationStore extends Service {
  private readonly core: TokenOptimizationCore

  constructor(ctx: Context, config: Config) {
    super(ctx, 'tokenOptimization')
    // Context satisfies the seam once the systemPrompt augmentation above is
    // in scope, except Cordis's generic on() signature — cast deliberately.
    this.core = new TokenOptimizationCore(ctx as unknown as TokenOptimizationSeam, config)
  }

  /** @returns the current knob values. */
  getStatus(): TokenOptimizationStatus {
    return this.core.getStatus()
  }

  /** Switch the response-compression style; applies immediately. */
  setResponseStyle(style: ResponseStyle): TokenOptimizationStatus {
    return this.core.setResponseStyle(style)
  }

  /** Switch the prompt cleaner; applies immediately. */
  setCleanPrompt(enabled: boolean): TokenOptimizationStatus {
    return this.core.setCleanPrompt(enabled)
  }
}

/**
 * Install the token-optimization store with the configured knobs.
 * @param ctx - the plugin context (must inject systemPrompt).
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.plugin(TokenOptimizationStore, config)
}
