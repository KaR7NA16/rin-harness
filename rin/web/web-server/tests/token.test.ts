import { describe, expect, test } from 'vitest'
import { handle } from '../src/routes/token.ts'

const config = { port: 8320, host: '127.0.0.1' }

function services(token?: unknown) {
  return { tokenOptimization: () => token }
}

describe('token routes', () => {
  test('unknown pathname returns null', async () => {
    expect(await handle('/api/token-optimization/x', '', 'GET', undefined, services(), config)).toBeNull()
  })

  test('status unmounted returns notMounted', async () => {
    const res = await handle('/api/token-optimization/status', '', 'GET', undefined, services(), config)
    expect(res).toEqual({ status: 200, body: { mounted: false } })
  })

  test('status mounted', async () => {
    const s = services({ getStatus: () => ({ responseStyle: 'caveman', cleanPrompt: true }) })
    const res = await handle('/api/token-optimization/status', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { mounted: true, responseStyle: 'caveman', cleanPrompt: true } })
  })

  test('status failure returns 500', async () => {
    const s = services({ getStatus() { throw new Error('boom') } })
    const res = await handle('/api/token-optimization/status', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 500, body: { error: 'boom' } })
  })

  test('set unmounted returns notMounted', async () => {
    const res = await handle('/api/token-optimization/set', '', 'POST', {}, services(), config)
    expect(res).toEqual({ status: 200, body: { mounted: false } })
  })

  test('set wrong method returns 405', async () => {
    const s = services({})
    const res = await handle('/api/token-optimization/set', '', 'GET', undefined, s, config)
    expect(res?.status).toBe(405)
  })

  test('set non-object body returns 400', async () => {
    const s = services({})
    const res = await handle('/api/token-optimization/set', '', 'POST', 'x', s, config)
    expect(res).toEqual({ status: 400, body: { error: 'request body must be a JSON object' } })
  })

  test('set with neither field returns 400', async () => {
    const s = services({})
    const res = await handle('/api/token-optimization/set', '', 'POST', {}, s, config)
    expect(res).toEqual({ status: 400, body: { error: 'at least one of responseStyle or cleanPrompt is required' } })
  })

  test('set invalid responseStyle returns 400', async () => {
    const s = services({ getStatus: () => ({ responseStyle: 'off', cleanPrompt: false }) })
    const res = await handle('/api/token-optimization/set', '', 'POST', { responseStyle: 'bogus' }, s, config)
    expect(res).toEqual({ status: 400, body: { error: 'responseStyle must be off, caveman, or ponytail' } })
  })

  test('set invalid cleanPrompt returns 400', async () => {
    const s = services({ getStatus: () => ({ responseStyle: 'off', cleanPrompt: false }) })
    const res = await handle('/api/token-optimization/set', '', 'POST', { cleanPrompt: 'yes' }, s, config)
    expect(res).toEqual({ status: 400, body: { error: 'cleanPrompt must be a boolean' } })
  })

  test('set forwards both knobs', async () => {
    const calls: string[] = []
    const s = services({
      getStatus: () => ({ responseStyle: 'off', cleanPrompt: false }),
      setResponseStyle: (style: string) => { calls.push('style:' + style); return { responseStyle: style, cleanPrompt: false } },
      setCleanPrompt: (v: boolean) => { calls.push('clean:' + v); return { responseStyle: 'ponytail', cleanPrompt: v } },
    })
    const res = await handle('/api/token-optimization/set', '', 'POST', { responseStyle: 'ponytail', cleanPrompt: true }, s, config)
    expect(res).toEqual({ status: 200, body: { mounted: true, responseStyle: 'ponytail', cleanPrompt: true } })
    expect(calls).toEqual(['style:ponytail', 'clean:true'])
  })

  test('set failure returns 500', async () => {
    const s = services({ getStatus() { throw new Error('boom') } })
    const res = await handle('/api/token-optimization/set', '', 'POST', { responseStyle: 'off' }, s, config)
    expect(res).toEqual({ status: 500, body: { error: 'boom' } })
  })
})
