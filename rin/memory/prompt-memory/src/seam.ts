/**
 * rin prompt-memory — system prompt seam projection (structural, cordis-free).
 *
 * Registers the prompt memory (SOUL identity + BRIEF/USER memory) as an ordered
 * system prompt section and keeps that section in sync with the store on every
 * assembly through the `system-prompt/assemble` waterfall. The seam is
 * structural: it consumes only the minimal context surface declared here, so
 * the wiring is strip-types smoke-testable without @deepseek-ai/cordis.
 *
 * @module @rin/prompt-memory
 */

import {
  buildPromptMemorySectionText,
  type PromptMemoryProjectionOptions,
} from './projection.ts'
import type { PromptMemoryStatus } from './types.ts'

export const PROMPT_MEMORY_SECTION_NAME = 'rin:prompt-memory'

/** Prompt order of the memory section: after the persona (0), before tool guidance (100–199). */
export const PROMPT_MEMORY_SECTION_ORDER = 50

/** One assembled system prompt, mirroring the seam's merge-extensible input. */
export interface PromptAssembly {
  sections: Array<{ name: string; text: string }>
  contexts: Array<{ name: string; text: string }>
  tools: unknown[]
  variables: Record<string, string | undefined>
}

/** An expert waterfall listener over the assembled system prompt. */
export type PromptAssemblyListener = (
  assembly: PromptAssembly,
  context: unknown,
  next: () => Promise<PromptAssembly>,
) => Promise<PromptAssembly> | void

/** The minimal context surface the projection consumes (structural subset of Context). */
export interface PromptMemorySeam {
  systemPrompt: {
    /** Register an ordered prompt section; returns its disposer. */
    section(section: { name: string; order: number; text: string }): () => void
  }
  /** Register an event listener; returns its disposer. */
  on(event: string, listener: PromptAssemblyListener): () => void
  /** Register a disposal callback for the owning context. */
  effect(disposer: () => void, label?: string): void
  promptMemory: {
    getStatus(): Promise<PromptMemoryStatus>
  }
}

/**
 * Project prompt memory into the system prompt.
 *
 * Registers an ordered section with the current store snapshot, then keeps its
 * text in sync with the store by re-reading on every `system-prompt/assemble`.
 * All registrations are disposed together when the owning context is disposed.
 *
 * @param ctx - the structural context surface (systemPrompt + promptMemory).
 * @param options - which memory components to include.
 */
export async function registerPromptMemorySeam(
  ctx: PromptMemorySeam,
  options: PromptMemoryProjectionOptions,
): Promise<void> {
  const initial = await ctx.promptMemory.getStatus()
  const disposeSection = ctx.systemPrompt.section({
    name: PROMPT_MEMORY_SECTION_NAME,
    order: PROMPT_MEMORY_SECTION_ORDER,
    text: buildPromptMemorySectionText(initial, options),
  })

  const disposeListener = ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembled = await next()
    const status = await ctx.promptMemory.getStatus()
    const text = buildPromptMemorySectionText(status, options)
    return {
      ...assembled,
      sections: assembled.sections.map(section =>
        section.name === PROMPT_MEMORY_SECTION_NAME ? { ...section, text } : section,
      ),
    }
  })

  ctx.effect(() => {
    disposeListener()
    disposeSection()
  }, 'prompt-memory.seam')
}
