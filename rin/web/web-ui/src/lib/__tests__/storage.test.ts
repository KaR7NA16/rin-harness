import { beforeEach, describe, expect, it } from 'vitest'
import {
  readStoredJson,
  readStoredValue,
  removeStoredValue,
  writeStoredValue,
} from '../storage'

describe('rin storage helpers', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('reads and writes string values', () => {
    expect(readStoredValue('rin-theme')).toBeNull()
    writeStoredValue('rin-theme', 'dark')
    expect(readStoredValue('rin-theme')).toBe('dark')
  })

  it('parses JSON and returns fallback for absent or corrupted values', () => {
    expect(readStoredJson('rin-open-tabs', [])).toEqual([])
    window.localStorage.setItem('rin-open-tabs', JSON.stringify({ openTabs: ['a'] }))
    expect(readStoredJson('rin-open-tabs', [])).toEqual({ openTabs: ['a'] })
    window.localStorage.setItem('rin-open-tabs', '{bad json')
    expect(readStoredJson('rin-open-tabs', [])).toEqual([])
  })

  it('removes only the requested key', () => {
    writeStoredValue('rin-theme', 'dark')
    removeStoredValue('rin-theme')
    expect(readStoredValue('rin-theme')).toBeNull()
  })
})
