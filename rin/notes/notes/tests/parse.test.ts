/**
 * rin notes — parsing contract tests.
 *
 * These describe behavior, not correctness. They run under vitest in CI; the
 * sandbox cannot spawn vitest, so an equivalent strip-types smoke test is run
 * during development.
 *
 * @module @rin/notes
 */

import { describe, expect, test } from 'vitest'
import { extractLinks, extractTags, extractTitle, extractTransclusions, parseWikilinkTarget, splitFrontmatter } from '../src/parse.ts'

describe('extractTitle', () => {
  test('prefers a frontmatter title over the first H1', () => {
    expect(extractTitle('---\ntitle: Frontmatter Title\n---\n# Heading', 'fallback')).toBe('Frontmatter Title')
  })

  test('returns the first H1 heading', () => {
    expect(extractTitle('# My Title\n\nbody', 'fallback')).toBe('My Title')
  })

  test('falls back when no H1 exists', () => {
    expect(extractTitle('## not an H1\n\nbody', 'name')).toBe('name')
  })

  test('ignores H2 and below for the title', () => {
    expect(extractTitle('## Section\n\n### Sub\n\n# Real Title', 'name')).toBe('Real Title')
  })
})

describe('parseWikilinkTarget', () => {
  test('parses plain, heading, and block targets', () => {
    expect(parseWikilinkTarget('note')).toEqual({ note: 'note' })
    expect(parseWikilinkTarget('note#Heading')).toEqual({ note: 'note', heading: 'Heading' })
    expect(parseWikilinkTarget('note^block-1')).toEqual({ note: 'note', block: 'block-1' })
  })
})

describe('extractTransclusions', () => {
  test('extracts transclusion targets and aliases', () => {
    expect(extractTransclusions('![[alpha]] and ![[beta|Alias]]')).toEqual([
      { raw: '![[alpha]]', target: 'alpha' },
      { raw: '![[beta|Alias]]', target: 'beta', alias: 'Alias' },
    ])
  })
})

describe('extractLinks', () => {
  test('parses target-only and aliased wikilinks', () => {
    expect(extractLinks('See [[target]] and [[target|alias]].')).toEqual([
      { raw: '[[target]]', target: 'target' },
      { raw: '[[target|alias]]', target: 'target', alias: 'alias' },
    ])
  })

  test('skips empty targets', () => {
    expect(extractLinks('[[]]')).toEqual([])
  })

  test('trims whitespace around targets and aliases', () => {
    expect(extractLinks('[[ spaced target | alias text ]]')).toEqual([
      { raw: '[[ spaced target | alias text ]]', target: 'spaced target', alias: 'alias text' },
    ])
  })
})

describe('splitFrontmatter', () => {
  test('parses a YAML frontmatter block and returns the body', () => {
    const { frontmatter, body } = splitFrontmatter('---\ntags: [alpha, beta]\n---\n# Hi\n')
    expect(frontmatter).toEqual({ tags: ['alpha', 'beta'] })
    expect(body).toBe('# Hi\n')
  })

  test('returns null frontmatter without a block', () => {
    const { frontmatter, body } = splitFrontmatter('# Hi\n')
    expect(frontmatter).toBeNull()
    expect(body).toBe('# Hi\n')
  })

  test('treats a malformed block as body text', () => {
    const { frontmatter, body } = splitFrontmatter('---\nnot: [valid\n---\n# Title\n')
    expect(frontmatter).toBeNull()
    expect(body).toBe('# Title\n')
  })
})

describe('extractTags', () => {
  test('reads a frontmatter tag list via YAML', () => {
    expect(extractTags('---\ntags:\n  - alpha\n  - beta\n---\n# T\n')).toEqual(['alpha', 'beta'])
  })

  test('reads inline tags from the body', () => {
    expect(extractTags('Body mentions #inline and #other.')).toEqual(['inline', 'other'])
  })

  test('deduplicates and sorts frontmatter plus inline tags', () => {
    expect(extractTags('---\ntags: [b, a]\n---\n#b #a\n')).toEqual(['a', 'b'])
  })
})
