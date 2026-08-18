import { afterEach, describe, expect, it, vi } from 'vitest'
import { knowledgeGraphApi } from './knowledgeGraph'
import { getDefaultBaseUrl, setAuthToken, setBaseUrl } from './client'

afterEach(() => {
  setAuthToken('')
  setBaseUrl(getDefaultBaseUrl())
  vi.restoreAllMocks()
})

describe('knowledgeGraphApi', () => {
  it('builds the graph URL from query filters', async () => {
    setBaseUrl('http://127.0.0.1:45678')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ mounted: true, graph: { nodes: [], edges: [], refreshedAt: 'x' } }),
    )

    await knowledgeGraphApi.graph({
      sources: ['notes', 'knowledge'],
      kinds: ['note', 'tag'],
      pathPrefix: 'work',
      limit: 500,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:45678/api/knowledge-graph/graph?sources=notes%2Cknowledge&kinds=note%2Ctag&pathPrefix=work&limit=500',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('omits empty filters from the graph URL', async () => {
    setBaseUrl('http://127.0.0.1:45678')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ mounted: true, graph: { nodes: [], edges: [], refreshedAt: 'x' } }),
    )

    await knowledgeGraphApi.graph({})

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:45678/api/knowledge-graph/graph',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('builds the related URL with node and depth', async () => {
    setBaseUrl('http://127.0.0.1:45678')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ mounted: true, graph: { nodes: [], edges: [], refreshedAt: 'x' } }),
    )

    await knowledgeGraphApi.related('note:a.md', 2)

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:45678/api/knowledge-graph/related?node=note%3Aa.md&depth=2',
      expect.objectContaining({ method: 'GET' }),
    )
  })
})
