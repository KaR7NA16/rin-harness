import { describe, expect, test } from 'vitest'
import { handle } from '../src/routes/sessions.ts'

const config = { port: 8320, host: '127.0.0.1' }

function services(search?: unknown) {
  return { sessionSearch: () => search }
}

describe('sessions routes', () => {
  test('unknown pathname returns null', async () => {
    expect(await handle('/api/sessions/x', '', 'GET', undefined, services(), config)).toBeNull()
  })

  test('browse unmounted returns notMounted', async () => {
    const res = await handle('/api/sessions/browse', '', 'GET', undefined, services(), config)
    expect(res).toEqual({ status: 200, body: { mounted: false } })
  })

  test('browse forwards limit and returns result', async () => {
    let opts: unknown
    const s = services({ async browse(o: unknown) { opts = o; return [{ id: 's1' }] } })
    const res = await handle('/api/sessions/browse', '?limit=10', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { mounted: true, 0: { id: 's1' } } })
    expect(opts).toEqual({ limit: 10 })
  })

  test('browse failure returns 500', async () => {
    const s = services({ async browse() { throw new Error('boom') } })
    const res = await handle('/api/sessions/browse', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 500, body: { error: 'boom' } })
  })

  test('discover requires query', async () => {
    const s = services({})
    const res = await handle('/api/sessions/discover', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 400, body: { error: 'query is required; pass ?query=' } })
  })

  test('discover forwards query and limit', async () => {
    let opts: unknown
    const s = services({ async discover(o: unknown) { opts = o; return [{ id: 's1' }] } })
    const res = await handle('/api/sessions/discover', '?query=hi&limit=2', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { mounted: true, 0: { id: 's1' } } })
    expect(opts).toEqual({ query: 'hi', limit: 2 })
  })

  test('discover failure returns 500', async () => {
    const s = services({ async discover() { throw new Error('boom') } })
    const res = await handle('/api/sessions/discover', '?query=hi', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 500, body: { error: 'boom' } })
  })

  test('read requires key', async () => {
    const s = services({})
    const res = await handle('/api/sessions/read', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 400, body: { error: 'key is required; pass ?key=<sessionId>' } })
  })

  test('read returns mounted result', async () => {
    let arg: unknown
    const s = services({ async read(a: unknown) { arg = a; return { id: 's1' } } })
    const res = await handle('/api/sessions/read', '?key=s1', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { mounted: true, id: 's1' } })
    expect(arg).toEqual({ sessionId: 's1' })
  })

  test('read null returns 404', async () => {
    const s = services({ async read() { return null } })
    const res = await handle('/api/sessions/read', '?key=s1', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 404, body: { error: 'session not found' } })
  })

  test('read failure returns 500', async () => {
    const s = services({ async read() { throw new Error('boom') } })
    const res = await handle('/api/sessions/read', '?key=s1', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 500, body: { error: 'boom' } })
  })
})
