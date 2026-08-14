/**
 * Deterministic character budgets for injected prompt memory.
 *
 * @module @rin/prompt-memory
 */

import {
  BRIEF_CHAR_LIMIT,
  PROMPT_MEMORY_TOTAL_CHAR_LIMIT,
  USER_PROMPT_MEMORY_CHAR_LIMIT,
  type BoundedText,
} from './types.ts'

/**
 * Bound one text to its limit, suffixing an explicit truncation notice when the
 * content must be cut so the loss is visible to the model.
 *
 * @param label - the file label used inside the truncation notice.
 * @param raw - the raw file content.
 * @param limit - the character limit to bound against.
 * @returns the bounded text plus its original length and truncation flag.
 */
export function boundPromptMemoryText(
  label: string,
  raw: string,
  limit: number,
): BoundedText {
  const trimmed = raw.trim()
  if (trimmed.length <= limit) {
    return {
      content: trimmed,
      originalLength: trimmed.length,
      limit,
      truncated: false,
    }
  }

  const notice = `\n\n[Truncated ${label}: kept ${limit} of ${trimmed.length} characters. Shorten this file so the full content loads next session.]`
  const keep = Math.max(0, limit - notice.length)
  return {
    content: trimmed.slice(0, keep).trimEnd() + notice,
    originalLength: trimmed.length,
    limit,
    truncated: true,
  }
}

/**
 * Bound BRIEF and USER together so their combined length stays within the
 * shared total budget, giving USER whatever budget BRIEF does not consume.
 */
export function boundPromptMemoryPair(params: {
  brief: string
  user: string
}): {
  brief: BoundedText
  user: BoundedText
} {
  const brief = boundPromptMemoryText('BRIEF.md', params.brief, BRIEF_CHAR_LIMIT)
  const remainingForUser = Math.max(
    0,
    PROMPT_MEMORY_TOTAL_CHAR_LIMIT - brief.content.length,
  )
  const userLimit = Math.min(USER_PROMPT_MEMORY_CHAR_LIMIT, remainingForUser)
  const user = boundPromptMemoryText('USER.md', params.user, userLimit)
  return { brief, user }
}
