/**
 * rin token-optimization — one minimal switch for the token-saving family.
 *
 * Two knobs today: a response-compression style (caveman/ponytail) installed as
 * a system-prompt section, and a deterministic prompt cleaner on the assemble
 * waterfall. Neither touches tool schemas, tool results, or the session log.
 *
 * @module @rin/token-optimization
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { CAVEMAN_PROMPT, PONYTAIL_PROMPT } from './prompts.ts'
import { cleanPromptText } from './clean.ts'

/**
 * Local type declarations for the systemPrompt seam this plugin consumes.
 * Declared here rather than importing `@deepseek-ai/dsh-system-prompt`, so the
 * package stays free of dsh-* source references (whose tsconfig paths mapping
 * would pull that package's source graph under this package's rootDir).
 */
declare module '@deepseek-ai/cordis' {
  interface Context {
    systemPrompt: {
      /** Register an ordered prompt section in the calling context's scope. */
      section(section: { name: string; order: number; text: string }): () => void
    }
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

/** One assembled system prompt, mirroring the seam's merge-extensible input. */
interface PromptAssembly {
  sections: { name: string; text: string }[]
  contexts: { name: string; text: string }[]
  tools: unknown[]
  variables: Record<string, string | undefined>
}

export { CAVEMAN_PROMPT, PONYTAIL_PROMPT } from './prompts.ts'
export { cleanPromptText, cleanSystemPromptParts } from './clean.ts'

export const name = 'token-optimization'
export const inject = ['systemPrompt']

/** The response-compression styles this plugin can install. */
export type ResponseStyle = 'off' | 'caveman' | 'ponytail'

/** Plugin configuration: one switch for the token-saving family. */
export interface Config {
  responseStyle?: ResponseStyle
  cleanPrompt?: boolean
}

export const Config: z<Config> = z.object({
  responseStyle: z.union(['off', 'caveman', 'ponytail'] as const).default('off'),
  cleanPrompt: z.boolean().default(false),
})

const SECTION_NAME = 'rin:response-style'
const SECTION_ORDER = 100

/**
 * Install the selected token-saving behavior.
 * @param ctx - the plugin context (must inject systemPrompt).
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  if (config.responseStyle === 'caveman' || config.responseStyle === 'ponytail') {
    const text = config.responseStyle === 'ponytail' ? PONYTAIL_PROMPT : CAVEMAN_PROMPT
    ctx.systemPrompt.section({ name: SECTION_NAME, order: SECTION_ORDER, text })
  } else if (config.responseStyle !== 'off') {
    throw new Error('rin token-optimization: responseStyle must be off, caveman, or ponytail')
  }

  if (config.cleanPrompt) {
    ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
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
