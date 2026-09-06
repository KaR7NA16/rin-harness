import { afterEach, describe, expect, it, vi } from 'vitest'
import { memoryApi } from './memory'

describe('memoryApi', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses the read-only cognition query endpoints', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ mounted: true, scenes: [], cycles: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))
    vi.stubGlobal('fetch', fetchMock)

    await memoryApi.manifest()
    await memoryApi.field()
    await memoryApi.scenes()
    await memoryApi.representation('scene-1')
    await memoryApi.recallCycles(20)
    await memoryApi.recallCycle('cycle-1')

    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:8320/api/memory/manifest', expect.objectContaining({ method: 'GET' }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:8320/api/memory/field', expect.objectContaining({ method: 'GET' }))
    expect(fetchMock).toHaveBeenNthCalledWith(3, 'http://127.0.0.1:8320/api/memory/scenes', expect.objectContaining({ method: 'GET' }))
    expect(fetchMock).toHaveBeenNthCalledWith(4, 'http://127.0.0.1:8320/api/memory/representations/scene-1', expect.objectContaining({ method: 'GET' }))
    expect(fetchMock).toHaveBeenNthCalledWith(5, 'http://127.0.0.1:8320/api/memory/recall?limit=20', expect.objectContaining({ method: 'GET' }))
    expect(fetchMock).toHaveBeenNthCalledWith(6, 'http://127.0.0.1:8320/api/memory/recall/cycle-1', expect.objectContaining({ method: 'GET' }))
  })

  it('turns an unmounted catalog into safe empty values', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ mounted: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )))
    await expect(memoryApi.manifest()).resolves.toBeNull()
    await expect(memoryApi.field()).resolves.toBeNull()
    await expect(memoryApi.scenes()).resolves.toEqual([])
    await expect(memoryApi.representation('missing')).resolves.toBeNull()
    await expect(memoryApi.recallCycles()).resolves.toEqual([])
    await expect(memoryApi.recallCycle('missing')).resolves.toBeNull()
    await expect(memoryApi.erasePreview(['scene-1'])).resolves.toBeNull()
    await expect(memoryApi.eraseAuthorize({ rootMemoryIds: ['scene-1'], ownerId: 'owner' })).resolves.toBeNull()
    await expect(memoryApi.eraseCommit({ authorizationId: 'auth', ownerId: 'owner' })).resolves.toBeNull()
  })

  it('queries the cognition surfaces and dispatches owner intents', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ mounted: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))
    vi.stubGlobal('fetch', fetchMock)

    await memoryApi.scenes()
    await memoryApi.representation('scene-1')
    await memoryApi.recallCycles(20)
    await memoryApi.recallCycle('cycle-1')
    await memoryApi.correct({
      memoryId: 'scene-1',
      replacement: { form: 'scene', data: {} },
      explanation: 'the owner corrected the scene',
      ownerId: 'owner-1',
    })
    await memoryApi.restrictInfluence({ memoryId: 'scene-1', surfaces: ['recall'], reason: 'limit', ownerId: 'owner-1' })
    await memoryApi.revokeInfluence({ memoryId: 'scene-1', reason: 'withdraw', ownerId: 'owner-1' })
    await memoryApi.erasePreview(['scene-1'])
    await memoryApi.eraseAuthorize({ rootMemoryIds: ['scene-1'], ownerId: 'owner-1' })
    await memoryApi.eraseCommit({ authorizationId: 'auth-1', ownerId: 'owner-1' })

    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:8320/api/memory/scenes', expect.objectContaining({ method: 'GET' }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:8320/api/memory/representations/scene-1', expect.objectContaining({ method: 'GET' }))
    expect(fetchMock).toHaveBeenNthCalledWith(3, 'http://127.0.0.1:8320/api/memory/recall?limit=20', expect.objectContaining({ method: 'GET' }))
    expect(fetchMock).toHaveBeenNthCalledWith(4, 'http://127.0.0.1:8320/api/memory/recall/cycle-1', expect.objectContaining({ method: 'GET' }))
    expect(fetchMock).toHaveBeenNthCalledWith(5, 'http://127.0.0.1:8320/api/memory/corrections', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        memoryId: 'scene-1',
        replacement: { form: 'scene', data: {} },
        explanation: 'the owner corrected the scene',
        ownerId: 'owner-1',
      }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(6, 'http://127.0.0.1:8320/api/memory/influence/restrict', expect.objectContaining({ method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(7, 'http://127.0.0.1:8320/api/memory/influence/revoke', expect.objectContaining({ method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(8, 'http://127.0.0.1:8320/api/memory/erase/preview', expect.objectContaining({ method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(9, 'http://127.0.0.1:8320/api/memory/erase/authorize', expect.objectContaining({ method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(10, 'http://127.0.0.1:8320/api/memory/erase/commit', expect.objectContaining({ method: 'POST' }))
  })
})
