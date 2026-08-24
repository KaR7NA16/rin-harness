/**
 * rin sandboxes — profile module tests.
 *
 * Pure-profile behavior: construction, patching, repository mount attachment,
 * legacy migration, and file-boundary validation.
 */

import { describe, expect, it } from 'vitest'
import {
  applySandboxProfilePatch,
  attachRepositoryToContainer,
  migrateLegacySandboxes,
  newSandboxProfile,
  parseSandboxProfile,
} from '../../src/sandboxes/profile.ts'
import { SANDBOX_STORE_SCHEMA_VERSION, type ContainerConfig, type SandboxProfile } from '../../src/sandboxes/types.ts'

function baseProfile(): SandboxProfile {
  return {
    id: 'p1',
    name: 'Local',
    type: 'local-sandbox',
    isDefault: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('newSandboxProfile', () => {
  it('builds a profile with an id and timestamps', () => {
    const profile = newSandboxProfile({ name: ' Local ', type: 'local-sandbox' }, '2026-01-01T00:00:00.000Z')
    expect(profile.name).toBe('Local')
    expect(profile.type).toBe('local-sandbox')
    expect(profile.isDefault).toBe(false)
    expect(profile.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(profile.createdAt).toBe(profile.updatedAt)
  })

  it('rejects an empty name', () => {
    expect(() => newSandboxProfile({ name: '   ', type: 'container' })).toThrow(/name is required/)
  })

  it('rejects an unknown type', () => {
    expect(() => newSandboxProfile({ name: 'x', type: 'bogus' as never })).toThrow(/unknown sandbox type/)
  })
})

describe('applySandboxProfilePatch', () => {
  it('merges fields and bumps updatedAt', () => {
    const patched = applySandboxProfilePatch(baseProfile(), { name: 'Renamed', isDefault: true }, '2026-02-01T00:00:00.000Z')
    expect(patched.name).toBe('Renamed')
    expect(patched.isDefault).toBe(true)
    expect(patched.id).toBe('p1')
    expect(patched.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(patched.updatedAt).toBe('2026-02-01T00:00:00.000Z')
  })

  it('preserves id and createdAt regardless of patch', () => {
    const patched = applySandboxProfilePatch(baseProfile(), {})
    expect(patched.id).toBe('p1')
    expect(patched.createdAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('rejects a patch that clears the name', () => {
    expect(() => applySandboxProfilePatch(baseProfile(), { name: '  ' })).toThrow(/name is required/)
  })
})

describe('attachRepositoryToContainer', () => {
  it('appends a /workspace mount and defaults workdir', () => {
    const attached = attachRepositoryToContainer({ image: 'node:22' }, '/repo')
    expect(attached.workdir).toBe('/workspace')
    expect(attached.mounts).toEqual([{ host: '/repo', guest: '/workspace' }])
  })

  it('preserves an existing workdir', () => {
    const attached = attachRepositoryToContainer({ image: 'node:22', workdir: '/app' }, '/repo')
    expect(attached.workdir).toBe('/app')
    expect(attached.mounts).toHaveLength(1)
  })

  it('does not duplicate an existing /workspace mount', () => {
    const container: ContainerConfig = { image: 'node:22', mounts: [{ host: '/x', guest: '/workspace' }] }
    expect(attachRepositoryToContainer(container, '/repo')).toBe(container)
  })

  it('returns the container unchanged for an empty path', () => {
    const container: ContainerConfig = { image: 'node:22' }
    expect(attachRepositoryToContainer(container, '   ')).toBe(container)
    expect(attachRepositoryToContainer(container)).toBe(container)
  })
})

describe('migrateLegacySandboxes', () => {
  it('migrates a bare array to a v2 document and defaults the first profile', () => {
    const doc = migrateLegacySandboxes([{ id: 'a', name: 'A', type: 'container', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }], '2026-01-01T00:00:00.000Z')
    expect(doc.version).toBe(SANDBOX_STORE_SCHEMA_VERSION)
    expect(doc.profiles).toHaveLength(1)
    expect(doc.profiles[0]?.id).toBe('a')
    expect(doc.profiles[0]?.isDefault).toBe(true)
  })

  it('migrates a { profiles: [...] } object', () => {
    const doc = migrateLegacySandboxes({ profiles: [{ id: 'b', name: 'B', type: 'local-sandbox' }] }, '2026-01-01T00:00:00.000Z')
    expect(doc.profiles).toHaveLength(1)
    expect(doc.profiles[0]?.id).toBe('b')
  })

  it('defaults type and timestamps for legacy entries', () => {
    const doc = migrateLegacySandboxes([{ id: 'c', name: 'C' }], '2026-01-01T00:00:00.000Z')
    expect(doc.profiles[0]?.type).toBe('container')
    expect(doc.profiles[0]?.createdAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('returns an empty document for empty or invalid input', () => {
    expect(migrateLegacySandboxes(undefined).profiles).toEqual([])
    expect(migrateLegacySandboxes({ nope: true }).profiles).toEqual([])
  })
})

describe('parseSandboxProfile', () => {
  it('round-trips a valid profile', () => {
    expect(parseSandboxProfile(baseProfile(), 0)).toEqual(baseProfile())
  })

  it('rejects a profile missing a name', () => {
    expect(() => parseSandboxProfile({ id: 'x', type: 'container', createdAt: '', updatedAt: '' }, 0)).toThrow(/name/)
  })

  it('rejects a container without an image', () => {
    expect(() => parseSandboxProfile({ id: 'x', name: 'x', type: 'container', container: {}, createdAt: '', updatedAt: '' }, 0)).toThrow(/image/)
  })

  it('rejects an unknown type', () => {
    expect(() => parseSandboxProfile({ id: 'x', name: 'x', type: 'bogus', createdAt: '', updatedAt: '' }, 0)).toThrow(/sandbox type/)
  })
})
