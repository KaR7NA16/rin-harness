import { describe, expect, test } from 'vitest'
import { handle } from '../src/routes/prompt-memory.ts'

const config = { port: 8320, host: '127.0.0.1' }

function services(promptMemory?: unknown) {
  return { promptMemory: () => promptMemory }
}

describe('prompt-memory: dispatch', () => {
  test('unknown pathname returns null', async () => {
    expect(await handle('/api/prompt-memory/unknown', '', 'GET', undefined, services(), config)).toBeNull()
  })
})

describe('prompt-memory: config', () => {
  test('unmounted returns notMounted', async () => {
    const res = await handle('/api/prompt-memory/config', '', 'PATCH', {}, services(), config)
    expect(res).toEqual({ status: 200, body: { mounted: false } })
  })

  test('wrong method returns 405', async () => {
    const res = await handle('/api/prompt-memory/config', '', 'GET', undefined, services({}), config)
    expect(res?.status).toBe(405)
  })

  test('missing injectEvolutionMemory returns 400', async () => {
    const res = await handle('/api/prompt-memory/config', '', 'PATCH', {}, services({}), config)
    expect(res).toEqual({ status: 400, body: { error: 'injectEvolutionMemory is required and must be a boolean' } })
  })

  test('non-boolean injectEvolutionMemory returns 400', async () => {
    const res = await handle('/api/prompt-memory/config', '', 'PATCH', { injectEvolutionMemory: 'yes' }, services({}), config)
    expect(res?.status).toBe(400)
  })

  test('updates config', async () => {
    let arg: unknown
    const s = services({ async updateConfig(a: unknown) { arg = a; return { ok: true } } })
    const res = await handle('/api/prompt-memory/config', '', 'PATCH', { injectEvolutionMemory: true }, s, config)
    expect(res).toEqual({ status: 200, body: { ok: true } })
    expect(arg).toEqual({ injectEvolutionMemory: true })
  })

  test('update failure returns 500', async () => {
    const s = services({ async updateConfig() { throw new Error('boom') } })
    const res = await handle('/api/prompt-memory/config', '', 'PATCH', { injectEvolutionMemory: true }, s, config)
    expect(res).toEqual({ status: 500, body: { error: 'boom' } })
  })
})

describe('prompt-memory: entries', () => {
  test('unmounted returns notMounted', async () => {
    const res = await handle('/api/prompt-memory/brief/entries', '', 'POST', {}, services(), config)
    expect(res).toEqual({ status: 200, body: { mounted: false } })
  })

  test('wrong method returns 405', async () => {
    const res = await handle('/api/prompt-memory/user/entries', '', 'GET', undefined, services({}), config)
    expect(res?.status).toBe(405)
  })

  test('unknown action returns 400', async () => {
    const res = await handle('/api/prompt-memory/brief/entries', '', 'POST', { action: 'wat' }, services({}), config)
    expect(res).toEqual({ status: 400, body: { error: "action must be 'add', 'replace', or 'remove'" } })
  })

  test('add requires content', async () => {
    const res = await handle('/api/prompt-memory/brief/entries', '', 'POST', { action: 'add' }, services({}), config)
    expect(res).toEqual({ status: 400, body: { error: 'content is required for add' } })
  })

  test('add forwards to service', async () => {
    let target = ''
    let content = ''
    const s = services({ async addEntry(t: string, c: string) { target = t; content = c; return { ok: true } } })
    const res = await handle('/api/prompt-memory/brief/entries', '', 'POST', { action: 'add', content: 'hi' }, s, config)
    expect(res).toEqual({ status: 200, body: { ok: true } })
    expect(target).toBe('brief')
    expect(content).toBe('hi')
  })

  test('replace requires oldText and content', async () => {
    const res = await handle('/api/prompt-memory/user/entries', '', 'POST', { action: 'replace' }, services({}), config)
    expect(res).toEqual({ status: 400, body: { error: 'oldText is required for replace' } })
  })

  test('replace forwards to service', async () => {
    const calls: string[] = []
    const s = services({ async replaceEntry(t: string, o: string, c: string) { calls.push(t, o, c); return { ok: true } } })
    const res = await handle('/api/prompt-memory/user/entries', '', 'POST', { action: 'replace', oldText: 'a', content: 'b' }, s, config)
    expect(res).toEqual({ status: 200, body: { ok: true } })
    expect(calls).toEqual(['user', 'a', 'b'])
  })

  test('remove requires oldText', async () => {
    const res = await handle('/api/prompt-memory/brief/entries', '', 'POST', { action: 'remove' }, services({}), config)
    expect(res).toEqual({ status: 400, body: { error: 'oldText is required for remove' } })
  })

  test('remove forwards to service', async () => {
    let target = ''
    let oldText = ''
    const s = services({ async removeEntry(t: string, o: string) { target = t; oldText = o; return { ok: true } } })
    const res = await handle('/api/prompt-memory/brief/entries', '', 'POST', { action: 'remove', oldText: 'x' }, s, config)
    expect(res).toEqual({ status: 200, body: { ok: true } })
    expect(target).toBe('brief')
    expect(oldText).toBe('x')
  })

  test('entry mutation failure returns 500', async () => {
    const s = services({ async addEntry() { throw new Error('boom') } })
    const res = await handle('/api/prompt-memory/brief/entries', '', 'POST', { action: 'add', content: 'hi' }, s, config)
    expect(res).toEqual({ status: 500, body: { error: 'boom' } })
  })
})

describe('prompt-memory: status/file/review-logs', () => {
  test('status returns mounted result', async () => {
    const s = services({ async getStatus() { return { files: {} } } })
    const res = await handle('/api/prompt-memory/status', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { mounted: true, files: {} } })
  })

  test('status failure returns 500', async () => {
    const s = services({ async getStatus() { throw new Error('boom') } })
    const res = await handle('/api/prompt-memory/status', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 500, body: { error: 'boom' } })
  })

  test('file missing target returns 400', async () => {
    const res = await handle('/api/prompt-memory/file', '', 'GET', undefined, services({}), config)
    expect(res).toEqual({ status: 400, body: { error: 'target is required; pass ?target=user|brief' } })
  })

  test('file reads target', async () => {
    let target = ''
    const s = services({ async readFile(t: string) { target = t; return { target: t, content: 'content' } } })
    const res = await handle('/api/prompt-memory/file', '?target=user', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { mounted: true, target: 'user', content: 'content' } })
    expect(target).toBe('user')
  })

  test('review-logs reads limit', async () => {
    let limit: unknown
    const s = services({ async readReviewLogs(l: unknown) { limit = l; return [{ a: 1 }] } })
    const res = await handle('/api/prompt-memory/review-logs', '?limit=5', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { mounted: true, logs: [{ a: 1 }] } })
    expect(limit).toBe(5)
  })

  test('review-logs without limit passes undefined', async () => {
    let limit: unknown = 'sentinel'
    const s = services({ async readReviewLogs(l: unknown) { limit = l; return [] } })
    await handle('/api/prompt-memory/review-logs', '', 'GET', undefined, s, config)
    expect(limit).toBeUndefined()
  })
})
