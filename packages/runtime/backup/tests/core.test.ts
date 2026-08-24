import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { describe, expect, test } from 'vitest'
import {
  buildRinArchiveOptions,
  defaultOptions,
  exportRinArchive,
  importRinArchive,
} from '../src/core.ts'

describe('@rin/backup complete archive', () => {
  test('exports portable RIN files while excluding secrets and backups', async () => {
    const source = await mkdtemp(join(tmpdir(), 'rin-archive-source-'))
    await mkdir(join(source, 'memory'), { recursive: true })
    await mkdir(join(source, 'dsh', 'sessions'), { recursive: true })
    await mkdir(join(source, 'backups'), { recursive: true })
    await writeFile(join(source, 'memory', 'manifest.json'), '{"root":"."}\n')
    await writeFile(join(source, 'dsh', 'sessions', 'session-1.jsonl'), 'session\n')
    await writeFile(join(source, '.credentials.yaml'), 'secret\n')
    await writeFile(join(source, 'backups', 'old.rinbackup.gz'), 'backup\n')

    const archive = await exportRinArchive({ root: source })
    const envelope = JSON.parse(gunzipSync(archive).toString('utf8')) as {
      kind: string
      version: number
      files: Array<{ path: string }>
    }

    expect(envelope.kind).toBe('rin-archive')
    expect(envelope.version).toBe(2)
    expect(envelope.files.map(file => file.path)).toEqual([
      'dsh/sessions/session-1.jsonl',
      'memory/manifest.json',
    ])
  })

  test('imports additively and preserves existing files', async () => {
    const source = await mkdtemp(join(tmpdir(), 'rin-archive-source-'))
    const target = await mkdtemp(join(tmpdir(), 'rin-archive-target-'))
    await writeFile(join(source, 'notes.md'), 'new\n')
    const archive = await exportRinArchive({ root: source })
    await writeFile(join(target, 'notes.md'), 'existing\n')

    const result = await importRinArchive(archive, { root: target })
    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(1)
    expect(await readFile(join(target, 'notes.md'), 'utf8')).toBe('existing\n')
  })
  test('archives external DSH sources and restores them to mapped roots', async () => {
    const source = await mkdtemp(join(tmpdir(), 'rin-archive-source-'))
    const dshSource = await mkdtemp(join(tmpdir(), 'rin-archive-dsh-source-'))
    const target = await mkdtemp(join(tmpdir(), 'rin-archive-target-'))
    const dshTarget = await mkdtemp(join(tmpdir(), 'rin-archive-dsh-target-'))
    await mkdir(join(dshSource, 'sessions'), { recursive: true })
    await writeFile(join(dshSource, 'sessions', 'session-2.jsonl'), 'session-2\n')
    await writeFile(join(dshSource, 'settings.yaml'), 'theme: dark\n')
    await writeFile(join(dshSource, '.credentials.yaml'), 'secret\n')

    const archive = await exportRinArchive({
      root: source,
      sources: [{ root: dshSource, prefix: 'dsh' }],
    })
    const envelope = JSON.parse(gunzipSync(archive).toString('utf8')) as {
      files: Array<{ path: string }>
    }
    expect(envelope.files.map(file => file.path)).toEqual([
      'dsh/sessions/session-2.jsonl',
      'dsh/settings.yaml',
    ])

    const result = await importRinArchive(archive, {
      root: target,
      sources: [{ root: dshTarget, prefix: 'dsh', targetRoot: dshTarget }],
    })
    expect(result.imported).toBe(2)
    expect(await readFile(join(dshTarget, 'sessions', 'session-2.jsonl'), 'utf8')).toBe('session-2\n')
    expect(await readFile(join(dshTarget, 'settings.yaml'), 'utf8')).toBe('theme: dark\n')
  })


  test('excludes a custom credentials path from an external DSH source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-archive-custom-credentials-root-'))
    const dshRoot = await mkdtemp(join(tmpdir(), 'rin-archive-custom-credentials-dsh-'))
    await mkdir(join(dshRoot, 'sessions'), { recursive: true })
    await writeFile(join(dshRoot, 'profile.json'), 'profile\n')
    await writeFile(join(dshRoot, 'private-auth.json'), 'secret\n')
    const options = buildRinArchiveOptions({
      archiveRoot: root,
      sessionsRoot: join(dshRoot, 'sessions'),
      backupsRoot: join(root, 'backups'),
      settingsPath: join(root, 'backup-settings.json'),
      dshRoot,
      dshSettingsPath: join(dshRoot, 'settings.yaml'),
      credentialsPath: join(dshRoot, 'private-auth.json'),
    })
    const archive = await exportRinArchive(options)
    const envelope = JSON.parse(gunzipSync(archive).toString('utf8')) as { files: Array<{ path: string }> }
    expect(envelope.files.map(file => file.path)).toContain('dsh/profile.json')
    expect(envelope.files.map(file => file.path)).not.toContain('dsh/private-auth.json')
    expect(options.exclude).toEqual(['dsh/private-auth.json'])
  })

  test('runs archive preparation before reading source files', async () => {
    const source = await mkdtemp(join(tmpdir(), 'rin-archive-preparation-'))
    await writeFile(join(source, 'state.txt'), 'initial\n')
    const archive = await exportRinArchive({
      root: source,
      beforeExport: () => writeFile(join(source, 'state.txt'), 'prepared\n'),
    })
    const envelope = JSON.parse(gunzipSync(archive).toString('utf8')) as { files: Array<{ path: string; content: string }> }
    expect(envelope.files.find(file => file.path === 'state.txt')?.content).toBe(Buffer.from('prepared\n').toString('base64'))
  })
  test('maps independent external roots without collapsing them', () => {
    const options = buildRinArchiveOptions({
      archiveRoot: '/tmp/rin',
      sessionsRoot: '/tmp/sessions',
      backupsRoot: '/tmp/rin/backups',
      settingsPath: '/tmp/rin/backup-settings.json',
      dshRoot: '/tmp/dsh',
      dshSettingsPath: '/tmp/config/settings.yaml',
    })
    expect(options.sources).toEqual([
      { root: '/tmp/dsh', prefix: 'dsh', targetRoot: '/tmp/dsh' },
      { root: '/tmp/sessions', prefix: 'dsh/sessions', targetRoot: '/tmp/sessions' },
      {
        root: '/tmp/config',
        prefix: 'external/settings',
        include: ['settings.yaml'],
        targetRoot: '/tmp/config',
      },
    ])
  })
  test('rejects malformed archive file entries', async () => {
    const target = await mkdtemp(join(tmpdir(), 'rin-archive-invalid-target-'))
    const archive = gzipSync(Buffer.from(JSON.stringify({
      kind: 'rin-archive',
      version: 2,
      root: '.',
      files: [{ path: 'notes.md', content: 'not-valid-base64!' }],
    })))

    await expect(importRinArchive(archive, { root: target })).rejects.toThrow('not valid base64')
  })
  test('derives defaults from the unified environment boundary', () => {
    const previous = {
      RIN_HOME: process.env.RIN_HOME,
      DSH_HOME: process.env.DSH_HOME,
      RIN_SESSION_ROOT: process.env.RIN_SESSION_ROOT,
      RIN_SETTINGS_PATH: process.env.RIN_SETTINGS_PATH,
      RIN_CREDENTIALS_PATH: process.env.RIN_CREDENTIALS_PATH,
    }
    try {
      process.env.RIN_HOME = '/tmp/rin-home'
      delete process.env.RIN_SETTINGS_PATH
      delete process.env.RIN_CREDENTIALS_PATH
      process.env.DSH_HOME = '/tmp/dsh-home'
      process.env.RIN_SESSION_ROOT = '/tmp/sessions'
      expect(defaultOptions('/ignored')).toEqual({
        sessionsRoot: '/tmp/sessions',
        backupsRoot: '/tmp/rin-home/backups',
        settingsPath: '/tmp/rin-home/backup-settings.json',
        archiveRoot: '/tmp/rin-home',
        dshRoot: '/tmp/dsh-home',
        dshSettingsPath: '/tmp/dsh-home/settings.yaml',
        credentialsPath: '/tmp/dsh-home/.credentials.yaml',
      })
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) Reflect.deleteProperty(process.env, name)
        else process.env[name] = value
      }
    }
  })
})
