import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { buildMemoryManifest, normalizeMemoryStorage, readMemoryManifest, writeMemoryManifestSync } from '../src/manifest.ts'
import { MemoryDatabase } from '../src/store.ts'

describe('@rin/memory', () => {
  test('stores provenance, revokes, deletes, and audits injected versions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-memory-'))
    const database = new MemoryDatabase(join(root, 'memory.db'))
    const item = database.upsert({
      projection: 'prompt-memory',
      kind: 'preference',
      content: 'User prefers concise answers.',
      source: { id: 'prompt-memory:user', kind: 'file', uri: 'prompt-memory/prompt-memory/USER.md' },
    })

    expect(item.version).toHaveLength(24)
    expect(database.get(item.id)?.source.uri).toContain('USER.md')
    database.recordInjection({
      surface: 'system-prompt',
      memoryIds: [item.id],
      memoryVersions: { [item.id]: item.version },
      sessionId: 'session-1',
    })
    expect(database.listInjections()).toHaveLength(1)
    expect(database.revoke(item.id, 'user withdrew consent')?.status).toBe('revoked')
    expect(database.list({ status: 'active' })).toHaveLength(0)
    expect(database.delete(item.id)).toBe(true)
    expect(database.get(item.id)?.status).toBe('deleted')
    expect(database.revoke(item.id, 'late revoke')?.status).toBe('deleted')
    expect(database.list()).toHaveLength(0)
    expect(database.upsert({
      id: item.id,
      projection: 'prompt-memory',
      kind: 'preference',
      content: 'A replacement must not resurrect a deleted memory.',
      source: { id: 'prompt-memory:user', kind: 'file', uri: 'prompt-memory/prompt-memory/USER.md' },
    }).status).toBe('deleted')
  })

  test('keeps the catalog file private', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-memory-permissions-'))
    const path = join(root, 'memory.db')
    const database = new MemoryDatabase(path)
    database.list()
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  test('exports every item beyond the normal list limit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-memory-export-'))
    const path = join(root, 'memory.db')
    const database = new MemoryDatabase(path)
    database.list()
    const db = new DatabaseSync(path)
    const now = new Date().toISOString()
    const insert = db.prepare(`
      INSERT INTO memory_items (
        id, projection, kind, content, version, status, visibility, confidence,
        source_json, metadata_json, created_at, updated_at, revoked_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, 'active', 'model', NULL, ?, '{}', ?, ?, NULL, NULL)
    `)
    db.exec('BEGIN')
    try {
      for (let index = 0; index <= 1000; index += 1) {
        insert.run(
          `item-${index}`,
          'notes',
          'document',
          `item ${index}`,
          `version-${index}`,
          JSON.stringify({ id: `source-${index}`, kind: 'file', uri: `notes/${index}.md` }),
          now,
          now,
        )
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    } finally {
      db.close()
    }
    expect(database.list({ limit: 1000 })).toHaveLength(1000)
    expect(database.exportData().items).toHaveLength(1001)
  })

  test('rejects injection records with stale or private memory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-memory-injection-'))
    const database = new MemoryDatabase(join(root, 'memory.db'))
    const item = database.upsert({
      projection: 'prompt-memory',
      kind: 'preference',
      content: 'A model-visible preference.',
      source: { id: 'source-1', kind: 'user', uri: 'user://memory/1' },
    })

    expect(() => database.recordInjection({
      surface: 'system-prompt',
      memoryIds: [item.id],
      memoryVersions: { [item.id]: 'stale-version' },
    })).toThrow('version does not match')

    const privateItem = database.upsert({
      id: 'private-item',
      projection: 'canonical',
      kind: 'self',
      content: 'A private note.',
      visibility: 'private',
      source: { id: 'source-2', kind: 'user', uri: 'user://memory/2' },
    })
    expect(() => database.recordInjection({
      surface: 'system-prompt',
      memoryIds: [privateItem.id],
      memoryVersions: { [privateItem.id]: privateItem.version },
    })).toThrow('non-model-visible')
  })

  test('filters by source before limiting and versions provenance changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-memory-filter-'))
    const database = new MemoryDatabase(join(root, 'memory.db'))
    database.upsert({
      id: 'first',
      projection: 'notes',
      kind: 'document',
      content: 'first',
      source: { id: 'source-a', kind: 'file', uri: 'notes/first.md' },
    })
    database.upsert({
      id: 'second',
      projection: 'notes',
      kind: 'document',
      content: 'second',
      source: { id: 'source-b', kind: 'file', uri: 'notes/second.md' },
    })
    expect(database.list({ sourceId: 'source-a', limit: 1 }).map(item => item.id)).toEqual(['first'])

    const original = database.upsert({
      id: 'versioned',
      projection: 'notes',
      kind: 'document',
      content: 'same',
      source: { id: 'source-c', kind: 'file', uri: 'notes/a.md' },
      metadata: { tag: 'one' },
    })
    const updated = database.upsert({
      id: 'versioned',
      projection: 'notes',
      kind: 'document',
      content: 'same',
      source: { id: 'source-c', kind: 'file', uri: 'notes/b.md' },
      metadata: { tag: 'two' },
    })
    expect(updated.version).not.toBe(original.version)
  })

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
