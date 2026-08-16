import { beforeEach, describe, expect, it } from 'vitest'
import {
  readStoredJson,
  readStoredValue,
  removeStoredValue,
  writeStoredValue,
} from '../storage'

describe('storage migration helpers', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('prefers the rin key over the legacy key', () => {
    window.localStorage.setItem('cybercode-theme', 'dark')
    window.localStorage.setItem('rin-theme', 'light')
    expect(readStoredValue('rin-theme', 'cybercode-theme')).toBe('light')
  })

  it('falls back to the legacy key when the rin key is absent', () => {
    window.localStorage.setItem('cybercode-locale', 'ja')
    expect(readStoredValue('rin-locale', 'cybercode-locale')).toBe('ja')
  })

  it('parses JSON with the same migration order and returns fallback on corruption', () => {
    window.localStorage.setItem('cybercode-open-tabs', JSON.stringify({ openTabs: ['legacy'] }))
    expect(readStoredJson('rin-open-tabs', 'cybercode-open-tabs', [])).toEqual({ openTabs: ['legacy'] })

    window.localStorage.setItem('rin-open-tabs', '{bad json')
    expect(readStoredJson('rin-open-tabs', 'cybercode-open-tabs', [])).toEqual([])
  })

  it('writes and removes only the new key', () => {
    writeStoredValue('rin-theme', 'dark')
    expect(window.localStorage.getItem('rin-theme')).toBe('dark')
    removeStoredValue('rin-theme')
    expect(window.localStorage.getItem('rin-theme')).toBeNull()
  })
})
