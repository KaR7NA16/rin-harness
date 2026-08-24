import { afterEach, describe, expect, it, vi } from 'vitest'
import { memoryApi } from './memory'

describe('memoryApi', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses the unified catalog endpoints', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ mounted: true, items: [], injections: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))
    vi.stubGlobal('fetch', fetchMock)

    await memoryApi.manifest()
    await memoryApi.list({ projection: 'notes', status: 'active', sourceId: 'notes:guide', limit: 10 })
    await memoryApi.get('notes:guide')
    await memoryApi.revoke('notes:guide', 'superseded')
    await memoryApi.remove('notes:guide')
    await memoryApi.exportData()
    await memoryApi.injections(5)

    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:8320/api/memory/manifest', expect.objectContaining({ method: 'GET' }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:8320/api/memory?projection=notes&status=active&sourceId=notes%3Aguide&limit=10', expect.objectContaining({ method: 'GET' }))
    expect(fetchMock).toHaveBeenNthCalledWith(3, 'http://127.0.0.1:8320/api/memory/notes%3Aguide', expect.objectContaining({ method: 'GET' }))
    expect(fetchMock).toHaveBeenNthCalledWith(4, 'http://127.0.0.1:8320/api/memory/notes%3Aguide/revoke', expect.objectContaining({ method: 'POST', body: JSON.stringify({ reason: 'superseded' }) }))
    expect(fetchMock).toHaveBeenNthCalledWith(5, 'http://127.0.0.1:8320/api/memory/notes%3Aguide', expect.objectContaining({ method: 'DELETE' }))
    expect(fetchMock).toHaveBeenNthCalledWith(6, 'http://127.0.0.1:8320/api/memory/export', expect.objectContaining({ method: 'GET' }))
    expect(fetchMock).toHaveBeenNthCalledWith(7, 'http://127.0.0.1:8320/api/memory/injections?limit=5', expect.objectContaining({ method: 'GET' }))
  })

  it('turns an unmounted catalog into safe empty values', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ mounted: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )))
    await expect(memoryApi.manifest()).resolves.toBeNull()
    await expect(memoryApi.list()).resolves.toEqual([])
    await expect(memoryApi.get('missing')).resolves.toBeNull()
    await expect(memoryApi.remove('missing')).resolves.toBe(false)
  })
})
