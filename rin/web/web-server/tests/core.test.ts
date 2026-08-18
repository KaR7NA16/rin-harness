import { describe, expect, test } from 'vitest'
import { handle } from '../src/routes/core.ts'

const config = { port: 8320, host: '127.0.0.1', repositoryRoot: '/repo' }

function services(overrides: Record<string, () => unknown> = {}) {
  const base: Record<string, () => unknown> = {
    repository: () => undefined,
    environment: () => undefined,
    filesystem: () => undefined,
    sessionBackup: () => undefined,
    smartPruning: () => undefined,
    knowledge: () => undefined,
    knowledgeGraph: () => undefined,
    sessionSearch: () => undefined,
    promptMemory: () => undefined,
    evolution: () => undefined,
    skillMemory: () => undefined,
    agents: () => undefined,
    notes: () => undefined,
    sandboxes: () => undefined,
    tokenOptimization: () => undefined,
    codegraph: () => undefined,
    plugins: () => undefined,
    providerProbe: () => undefined,
    teams: () => undefined,
    tasks: () => undefined,
    mcp: () => undefined,
    computerUse: () => undefined,
    agentMigration: () => undefined,
    doctor: () => undefined,
  }
  return { ...base, ...overrides }
}

describe('core: static status endpoints', () => {
  test('/health and /api/status return ok with uptime', async () => {
    for (const pathname of ['/health', '/api/status']) {
      const res = await handle(pathname, '', 'GET', undefined, services(), config)
      expect(res?.status).toBe(200)
      expect(res?.body.status).toBe('ok')
      expect(res?.body.version).toBe('0.1.0')
      expect(typeof res?.body.uptime).toBe('number')
    }
  })

  test('unknown pathname returns null', async () => {
    expect(await handle('/api/unknown', '', 'GET', undefined, services(), config)).toBeNull()
  })
})

describe('core: /api/health', () => {
  test('reports mounted services', async () => {
    const s = services({
      repository: () => ({}),
      smartPruning: () => ({}),
      knowledge: () => ({}),
      agents: () => ({}),
      tokenOptimization: () => ({}),
    })
    const res = await handle('/api/health', '', 'GET', undefined, s, config)
    expect(res?.status).toBe(200)
    expect(res?.body.name).toBe('rin-web')
    expect(res?.body.services).toEqual({
      repository: true,
      environment: false,
      filesystem: false,
      sessionBackup: false,
      smartPruning: true,
      knowledge: true,
      knowledgeGraph: false,
      sessionSearch: false,
      promptMemory: false,
      evolution: false,
      skillMemory: false,
      agents: true,
      notes: false,
      sandboxes: false,
      tokenOptimization: true,
      codegraph: false,
      plugins: false,
      providerProbe: false,
      teams: false,
      tasks: false,
      mcp: false,
      computerUse: false,
      agentMigration: false,
      doctor: false,
    })
  })
})

describe('core: /api/repository', () => {
  test('unmounted service returns 500', async () => {
    const res = await handle('/api/repository', '', 'GET', undefined, services(), config)
    expect(res).toEqual({ status: 500, body: { error: 'repository service is not mounted' } })
  })

  test('missing root returns 400', async () => {
    const s = services({ repository: () => ({}) })
    const res = await handle('/api/repository', '', 'GET', undefined, s, { ...config, repositoryRoot: undefined })
    expect(res).toEqual({ status: 400, body: { error: 'repository root not configured; pass ?root=' } })
  })

  test('reads via service', async () => {
    const s = services({ repository: () => ({ async read(root: string) { return { root } } }) })
    const res = await handle('/api/repository', '?root=/repo/sub', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { root: '/repo/sub' } })
  })

  test('root outside the configured repository returns 400', async () => {
    const s = services({ repository: () => ({ async read() { return {} } }) })
    const res = await handle('/api/repository', '?root=/etc', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 400, body: { error: 'repository root must resolve within the configured repository root' } })
  })

  test('root traversal returns 400', async () => {
    const s = services({ repository: () => ({ async read() { return {} } }) })
    const res = await handle('/api/repository', '?root=/repo/../etc', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 400, body: { error: 'repository root must resolve within the configured repository root' } })
  })

  test('root override without a configured root returns 400', async () => {
    const s = services({ repository: () => ({ async read() { return {} } }) })
    const res = await handle('/api/repository', '?root=/repo/sub', 'GET', undefined, s, { ...config, repositoryRoot: undefined })
    expect(res).toEqual({ status: 400, body: { error: 'repository root override requires a configured repositoryRoot' } })
  })

  test('read failure returns 500', async () => {
    const s = services({ repository: () => ({ async read() { throw new Error('boom') } }) })
    const res = await handle('/api/repository', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 500, body: { error: 'boom' } })
  })
})

describe('core: /api/environment/plan', () => {
  test('unmounted service returns 500', async () => {
    const res = await handle('/api/environment/plan', '', 'GET', undefined, services(), config)
    expect(res).toEqual({ status: 500, body: { error: 'environment service is not mounted' } })
  })

  test('missing profile returns 400', async () => {
    const s = services({ environment: () => ({}) })
    const res = await handle('/api/environment/plan', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 400, body: { error: 'profile is required; pass ?profile=<id>' } })
  })

  test('missing root returns 400', async () => {
    const s = services({ environment: () => ({}) })
    const res = await handle('/api/environment/plan', '?profile=p1', 'GET', undefined, s, { ...config, repositoryRoot: undefined })
    expect(res).toEqual({ status: 400, body: { error: 'repository root not configured; pass ?root=' } })
  })

  test('plans with parsed capabilities', async () => {
    let captured: unknown
    const s = services({
      environment: () => ({
        async plan(root: string, profile: string, capabilities: unknown) {
          captured = { root, profile, capabilities }
          return { plan: true }
        },
      }),
    })
    const res = await handle('/api/environment/plan', '?profile=p1&platform=linux&apt=true&python=1', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { plan: true } })
    expect(captured).toEqual({
      root: '/repo',
      profile: 'p1',
      capabilities: {
        platform: 'linux',
        runtimes: { apt: true, python: true, pip: false, r: false, npm: false, tlmgr: false },
      },
    })
  })

  test('unknown profile error maps to 400', async () => {
    const s = services({ environment: () => ({ async plan() { throw new Error('unknown profile: xyz') } }) })
    const res = await handle('/api/environment/plan', '?profile=p1', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 400, body: { error: 'unknown profile: xyz' } })
  })

  test('other error maps to 500', async () => {
    const s = services({ environment: () => ({ async plan() { throw new Error('nope') } }) })
    const res = await handle('/api/environment/plan', '?profile=p1', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 500, body: { error: 'nope' } })
  })
})

describe('core: smart-pruning', () => {
  test('status unmounted', async () => {
    const res = await handle('/api/smart-pruning/status', '', 'GET', undefined, services(), config)
    expect(res).toEqual({ status: 200, body: { mounted: false } })
  })

  test('status mounted', async () => {
    const s = services({ smartPruning: () => ({ getStatus: () => ({ enabled: true, level: 'balanced', mode: 'deterministic' }) }) })
    const res = await handle('/api/smart-pruning/status', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { mounted: true, enabled: true, level: 'balanced', mode: 'deterministic' } })
  })

  test('set unmounted returns notMounted', async () => {
    const res = await handle('/api/smart-pruning/set', '', 'POST', {}, services(), config)
    expect(res).toEqual({ status: 200, body: { mounted: false } })
  })

  test('set wrong method returns 405', async () => {
    const s = services({ smartPruning: () => ({}) })
    const res = await handle('/api/smart-pruning/set', '', 'GET', undefined, s, config)
    expect(res?.status).toBe(405)
  })

  test('set non-object body returns 400', async () => {
    const s = services({ smartPruning: () => ({}) })
    const res = await handle('/api/smart-pruning/set', '', 'POST', 'nope', s, config)
    expect(res?.status).toBe(400)
  })

  test('set with neither enabled nor level returns 400', async () => {
    const s = services({ smartPruning: () => ({}) })
    const res = await handle('/api/smart-pruning/set', '', 'POST', {}, s, config)
    expect(res).toEqual({ status: 400, body: { error: 'at least one of enabled or level is required' } })
  })

  test('set enabled must be boolean', async () => {
    const s = services({ smartPruning: () => ({ getStatus: () => ({ enabled: false, level: 'conservative', mode: 'deterministic' }) }) })
    const res = await handle('/api/smart-pruning/set', '', 'POST', { enabled: 'yes' }, s, config)
    expect(res).toEqual({ status: 400, body: { error: 'enabled must be a boolean' } })
  })

  test('set level must be valid', async () => {
    const s = services({ smartPruning: () => ({ getStatus: () => ({ enabled: false, level: 'conservative', mode: 'deterministic' }) }) })
    const res = await handle('/api/smart-pruning/set', '', 'POST', { level: 'bogus' }, s, config)
    expect(res).toEqual({ status: 400, body: { error: 'level must be conservative, balanced, or aggressive' } })
  })

  test('set enabled and level forwards to service', async () => {
    const calls: string[] = []
    const s = services({
      smartPruning: () => ({
        getStatus: () => ({ enabled: false, level: 'conservative', mode: 'deterministic' }),
        setEnabled: (enabled: boolean) => { calls.push('setEnabled:' + enabled); return { enabled, level: 'conservative', mode: 'deterministic' } },
        setLevel: (level: string) => { calls.push('setLevel:' + level); return { enabled: true, level, mode: 'deterministic' } },
      }),
    })
    const res = await handle('/api/smart-pruning/set', '', 'POST', { enabled: true, level: 'aggressive' }, s, config)
    expect(res).toEqual({ status: 200, body: { mounted: true, enabled: true, level: 'aggressive', mode: 'deterministic' } })
    expect(calls).toEqual(['setEnabled:true', 'setLevel:aggressive'])
  })
})
