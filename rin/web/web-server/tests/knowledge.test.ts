import { describe, expect, test } from 'vitest'
import { handle } from '../src/routes/knowledge.ts'

const config = { port: 8320, host: '127.0.0.1', knowledgeDbPath: '/tmp/kb.db', knowledgeSourcesRoots: ['/sources'] }

interface FakeKnowledge {
  listSources(): unknown[]
  listDocuments(opts: unknown): unknown[]
  search(q: string, opts: unknown): unknown[]
  getStats(): Record<string, unknown>
  addSources(paths: string[]): Promise<unknown[]>
  removeSource(id: string): boolean
  reindexSource(id: string): Promise<unknown>
  close(): void
}

function makeService(overrides: Partial<FakeKnowledge> = {}): FakeKnowledge {
  return {
    listSources: () => [{ id: 's1' }],
    listDocuments: () => [{ id: 'd1' }],
    search: () => [{ id: 'd1' }],
    getStats: () => ({ documents: 1 }),
    addSources: async (paths) => paths.map(p => ({ id: p })),
    removeSource: () => true,
    reindexSource: async (id) => ({ id, status: 'indexing' }),
    close: () => {},
    ...overrides,
  }
}

function services(service?: FakeKnowledge) {
  const store = {
    open(_dbPath: string) {
      return service
    },
  }
  return { knowledge: () => (service === undefined ? undefined : store) }
}

describe('knowledge: dispatch', () => {
  test('unknown pathname returns null', async () => {
    expect(await handle('/api/knowledge/unknown', '', 'GET', undefined, services(), config)).toBeNull()
  })
})

describe('knowledge: sources list', () => {
  test('unmounted returns notMounted', async () => {
    const res = await handle('/api/knowledge/sources', '', 'GET', undefined, services(), config)
    expect(res).toEqual({ status: 200, body: { mounted: false } })
  })

  test('missing db path returns 400', async () => {
    const res = await handle('/api/knowledge/sources', '', 'GET', undefined, services(makeService()), { ...config, knowledgeDbPath: undefined })
    expect(res).toEqual({ status: 400, body: { error: 'knowledge database path not configured; pass ?db=' } })
  })

  test('open failure returns 500', async () => {
    const store = { open() { throw new Error('open failed') } }
    const res = await handle('/api/knowledge/sources', '', 'GET', undefined, { knowledge: () => store }, config)
    expect(res).toEqual({ status: 500, body: { error: 'open failed' } })
  })

  test('GET lists sources and closes the service', async () => {
    const svc = makeService()
    let closed = false
    svc.close = () => { closed = true }
    const res = await handle('/api/knowledge/sources', '', 'GET', undefined, services(svc), config)
    expect(res).toEqual({ status: 200, body: { mounted: true, sources: [{ id: 's1' }] } })
    expect(closed).toBe(true)
  })

  test('db query param overrides config path', async () => {
    let openedPath = ''
    const store = { open(dbPath: string) { openedPath = dbPath; return makeService() } }
    await handle('/api/knowledge/sources', '?db=/tmp/override.db', 'GET', undefined, { knowledge: () => store }, config)
    expect(openedPath).toBe('/tmp/override.db')
  })

  test('db query param outside the configured directory returns 400', async () => {
    const res = await handle('/api/knowledge/sources', '?db=/etc/passwd', 'GET', undefined, services(makeService()), config)
    expect(res).toEqual({ status: 400, body: { error: 'knowledge database path must stay within the configured knowledge directory' } })
  })

  test('db query param with traversal returns 400', async () => {
    const res = await handle('/api/knowledge/sources', '?db=/tmp/../etc/passwd', 'GET', undefined, services(makeService()), config)
    expect(res).toEqual({ status: 400, body: { error: 'knowledge database path must stay within the configured knowledge directory' } })
  })

  test('db query param without a configured path returns 400', async () => {
    const res = await handle('/api/knowledge/sources', '?db=/tmp/x.db', 'GET', undefined, services(makeService()), { ...config, knowledgeDbPath: undefined })
    expect(res).toEqual({ status: 400, body: { error: 'knowledge database path override requires a configured knowledgeDbPath' } })
  })

  test('wrong method returns 405', async () => {
    const res = await handle('/api/knowledge/sources', '', 'DELETE', undefined, services(makeService()), config)
    expect(res?.status).toBe(405)
  })
})

describe('knowledge: documents', () => {
  test('lists documents with optional sourceId and limit', async () => {
    const svc = makeService()
    let opts: unknown
    svc.listDocuments = (o) => { opts = o; return [{ id: 'd1' }] }
    const res = await handle('/api/knowledge/documents', '?sourceId=s1&limit=5', 'GET', undefined, services(svc), config)
    expect(res).toEqual({ status: 200, body: { mounted: true, documents: [{ id: 'd1' }] } })
    expect(opts).toEqual({ sourceId: 's1', limit: 5 })
  })

  test('invalid limit is dropped', async () => {
    const svc = makeService()
    let opts: unknown
    svc.listDocuments = (o) => { opts = o; return [] }
    await handle('/api/knowledge/documents', '?limit=abc', 'GET', undefined, services(svc), config)
    expect(opts).toEqual({})
  })
})

describe('knowledge: search', () => {
  test('missing query returns 400', async () => {
    const res = await handle('/api/knowledge/search', '', 'GET', undefined, services(makeService()), config)
    expect(res).toEqual({ status: 400, body: { error: 'query is required; pass ?query=' } })
  })

  test('searches with query and limit', async () => {
    const svc = makeService()
    let q = ''
    let opts: unknown
    svc.search = (query, o) => { q = query; opts = o; return [{ id: 'd1' }] }
    const res = await handle('/api/knowledge/search', '?query=hello&limit=3', 'GET', undefined, services(svc), config)
    expect(res).toEqual({ status: 200, body: { mounted: true, results: [{ id: 'd1' }] } })
    expect(q).toBe('hello')
    expect(opts).toEqual({ limit: 3 })
  })
})

describe('knowledge: stats', () => {
  test('returns stats', async () => {
    const res = await handle('/api/knowledge/stats', '', 'GET', undefined, services(makeService()), config)
    expect(res).toEqual({ status: 200, body: { mounted: true, documents: 1 } })
  })
})

describe('knowledge: addSources', () => {
  test('forwards paths and returns result', async () => {
    const svc = makeService()
    const res = await handle('/api/knowledge/sources', '', 'POST', { paths: ['/a', '/b'] }, services(svc), config)
    expect(res).toEqual({ status: 200, body: [{ id: '/a' }, { id: '/b' }] })
  })

  test('forwards allowedRoots to addSources', async () => {
    let options: unknown
    const svc = makeService({ addSources: async (paths: string[], opts: unknown) => { options = opts; return paths.map(p => ({ id: p })) } })
    await handle('/api/knowledge/sources', '', 'POST', { paths: ['/a'] }, services(svc), config)
    expect(options).toEqual({ allowedRoots: ['/sources'] })
  })

  test('addSources without a configured sources root returns 400', async () => {
    const res = await handle('/api/knowledge/sources', '', 'POST', { paths: ['/a'] }, services(makeService()), { ...config, knowledgeSourcesRoots: undefined })
    expect(res).toEqual({ status: 400, body: { error: 'knowledge sources root is not configured; set Config.knowledgeSourcesRoots' } })
  })

  test('wrong method returns 405', async () => {
    const res = await handle('/api/knowledge/sources', '', 'PUT', { paths: ['/a'] }, services(makeService()), config)
    expect(res?.status).toBe(405)
  })

  test('non-object body returns 400', async () => {
    const res = await handle('/api/knowledge/sources', '', 'POST', 'x', services(makeService()), config)
    expect(res).toEqual({ status: 400, body: { error: 'request body must be a JSON object' } })
  })

  test('missing paths returns 400', async () => {
    const res = await handle('/api/knowledge/sources', '', 'POST', {}, services(makeService()), config)
    expect(res?.status).toBe(400)
  })

  test('empty paths returns 400', async () => {
    const res = await handle('/api/knowledge/sources', '', 'POST', { paths: [] }, services(makeService()), config)
    expect(res?.status).toBe(400)
  })

  test('non-string path returns 400', async () => {
    const res = await handle('/api/knowledge/sources', '', 'POST', { paths: ['', 42] }, services(makeService()), config)
    expect(res?.status).toBe(400)
  })

  test('addSources failure returns 500', async () => {
    const svc = makeService({ addSources: async () => { throw new Error('add failed') } })
    const res = await handle('/api/knowledge/sources', '', 'POST', { paths: ['/a'] }, services(svc), config)
    expect(res).toEqual({ status: 500, body: { error: 'add failed' } })
  })
})

describe('knowledge: removeSource', () => {
  test('forwards id', async () => {
    const svc = makeService()
    let removed = ''
    svc.removeSource = (id) => { removed = id; return true }
    const res = await handle('/api/knowledge/sources/src-a', '', 'DELETE', undefined, services(svc), config)
    expect(res).toEqual({ status: 200, body: { removed: true } })
    expect(removed).toBe('src-a')
  })

  test('wrong method returns 405', async () => {
    const res = await handle('/api/knowledge/sources/src-a', '', 'GET', undefined, services(makeService()), config)
    expect(res?.status).toBe(405)
  })

  test('malformed id returns 400', async () => {
    const res = await handle('/api/knowledge/sources/%E0%A4%A', '', 'DELETE', undefined, services(makeService()), config)
    expect(res).toEqual({ status: 400, body: { error: 'invalid knowledge source id' } })
  })
})

describe('knowledge: reindexSource', () => {
  test('forwards id and returns result', async () => {
    const svc = makeService()
    let idx = ''
    svc.reindexSource = async (id) => { idx = id; return { id, status: 'indexing' } }
    const res = await handle('/api/knowledge/sources/src-a/reindex', '', 'POST', undefined, services(svc), config)
    expect(res).toEqual({ status: 200, body: { id: 'src-a', status: 'indexing' } })
    expect(idx).toBe('src-a')
  })

  test('wrong method returns 405', async () => {
    const res = await handle('/api/knowledge/sources/src-a/reindex', '', 'GET', undefined, services(makeService()), config)
    expect(res?.status).toBe(405)
  })

  test('reindex failure returns 500', async () => {
    const svc = makeService({ reindexSource: async () => { throw new Error('reindex failed') } })
    const res = await handle('/api/knowledge/sources/src-a/reindex', '', 'POST', undefined, services(svc), config)
    expect(res).toEqual({ status: 500, body: { error: 'reindex failed' } })
  })
})
