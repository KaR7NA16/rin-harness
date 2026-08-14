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
import type {} from '@deepseek-ai/dsh-system-prompt'
import { CAVEMAN_PROMPT, PONYTAIL_PROMPT } from './prompts.ts'
import { cleanPromptText } from './clean.ts'

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
  responseStyle: z.string().default('off'),
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
    ctx.on('system-prompt/assemble', async (assembly, _context, next) => {
      await next()
      assembly.sections = assembly.sections.map(section => ({
        ...section,
        text: cleanPromptText(section.text),
      }))
    })
  }
}
