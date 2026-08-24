import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  api,
  getBrowserBaseUrl,
  getDefaultBaseUrl,
  setAuthToken,
  setBaseUrl,
  setServerConnectionRefresher,
} from './client'

afterEach(() => {
  setAuthToken('')
  setBaseUrl(getDefaultBaseUrl())
  setServerConnectionRefresher(null)
  vi.restoreAllMocks()
})

describe('desktop API client authentication', () => {
  it('uses the current browser origin when no server URL is configured', () => {
    expect(getBrowserBaseUrl()).toBe(window.location.origin)
  })

  it('sends the ephemeral local server token without putting it in the URL', async () => {
    setBaseUrl('http://127.0.0.1:45678')
    setAuthToken('desktop-secret')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ ok: true }),
    )

    await api.get('/api/status')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:45678/api/status',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer desktop-secret',
        }),
      }),
    )
  })

  it('refreshes the local sidecar connection and retries a failed GET once', async () => {
    setBaseUrl('http://127.0.0.1:45678')
    setAuthToken('stale-secret')
    const refreshConnection = vi.fn().mockResolvedValue({
      url: 'http://127.0.0.1:56789',
      authToken: 'fresh-secret',
    })
    setServerConnectionRefresher(refreshConnection)
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockResolvedValueOnce(Response.json({ ok: true }))

    await expect(api.get('/api/sessions')).resolves.toEqual({ ok: true })

    expect(refreshConnection).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:45678/api/sessions',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer stale-secret' }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:56789/api/sessions',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer fresh-secret' }),
      }),
    )
  })

  it('rawPostJson sends a binary body and parses the JSON response', async () => {
    setBaseUrl('http://127.0.0.1:45678')
    const pdf = new Blob(['%PDF'], { type: 'application/pdf' })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ path: 'assets/doc.pdf', url: '/api/notes/assets/assets/doc.pdf' }),
    )

    await expect(api.rawPostJson('/api/notes/assets/raw?fileName=doc.pdf', pdf)).resolves.toEqual({
      path: 'assets/doc.pdf',
      url: '/api/notes/assets/assets/doc.pdf',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:45678/api/notes/assets/raw?fileName=doc.pdf',
      expect.objectContaining({ method: 'POST', body: pdf }),
    )
  })

  it('does not replay mutation requests after a connection error', async () => {
    const refreshConnection = vi.fn().mockResolvedValue({
      url: 'http://127.0.0.1:56789',
      authToken: 'fresh-secret',
    })
    setServerConnectionRefresher(refreshConnection)
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Load failed'))

    await expect(api.post('/api/messages', { content: 'hello' })).rejects.toThrow('Load failed')

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(refreshConnection).not.toHaveBeenCalled()
  })
})
