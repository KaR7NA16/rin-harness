/**
 * rin token-optimization — runtime knob state without the Cordis import graph.
 *
 * Holds the current knob values (response style + prompt cleaner) and keeps the
 * registered system-prompt effects in sync through a structural seam, so the
 * logic is strip-types smoke-testable without pulling in @deepseek-ai/cordis.
 * The plugin entry (index.ts) wraps this core in the Service type.
 *
 * @module @rin/token-optimization
 */

import { CAVEMAN_PROMPT, PONYTAIL_PROMPT } from './prompts.ts'
import { cleanPromptText } from './clean.ts'

export const SECTION_NAME = 'rin:response-style'
export const SECTION_ORDER = 100

/** The response-compression styles this plugin can install. */
export type ResponseStyle = 'off' | 'caveman' | 'ponytail'

/** The minimal context surface the core consumes (structural subset of Context). */
export interface TokenOptimizationSeam {
  systemPrompt: {
    /** Register an ordered prompt section; returns its disposer. */
    section(section: { name: string; order: number; text: string }): () => void
  }
  /** Register an event listener; returns its disposer. */
  on(event: string, listener: (assembly: PromptAssembly, context: unknown, next: () => Promise<PromptAssembly>) => Promise<PromptAssembly> | void): () => void
  /** Register a disposal callback for the owning context. */
  effect(disposer: () => void, label?: string): void
}

/** One assembled system prompt, mirroring the seam's merge-extensible input. */
export interface PromptAssembly {
  sections: { name: string; text: string }[]
  contexts: { name: string; text: string }[]
  tools: unknown[]
  variables: Record<string, string | undefined>
}

/** The live knob state. */
export interface TokenOptimizationStatus {
  responseStyle: ResponseStyle
  cleanPrompt: boolean
}

/** Initial knob values. */
export interface TokenKnobConfig {
  responseStyle?: ResponseStyle
  cleanPrompt?: boolean
}

/**
 * Validate a response-style value.
 * @param style - the candidate value.
 * @returns the validated style.
 * @throws when the value is not a known style.
 */
export function validateResponseStyle(style: unknown): ResponseStyle {
  if (style !== 'off' && style !== 'caveman' && style !== 'ponytail') {
    throw new Error('rin token-optimization: responseStyle must be off, caveman, or ponytail')
  }
  return style
}

/**
 * The runtime knob holder: applies changes immediately by swapping the two
 * registration effects through their disposers.
 */
export class TokenOptimizationCore {
  private style: ResponseStyle
  private cleaning: boolean
  private styleDisposer: (() => void) | null = null
  private cleanDisposer: (() => void) | null = null

  private readonly seam: TokenOptimizationSeam

  constructor(seam: TokenOptimizationSeam, config: TokenKnobConfig = {}) {
    this.seam = seam
    this.style = validateResponseStyle(config.responseStyle ?? 'off')
    this.cleaning = config.cleanPrompt ?? false
    this.install()
    seam.effect(() => {
      this.styleDisposer?.()
      this.styleDisposer = null
      this.cleanDisposer?.()
      this.cleanDisposer = null
    }, 'token-optimization.dispose')
  }

  /** @returns the current knob values. */
  getStatus(): TokenOptimizationStatus {
    return { responseStyle: this.style, cleanPrompt: this.cleaning }
  }

  /** Switch the response-compression style; applies immediately. */
  setResponseStyle(style: ResponseStyle): TokenOptimizationStatus {
    this.style = validateResponseStyle(style)
    this.install()
    return this.getStatus()
  }

  /** Switch the prompt cleaner; applies immediately. */
  setCleanPrompt(enabled: boolean): TokenOptimizationStatus {
    this.cleaning = enabled
    this.install()
    return this.getStatus()
  }

  /** Swap both registration effects to match the current knob values. */
  private install(): void {
    this.styleDisposer?.()
    this.styleDisposer = null
    if (this.style === 'caveman' || this.style === 'ponytail') {
      const text = this.style === 'ponytail' ? PONYTAIL_PROMPT : CAVEMAN_PROMPT
      this.styleDisposer = this.seam.systemPrompt.section({ name: SECTION_NAME, order: SECTION_ORDER, text })
    }
    this.cleanDisposer?.()
    this.cleanDisposer = null
    if (this.cleaning) {
      this.cleanDisposer = this.seam.on('system-prompt/assemble', async (_assembly, _context, next) => {
        const assembled = await next()
        return {
          ...assembled,
          sections: assembled.sections.map(section => ({
            ...section,
            text: cleanPromptText(section.text),
          })),
        }
      })
    }
  }
}
