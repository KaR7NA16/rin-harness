import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  expandHome,
  isMissingPathError,
  readDirectory,
  readFileIfExists,
  resolveDefaultDshHome,
  resolveDefaultPresetRoot,
} from '../src/paths.ts'

describe('isMissingPathError', () => {
  test('detects ENOENT errors and ignores everything else', () => {
    expect(isMissingPathError(Object.assign(new Error('gone'), { code: 'ENOENT' }))).toBe(true)
    expect(isMissingPathError(new Error('boom'))).toBe(false)
    expect(isMissingPathError(null)).toBe(false)
    expect(isMissingPathError('ENOENT')).toBe(false)
  })
})

describe('readDirectory and readFileIfExists', () => {
  test('return empty/undefined for missing paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-paths-'))
    expect(await readDirectory(join(root, 'nope'))).toEqual([])
    expect(await readFileIfExists(join(root, 'nope'))).toBeUndefined()
  })

  test('list entries and read file contents when present', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-paths-'))
    const dir = join(root, 'sub')
    await mkdir(dir)
    await writeFile(join(dir, 'a.txt'), 'hello')
    const entries = await readDirectory(dir)
    expect(entries.map(entry => entry.name)).toEqual(['a.txt'])
    expect(await readFileIfExists(join(dir, 'a.txt'))).toBe('hello')
  })
})

describe('expandHome', () => {
  test('expands a bare tilde and tilde-prefixed paths', () => {
    expect(expandHome('~')).toBe(homedir())
    expect(expandHome('~/agents')).toBe(join(homedir(), 'agents'))
    expect(expandHome('~\\agents')).toBe(join(homedir(), 'agents'))
  })

  test('leaves absolute and relative paths unchanged', () => {
    expect(expandHome('/abs/path')).toBe('/abs/path')
    expect(expandHome('relative/path')).toBe('relative/path')
  })
})

describe('resolveDefaultDshHome', () => {
  test('honours a non-blank DSH_HOME override', () => {
    expect(resolveDefaultDshHome({ DSH_HOME: '/tmp/rin-home' })).toBe(resolve('/tmp/rin-home'))
  })

  test('falls back to ~/.dsh when DSH_HOME is blank or absent', () => {
    expect(resolveDefaultDshHome({})).toBe(resolve(join(homedir(), '.dsh')))
    expect(resolveDefaultDshHome({ DSH_HOME: '   ' })).toBe(resolve(join(homedir(), '.dsh')))
  })
})

describe('resolveDefaultPresetRoot', () => {
  test('appends the user preset dirname under the resolved home', () => {
    expect(resolveDefaultPresetRoot({ DSH_HOME: '/tmp/rin-home' })).toBe(join(resolve('/tmp/rin-home'), '.agent-presets'))
  })
})
