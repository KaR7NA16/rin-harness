/**
 * Deterministic project-memory context tag injected into and stripped from
 * indexed transcript text, so derived recall context never leaks into the
 * searchable corpus.
 *
 * @module @rin/session-search
 */

export const PROJECT_MEMORY_CONTEXT_TAG = 'rin_project_memory_context'

const PROJECT_MEMORY_CONTEXT_RE = new RegExp(
  `\\n?\\s*<${PROJECT_MEMORY_CONTEXT_TAG}>[\\s\\S]*?<\\/${PROJECT_MEMORY_CONTEXT_TAG}>\\s*`,
  'g',
)

export function hasProjectMemoryContext(text: string): boolean {
  return new RegExp(
    `<${PROJECT_MEMORY_CONTEXT_TAG}>[\\s\\S]*?<\\/${PROJECT_MEMORY_CONTEXT_TAG}>`,
  ).test(text)
}

export function stripProjectMemoryContext(text: string): string {
  return text.replace(PROJECT_MEMORY_CONTEXT_RE, '').trim()
}

export function appendProjectMemoryContext(
  content: string,
  context: string,
): string {
  const trimmedContent = content.trim()
  const trimmedContext = context.trim()
  if (!trimmedContext) return trimmedContent

  const block = `<${PROJECT_MEMORY_CONTEXT_TAG}>\n${trimmedContext}\n</${PROJECT_MEMORY_CONTEXT_TAG}>`
  return trimmedContent ? `${trimmedContent}\n\n${block}` : block
}
