import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { en } from '../locales/en'
import { zh } from '../locales/zh'
import { ja } from '../locales/ja'
import { ko } from '../locales/ko'

function sourceKeys(localeFile: string): string[] {
  const path = resolve(process.cwd(), 'src/i18n/locales', localeFile)
  const source = readFileSync(path, 'utf8')
  return [...source.matchAll(/^\s*'((?:[^'\\]|\\.)+)':/gm)].map((m) => m[1]!)
}

function duplicateKeys(keys: string[]): string[] {
  const seen = new Set<string>()
  const dupes = new Set<string>()
  for (const key of keys) {
    if (seen.has(key)) dupes.add(key)
    seen.add(key)
  }
  return [...dupes]
}

describe('i18n locale completeness', () => {
  it('en has no duplicate keys in source', () => {
    expect(duplicateKeys(sourceKeys('en.ts'))).toEqual([])
  })

  it('zh has no duplicate keys in source', () => {
    expect(duplicateKeys(sourceKeys('zh.ts'))).toEqual([])
  })

  it('zh covers exactly the same key set as en (no missing, no extra)', () => {
    const enKeys = new Set(Object.keys(en))
    const zhKeys = new Set(Object.keys(zh))
    const missing = [...enKeys].filter((k) => !zhKeys.has(k))
    const extra = [...zhKeys].filter((k) => !enKeys.has(k))
    expect(missing).toEqual([])
    expect(extra).toEqual([])
    expect(Object.keys(zh)).toHaveLength(Object.keys(en).length)
  })

  it('reports ja/ko missing key counts (partial locales, English fallback allowed)', () => {
    const enKeys = Object.keys(en)
    const jaMissing = enKeys.filter((k) => !(k in ja))
    const koMissing = enKeys.filter((k) => !(k in ko))
    console.info(`[i18n] ja missing keys: ${jaMissing.length}`)
    console.info(`[i18n] ko missing keys: ${koMissing.length}`)
    expect(Array.isArray(jaMissing)).toBe(true)
    expect(Array.isArray(koMissing)).toBe(true)
  })
})
