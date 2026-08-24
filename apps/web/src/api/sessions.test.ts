import { afterEach, describe, expect, it, vi } from 'vitest'
import { sessionsApi } from './sessions'

describe('sessionsApi token usage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads the lightweight cumulative usage endpoint with the project locator', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ usage: null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await sessionsApi.getUsage('session-1', { projectPath: '/tmp/my project' })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8320/api/sessions/session-1/usage?projectPath=%2Ftmp%2Fmy%20project',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('uses the complete archive endpoints for full export and import', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2]), {
        status: 200,
        headers: { 'Content-Type': 'application/gzip' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        imported: 1,
        skipped: 0,
        sessions: [],
        files: ['memory/manifest.json'],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    const blob = await sessionsApi.exportArchive()
    const result = await sessionsApi.importArchive(new Blob(['archive'], { type: 'application/gzip' }))
    expect(blob.type).toBe('application/gzip')
    expect(blob.size).toBe(2)
    expect(result.files).toEqual(['memory/manifest.json'])
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:8320/api/archive/export', expect.objectContaining({ method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:8320/api/archive/import', expect.objectContaining({ method: 'POST' }))
  })
})
