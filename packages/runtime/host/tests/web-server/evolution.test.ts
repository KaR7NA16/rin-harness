import { describe, expect, test } from 'vitest'
import { handle } from '../../src/web-server/routes/evolution.ts'

const config = { port: 8320, host: '127.0.0.1' }

function services(evolution?: unknown) {
  return { evolution: () => evolution }
}

describe('evolution routes', () => {
  test('unknown pathname returns null', async () => {
    expect(await handle('/api/evolution/x', '', 'GET', undefined, services(), config)).toBeNull()
  })

  test('unmounted returns notMounted', async () => {
    const res = await handle('/api/evolution/overview', '', 'GET', undefined, services(), config)
    expect(res).toEqual({ status: 200, body: { mounted: false } })
  })

  test('overview filters pending and sorts recent', async () => {
    const s = services({
      async readConfig() { return { config: true } },
      async readState() {
        return {
          candidates: [
            { status: 'pending', updatedAt: '2026-01-01T00:00:00.000Z', id: 'p' },
            { status: 'approved', updatedAt: '2026-03-01T00:00:00.000Z', id: 'r1' },
            { status: 'rejected', updatedAt: '2026-02-01T00:00:00.000Z', id: 'r2' },
          ],
          events: [{ id: 'e1' }],
        }
      },
    })
    const res = await handle('/api/evolution/overview', '', 'GET', undefined, s, config)
    expect(res?.status).toBe(200)
    expect(res?.body.mounted).toBe(true)
    expect(res?.body.config).toEqual({ config: true })
    expect(res?.body.pendingCandidates).toEqual([{ status: 'pending', updatedAt: '2026-01-01T00:00:00.000Z', id: 'p' }])
    expect(res?.body.recentCandidates.map((c: { id: string }) => c.id)).toEqual(['r1', 'r2', 'p'])
    expect(res?.body.events).toEqual([{ id: 'e1' }])
  })

  test('failure returns 500', async () => {
    const s = services({ async readConfig() { throw new Error('boom') }, async readState() { return { candidates: [], events: [] } } })
    const res = await handle('/api/evolution/overview', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 500, body: { error: 'boom' } })
  })
})
