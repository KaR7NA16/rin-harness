/**
 * rin sandboxes — strip-types smoke.
 *
 * Exercises the plain (Cordis-free) surface against a temp directory:
 * profile-library CRUD with YAML persistence, repository mount attachment,
 * local capability probing with an injected probe function, and legacy
 * sandboxes.json migration with a .bak backup.
 *
 * Run from the package directory:
 *   node --experimental-strip-types tests/sandboxes.smoke.ts
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileSandboxStore } from '../src/store.ts'
import { LocalProvider } from '../src/providers.ts'
import { attachRepositoryToContainer } from '../src/profile.ts'

const root = await mkdtemp(join(tmpdir(), 'rin-sbx-'))
const profilesPath = join(root, 'sandbox.yaml')

try {
  // 1. Profile-library CRUD with YAML persistence.
  const store = new FileSandboxStore({ profilesPath })
  const first = await store.create({ name: 'Local', type: 'local-sandbox' })
  if (!first.isDefault) throw new Error('first profile should be default')
  const second = await store.create({ name: 'Dev', type: 'container', container: { image: 'node:22' } })
  if (second.isDefault) throw new Error('second profile should not be default')
  if ((await store.list()).length !== 2) throw new Error('expected 2 profiles after create')

  const reloaded = new FileSandboxStore({ profilesPath })
  if ((await reloaded.list()).length !== 2) throw new Error('reload from disk failed')
  if ((await reloaded.get(first.id))?.name !== 'Local') throw new Error('get by id failed')

  // 2. Repository mount attachment.
  const attached = attachRepositoryToContainer({ image: 'node:22' }, '/repo')
  if (attached.workdir !== '/workspace') throw new Error('attach should default workdir to /workspace')
  if (attached.mounts?.[0]?.guest !== '/workspace') throw new Error('attach should append a /workspace mount')
  const alreadyMounted = attachRepositoryToContainer(
    { image: 'node:22', mounts: [{ host: '/x', guest: '/workspace' }] },
    '/repo',
  )
  if (alreadyMounted.mounts?.length !== 1) throw new Error('attach should not duplicate /workspace mount')

  // 3. Local capability probe with an injected probe function.
  const local = new LocalProvider({
    platform: 'linux',
    exec: async (file) => {
      if (file === 'python' || file === 'python3' || file === 'pip') return 'ok'
      throw new Error('missing ' + file)
    },
  })
  const caps = await local.probeCapabilities({ id: 'p', name: 'p', type: 'local-sandbox', isDefault: false, createdAt: '', updatedAt: '' })
  if (caps.platform !== 'linux') throw new Error('probe platform mismatch')
  if (!caps.runtimes.python || !caps.runtimes.pip) throw new Error('python/pip should be detected')
  if (caps.runtimes.apt || caps.runtimes.r) throw new Error('apt/r should be absent under the fake probe')

  // 4. Legacy sandboxes.json migration with .bak backup.
  await rm(profilesPath)
  await writeFile(join(root, 'sandboxes.json'), JSON.stringify([
    { id: 'legacy-1', name: 'Legacy', type: 'local-sandbox' },
  ]))
  const migrated = new FileSandboxStore({ profilesPath })
  const profiles = await migrated.list()
  if (profiles.length !== 1 || profiles[0]?.id !== 'legacy-1') throw new Error('migration failed')
  if (profiles[0]?.isDefault !== true) throw new Error('migrated first profile should be default')
  const bakExists = await readFile(join(root, 'sandboxes.json.bak'), 'utf8').then(() => true).catch(() => false)
  if (!bakExists) throw new Error('expected sandboxes.json.bak after migration')

  // 5. exec: run one command inside a profile's sandbox via its provider.
  const execProfile = await migrated.create({ name: 'Exec', type: 'local-sandbox', repositoryPath: root })
  const result = await migrated.exec(execProfile.id, 'echo hello-from-sandbox')
  if (result.code !== 0) throw new Error('exec echo failed: ' + result.stderr)
  if (!result.stdout.includes('hello-from-sandbox')) throw new Error('exec stdout missing: ' + result.stdout)
  let missingProfile = false
  try {
    await migrated.exec('missing-id', 'echo x')
  } catch {
    missingProfile = true
  }
  if (!missingProfile) throw new Error('exec should reject an unknown profile id')

  console.log('SANDBOXES-SMOKE-OK', {
    profiles: profiles.length,
    mounts: attached.mounts?.length,
    pip: caps.runtimes.pip,
    exec: result.stdout.trim(),
  })
} finally {
  await rm(root, { recursive: true, force: true })
}
