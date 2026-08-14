/**
 * rin sandboxes — store module tests.
 *
 * FileSandboxStore CRUD against a temp directory, YAML persistence, legacy
 * JSON migration with a .bak backup, and provider dispatch.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import type { ResolverCapabilities } from '@rin/repository'
import { FileSandboxStore } from '../src/store.ts'
import { defaultProviders } from '../src/providers.ts'
import type { SandboxProvider, SandboxProfile } from '../src/types.ts'

const CAPABILITIES: ResolverCapabilities = {
  platform: 'linux',
  runtimes: { apt: true, python: true, pip: true, r: true, npm: true, tlmgr: true },
}

function fakeProvider(type: SandboxProvider['type']): SandboxProvider {
  return {
    type,
    probeCapabilities: async () => CAPABILITIES,
    runCommand: async () => ({ code: 0, stdout: '', stderr: '' }),
  }
}

describe('FileSandboxStore', () => {
  let dir: string
  let profilesPath: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rin-sbx-test-'))
    profilesPath = join(dir, 'sandbox.yaml')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('persists created profiles to YAML and reloads them', async () => {
    const store = new FileSandboxStore({ profilesPath })
    await store.create({ name: 'Local', type: 'local-sandbox' })
    const reloaded = new FileSandboxStore({ profilesPath })
    const profiles = await reloaded.list()
    expect(profiles).toHaveLength(1)
    expect(profiles[0]?.name).toBe('Local')
    expect(profiles[0]?.type).toBe('local-sandbox')
  })

  it('makes only the first profile default', async () => {
    const store = new FileSandboxStore({ profilesPath })
    const first = await store.create({ name: 'A', type: 'local-sandbox' })
    const second = await store.create({ name: 'B', type: 'local-sandbox' })
    expect(first.isDefault).toBe(true)
    expect(second.isDefault).toBe(false)
  })

  it('re-assigns the default on an explicit isDefault create', async () => {
    const store = new FileSandboxStore({ profilesPath })
    await store.create({ name: 'A', type: 'local-sandbox' })
    const second = await store.create({ name: 'B', type: 'local-sandbox', isDefault: true })
    expect(second.isDefault).toBe(true)
    expect((await store.list()).find(p => p.name === 'A')?.isDefault).toBe(false)
  })

  it('supports get, update, setDefault, and remove', async () => {
    const store = new FileSandboxStore({ profilesPath })
    const a = await store.create({ name: 'A', type: 'local-sandbox' })
    const b = await store.create({ name: 'B', type: 'local-sandbox' })
    expect((await store.get(b.id))?.name).toBe('B')
    expect(await store.get('missing')).toBeNull()

    await store.update(a.id, { name: 'A2' })
    expect((await store.get(a.id))?.name).toBe('A2')
    await expect(store.update('missing', { name: 'x' })).rejects.toThrow(/not found/)

    await store.setDefault(b.id)
    expect((await store.get(b.id))?.isDefault).toBe(true)
    expect((await store.get(a.id))?.isDefault).toBe(false)

    expect(await store.remove(a.id)).toBe(true)
    expect(await store.list()).toHaveLength(1)
    expect(await store.remove(a.id)).toBe(false)
  })

  it('promotes the first remaining profile when the default is removed', async () => {
    const store = new FileSandboxStore({ profilesPath })
    const a = await store.create({ name: 'A', type: 'local-sandbox' })
    await store.create({ name: 'B', type: 'local-sandbox' })
    await store.remove(a.id)
    const remaining = await store.list()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.isDefault).toBe(true)
  })

  it('migrates legacy sandboxes.json and keeps a .bak backup', async () => {
    await writeFile(join(dir, 'sandboxes.json'), JSON.stringify([{ id: 'legacy', name: 'Legacy', type: 'local-sandbox' }]))
    const store = new FileSandboxStore({ profilesPath })
    const profiles = await store.list()
    expect(profiles).toHaveLength(1)
    expect(profiles[0]?.id).toBe('legacy')
    expect(profiles[0]?.isDefault).toBe(true)
    await expect(readFile(join(dir, 'sandboxes.json.bak'), 'utf8')).resolves.toContain('legacy')
  })

  it('returns an empty list when neither the YAML nor the legacy JSON exists', async () => {
    const store = new FileSandboxStore({ profilesPath })
    expect(await store.list()).toEqual([])
  })

  it('dispatches probeCapabilities to the provider matching the profile type', async () => {
    const provider = fakeProvider('container')
    const store = new FileSandboxStore({ profilesPath, providers: { ...defaultProviders(), container: provider } })
    const profile: SandboxProfile = await store.create({ name: 'C', type: 'container', container: { image: 'node:22' } })
    const caps = await store.probeCapabilities(profile)
    expect(caps.runtimes.python).toBe(true)
  })
})
