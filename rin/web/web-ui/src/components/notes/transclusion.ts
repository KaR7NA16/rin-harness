/**
 * Note transclusion helpers.
 *
 * Expands `![[target]]` references into callout blocks containing the target
 * note's markdown. Expansion is one level deep; recursive transclusions are
 * intentionally not followed.
 */

const TRANSCLUSION_RE = /!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g

/** Extract transclusion targets in document order. */
export function transclusionTargets(markdown: string): string[] {
  const targets: string[] = []
  for (const match of markdown.matchAll(TRANSCLUSION_RE)) {
    const target = (match[1] ?? '').trim()
    if (target) targets.push(target)
  }
  return targets
}

/** Convert one transcluded note body into a callout block. */
export function renderTransclusion(target: string, content: string): string {
  const body = content
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n')
  return `\n> [!note] ${target}\n> \n${body}\n`
}

/**
 * Replace every transclusion in `markdown` with the resolved target content.
 * Unreadable targets remain as warning callouts.
 */
export async function expandTransclusions(
  markdown: string,
  read: (target: string) => Promise<{ content: string }>,
): Promise<string> {
  const targets = transclusionTargets(markdown)
  if (targets.length === 0) return markdown
  const replacements = await Promise.all(targets.map(async (target) => {
    const notePath = target.endsWith('.md') ? target : `${target}.md`
    try {
      const doc = await read(notePath)
      return { target, content: renderTransclusion(target, doc.content) }
    } catch {
      return { target, content: `\n> [!warning] Unable to transclude [[${target}]]\n` }
    }
  }))
  let next = markdown
  for (const replacement of replacements) {
    const pattern = new RegExp(`!\\[\\[${escapeRegExp(replacement.target)}(?:\\|[^\\]]+)?\\]\\]`, 'g')
    next = next.replace(pattern, () => replacement.content)
  }
  return next
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
