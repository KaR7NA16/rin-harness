/**
 * rin knowledge — entity projection helpers.
 *
 * Owns the stable `knowledge:` node-id vocabulary and markdown link extraction
 * that turns indexed files into graph-navigable entities. Pure functions with
 * no runtime dependencies, so the strip-types smoke test can exercise them.
 *
 * @module @rin/knowledge
 */

/** Stable graph node id for a knowledge source. */
export function knowledgeSourceNodeId(id: string): string {
  return `knowledge_source:${id}`
}

/** Stable graph node id for a knowledge document. */
export function knowledgeDocumentNodeId(id: string): string {
  return `knowledge_document:${id}`
}

const WIKILINK_RE = /\[\[([^\]|#^]+)(?:[|#^][^\]]*)?\]\]/g

/**
 * Extract the unique wikilink targets from markdown content, in first-seen
 * order. Targets are the first `[[...]]` segment with any `|alias`, `#heading`,
 * or `^block` suffix stripped.
 *
 * @param content - markdown text.
 * @returns deduplicated, trimmed link targets (empty string excluded).
 */
export function extractWikilinkTargets(content: string): string[] {
  const targets: string[] = []
  const seen = new Set<string>()
  for (const match of content.matchAll(WIKILINK_RE)) {
    const target = match[1]!.trim()
    if (target === '' || seen.has(target)) continue
    seen.add(target)
    targets.push(target)
  }
  return targets
}
