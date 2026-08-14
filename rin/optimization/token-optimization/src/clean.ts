/**
 * Deterministic prompt-fragment cleaning: line-ending normalization, trailing
 * whitespace stripping, and blank-run collapsing.
 *
 * @module @rin/token-optimization
 */

/** Normalize one prompt fragment. */
export function cleanPromptText(value: string): string {
  const lines = value.replace(/\r\n?/g, '\n').split('\n')
  const result: string[] = []
  let pendingBlank = false

  for (const rawLine of lines) {
    const line = rawLine.replace(/[ \t]+$/g, '')
    if (line.trim().length === 0) {
      pendingBlank = result.length > 0
      continue
    }
    if (pendingBlank) result.push('')
    pendingBlank = false
    result.push(line)
  }

  return result.join('\n')
}

/** Clean and deduplicate a list of prompt fragments. */
export function cleanSystemPromptParts(parts: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const part of parts) {
    const cleaned = cleanPromptText(part)
    if (!cleaned || seen.has(cleaned)) continue
    seen.add(cleaned)
    result.push(cleaned)
  }

  return result
}
