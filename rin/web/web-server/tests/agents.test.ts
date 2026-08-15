import { describe, expect, test } from 'vitest'
import { handle } from '../src/routes/agents.ts'

const config = { port: 8320, host: '127.0.0.1', repositoryRoot: '/repo' }

function services(agents?: unknown) {
  return { agents: () => agents }
}

describe('agents routes', () => {
  test('unknown pathname returns null', async () => {
    expect(await handle('/api/agents/unknown', '', 'GET', undefined, services(), config)).toBeNull()
  })

  test('list unmounted returns notMounted', async () => {
    const res = await handle('/api/agents', '', 'GET', undefined, services(), config)
    expect(res).toEqual({ status: 200, body: { mounted: false } })
  })

  test('list forwards root and returns agents', async () => {
    let root: unknown
    const s = services({ async listRepositoryAgents(r: unknown) { root = r; return [{ name: 'a' }] } })
    const res = await handle('/api/agents', '?root=/r', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { mounted: true, agents: [{ name: 'a' }] } })
    expect(root).toBe('/r')
  })

  test('list uses config root when query absent', async () => {
    let root: unknown
    const s = services({ async listRepositoryAgents(r: unknown) { root = r; return [] } })
    await handle('/api/agents', '', 'GET', undefined, s, config)
    expect(root).toBe('/repo')
  })

  test('runtime list', async () => {
    const s = services({ async listRuntimeAgents() { return [{ id: 'r' }] } })
    const res = await handle('/api/agents/runtime', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { mounted: true, agents: [{ id: 'r' }] } })
  })

  test('create requires input object', async () => {
    const s = services({})
    expect(await handle('/api/agents', '', 'POST', 'x', s, config)).toEqual({ status: 400, body: { error: 'request body must be a JSON object' } })
    expect(await handle('/api/agents', '', 'POST', { input: 'x' }, s, config)).toEqual({ status: 400, body: { error: 'input is required and must be an object' } })
  })

  test('create requires input.name', async () => {
    const res = await handle('/api/agents', '', 'POST', { input: {} }, services({}), config)
    expect(res).toEqual({ status: 400, body: { error: 'input.name is required' } })
  })

  test('create requires description and systemPrompt', async () => {
    const s = services({})
    expect(await handle('/api/agents', '', 'POST', { input: { name: 'n' } }, s, config)).toEqual({ status: 400, body: { error: 'description is required' } })
    expect(await handle('/api/agents', '', 'POST', { input: { name: 'n', description: 'd' } }, s, config)).toEqual({ status: 400, body: { error: 'systemPrompt is required' } })
  })

  test('create forwards full input', async () => {
    let captured: unknown
    const s = services({ async createRepositoryAgent(r: unknown, input: unknown) { captured = { r, input }; return { name: 'n' } } })
    const res = await handle('/api/agents', '', 'POST', {
      input: {
        name: 'n',
        description: 'd',
        systemPrompt: 'sp',
        model: 'm',
        permissionMode: 'plan',
        tools: ['t1'],
        resources: { environmentProfileId: 'e', skillIds: ['s'], workflowIds: ['w'] },
      },
    }, s, config)
    expect(res).toEqual({ status: 200, body: { mounted: true, agent: { name: 'n' } } })
    expect(captured).toEqual({
      r: '/repo',
      input: {
        name: 'n',
        description: 'd',
        systemPrompt: 'sp',
        model: 'm',
        permissionMode: 'plan',
        tools: ['t1'],
        resources: { environmentProfileId: 'e', skillIds: ['s'], workflowIds: ['w'] },
      },
    })
  })

  test('create invalid permissionMode returns 400', async () => {
    const res = await handle('/api/agents', '', 'POST', { input: { name: 'n', description: 'd', systemPrompt: 'sp', permissionMode: 'bad' } }, services({}), config)
    expect(res).toEqual({ status: 400, body: { error: 'permissionMode must be default, acceptEdits, plan, or bypassPermissions' } })
  })

  test('create invalid tools returns 400', async () => {
    const res = await handle('/api/agents', '', 'POST', { input: { name: 'n', description: 'd', systemPrompt: 'sp', tools: [1] } }, services({}), config)
    expect(res).toEqual({ status: 400, body: { error: 'tools must be an array of strings' } })
  })

  test('create invalid resources returns 400', async () => {
    const res = await handle('/api/agents', '', 'POST', { input: { name: 'n', description: 'd', systemPrompt: 'sp', resources: { skillIds: 'x' } } }, services({}), config)
    expect(res).toEqual({ status: 400, body: { error: 'resources must be an object with optional environmentProfileId, skillIds, workflowIds' } })
  })

  test('action: update and delete', async () => {
    const calls: string[] = []
    const s = services({
      async updateRepositoryAgent(r: string, name: string, input: unknown) { calls.push('update:' + name); return { name, ...(input as object) } },
      async deleteRepositoryAgent(r: string, name: string) { calls.push('delete:' + name) },
    })
    const upd = await handle('/api/agents/a1/update', '', 'POST', { input: { description: 'd', systemPrompt: 'sp' } }, s, config)
    expect(upd?.status).toBe(200)
    expect(upd?.body.mounted).toBe(true)
    const del = await handle('/api/agents/a1/delete', '', 'POST', {}, s, config)
    expect(del).toEqual({ status: 200, body: { mounted: true, deleted: true } })
    expect(calls).toEqual(['update:a1', 'delete:a1'])
  })

  test('action wrong method returns 405', async () => {
    const res = await handle('/api/agents/a1/update', '', 'GET', undefined, services({}), config)
    expect(res?.status).toBe(405)
  })

  test('action non-object body returns 400', async () => {
    const res = await handle('/api/agents/a1/update', '', 'POST', 'x', services({}), config)
    expect(res).toEqual({ status: 400, body: { error: 'request body must be a JSON object' } })
  })

  test('project route', async () => {
    const s = services({ async projectRepositoryAgents(r: string, opts: unknown) { return { ids: ['i1'], opts, r } } })
    const res = await handle('/api/agents/project', '', 'POST', { presetRoot: '/p' }, s, config)
    expect(res).toEqual({ status: 200, body: { mounted: true, ids: ['i1'] } })
    const noBody = await handle('/api/agents/project', '', 'POST', {}, s, config)
    expect(noBody?.body.mounted).toBe(true)
  })

  test('project wrong method returns 405', async () => {
    const res = await handle('/api/agents/project', '', 'GET', undefined, services({}), config)
    expect(res?.status).toBe(405)
  })

  test('propose requires instructions', async () => {
    const s = services({})
    expect(await handle('/api/agents/propose', '', 'POST', {}, s, config)).toEqual({ status: 400, body: { error: 'instructions is required and must be a non-empty string' } })
    expect(await handle('/api/agents/propose', '', 'POST', { instructions: '  ' }, s, config)).toEqual({ status: 400, body: { error: 'instructions is required and must be a non-empty string' } })
  })

  test('propose forwards instructions', async () => {
    let arg = ''
    const s = services({ async proposeAgent(i: string) { arg = i; return { proposal: true } } })
    const res = await handle('/api/agents/propose', '', 'POST', { instructions: 'do the thing' }, s, config)
    expect(res).toEqual({ status: 200, body: { mounted: true, proposal: { proposal: true } } })
    expect(arg).toBe('do the thing')
  })
})
