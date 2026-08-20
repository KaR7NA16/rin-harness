import { describe, expect, test } from 'vitest'
import { cleanSystemPromptParts } from '../src/clean.ts'

describe('cleanSystemPromptParts', () => {
  test('deduplicates and drops empty fragments', () => {
    expect(cleanSystemPromptParts(['a', 'a', 'b', ''])).toEqual(['a', 'b'])
  })
  test('strips trailing whitespace', () => {
    expect(cleanSystemPromptParts(['x  ', 'y'])).toEqual(['x', 'y'])
  })
})
