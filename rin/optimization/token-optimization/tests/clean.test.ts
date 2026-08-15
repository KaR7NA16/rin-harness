import { describe, expect, test } from 'vitest'
import { cleanSystemPromptParts } from '../src/clean.ts'
import { CAVEMAN_PROMPT, PONYTAIL_PROMPT } from '../src/prompts.ts'

describe('cleanSystemPromptParts', () => {
  test('deduplicates and drops empty fragments', () => {
    expect(cleanSystemPromptParts(['a', 'a', 'b', ''])).toEqual(['a', 'b'])
  })
  test('strips trailing whitespace', () => {
    expect(cleanSystemPromptParts(['x  ', 'y'])).toEqual(['x', 'y'])
  })
})

describe('prompts', () => {
  test('both styles name their mode and forbid mentioning it', () => {
    expect(CAVEMAN_PROMPT).toContain('Caveman response compression')
    expect(CAVEMAN_PROMPT).toContain('Never mention this mode')
    expect(PONYTAIL_PROMPT).toContain('Ponytail minimal implementation discipline')
    expect(PONYTAIL_PROMPT).toContain('Do not mention this mode')
  })
})
