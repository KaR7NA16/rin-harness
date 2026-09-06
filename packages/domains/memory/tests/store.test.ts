import { readFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { buildMemoryManifest, normalizeMemoryStorage, readMemoryManifest, writeMemoryManifestSync } from '../src/manifest.ts'

describe('@rin/memory manifest', () => {
  test('writes a relative, portable projection manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-memory-manifest-'))
    const path = join(root, 'memory', 'manifest.json')
    writeMemoryManifestSync(path, buildMemoryManifest('2026-08-22T00:00:00.000Z'))
    const parsed = readMemoryManifest(path)
    expect(parsed.root).toBe('.')
    expect(parsed.canonical.database).toBe('memory/memory.db')
    expect(parsed.storage.sessionRoot).toBe('dsh/sessions')
    expect(parsed.storage.settingsPath).toBe('dsh/settings.yaml')
    expect(parsed.storage.credentialsPath).toBe('dsh/.credentials.yaml')
    expect(parsed.storage.credentialsExcludedByDefault).toBe(true)
    expect(parsed.projections.find(item => item.id === 'session')?.path).toBe('dsh/sessions')
    expect(await readFile(path, 'utf8')).toContain('secretsExcludedByDefault')
  })

  test('maps resolved storage paths to portable manifest paths', () => {
    const local = normalizeMemoryStorage('/tmp/rin', {
      sessionRoot: '/tmp/rin/dsh/sessions',
      settingsPath: '/tmp/rin/dsh/settings.yaml',
      credentialsPath: '/tmp/rin/dsh/.credentials.yaml',
      archiveRoot: '/tmp/rin',
    })
    expect(local.sessionRoot).toBe('dsh/sessions')
    expect(local.settingsPath).toBe('dsh/settings.yaml')
    expect(local.credentialsPath).toBe('dsh/.credentials.yaml')
    expect(local.archiveRoot).toBe('.')

    const external = normalizeMemoryStorage('/tmp/rin', {
      sessionRoot: '/tmp/sessions',
      settingsPath: '/tmp/config/settings.yaml',
      credentialsPath: '/tmp/config/.credentials.yaml',
    })
    expect(external.sessionRoot).toBe('dsh/sessions')
    expect(external.settingsPath).toBe('external/settings/settings.yaml')
    expect(external.credentialsPath).toBe('external/credentials/.credentials.yaml')
    expect(buildMemoryManifest('2026-08-22T00:00:00.000Z', external).projections.find(item => item.id === 'session')?.path)
      .toBe('dsh/sessions')
  })
})
