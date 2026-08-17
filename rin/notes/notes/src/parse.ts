/**
 * rin notes — markdown parsing helpers.
 *
 * Owns the note-content parsing rules: the wikilink and inline-tag grammars,
 * title extraction, tag extraction (frontmatter via the `yaml` parser plus
 * inline `#tag`), and link extraction. These are pure functions of the note
 * text and depend only on `yaml` and `node:` builtins, so they stay
 * smoke-testable without the Cordis runtime.
 *
 * @module @rin/notes
 */

import { parse as parseYaml } from 'yaml'
import type { NoteLink } from './types.ts'

/** Matches `[[target]]` and `[[target|alias]]`. */
export const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g

/** Matches `![[target]]` transclusions, including `![[target#heading]]`. */
export const TRANSCLUSION_RE = /!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g

/** Matches an inline `#tag` preceded by whitespace or the line start. */
export const TAG_RE = /(^|\s)#([\p{L}\p{N}_/-]+)/gu

/** Marks the boundary between frontmatter and body (`---\n ... \n---`). */
const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

/**
 * Split a note into its YAML frontmatter (when present) and the remaining body.
 * A malformed frontmatter block is treated as body text rather than a fatal
 * error, so a stray `---` never makes a note unreadable.
 *
 * @param content - the raw markdown note text.
 * @returns the parsed frontmatter object (or `null`) and the body after it.
 */
export function splitFrontmatter(content: string): {
  frontmatter: Record<string, unknown> | null
  body: string
} {
  const match = FRONTMATTER_RE.exec(content)
  if (!match) return { frontmatter: null, body: content }
  const raw = match[1] ?? ''
  let frontmatter: Record<string, unknown> | null = null
  try {
    const parsed = parseYaml(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      frontmatter = parsed as Record<string, unknown>
    }
  } catch {
    // Malformed frontmatter is not a note error: fall back to body-only.
    frontmatter = null
  }
  return { frontmatter, body: content.slice(match[0].length) }
}

/**
 * Extract the note title: the first `#` heading, or a fallback when absent.
 *
 * @param content - the raw markdown note text.
 * @param fallback - the title to use when no `#` heading exists.
 * @returns the trimmed first heading or the fallback.
 */
export function extractTitle(content: string, fallback: string): string {
  const { frontmatter } = splitFrontmatter(content)
  if (frontmatter && typeof frontmatter.title === 'string' && frontmatter.title.trim()) {
    return frontmatter.title.trim()
  }
  const match = content.match(/^#\s+(.+)$/m)
  return match ? (match[1] ?? '').trim() : fallback
}

/**
 * Normalize a YAML `tags` value (string, list, or comma-separated string)
 * into trimmed non-empty tags.
 *
 * @param value - the raw `tags` frontmatter value.
 * @returns the normalized tag list.
 */
function normalizeTags(value: unknown): string[] {
  if (typeof value === 'string') {
    return value.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0)
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string')
      .map(tag => tag.trim())
      .filter(tag => tag.length > 0)
  }
  return []
}

/**
 * Extract tags from frontmatter (`tags:` key, parsed via YAML) and inline
 * `#tag` occurrences in the body, deduplicated and sorted.
 *
 * @param content - the raw markdown note text.
 * @returns the sorted, deduplicated tag list.
 */
export function extractTags(content: string): string[] {
  const tags = new Set<string>()
  const { frontmatter, body } = splitFrontmatter(content)
  if (frontmatter && 'tags' in frontmatter) {
    for (const tag of normalizeTags(frontmatter.tags)) tags.add(tag)
  }
  for (const match of body.matchAll(TAG_RE)) {
    const tag = match[2]
    if (tag) tags.add(tag)
  }
  return [...tags].sort()
}

/** A parsed wikilink target with optional heading or block anchor. */
export interface WikilinkTarget {
  /** The note path/name before any anchor. */
  note: string
  /** Heading text after `#`, when present. */
  heading?: string
  /** Block id after `^`, when present. */
  block?: string
}

/**
 * Parse `[[note]]`, `[[note|alias]]`, `[[note#heading]]`, and
 * `[[note^block]]` target syntax. Aliases are intentionally ignored here.
 * @param raw - the raw text inside `[[...]]`.
 * @returns the note name and optional anchor parts.
 */
export function parseWikilinkTarget(raw: string): WikilinkTarget {
  const value = raw.trim()
  const blockIndex = value.indexOf('^')
  const headingIndex = value.indexOf('#')
  if (blockIndex >= 0 && (headingIndex < 0 || blockIndex < headingIndex)) {
    const block = value.slice(blockIndex + 1).trim()
    return { note: value.slice(0, blockIndex).trim(), ...(block ? { block } : {}) }
  }
  if (headingIndex >= 0) {
    const heading = value.slice(headingIndex + 1).trim()
    return { note: value.slice(0, headingIndex).trim(), ...(heading ? { heading } : {}) }
  }
  return { note: value }
}

/**
 * Extract transclusion references from note content.
 * @param content - the raw markdown note text.
 * @returns the targets in document order with their optional aliases.
 */
export function extractTransclusions(content: string): NoteLink[] {
  const links: NoteLink[] = []
  for (const match of content.matchAll(TRANSCLUSION_RE)) {
    const target = (match[1] ?? '').trim()
    if (!target) continue
    const alias = (match[2] ?? '').trim()
    links.push({ raw: match[0], target, ...(alias ? { alias } : {}) })
  }
  return links
}

/**
 * Extract wikilinks from note content.
 *
 * @param content - the raw markdown note text.
 * @returns the links in document order, each with its raw text, target, and
 *   optional alias.
 */
export function extractLinks(content: string): NoteLink[] {
  const links: NoteLink[] = []
  for (const match of content.matchAll(WIKILINK_RE)) {
    const target = (match[1] ?? '').trim()
    if (!target) continue
    const alias = (match[2] ?? '').trim()
    links.push({ raw: match[0], target, ...(alias ? { alias } : {}) })
  }
  return links
}
