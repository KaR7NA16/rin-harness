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

  test('runtime list', async () => {
    const s = services({ async listRuntimeAgents() { return [{ id: 'r' }] } })
    const res = await handle('/api/agents/runtime', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { mounted: true, agents: [{ id: 'r' }] } })
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
