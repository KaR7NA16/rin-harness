/**
 * rin prompt-memory — system prompt projection (pure, cordis-free).
 *
 * Builds the model-visible memory section text from a status snapshot, applying
 * the package's deterministic character budgets: the SOUL identity is bounded
 * to SOUL_CHAR_LIMIT, and BRIEF/USER share the combined prompt-memory budget.
 *
 * @module @rin/prompt-memory
 */

import { boundPromptMemoryPair, boundPromptMemoryText } from './budget.ts'
import { SOUL_CHAR_LIMIT, USER_PROMPT_MEMORY_CHAR_LIMIT } from './types.ts'
import type { PromptMemoryStatus } from './types.ts'

/** Resolved switches controlling what the projected section includes. */
export interface PromptMemoryProjectionOptions {
  /** Include the SOUL identity (default true). */
  injectSoul: boolean
  /** Include the BRIEF working memory (default true). */
  injectBrief: boolean
}

/**
 * Build the model-visible prompt memory section text from a status snapshot.
 *
 * The SOUL identity is bounded to its character limit and included first; BRIEF
 * and USER are bounded together against the shared prompt-memory budget (BRIEF
 * first, USER receiving the remainder) so the combined injection never exceeds
 * PROMPT_MEMORY_TOTAL_CHAR_LIMIT. Empty or disabled components are omitted; when
 * nothing remains the result is an empty string.
 *
 * @param status - the store snapshot to project.
 * @param options - which components to include.
 * @returns the section text, or `''` when there is nothing to inject.
 */
export function buildPromptMemorySectionText(
  status: PromptMemoryStatus,
  options: PromptMemoryProjectionOptions,
): string {
  const { soul, brief, user } = status.files
  const parts: string[] = []

  if (options.injectSoul) {
    const bounded = boundPromptMemoryText('SOUL.md', soul.content, SOUL_CHAR_LIMIT)
    if (bounded.content) parts.push(`# Identity\n\n${bounded.content}`)
  }

  if (options.injectBrief) {
    const pair = boundPromptMemoryPair({ brief: brief.content, user: user.content })
    if (pair.brief.content) parts.push(`# Working brief\n\n${pair.brief.content}`)
    if (pair.user.content) parts.push(`# User memory\n\n${pair.user.content}`)
  } else {
    const bounded = boundPromptMemoryText(
      'USER.md',
      user.content,
      USER_PROMPT_MEMORY_CHAR_LIMIT,
    )
    if (bounded.content) parts.push(`# User memory\n\n${bounded.content}`)
  }

  return parts.join('\n\n')
}
