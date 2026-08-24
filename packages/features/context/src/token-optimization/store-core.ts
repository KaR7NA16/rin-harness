/**
 * rin token-optimization — runtime knob state without the Cordis import graph.
 *
 * Holds the current knob values (prompt cleaner) and keeps the registered
 * system-prompt effects in sync through a structural seam, so the logic is
 * strip-types smoke-testable without pulling in @deepseek-ai/cordis.
 * The plugin entry (index.ts) wraps this core in the Service type.
 *
 * @module @rin/context
 */

import { cleanPromptText } from './clean.ts'

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
  cleanPrompt: boolean
}

/** Initial knob values. */
export interface TokenKnobConfig {
  cleanPrompt?: boolean
}

/**
 * The runtime knob holder: applies changes immediately by swapping the
 * registered system-prompt effect through its disposer.
 */
export class TokenOptimizationCore {
  private cleaning: boolean
  private cleanDisposer: (() => void) | null = null

  private readonly seam: TokenOptimizationSeam

  constructor(seam: TokenOptimizationSeam, config: TokenKnobConfig = {}) {
    this.seam = seam
    this.cleaning = config.cleanPrompt ?? false
    this.install()
    seam.effect(() => {
      this.cleanDisposer?.()
      this.cleanDisposer = null
    }, 'token-optimization.dispose')
  }

  /** @returns the current knob values. */
  getStatus(): TokenOptimizationStatus {
    return { cleanPrompt: this.cleaning }
  }

  /** Switch the prompt cleaner; applies immediately. */
  setCleanPrompt(enabled: boolean): TokenOptimizationStatus {
    this.cleaning = enabled
    this.install()
    return this.getStatus()
  }

  /** Swap the registration effect to match the current knob values. */
  private install(): void {
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
