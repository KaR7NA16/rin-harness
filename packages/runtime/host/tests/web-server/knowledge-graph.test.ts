import { describe, expect, test } from 'vitest'
import { handle } from '../../src/web-server/routes/knowledge-graph.ts'

const config = { port: 8320, host: '127.0.0.1' }

const snapshot = { nodes: [], edges: [], refreshedAt: '2026-01-01T00:00:00.000Z' }

interface FakeKnowledgeGraph {
  graph(query?: unknown): Promise<typeof snapshot>
  related(nodeId: string, depth?: number): Promise<typeof snapshot>
}

function makeService(overrides: Partial<FakeKnowledgeGraph> = {}): FakeKnowledgeGraph {
  return {
    graph: async () => snapshot,
    related: async () => snapshot,
    ...overrides,
  }
}

function services(service?: FakeKnowledgeGraph) {
  return { knowledgeGraph: () => service }
}

describe('knowledge-graph: dispatch', () => {
  test('unknown pathname returns null', async () => {
    expect(await handle('/api/knowledge-graph/unknown', '', 'GET', undefined, services(), config)).toBeNull()
  })
})

describe('knowledge-graph: graph', () => {
  test('unmounted returns notMounted', async () => {
    const res = await handle('/api/knowledge-graph/graph', '', 'GET', undefined, services(), config)
    expect(res).toEqual({ status: 200, body: { mounted: false } })
  })

  test('forwards sources, kinds, pathPrefix, and limit', async () => {
    const svc = makeService()
    let captured: unknown
    svc.graph = async (query) => { captured = query; return snapshot }
    const res = await handle(
      '/api/knowledge-graph/graph',
      '?sources=notes,knowledge,repository,codegraph,session,filesystem&kinds=note,tag,knowledge_source,knowledge_document,repository_agent,repository_environment,repository_package,code_file,code_symbol,session,file&pathPrefix=work&limit=3',
      'GET',
      undefined,
      services(svc),
      config,
    )
    expect(res).toEqual({ status: 200, body: { mounted: true, graph: snapshot } })
    expect(captured).toEqual({
      sources: ['notes', 'knowledge', 'repository', 'codegraph', 'session', 'filesystem'],
      kinds: ['note', 'tag', 'knowledge_source', 'knowledge_document', 'repository_agent', 'repository_environment', 'repository_package', 'code_file', 'code_symbol', 'session', 'file'],
      pathPrefix: 'work',
      limit: 3,
    })
  })

  test('drops unknown sources and kinds', async () => {
    const svc = makeService()
    let captured: unknown
    svc.graph = async (query) => { captured = query; return snapshot }
    await handle('/api/knowledge-graph/graph', '?sources=notes,bogus&kinds=note,bogus', 'GET', undefined, services(svc), config)
    expect(captured).toEqual({ sources: ['notes'], kinds: ['note'] })
  })

  test('drops an invalid limit', async () => {
    const svc = makeService()
    let captured: unknown
    svc.graph = async (query) => { captured = query; return snapshot }
    await handle('/api/knowledge-graph/graph', '?limit=abc', 'GET', undefined, services(svc), config)
    expect(captured).toEqual({})
  })

  test('graph failure returns 500', async () => {
    const svc = makeService({ graph: async () => { throw new Error('graph failed') } })
    const res = await handle('/api/knowledge-graph/graph', '', 'GET', undefined, services(svc), config)
    expect(res).toEqual({ status: 500, body: { error: 'graph failed' } })
  })
})

describe('knowledge-graph: related', () => {
  test('missing node returns 400', async () => {
    const res = await handle('/api/knowledge-graph/related', '', 'GET', undefined, services(makeService()), config)
    expect(res).toEqual({ status: 400, body: { error: 'node is required; pass ?node=<id>' } })
  })

  test('forwards node and depth', async () => {
    const svc = makeService()
    let nodeArg = ''
    let depthArg: number | undefined
    svc.related = async (node, depth) => { nodeArg = node; depthArg = depth; return snapshot }
    const res = await handle('/api/knowledge-graph/related', '?node=note:a.md&depth=2', 'GET', undefined, services(svc), config)
    expect(res).toEqual({ status: 200, body: { mounted: true, graph: snapshot } })
    expect(nodeArg).toBe('note:a.md')
    expect(depthArg).toBe(2)
  })

  test('related failure returns 500', async () => {
    const svc = makeService({ related: async () => { throw new Error('related failed') } })
    const res = await handle('/api/knowledge-graph/related', '?node=note:a.md', 'GET', undefined, services(svc), config)
    expect(res).toEqual({ status: 500, body: { error: 'related failed' } })
  })
})
