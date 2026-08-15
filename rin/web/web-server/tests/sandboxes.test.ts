import { describe, expect, test } from 'vitest'
import { handle } from '../src/routes/sandboxes.ts'

const config = { port: 8320, host: '127.0.0.1', repositoryRoot: '/repo' }

function services(sandboxes?: unknown, environment?: unknown) {
  return { sandboxes: () => sandboxes, environment: () => environment }
}

describe('sandboxes: dispatch', () => {
  test('unknown pathname returns null', async () => {
    expect(await handle('/api/sandboxes/x', '', 'GET', undefined, services(), config)).toBeNull()
  })
})

describe('sandboxes: list', () => {
  test('unmounted returns notMounted', async () => {
    const res = await handle('/api/sandboxes', '', 'GET', undefined, services(), config)
    expect(res).toEqual({ status: 200, body: { mounted: false } })
  })

  test('lists sandboxes', async () => {
    const s = services({ async list() { return [{ id: 'sb1' }] } })
    const res = await handle('/api/sandboxes', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { mounted: true, sandboxes: [{ id: 'sb1' }] } })
  })

  test('list failure returns 500', async () => {
    const s = services({ async list() { throw new Error('boom') } })
    const res = await handle('/api/sandboxes', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 500, body: { error: 'boom' } })
  })

  test('non-GET/non-POST returns 405', async () => {
    const s = services({ async list() { return [{ id: 'sb1' }] } })
    expect(await handle('/api/sandboxes', '', 'PUT', {}, s, config)).toEqual({ status: 405, body: { error: 'method not allowed; GET or POST /api/sandboxes' } })
    expect(await handle('/api/sandboxes', '', 'DELETE', undefined, s, config)).toEqual({ status: 405, body: { error: 'method not allowed; GET or POST /api/sandboxes' } })
  })

  test('HEAD lists', async () => {
    const s = services({ async list() { return [{ id: 'sb1' }] } })
    expect(await handle('/api/sandboxes', '', 'HEAD', undefined, s, config)).toEqual({ status: 200, body: { mounted: true, sandboxes: [{ id: 'sb1' }] } })
  })
})

describe('sandboxes: create', () => {
  test('requires name and type', async () => {
    const s = services({})
    expect(await handle('/api/sandboxes', '', 'POST', {}, s, config)).toEqual({ status: 400, body: { error: 'name is required' } })
    expect(await handle('/api/sandboxes', '', 'POST', { name: 'n' }, s, config)).toEqual({ status: 400, body: { error: 'type is required' } })
  })

  test('invalid type returns 400', async () => {
    const res = await handle('/api/sandboxes', '', 'POST', { name: 'n', type: 'bogus' }, services({}), config)
    expect(res).toEqual({ status: 400, body: { error: 'type must be local-sandbox, container, or remote' } })
  })

  test('creates with full input', async () => {
    let captured: unknown
    const s = services({ async create(input: unknown) { captured = input; return { id: 'sb1' } } })
    const res = await handle('/api/sandboxes', '', 'POST', {
      name: 'n', type: 'container', isDefault: true, repositoryId: 'r1', repositoryPath: '/rp',
      environmentProfileId: 'e1', container: { image: 'img', runtime: 'docker' }, remote: { host: 'h', user: 'u' },
    }, s, config)
    expect(res).toEqual({ status: 200, body: { mounted: true, sandbox: { id: 'sb1' } } })
    expect(captured).toEqual({
      name: 'n', type: 'container', isDefault: true, repositoryId: 'r1', repositoryPath: '/rp',
      environmentProfileId: 'e1', container: { image: 'img', runtime: 'docker' }, remote: { host: 'h', user: 'u' },
    })
  })

  test('invalid isDefault returns 400', async () => {
    const res = await handle('/api/sandboxes', '', 'POST', { name: 'n', type: 'local-sandbox', isDefault: 'yes' }, services({}), config)
    expect(res).toEqual({ status: 400, body: { error: 'isDefault must be a boolean' } })
  })

  test('invalid container returns 400', async () => {
    const res = await handle('/api/sandboxes', '', 'POST', { name: 'n', type: 'container', container: {} }, services({}), config)
    expect(res).toEqual({ status: 400, body: { error: 'container must be an object with a string image' } })
  })

  test('invalid remote returns 400', async () => {
    const res = await handle('/api/sandboxes', '', 'POST', { name: 'n', type: 'remote', remote: { host: 'h' } }, services({}), config)
    expect(res).toEqual({ status: 400, body: { error: 'remote must be an object with string host and user' } })
  })
})

describe('sandboxes: container parsing', () => {
  test('container with mounts, env, ports, runtime', async () => {
    let captured: unknown
    const s = services({ async create(input: unknown) { captured = input; return {} } })
    await handle('/api/sandboxes', '', 'POST', {
      name: 'n', type: 'container',
      container: {
        image: 'img', runtime: 'podman', workdir: '/w', shell: 'sh',
        mounts: [{ host: '/h', guest: '/g', ro: true }],
        env: { A: '1' },
        ports: [{ host: 8080, guest: 80 }],
      },
    }, s, config)
    expect(captured).toEqual({
      name: 'n', type: 'container',
      container: {
        image: 'img', runtime: 'podman', workdir: '/w', shell: 'sh',
        mounts: [{ host: '/h', guest: '/g', ro: true }],
        env: { A: '1' },
        ports: [{ host: 8080, guest: 80 }],
      },
    })
  })

  test('container rejects bad runtime/mount/env/port', async () => {
    const s = services({})
    const cases = [
      { container: { image: 'i', runtime: 'bad' } },
      { container: { image: 'i', mounts: [{}] } },
      { container: { image: 'i', mounts: 'x' } },
      { container: { image: 'i', env: { A: 1 } } },
      { container: { image: 'i', ports: [{ host: 'x', guest: 1 }] } },
    ]
    for (const c of cases) {
      const res = await handle('/api/sandboxes', '', 'POST', { name: 'n', type: 'container', ...c }, s, config)
      expect(res?.status).toBe(400)
    }
  })

  test('remote with port, identityFile, useDocker', async () => {
    let captured: unknown
    const s = services({ async create(input: unknown) { captured = input; return {} } })
    await handle('/api/sandboxes', '', 'POST', { name: 'n', type: 'remote', remote: { host: 'h', user: 'u', port: 22, identityFile: '/k', useDocker: true } }, s, config)
    expect(captured).toEqual({ name: 'n', type: 'remote', remote: { host: 'h', user: 'u', port: 22, identityFile: '/k', useDocker: true } })
  })

  test('remote rejects non-number port', async () => {
    const res = await handle('/api/sandboxes', '', 'POST', { name: 'n', type: 'remote', remote: { host: 'h', user: 'u', port: '22' } }, services({}), config)
    expect(res?.status).toBe(400)
  })
})

describe('sandboxes: actions', () => {
  test('update forwards patch', async () => {
    let captured: unknown
    const s = services({ async update(id: string, patch: unknown) { captured = { id, patch }; return { id } } })
    const res = await handle('/api/sandboxes/sb1/update', '', 'POST', { name: 'n2', type: 'local-sandbox' }, s, config)
    expect(res).toEqual({ status: 200, body: { mounted: true, sandbox: { id: 'sb1' } } })
    expect(captured).toEqual({ id: 'sb1', patch: { name: 'n2', type: 'local-sandbox' } })
  })

  test('remove forwards', async () => {
    let id = ''
    const s = services({ async remove(i: string) { id = i; return true } })
    const res = await handle('/api/sandboxes/sb1/remove', '', 'POST', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { mounted: true, removed: true } })
    expect(id).toBe('sb1')
  })

  test('default forwards', async () => {
    let id = ''
    const s = services({ async setDefault(i: string) { id = i; return { id: i } } })
    const res = await handle('/api/sandboxes/sb1/default', '', 'POST', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { mounted: true, sandbox: { id: 'sb1' } } })
    expect(id).toBe('sb1')
  })

  test('probe forwards capabilities', async () => {
    let probed: unknown
    const s = services({
      async get(id: string) { return { id, name: 'sb1' } },
      async probeCapabilities(profile: unknown) { probed = profile; return ['docker'] },
    })
    const res = await handle('/api/sandboxes/sb1/probe', '', 'POST', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { mounted: true, capabilities: ['docker'] } })
    expect(probed).toEqual({ id: 'sb1', name: 'sb1' })
  })

  test('probe missing profile returns 404', async () => {
    const s = services({ async get() { return null } })
    const res = await handle('/api/sandboxes/sb1/probe', '', 'POST', undefined, s, config)
    expect(res).toEqual({ status: 404, body: { error: 'sandbox profile not found' } })
  })

  test('unknown verb falls through to null', async () => {
    expect(await handle('/api/sandboxes/sb1/bogus', '', 'POST', undefined, services({}), config)).toBeNull()
  })

  test('action wrong method returns 405', async () => {
    const res = await handle('/api/sandboxes/sb1/remove', '', 'GET', undefined, services({}), config)
    expect(res?.status).toBe(405)
  })

  test('action failure returns 500', async () => {
    const s = services({ async remove() { throw new Error('boom') } })
    const res = await handle('/api/sandboxes/sb1/remove', '', 'POST', undefined, s, config)
    expect(res).toEqual({ status: 500, body: { error: 'boom' } })
  })
})

describe('sandboxes: execute', () => {
  test('requires profileId/repositoryId/environmentProfileId', async () => {
    const s = services({}, {})
    expect(await handle('/api/sandboxes/execute', '', 'POST', {}, s, config)).toEqual({ status: 400, body: { error: 'profileId is required' } })
    expect(await handle('/api/sandboxes/execute', '', 'POST', { profileId: 'p' }, s, config)).toEqual({ status: 400, body: { error: 'repositoryId is required' } })
    expect(await handle('/api/sandboxes/execute', '', 'POST', { profileId: 'p', repositoryId: 'r' }, s, config)).toEqual({ status: 400, body: { error: 'environmentProfileId is required' } })
  })

  test('requires root when not configured', async () => {
    const s = services({}, {})
    const res = await handle('/api/sandboxes/execute', '', 'POST', { profileId: 'p', repositoryId: 'r', environmentProfileId: 'e', approve: true }, s, { ...config, repositoryRoot: undefined })
    expect(res).toEqual({ status: 400, body: { error: 'repository root not configured; pass root in the body or set Config.repositoryRoot' } })
  })

  test('requires approve to execute', async () => {
    const s = services({}, {})
    const res = await handle('/api/sandboxes/execute', '', 'POST', { profileId: 'p', repositoryId: 'r', environmentProfileId: 'e' }, s, config)
    expect(res).toEqual({ status: 400, body: { error: 'approve must be true to execute an environment plan' } })
  })

  test('executes the full pipeline', async () => {
    const calls: string[] = []
    let execOptions: unknown
    const s = services({
      async get(id: string) { calls.push('get:' + id); return { id, environmentProfileId: 'e', repositoryId: 'r' } },
      async probeCapabilities() { calls.push('probe'); return ['docker'] },
      async executeEnvironmentPlan(_p: unknown, _r: unknown, _e: unknown, _plan: unknown, options: unknown) { calls.push('execute'); execOptions = options; return { run: true } },
    }, {
      async plan() { calls.push('plan'); return { plan: true } },
    })
    const res = await handle('/api/sandboxes/execute', '', 'POST', { profileId: 'p', repositoryId: 'r', environmentProfileId: 'e', approve: true }, s, config)
    expect(res).toEqual({ status: 200, body: { mounted: true, run: { run: true } } })
    expect(calls).toEqual(['get:p', 'probe', 'plan', 'execute'])
    expect(execOptions).toEqual({ approve: true })
  })

  test('environment unmounted returns 500', async () => {
    const s = services({ async get() { return {} } })
    const res = await handle('/api/sandboxes/execute', '', 'POST', { profileId: 'p', repositoryId: 'r', environmentProfileId: 'e' }, s, config)
    expect(res).toEqual({ status: 500, body: { error: 'environment service is not mounted' } })
  })

  test('execute wrong method returns 405', async () => {
    const res = await handle('/api/sandboxes/execute', '', 'GET', undefined, services({}), config)
    expect(res?.status).toBe(405)
  })
})
