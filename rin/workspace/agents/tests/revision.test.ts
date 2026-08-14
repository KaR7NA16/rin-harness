import { describe, expect, test } from 'vitest'
import { computeRevision } from '../src/revision.ts'

describe('computeRevision', () => {
  test('is the first 12 hex digits of the sha256 digest', () => {
    expect(computeRevision('abc')).toBe('ba7816bf8f01')
  })

  test('is stable and 12 lowercase hex chars', () => {
    const revision = computeRevision('hello')
    expect(revision).toHaveLength(12)
    expect(revision).toMatch(/^[0-9a-f]{12}$/)
    expect(computeRevision('hello')).toBe(revision)
  })

  test('differs for different content', () => {
    expect(computeRevision('a')).not.toBe(computeRevision('b'))
  })
})
