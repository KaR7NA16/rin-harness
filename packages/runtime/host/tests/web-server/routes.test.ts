import { describe, expect, test } from 'vitest'
import { routeApi } from '../../src/web-server/routes.ts'

const config = { port: 8320, host: '127.0.0.1', repositoryRoot: '/repo', knowledgeDbPath: '/tmp/kb.db', knowledgeSourcesRoots: ['/sources'] }

function services(overrides: Record<string, () => unknown> = {}) {
  const base: Record<string, () => unknown> = {
    repository: () => undefined,
    environment: () => undefined,
    filesystem: () => undefined,
    sessionBackup: () => undefined,
    memory: () => undefined,
    smartPruning: () => undefined,
    knowledge: () => undefined,
    knowledgeGraph: () => undefined,
    sessionSearch: () => undefined,
    promptMemory: () => undefined,
    evolution: () => undefined,
    skillMemory: () => undefined,
    agents: () => undefined,
    notes: () => undefined,
    sandboxes: () => undefined,
    tokenOptimization: () => undefined,
    codegraph: () => undefined,
    plugins: () => undefined,
    providerProbe: () => undefined,
    sessions: () => undefined,
    sessionPersistence: () => undefined,
    dshAgents: () => undefined,
    agentDefaultModel: () => undefined,
    llm: () => undefined,
    credentials: () => undefined,
    workspaceRegistry: () => undefined,
    commands: () => undefined,
    tokenMeter: () => undefined,
    sessionProjections: () => undefined,
    shell: () => undefined,
    mcp: () => undefined,
    teams: () => undefined,
    tasks: () => undefined,
    computerUse: () => undefined,
    agentMigration: () => undefined,
    doctor: () => undefined,
  }
  return { ...base, ...overrides }
}

describe('routeApi dispatch', () => {
  test('unknown pathname returns null', async () => {
    expect(await routeApi('/api/unknown', '', 'GET', undefined, services(), config)).toBeNull()
  })

  test('dispatches core pathname', async () => {
    const res = await routeApi('/api/health', '', 'GET', undefined, services(), config)
    expect(res?.status).toBe(200)
    expect(res?.body.name).toBe('rin-web')
  })

  test('dispatches legacy pathname (teams)', async () => {
    const s = services({ teams: () => ({ async list() { return [{ name: 't' }] } }) })
    const res = await routeApi('/api/teams', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { teams: [{ name: 't' }] } })
  })

  test('dispatches knowledge pathname', async () => {
    const svc = { listSources: () => [{ id: 's1' }], close: () => {} }
    const s = services({ knowledge: () => ({ open: () => svc }) })
    const res = await routeApi('/api/knowledge/sources', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { mounted: true, sources: [{ id: 's1' }] } })
  })

  test('/api/sessions/* is shadowed by legacy (405)', async () => {
    const s = services({ sessionSearch: () => ({ async browse() { return [] } }) })
    const res = await routeApi('/api/sessions/browse', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 405, body: { error: 'method not allowed' } })
  })

  test('dispatches prompt-memory pathname', async () => {
    const s = services({ promptMemory: () => ({ async getStatus() { return { files: {} } } }) })
    const res = await routeApi('/api/prompt-memory/status', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { mounted: true, files: {} } })
  })

  test('dispatches memory cognition queries and generic catalog paths are gone', async () => {
    const field = {
      ownerId: 'rin',
      version: 0,
      updatedAt: '1970-01-01T00:00:00.000Z',
      participants: [],
      goals: [],
      affect: { valence: 0, arousal: 0, control: 0.5 },
      predictions: [],
      predictionErrors: [],
      activeOpenLoops: [],
      candidateActions: [],
      candidateActionSources: [],
      activeMemoryCoalition: [],
      uncertainty: [],
    }
    const memory = {
      getManifest: () => ({ schemaVersion: 2, root: '.', projections: [] }),
      getCurrentField: () => field,
      readCognitionState: () => ({ version: 0, memories: [], erasedMemoryIds: [], links: [] }),
      requestErasePreview: () => ({
        rootMemoryIds: [],
        erasedMemoryIds: [],
        retractedLinkIds: [],
        dependentMemoryIds: [],
        unaffectedMemoryIds: [],
        scopeHash: 'hash',
      }),
      exportCognitionJournal: () => [],
      restoreCognitionJournal: () => 0,
    }
    const s = services({ memory: () => memory })
    expect(await routeApi('/api/memory/manifest', '', 'GET', undefined, s, config)).toEqual({
      status: 200,
      body: { mounted: true, schemaVersion: 2, root: '.', projections: [] },
    })
    expect(await routeApi('/api/memory/field', '', 'GET', undefined, s, config)).toEqual({
      status: 200,
      body: { mounted: true, field },
    })
    expect(await routeApi('/api/memory/scenes', '', 'GET', undefined, s, config)).toEqual({
      status: 200,
      body: { mounted: true, scenes: [] },
    })
    expect(await routeApi('/api/memory/journal', '', 'GET', undefined, s, config)).toEqual({
      status: 200,
      body: { mounted: true, transactions: [] },
    })
    // The generic v1 catalog routes no longer exist (M8-01): they fall through
    // to the router's not-found response instead of serving catalog data.
    expect(await routeApi('/api/memory', '', 'GET', undefined, s, config)).toBeNull()
    expect(await routeApi('/api/memory', '', 'POST', { content: 'legacy' }, s, config)).toBeNull()
    expect(await routeApi('/api/memory/injections', '', 'GET', undefined, s, config)).toBeNull()
    expect(await routeApi('/api/memory/export', '', 'GET', undefined, s, config)).toBeNull()
  })

  test('dispatches evolution pathname', async () => {
    const s = services({ evolution: () => ({ async readConfig() { return {} }, async readState() { return { candidates: [], events: [] } } }) })
    const res = await routeApi('/api/evolution/overview', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { mounted: true, config: {}, pendingCandidates: [], recentCandidates: [], events: [] } })
  })

  test('dispatches skill-memory pathname', async () => {
    const s = services({ skillMemory: () => undefined })
    const res = await routeApi('/api/skill-memory/overview', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { mounted: false } })
  })

  test('dispatches agents pathname (runtime)', async () => {
    const s = services({ agents: () => ({ async listRuntimeAgents() { return [] } }) })
    const res = await routeApi('/api/agents/runtime', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { mounted: true, agents: [] } })
  })

  test('dispatches notes pathname', async () => {
    const s = services({ notes: () => ({ async list() { return [] } }) })
    const res = await routeApi('/api/notes', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { mounted: true, notes: [] } })
  })

  test('dispatches sandboxes pathname', async () => {
    const s = services({ sandboxes: () => ({ async list() { return [] } }) })
    const res = await routeApi('/api/sandboxes', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { mounted: true, sandboxes: [] } })
  })

  test('token-optimization pathnames are claimed by legacy (shadowing)', async () => {
    const s = services({ tokenOptimization: () => ({ getStatus: () => ({ responseStyle: 'off', cleanPrompt: false }) }) })
    const res = await routeApi('/api/token-optimization/status', '', 'GET', undefined, s, config)
    // legacy claims /api/token-optimization/* and returns 404 for unknown sub-endpoints
    expect(res).toEqual({ status: 404, body: { error: 'unknown token optimization endpoint' } })
  })

  test('POST knowledge write route forwards', async () => {
    const svc = { async addSources(paths: string[]) { return paths.map(p => ({ id: p })) }, close: () => {} }
    const s = services({ knowledge: () => ({ open: () => svc }) })
    const res = await routeApi('/api/knowledge/sources', '', 'POST', { paths: ['/a'] }, s, config)
    expect(res).toEqual({ status: 200, body: [{ id: '/a' }] })
  })
})
