import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { handle } from '../src/routes/legacy.ts'

const config = { port: 8320, host: '127.0.0.1', repositoryRoot: '/repo' }

let rinHome: string
beforeEach(async () => {
  rinHome = await mkdtemp(join(tmpdir(), 'rin-legacy-'))
  process.env.RIN_HOME = rinHome
})
afterEach(async () => {
  delete process.env.RIN_HOME
  await rm(rinHome, { recursive: true, force: true })
})

function makeServices(overrides: Record<string, () => unknown> = {}) {
  const base: Record<string, () => unknown> = {
    repository: () => undefined,
    environment: () => undefined,
    smartPruning: () => undefined,
    knowledge: () => undefined,
    sessionSearch: () => undefined,
    promptMemory: () => undefined,
    evolution: () => undefined,
    skillMemory: () => undefined,
    agents: () => undefined,
    notes: () => undefined,
    sandboxes: () => undefined,
    tokenOptimization: () => undefined,
    sessions: () => undefined,
    sessionPersistence: () => undefined,
    sessionTitle: () => undefined,
    dshAgents: () => undefined,
    agentDefaultModel: () => undefined,
    settings: () => undefined,
    permissionPresets: () => undefined,
    llm: () => undefined,
    credentials: () => undefined,
    workspaceRegistry: () => undefined,
    commands: () => undefined,
    tokenMeter: () => undefined,
    sessionProjections: () => undefined,
    shell: () => undefined,
    mcp: () => undefined,
    providerProbe: () => undefined,
    teams: () => undefined,
    tasks: () => undefined,
    computerUse: () => undefined,
    agentMigration: () => undefined,
    filesystem: () => undefined,
    sessionBackup: () => undefined,
    memory: () => undefined,
    plugins: () => undefined,
    codegraph: () => undefined,
  }
  return { ...base, ...overrides }
}

describe('legacy: dispatch fallthrough', () => {
  test('unknown pathname returns null', async () => {
    expect(await handle('/api/does-not-exist', '', 'GET', undefined, makeServices(), config)).toBeNull()
  })
})

describe('legacy: filesystem file routes', () => {
  test('stat forwards to the filesystem service', async () => {
    let path = ''
    const s = makeServices({ filesystem: () => ({ async stat(p: string) { path = p; return { path: p, name: 'a.pdf', isDirectory: false, sizeBytes: 1, modifiedAt: 0, mimeType: 'application/pdf' } } }) })
    const res = await handle('/api/filesystem/stat', '?path=/tmp/a.pdf', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { path: '/tmp/a.pdf', name: 'a.pdf', isDirectory: false, sizeBytes: 1, modifiedAt: 0, mimeType: 'application/pdf' } })
    expect(path).toBe('/tmp/a.pdf')
  })

  test('stat requires path and returns unmounted cleanly', async () => {
    expect(await handle('/api/filesystem/stat', '', 'GET', undefined, makeServices(), config)).toEqual({ status: 400, body: { error: 'path is required' } })
    const s = makeServices({ filesystem: () => undefined })
    expect(await handle('/api/filesystem/stat', '?path=/tmp/a.pdf', 'GET', undefined, s, config)).toEqual({ status: 200, body: { mounted: false } })
  })

  test('text forwards maxBytes and reports access errors', async () => {
    let maxBytes: number | undefined
    const s = makeServices({ filesystem: () => ({ async readText(p: string, m?: number) { maxBytes = m; return { path: p, content: 'hello', truncated: false, sizeBytes: 5, mimeType: 'text/plain' } } }) })
    const res = await handle('/api/filesystem/text', '?path=/tmp/a.txt&maxBytes=3', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { path: '/tmp/a.txt', content: 'hello', truncated: false, sizeBytes: 5, mimeType: 'text/plain' } })
    expect(maxBytes).toBe(3)
    const denied = makeServices({ filesystem: () => ({ async readText() { throw new Error('Access denied: path outside allowed directory') } }) })
    expect(await handle('/api/filesystem/text', '?path=/etc/passwd', 'GET', undefined, denied, config)).toEqual({ status: 403, body: { error: 'Access denied: path outside allowed directory' } })
  })
})

describe('legacy: repositories', () => {
  const conn = { id: 'r1', name: 'Repo 1', rootPath: '/r', createdAt: '2026-01-01', updatedAt: '2026-01-01', environmentPackages: [], environmentProfiles: [{ id: 'e1' }] }

  test('list requires repository service', async () => {
    const res = await handle('/api/repositories', '', 'GET', undefined, makeServices(), config)
    expect(res).toEqual({ status: 200, body: { mounted: false } })
  })

  test('list returns connections', async () => {
    const s = makeServices({ repository: () => ({ listConnections: async () => [conn] }) })
    const res = await handle('/api/repositories', '', 'GET', undefined, s, config)
    expect(res?.status).toBe(200)
    expect(res?.body.repositories[0].id).toBe('r1')
    expect(res?.body.repositories[0].rootPath).toBe('/r')
  })

  test('list auto-connects the builtin repository when empty', async () => {
    let connectedPath: string | undefined
    const s = makeServices({ repository: () => ({
      listConnections: async () => connectedPath === undefined ? [] : [conn],
      connectRepository: async (path: string) => { connectedPath = path; return conn },
    }) })
    const res = await handle('/api/repositories', '', 'GET', undefined, s, config)
    expect(res?.status).toBe(200)
    expect(connectedPath?.endsWith('core/repository/builtin/')).toBe(true)
    expect(res?.body.repositories[0].id).toBe('r1')
  })

  test('list connect failure returns 500', async () => {
    const s = makeServices({ repository: () => ({
      listConnections: async () => [],
      connectRepository: async () => { throw new Error('bad repo') },
    }) })
    const res = await handle('/api/repositories', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 500, body: { error: 'bad repo' } })
  })

  test('connect requires path', async () => {
    const res = await handle('/api/repositories/connect', '', 'POST', {}, makeServices(), config)
    expect(res).toEqual({ status: 400, body: { error: 'path is required' } })
  })

  test('connect returns connection', async () => {
    const s = makeServices({ repository: () => ({ connectRepository: async () => conn }) })
    const res = await handle('/api/repositories/connect', '', 'POST', { path: '/r' }, s, config)
    expect(res?.status).toBe(200)
    expect(res?.body.id).toBe('r1')
  })

  test('create returns connection', async () => {
    const s = makeServices({ repository: () => ({ createRepository: async () => conn }) })
    const res = await handle('/api/repositories/create', '', 'POST', { parentDir: '/p', name: 'n' }, s, config)
    expect(res?.status).toBe(200)
    expect(res?.body.id).toBe('r1')
  })

  test('item GET returns connection', async () => {
    const s = makeServices({ repository: () => ({ getConnection: async () => conn }) })
    const res = await handle('/api/repositories/r1', '', 'GET', undefined, s, config)
    expect(res?.status).toBe(200)
    expect(res?.body.id).toBe('r1')
  })

  test('item unknown id returns 404', async () => {
    const s = makeServices({ repository: () => ({ getConnection: async () => undefined }) })
    const res = await handle('/api/repositories/other', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 404, body: { error: 'repository not found' } })
  })

  test('item DELETE returns disconnected', async () => {
    const s = makeServices({ repository: () => ({ disconnectRepository: async () => true }) })
    const res = await handle('/api/repositories/r1', '', 'DELETE', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { disconnected: true } })
  })

  test('environment-profiles reads connection', async () => {
    const s = makeServices({ repository: () => ({ getConnection: async () => conn }) })
    const res = await handle('/api/repositories/r1/environment-profiles', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { repositoryId: 'r1', profiles: [{ id: 'e1' }] } })
  })

  test('manifest returns unknown action', async () => {
    const s = makeServices({ repository: () => ({}) })
    const res = await handle('/api/repositories/r1/manifest', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 404, body: { error: 'unknown repository action' } })
  })

  test('resolve-environment plans', async () => {
    let captured: unknown
    const s = makeServices({ environment: () => ({ async plan(root: string, profile: string, caps: unknown) { captured = { root, profile, caps }; return { plan: true } } }) })
    const res = await handle('/api/repositories/builtin/resolve-environment', '', 'GET', { profileId: 'p', root: '/r', capabilities: { platform: 'linux', runtimes: { apt: true } } }, s, config)
    expect(res).toEqual({ status: 200, body: { plan: true } })
    expect(captured).toEqual({
      root: '/r',
      profile: 'p',
      caps: { platform: 'linux', runtimes: { apt: true, python: false, pip: false, r: false, npm: false, tlmgr: false } },
    })
  })

  test('resolve-environment missing profileId returns 400', async () => {
    const res = await handle('/api/repositories/builtin/resolve-environment', '', 'GET', {}, makeServices(), config)
    expect(res).toEqual({ status: 400, body: { error: 'profileId is required' } })
  })

  test('resolve-environment failure returns 400', async () => {
    const s = makeServices({ environment: () => ({ async plan() { throw new Error('bad') } }) })
    const res = await handle('/api/repositories/builtin/resolve-environment', '', 'GET', { profileId: 'p' }, s, config)
    expect(res).toEqual({ status: 400, body: { error: 'bad' } })
  })

  test('unknown repository action returns 404', async () => {
    const s = makeServices({ repository: () => ({ getConnection: async () => conn }) })
    const res = await handle('/api/repositories/r1/unknown-action', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 404, body: { error: 'unknown repository action' } })
  })
})

describe('legacy: sessions', () => {
  test('create requires session service', async () => {
    const res = await handle('/api/sessions', '', 'POST', {}, makeServices(), config)
    expect(res).toEqual({ status: 500, body: { error: 'session service is not mounted' } })
  })

  test('create returns new session', async () => {
    const s = makeServices({ sessions: () => ({ create() { return { id: 's-new-12345678', events: [] } }, prepare() { return { id: 's-new-12345678', events: [] } } }) })
    const res = await handle('/api/sessions', '', 'POST', { workDir: '/w' }, s, config)
    expect(res?.status).toBe(200)
    expect(res?.body.sessionId).toBe('s-new-12345678')
    expect(res?.body.session.workDir).toBe('/w')
  })

  test('list merges persistence and live sessions', async () => {
    const s = makeServices({
      sessions: () => ({ list: () => [{ id: 'live-1', events: [{ type: 'user/message', seq: 1, time: 1000, data: {} }] }], get: () => undefined }),
      sessionPersistence: () => ({ list: async () => [{ id: 'persisted-1', createdAt: 1000, cwd: '/p' }] }),
    })
    const res = await handle('/api/sessions', '', 'GET', undefined, s, config)
    expect(res?.status).toBe(200)
    expect(res?.body.total).toBe(2)
    expect(res?.body.sessions.map((r: { id: string }) => r.id)).toEqual(['persisted-1', 'live-1'])
  })

  test('list wrong method returns 405', async () => {
    const res = await handle('/api/sessions', '', 'PUT', undefined, makeServices(), config)
    expect(res).toEqual({ status: 405, body: { error: 'method not allowed' } })
  })

  test('list persistence failure returns 500', async () => {
    const s = makeServices({ sessionPersistence: () => ({ list: async () => { throw new Error('boom') } }) })
    const res = await handle('/api/sessions', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 500, body: { error: 'boom' } })
  })

  test('item messages projects events', async () => {
    const events = [
      { type: 'user/message', seq: 1, time: 1000, data: { content: 'hi' } },
      { type: 'assistant/message', seq: 2, time: 2000, data: { message: { content: [{ type: 'reasoning', text: 'think' }, { type: 'tool-call', id: 't1', name: 'tool', arguments: { a: 1 } }, { type: 'text', text: 'out' }], source: { model: 'm1' } } } },
      { type: 'tool/call', seq: 3, time: 3000, data: { callId: 'c1', name: 'tool', arguments: '{"x":1}' } },
      { type: 'tool/result', seq: 4, time: 4000, data: { message: { content: [{ toolCallId: 'c1', content: 'result' }] } } },
      { type: 'unknown', seq: 5, time: 5000, data: {} },
    ]
    const s = makeServices({ sessions: () => ({ get: () => ({ id: 's1', events }) }) })
    const res = await handle('/api/sessions/s1/messages', '', 'GET', undefined, s, config)
    expect(res?.status).toBe(200)
    expect(res?.body.messages.length).toBe(4)
    expect(res?.body.messages[0].type).toBe('user')
    expect(res?.body.messages[1].type).toBe('assistant')
    expect(res?.body.messages[1].content).toEqual([
      { type: 'thinking', thinking: 'think' },
      { type: 'tool_use', id: 't1', name: 'tool', input: { a: 1 } },
      { type: 'text', text: 'out' },
    ])
    expect(res?.body.messages[2].type).toBe('tool_use')
    expect(res?.body.messages[3].type).toBe('tool_result')
  })

  test('item messages with persistence prepare', async () => {
    let prepared = false
    let sessionReady = false
    const s = makeServices({
      sessions: () => ({ get: () => sessionReady ? { id: 's2', events: [] } : undefined }),
      sessionPersistence: () => ({ prepare: async () => { prepared = true; sessionReady = true } }),
    })
    const res = await handle('/api/sessions/s2/messages', '', 'GET', undefined, s, config)
    expect(res?.status).toBe(200)
    expect(prepared).toBe(true)
  })

  test('item messages reads a persisted log read-only via load()', async () => {
    const events = [
      { type: 'user/message', seq: 1, time: 1000, data: { content: 'persisted hi' } },
    ]
    let loaded = false
    const s = makeServices({
      sessions: () => ({ get: () => undefined }),
      sessionPersistence: () => ({
        load: async () => { loaded = true; return { meta: { id: 's3' }, events } },
      }),
    })
    const res = await handle('/api/sessions/s3/messages', '', 'GET', undefined, s, config)
    expect(res?.status).toBe(200)
    expect(loaded).toBe(true)
    expect(res?.body.messages).toEqual([
      { id: 'evt-1', type: 'user', content: 'persisted hi', timestamp: new Date(1000).toISOString() },
    ])
  })

  test('item messages load missing session returns 404', async () => {
    const s = makeServices({
      sessions: () => ({ get: () => undefined }),
      sessionPersistence: () => ({ load: async () => { throw new Error('session "s4" not found') } }),
    })
    const res = await handle('/api/sessions/s4/messages', '', 'GET', undefined, s, config)
    expect(res?.status).toBe(404)
  })

  test('item messages missing returns 404', async () => {
    const s = makeServices({ sessions: () => ({ get: () => undefined }) })
    const res = await handle('/api/sessions/s1/messages', '', 'GET', undefined, s, config)
    expect(res?.status).toBe(404)
  })

  test('item inspection returns fixed body', async () => {
    const res = await handle('/api/sessions/s1/inspection', '', 'GET', undefined, makeServices(), config)
    expect(res).toEqual({ status: 200, body: { active: false, status: { sessionId: 's1', workDir: '', permissionMode: 'default' } } })
  })

  test('item rewind/branch require POST', async () => {
    expect(await handle('/api/sessions/s1/rewind', '', 'GET', undefined, makeServices(), config)).toEqual({ status: 405, body: { error: 'method not allowed' } })
    expect(await handle('/api/sessions/s1/branch', '', 'GET', undefined, makeServices(), config)).toEqual({ status: 405, body: { error: 'method not allowed' } })
  })

  test('item unknown action returns 404', async () => {
    const res = await handle('/api/sessions/s1/unknown', '', 'GET', undefined, makeServices(), config)
    expect(res).toEqual({ status: 404, body: { error: 'unknown session action' } })
  })

  test('item PATCH renames a live session', async () => {
    let renamedTitle: string | undefined
    const s = makeServices({
      sessions: () => ({ get: () => ({ id: 's1', events: [] }) }),
      sessionTitle: () => ({ async rename(_session: unknown, title: string) { renamedTitle = title } }),
    })
    const res = await handle('/api/sessions/s1', '', 'PATCH', { title: 'New title' }, s, config)
    expect(res).toEqual({ status: 200, body: { ok: true } })
    expect(renamedTitle).toBe('New title')
  })

  test('item PATCH requires a non-empty title', async () => {
    const s = makeServices({
      sessions: () => ({ get: () => ({ id: 's1', events: [] }) }),
      sessionTitle: () => ({ async rename() {} }),
    })
    expect(await handle('/api/sessions/s1', '', 'PATCH', {}, s, config)).toEqual({ status: 400, body: { error: 'title is required' } })
    expect(await handle('/api/sessions/s1', '', 'PATCH', { title: '   ' }, s, config)).toEqual({ status: 400, body: { error: 'title is required' } })
  })

  test('item PATCH prepares a persisted session before renaming', async () => {
    let prepared = false
    let sessionReady = false
    let renamedTitle: string | undefined
    const s = makeServices({
      sessions: () => ({ get: () => sessionReady ? { id: 's2', events: [] } : undefined }),
      sessionPersistence: () => ({ prepare: async () => { prepared = true; sessionReady = true } }),
      sessionTitle: () => ({ async rename(_session: unknown, title: string) { renamedTitle = title } }),
    })
    const res = await handle('/api/sessions/s2', '', 'PATCH', { title: 'T' }, s, config)
    expect(res).toEqual({ status: 200, body: { ok: true } })
    expect(prepared).toBe(true)
    expect(renamedTitle).toBe('T')
  })

  test('item PATCH missing session returns 404', async () => {
    const s = makeServices({
      sessions: () => ({ get: () => undefined }),
      sessionTitle: () => ({ async rename() {} }),
    })
    const res = await handle('/api/sessions/s1', '', 'PATCH', { title: 'T' }, s, config)
    expect(res).toEqual({ status: 404, body: { error: 'session not found' } })
  })

  test('item PATCH without session title service returns 500', async () => {
    const s = makeServices({ sessions: () => ({ get: () => ({ id: 's1', events: [] }) }) })
    const res = await handle('/api/sessions/s1', '', 'PATCH', { title: 'T' }, s, config)
    expect(res).toEqual({ status: 500, body: { error: 'session title service is not mounted' } })
  })

  test('item DELETE removes the session', async () => {
    const res = await handle('/api/sessions/s1', '', 'DELETE', undefined, makeServices(), config)
    expect(res.status).toBe(200)
    expect((res as { body: { ok: boolean; removed: number } }).body.ok).toBe(true)
    expect((res as { body: { ok: boolean; removed: number } }).body.removed).toBe(0)
    // Deleted id is tombstoned: the list no longer reports it.
    const list = await handle('/api/sessions', '', 'GET', undefined, makeServices(), config)
    expect(JSON.stringify(list)).not.toContain('s1')
  })

  test('item no action wrong method returns 405', async () => {
    const res = await handle('/api/sessions/s1', '', 'GET', undefined, makeServices(), config)
    expect(res).toEqual({ status: 405, body: { error: 'method not allowed' } })
  })

  test('git-info returns branch and repo name', async () => {
    const shell = {
      resolve(req: unknown) { return req },
      async run(spec: { command: string }) {
        if (spec.command.includes('rev-parse')) return { exitCode: 0, stdout: { text: 'main\n' } }
        if (spec.command.includes('remote get-url')) return { exitCode: 0, stdout: { text: 'https://github.com/user/repo.git\n' } }
        if (spec.command.includes('status --porcelain')) return { exitCode: 0, stdout: { text: 'M a\nA b\n' } }
        return { exitCode: 1, stdout: { text: '' } }
      },
    }
    const s = makeServices({
      sessions: () => ({ get: () => ({ id: 's1', events: [], header: { cwd: '/proj' } }) }),
      shell: () => shell,
    })
    const res = await handle('/api/sessions/s1/git-info', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { branch: 'main', repoName: 'repo', workDir: '/proj', changedFiles: 2 } })
  })

  test('git-info without shell returns empty', async () => {
    const s = makeServices({ sessions: () => ({ get: () => ({ id: 's1', events: [], header: { cwd: '/proj' } }) }) })
    const res = await handle('/api/sessions/s1/git-info', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { branch: null, repoName: null, workDir: '/proj', changedFiles: 0 } })
  })

  test('usage projects token usage and context', async () => {
    const s = makeServices({
      sessions: () => ({ get: () => ({ id: 's1', events: [] }) }),
      sessionProjections: () => ({ snapshot: () => ({ asOfSeq: 0, values: { tokenUsage: { uncachedInputTokens: 10, outputTokens: 5, cacheReadTokens: 3, cacheWriteTokens: 2 }, contextPressure: { projectedTokens: 15, contextWindow: 100 } } }) }),
      agentDefaultModel: () => ({ currentSelection: () => ({ provider: 'p', model: 'm1' }) }),
    })
    const res = await handle('/api/sessions/s1/usage', '', 'GET', undefined, s, config)
    expect(res).toEqual({
      status: 200,
      body: {
        usage: { totalInputTokens: 15, totalOutputTokens: 5, totalCacheReadInputTokens: 3, totalCacheCreationInputTokens: 2 },
        context: { model: 'm1', usedTokens: 15, contextWindow: 100, percentage: 15 },
      },
    })
  })

  test('usage without session returns null usage', async () => {
    const res = await handle('/api/sessions/s1/usage', '', 'GET', undefined, makeServices(), config)
    expect(res).toEqual({ status: 200, body: { usage: null, context: null } })
  })

  test('slash-commands lists commands', async () => {
    const s = makeServices({
      dshAgents: () => ({ get: () => ({ id: 'a1' }) }),
      commands: () => ({ list: () => [{ name: 'cmd', description: 'd' }] }),
    })
    const res = await handle('/api/sessions/s1/slash-commands', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { commands: [{ name: 'cmd', description: 'd' }] } })
  })

  test('slash-commands without services returns empty', async () => {
    const res = await handle('/api/sessions/s1/slash-commands', '', 'GET', undefined, makeServices(), config)
    expect(res).toEqual({ status: 200, body: { commands: [] } })
  })
})

describe('legacy: recent projects', () => {
  test('empty without registry', async () => {
    const res = await handle('/api/sessions/recent-projects', '', 'GET', undefined, makeServices(), config)
    expect(res).toEqual({ status: 200, body: { projects: [] } })
  })

  test('projects with git facts', async () => {
    const shell = {
      resolve(req: unknown) { return req },
      async run(spec: { command: string }) {
        if (spec.command.includes('rev-parse')) return { exitCode: 0, stdout: { text: 'main\n' } }
        if (spec.command.includes('remote get-url')) return { exitCode: 0, stdout: { text: 'git@github.com:user/repo.git\n' } }
        return { exitCode: 1, stdout: { text: '' } }
      },
    }
    const s = makeServices({
      workspaceRegistry: () => ({ list: () => [{ id: 'w1', path: '/proj', title: 'Proj', createdAt: 'x', updatedAt: '2026-01-02T00:00:00.000Z', sessionIds: ['a', 'b', 'c'], status: async () => 'ok' }] }),
      shell: () => shell,
    })
    const res = await handle('/api/sessions/recent-projects', '?limit=5', 'GET', undefined, s, config)
    expect(res?.body.projects.length).toBe(1)
    expect(res?.body.projects[0].projectName).toBe('Proj')
    expect(res?.body.projects[0].isGit).toBe(true)
    expect(res?.body.projects[0].repoName).toBe('repo')
    expect(res?.body.projects[0].sessionCount).toBe(3)
  })
})

describe('legacy: notes', () => {
  const notesService = {
    async list() { return [{ path: 'a.md', links: [] }] },
    async read(path: string) { return { path, content: 'body', links: [] } },
    async search(q: string) { return [{ path: 'a.md', q }] },
    async graph() { return { nodes: [] } },
    async todos() { return [{ text: 't' }] },
    async templates() { return [{ id: 't' }] },
    async write(path: string, content: string) { return { path, content } },
    async delete() {},
    async listSnapshots(path: string) { return [{ id: 's1', notePath: path }] },
    async readSnapshot(path: string, id: string) { return { path, id } },
  }

  test('list unmounted returns notMounted', async () => {
    expect(await handle('/api/notes/list', '', 'GET', undefined, makeServices(), config)).toEqual({ status: 200, body: { mounted: false } })
  })

  test('list/search/graph/todos/templates', async () => {
    const s = makeServices({ notes: () => notesService })
    expect(await handle('/api/notes/list', '', 'GET', undefined, s, config)).toEqual({ status: 200, body: { notes: [{ path: 'a.md', links: [] }] } })
    expect(await handle('/api/notes/search', '?q=hi', 'GET', undefined, s, config)).toEqual({ status: 200, body: { results: [{ path: 'a.md', q: 'hi' }] } })
    expect(await handle('/api/notes/graph', '', 'GET', undefined, s, config)).toEqual({ status: 200, body: { nodes: [] } })
    expect(await handle('/api/notes/todos', '', 'GET', undefined, s, config)).toEqual({ status: 200, body: { todos: [{ text: 't' }] } })
    expect(await handle('/api/notes/templates', '', 'GET', undefined, s, config)).toEqual({ status: 200, body: { templates: [{ id: 't' }] } })
  })

  test('notes assets upload', async () => {
    const s = makeServices({ notes: () => ({ async saveAsset(fileName: string, _content: Buffer) { return { path: 'assets/1-' + fileName, url: '/api/notes/assets/assets/1-' + fileName } } }) })
    expect(await handle('/api/notes/assets', '', 'POST', { fileName: 'x.png', base64: 'AAEC' }, s, config)).toEqual({ status: 200, body: { path: 'assets/1-x.png', url: '/api/notes/assets/assets/1-x.png' } })
    expect(await handle('/api/notes/assets', '', 'POST', { fileName: 'x.png' }, s, config)).toEqual({ status: 400, body: { error: 'fileName and base64 are required' } })
    expect(await handle('/api/notes/assets', '', 'GET', undefined, s, config)).toEqual({ status: 405, body: { error: 'method not allowed' } })
  })

  test('note GET/PUT/DELETE', async () => {
    const s = makeServices({ notes: () => notesService })
    expect(await handle('/api/notes/note/a.md', '', 'GET', undefined, s, config)).toEqual({ status: 200, body: { path: 'a.md', content: 'body', links: [] } })
    expect(await handle('/api/notes/note/a.md', '', 'PUT', { content: 'x' }, s, config)).toEqual({ status: 200, body: { path: 'a.md', content: 'x' } })
    expect(await handle('/api/notes/note/a.md', '', 'DELETE', undefined, s, config)).toEqual({ status: 200, body: { removed: true } })
    expect(await handle('/api/notes/note/a.md', '', 'PUT', {}, s, config)).toEqual({ status: 400, body: { error: 'content is required' } })
  })

  test('note wrong method returns 405', async () => {
    const s = makeServices({ notes: () => notesService })
    expect(await handle('/api/notes/note/a.md', '', 'PATCH', {}, s, config)).toEqual({ status: 405, body: { error: 'method not allowed' } })
  })

  test('move requires from and to', async () => {
    const s = makeServices({ notes: () => notesService })
    expect(await handle('/api/notes/move', '', 'POST', {}, s, config)).toEqual({ status: 400, body: { error: 'from and to are required' } })
    const res = await handle('/api/notes/move', '', 'POST', { from: 'a.md', to: 'b.md' }, s, config)
    expect(res).toEqual({ status: 200, body: { path: 'b.md', content: 'body' } })
  })

  test('daily creates new note', async () => {
    const s = makeServices({ notes: () => notesService })
    const res = await handle('/api/notes/daily', '', 'POST', undefined, s, config)
    expect(res?.status).toBe(200)
    expect(res?.body.path).toMatch(/^daily\/\d{4}-\d{2}-\d{2}\.md$/)
  })

  test('backlinks requires path and filters', async () => {
    const s = makeServices({ notes: () => ({
      async list() {
        return [
          { path: 'a.md', links: [{ target: 'target.md' }] },
          { path: 'b.md', links: [{ target: '/sub/target.md' }] },
          { path: 'c.md', links: [{ target: 'other.md' }] },
        ]
      },
    }) })
    expect(await handle('/api/notes/backlinks', '', 'GET', undefined, s, config)).toEqual({ status: 400, body: { error: 'path is required' } })
    const res = await handle('/api/notes/backlinks', '?path=target.md', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { backlinks: [{ path: 'a.md', links: [{ target: 'target.md' }] }, { path: 'b.md', links: [{ target: '/sub/target.md' }] }] } })
  })

  test('snapshots/snapshot', async () => {
    const s = makeServices({ notes: () => notesService })
    expect(await handle('/api/notes/snapshots', '?path=a.md', 'GET', undefined, s, config)).toEqual({ status: 200, body: { snapshots: [{ id: 's1', notePath: 'a.md' }] } })
    expect(await handle('/api/notes/snapshots', '', 'GET', undefined, s, config)).toEqual({ status: 400, body: { error: 'path is required' } })
    expect(await handle('/api/notes/snapshot', '?path=a.md&id=s1', 'GET', undefined, s, config)).toEqual({ status: 200, body: { path: 'a.md', id: 's1' } })
    expect(await handle('/api/notes/snapshot', '', 'GET', undefined, s, config)).toEqual({ status: 400, body: { error: 'path and id are required' } })
  })
})

describe('legacy: prompt memory', () => {
  const promptMemory = {
    async getStatus() { return { files: { user: { entries: ['Call me Alice'] }, brief: { entries: ['[workflow] Run tests'] } } } },
    async readReviewLogs() { return [{ timestamp: '2026-01-01T00:00:00.000Z', trigger: 'explicit', target: 'user', changed: true, content: 'Call me Alice', message: 'added' }] },
    async readFile(target: string) { return 'file-' + target },
    async writeFile(target: string, content: string) { return { target, content } },
  }

  test('status unmounted returns notMounted', async () => {
    expect(await handle('/api/prompt-memory', '', 'GET', undefined, makeServices(), config)).toEqual({ status: 200, body: { mounted: false } })
  })

  test('status returns files', async () => {
    const s = makeServices({ promptMemory: () => promptMemory })
    const res = await handle('/api/prompt-memory', '', 'GET', undefined, s, config)
    expect(res?.status).toBe(200)
    expect(res?.body.files.user.entries).toEqual(['Call me Alice'])
  })

  test('logs forwards limit', async () => {
    let limit: unknown
    const s = makeServices({ promptMemory: () => ({ async readReviewLogs(l: unknown) { limit = l; return [{ a: 1 }] } }) })
    const res = await handle('/api/prompt-memory/logs', '?limit=3', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: [{ a: 1 }] })
    expect(limit).toBe(3)
  })

  test('logs without limit defaults to 20', async () => {
    let limit: unknown
    const s = makeServices({ promptMemory: () => ({ async readReviewLogs(l: unknown) { limit = l; return [] } }) })
    await handle('/api/prompt-memory/logs', '', 'GET', undefined, s, config)
    expect(limit).toBe(20)
  })

  test('insights builds from real projection', async () => {
    const s = makeServices({ promptMemory: () => promptMemory })
    const res = await handle('/api/prompt-memory/insights', '', 'GET', undefined, s, config)
    expect(res?.status).toBe(200)
    expect(res?.body.insights.length).toBe(2)
    expect(res?.body.stats.total).toBe(2)
  })

  test('insights unmounted returns empty stats', async () => {
    const res = await handle('/api/prompt-memory/insights', '', 'GET', undefined, makeServices(), config)
    expect(res).toEqual({ status: 200, body: { insights: [], stats: { total: 0, user: 0, methods: 0, dimensions: 0, automaticUpdates: 0 } } })
  })

  test('file GET and PUT', async () => {
    const s = makeServices({ promptMemory: () => promptMemory })
    expect(await handle('/api/prompt-memory/brief', '', 'GET', undefined, s, config)).toEqual({ status: 200, body: 'file-brief' })
    expect(await handle('/api/prompt-memory/user', '', 'PUT', { content: 'x' }, s, config)).toEqual({ status: 200, body: { target: 'user', content: 'x' } })
    expect(await handle('/api/prompt-memory/user', '', 'PUT', {}, s, config)).toEqual({ status: 400, body: { error: 'content is required' } })
    expect(await handle('/api/prompt-memory/user', '', 'DELETE', {}, s, config)).toEqual({ status: 405, body: { error: 'method not allowed' } })
  })
})

describe('legacy: search sessions', () => {
  test('unmounted returns notMounted', async () => {
    expect(await handle('/api/search/sessions', '', 'POST', {}, makeServices(), config)).toEqual({ status: 200, body: { mounted: false } })
  })

  test('wrong method returns 405', async () => {
    const s = makeServices({ sessionSearch: () => ({}) })
    expect(await handle('/api/search/sessions', '', 'GET', undefined, s, config)).toEqual({ status: 405, body: { error: 'method not allowed' } })
  })

  test('search forwards query', async () => {
    let arg: unknown
    const s = makeServices({ sessionSearch: () => ({ async search(a: unknown) { arg = a; return { results: [] } } }) })
    const res = await handle('/api/search/sessions', '', 'POST', { query: 'hi' }, s, config)
    expect(res).toEqual({ status: 200, body: { results: [] } })
    expect(arg).toEqual({ query: 'hi', limit: 20 })
  })

  test('search null result returns empty envelope', async () => {
    const s = makeServices({ sessionSearch: () => ({ async search() { return null } }) })
    const res = await handle('/api/search/sessions', '', 'POST', {}, s, config)
    expect(res).toEqual({ status: 200, body: { results: [], count: 0 } })
  })
})

describe('legacy: skills', () => {
  test('list unmounted returns notMounted', async () => {
    expect(await handle('/api/skills', '', 'GET', undefined, makeServices(), config)).toEqual({ status: 200, body: { mounted: false } })
  })

  test('list without roots returns empty', async () => {
    const s = makeServices({ skillMemory: () => ({ createStore() { return {} } }) })
    expect(await handle('/api/skills', '', 'GET', undefined, s, config)).toEqual({ status: 200, body: { skills: [] } })
  })

  test('config returns the skills dir', async () => {
    expect(await handle('/api/skills/config', '', 'GET', undefined, makeServices(), config)).toEqual({ status: 200, body: { config: { userSkillsDir: '', displayPath: '' } } })
  })

  test('open-config is desktop-only', async () => {
    expect(await handle('/api/skills/open-config', '', 'POST', undefined, makeServices(), config)).toEqual({ status: 501, body: { error: 'this action is desktop-only; switch to the rin desktop app' } })
  })
})

describe('legacy: token optimization', () => {
  const token = {
    getStatus: () => ({ responseStyle: 'off', cleanPrompt: false }),
    setCleanPrompt: (v: boolean) => ({ responseStyle: 'off', cleanPrompt: v }),
    setResponseStyle: (s: string) => ({ responseStyle: s, cleanPrompt: false }),
  }
  const pruning = {
    getStatus: () => ({ enabled: false, level: 'balanced', mode: 'deterministic' }),
    setEnabled: (v: boolean) => ({ enabled: v, level: 'balanced', mode: 'deterministic' }),
    setLevel: (l: string) => ({ enabled: true, level: l, mode: 'deterministic' }),
  }

  test('unmounted returns notMounted', async () => {
    expect(await handle('/api/token-optimization/lite', '', 'GET', undefined, makeServices(), config)).toEqual({ status: 200, body: { mounted: false } })
  })

  test('lite status and enable/disable', async () => {
    const s = makeServices({ tokenOptimization: () => token })
    expect(await handle('/api/token-optimization/lite', '', 'GET', undefined, s, config)).toEqual({ status: 200, body: { enabled: false, mode: 'deterministic' } })
    expect(await handle('/api/token-optimization/lite', '', 'POST', undefined, s, config)).toEqual({ status: 405, body: { error: 'method not allowed' } })
    expect(await handle('/api/token-optimization/lite/enable', '', 'POST', undefined, s, config)).toEqual({ status: 200, body: { enabled: true, mode: 'deterministic' } })
    expect(await handle('/api/token-optimization/lite/disable', '', 'POST', undefined, s, config)).toEqual({ status: 200, body: { enabled: false, mode: 'deterministic' } })
    expect(await handle('/api/token-optimization/lite/enable', '', 'GET', undefined, s, config)).toEqual({ status: 405, body: { error: 'method not allowed' } })
  })

  test('removed response-style endpoints return 404', async () => {
    const s = makeServices({ tokenOptimization: () => token })
    expect(await handle('/api/token-optimization/ponytail', '', 'GET', undefined, s, config)).toEqual({ status: 404, body: { error: 'unknown token optimization endpoint' } })
    expect(await handle('/api/token-optimization/caveman/enable', '', 'POST', undefined, s, config)).toEqual({ status: 404, body: { error: 'unknown token optimization endpoint' } })
  })

  test('pruning status unmounted fallback', async () => {
    const res = await handle('/api/token-optimization/pruning', '', 'GET', undefined, makeServices({ tokenOptimization: () => token }), config)
    expect(res).toEqual({ status: 200, body: { enabled: false, level: 'balanced', mode: 'deterministic' } })
  })

  test('pruning status and enable/disable/level', async () => {
    const s = makeServices({ tokenOptimization: () => token, smartPruning: () => pruning })
    expect(await handle('/api/token-optimization/pruning', '', 'GET', undefined, s, config)).toEqual({ status: 200, body: { enabled: false, level: 'balanced', mode: 'deterministic' } })
    expect(await handle('/api/token-optimization/pruning/enable', '', 'POST', undefined, s, config)).toEqual({ status: 200, body: { enabled: true, level: 'balanced', mode: 'deterministic' } })
    expect(await handle('/api/token-optimization/pruning/level', '', 'POST', { level: 'aggressive' }, s, config)).toEqual({ status: 200, body: { enabled: true, level: 'aggressive', mode: 'deterministic' } })
    expect(await handle('/api/token-optimization/pruning/level', '', 'POST', { level: 'bad' }, s, config)).toEqual({ status: 400, body: { error: 'level is required' } })
    expect(await handle('/api/token-optimization/pruning/enable', '', 'GET', undefined, s, config)).toEqual({ status: 405, body: { error: 'method not allowed' } })
  })

  test('pruning unmounted write returns notMounted', async () => {
    const s = makeServices({ tokenOptimization: () => token })
    expect(await handle('/api/token-optimization/pruning/enable', '', 'POST', undefined, s, config)).toEqual({ status: 200, body: { mounted: false } })
  })

  test('codegraph read requires the codegraph service', async () => {
    const res = await handle('/api/token-optimization/codegraph', '?projectPath=%2Fp', 'GET', undefined, makeServices(), config)
    expect(res).toEqual({ status: 200, body: { mounted: false } })
  })

  test('codegraph status requires projectPath', async () => {
    const s = makeServices({ codegraph: () => ({}) })
    const res = await handle('/api/token-optimization/codegraph', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 400, body: { error: 'projectPath is required' } })
  })

  test('codegraph status returns the service status', async () => {
    const statusBody = { projectPath: '/p', indexable: true, enabled: true, state: 'ready', progress: null, stats: null, error: null, bundledLanguages: [] }
    const s = makeServices({ codegraph: () => ({ status: () => statusBody }) })
    const res = await handle('/api/token-optimization/codegraph', '?projectPath=%2Fp', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: statusBody })
  })

  test('codegraph graph requires projectPath', async () => {
    const s = makeServices({ codegraph: () => ({}) })
    const res = await handle('/api/token-optimization/codegraph/graph', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 400, body: { error: 'projectPath is required' } })
  })

  test('codegraph graph returns the visualization', async () => {
    const vis = { nodes: [], edges: [], architecture: { analyzedNodeCount: 0, analyzedEdgeCount: 0, availableNodeCount: 0, truncated: false, communities: [], hubNodeIds: [], bridgeNodeIds: [], confidence: { extracted: 0, inferred: 0, unknown: 0 } } }
    const s = makeServices({ codegraph: () => ({ visualization: () => vis }) })
    const res = await handle('/api/token-optimization/codegraph/graph', '?projectPath=%2Fp&limit=50', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: vis })
  })

  test('codegraph enable/disable/rebuild require projectPath in body', async () => {
    const s = makeServices({ codegraph: () => ({}) })
    expect(await handle('/api/token-optimization/codegraph/enable', '', 'POST', {}, s, config)).toEqual({ status: 400, body: { error: 'projectPath is required' } })
    expect(await handle('/api/token-optimization/codegraph/disable', '', 'POST', {}, s, config)).toEqual({ status: 400, body: { error: 'projectPath is required' } })
    expect(await handle('/api/token-optimization/codegraph/rebuild', '', 'POST', {}, s, config)).toEqual({ status: 400, body: { error: 'projectPath is required' } })
  })

  test('codegraph enable/rebuild return 202 and disable returns 200', async () => {
    const statusBody = { projectPath: '/p', indexable: true, enabled: true, state: 'preparing', progress: null, stats: null, error: null, bundledLanguages: [] }
    const s = makeServices({ codegraph: () => ({ enable: async () => statusBody, disable: async () => statusBody, rebuild: async () => statusBody }) })
    expect(await handle('/api/token-optimization/codegraph/enable', '', 'POST', { projectPath: '/p' }, s, config)).toEqual({ status: 202, body: statusBody })
    expect(await handle('/api/token-optimization/codegraph/rebuild', '', 'POST', { projectPath: '/p' }, s, config)).toEqual({ status: 202, body: statusBody })
    expect(await handle('/api/token-optimization/codegraph/disable', '', 'POST', { projectPath: '/p' }, s, config)).toEqual({ status: 200, body: statusBody })
  })

  test('codegraph enable requires POST', async () => {
    const s = makeServices({ codegraph: () => ({}) })
    expect(await handle('/api/token-optimization/codegraph/enable', '', 'GET', undefined, s, config)).toEqual({ status: 405, body: { error: 'method not allowed' } })
  })

  test('codegraph global status and enable/disable', async () => {
    const s = makeServices({ codegraph: () => ({ globalStatus: () => ({ enabled: true }), enableGlobal: () => ({ enabled: true }), disableGlobal: async () => ({ enabled: false }) }) })
    expect(await handle('/api/token-optimization/codegraph/global', '', 'GET', undefined, s, config)).toEqual({ status: 200, body: { enabled: true } })
    expect(await handle('/api/token-optimization/codegraph/global/enable', '', 'POST', undefined, s, config)).toEqual({ status: 200, body: { enabled: true } })
    expect(await handle('/api/token-optimization/codegraph/global/disable', '', 'POST', undefined, s, config)).toEqual({ status: 200, body: { enabled: false } })
  })

  test('rtk returns unavailable', async () => {
    const res = await handle('/api/token-optimization/rtk', '', 'GET', undefined, makeServices(), config)
    expect(res).toEqual({ status: 200, body: { enabled: false, available: false, version: null, stats: null, error: 'rtk is not available on this host' } })
  })

  test('unknown token endpoint returns 404', async () => {
    const s = makeServices({ tokenOptimization: () => token })
    expect(await handle('/api/token-optimization/unknown', '', 'GET', undefined, s, config)).toEqual({ status: 404, body: { error: 'unknown token optimization endpoint' } })
  })
})

describe('legacy: sandboxes', () => {
  const sandboxes = {
    async list() { return [{ id: 'sb1', name: 'n' }] },
    async create(input: unknown) { return input },
    async update(id: string, patch: unknown) { return { id, ...(patch as object) } },
    async remove(id: string) { return id === 'sb1' },
    async get(id: string) { return id === 'missing' ? null : { id, environmentProfileId: 'e', repositoryId: 'r' } },
    async setDefault() { return {} },
    async probeCapabilities() { return ['docker'] },
    async executeEnvironmentPlan() { return { run: true } },
  }

  test('profiles unmounted returns notMounted', async () => {
    expect(await handle('/api/sandboxes/profiles', '', 'GET', undefined, makeServices(), config)).toEqual({ status: 200, body: { mounted: false } })
  })

  test('profiles GET lists', async () => {
    const s = makeServices({ sandboxes: () => sandboxes })
    expect(await handle('/api/sandboxes/profiles', '', 'GET', undefined, s, config)).toEqual({ status: 200, body: { profiles: [{ id: 'sb1', name: 'n' }] } })
  })

  test('profiles POST creates with coerced type', async () => {
    const s = makeServices({ sandboxes: () => sandboxes })
    const res = await handle('/api/sandboxes/profiles', '', 'POST', { name: 'n', type: 'container', isDefault: true, repositoryId: 'r1' }, s, config)
    expect(res?.status).toBe(200)
    expect(res?.body.type).toBe('container')
    expect(res?.body.isDefault).toBe(true)
    expect(res?.body.repositoryId).toBe('r1')
  })

  test('profiles POST requires name and type', async () => {
    const s = makeServices({ sandboxes: () => sandboxes })
    expect(await handle('/api/sandboxes/profiles', '', 'POST', {}, s, config)).toEqual({ status: 400, body: { error: 'name and type are required' } })
  })

  test('profiles wrong method returns 405', async () => {
    const s = makeServices({ sandboxes: () => sandboxes })
    expect(await handle('/api/sandboxes/profiles', '', 'PUT', undefined, s, config)).toEqual({ status: 405, body: { error: 'method not allowed' } })
  })

  test('runtime and stats return fixed bodies', async () => {
    expect(await handle('/api/sandboxes/runtime', '', 'GET', undefined, makeServices(), config)).toEqual({ status: 200, body: { runtime: null, version: null } })
    expect(await handle('/api/sandboxes/stats', '', 'GET', undefined, makeServices(), config)).toEqual({ status: 200, body: { stats: [] } })
  })

  test('default set', async () => {
    const s = makeServices({ sandboxes: () => sandboxes })
    expect(await handle('/api/sandboxes/default', '', 'POST', { id: 'sb1' }, s, config)).toEqual({ status: 200, body: { ok: true } })
    expect(await handle('/api/sandboxes/default', '', 'POST', {}, s, config)).toEqual({ status: 400, body: { error: 'id is required' } })
    expect(await handle('/api/sandboxes/default', '', 'GET', undefined, s, config)).toEqual({ status: 405, body: { error: 'method not allowed' } })
  })

  test('item PUT updates and DELETE removes', async () => {
    const s = makeServices({ sandboxes: () => sandboxes })
    const upd = await handle('/api/sandboxes/profile/sb1', '', 'PUT', { name: 'n2', type: 'container' }, s, config)
    expect(upd).toEqual({ status: 200, body: { id: 'sb1', name: 'n2', type: 'container' } })
    expect(await handle('/api/sandboxes/profile/sb1', '', 'DELETE', undefined, s, config)).toEqual({ status: 200, body: { removed: true } })
    expect(await handle('/api/sandboxes/profile/sb1', '', 'PUT', undefined, s, config)).toEqual({ status: 400, body: { error: 'request body must be a JSON object' } })
  })

  test('item state returns exists/running', async () => {
    const s = makeServices({ sandboxes: () => sandboxes })
    expect(await handle('/api/sandboxes/profile/sb1/state', '', 'GET', undefined, s, config)).toEqual({ status: 200, body: { exists: true, running: false } })
    expect(await handle('/api/sandboxes/profile/missing/state', '', 'GET', undefined, s, config)).toEqual({ status: 200, body: { exists: false, running: false } })
  })

  test('item start/stop/test/interactive-command are desktop-only', async () => {
    const s = makeServices({ sandboxes: () => sandboxes })
    for (const action of ['start', 'stop', 'test', 'interactive-command']) {
      const res = await handle('/api/sandboxes/profile/sb1/' + action, '', 'POST', undefined, s, config)
      expect(res).toEqual({ status: 501, body: { error: 'this action is desktop-only; switch to the rin desktop app' } })
    }
  })

  test('item exec runs a command', async () => {
    let captured: { id: string; command: string } | undefined
    const s = makeServices({ sandboxes: () => ({ ...sandboxes, async exec(id: string, command: string) { captured = { id, command }; return { code: 0, stdout: 'out', stderr: '' } } }) })
    const res = await handle('/api/sandboxes/profile/sb1/exec', '', 'POST', { command: 'ls -la' }, s, config)
    expect(res).toEqual({ status: 200, body: { code: 0, stdout: 'out', stderr: '' } })
    expect(captured).toEqual({ id: 'sb1', command: 'ls -la' })
  })

  test('item exec requires a command', async () => {
    const s = makeServices({ sandboxes: () => ({ ...sandboxes, async exec() { return { code: 0, stdout: '', stderr: '' } } }) })
    expect(await handle('/api/sandboxes/profile/sb1/exec', '', 'POST', {}, s, config)).toEqual({ status: 400, body: { error: 'command is required' } })
    expect(await handle('/api/sandboxes/profile/sb1/exec', '', 'POST', { command: '  ' }, s, config)).toEqual({ status: 400, body: { error: 'command is required' } })
  })

  test('item exec requires POST', async () => {
    const s = makeServices({ sandboxes: () => sandboxes })
    expect(await handle('/api/sandboxes/profile/sb1/exec', '', 'GET', undefined, s, config)).toEqual({ status: 405, body: { error: 'method not allowed' } })
  })

  test('item prepare-environment runs pipeline', async () => {
    const s = makeServices({
      sandboxes: () => sandboxes,
      environment: () => ({ async plan() { return { plan: true } } }),
    })
    const res = await handle('/api/sandboxes/profile/sb1/prepare-environment', '', 'POST', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { run: true } })
    expect(await handle('/api/sandboxes/profile/sb1/environment-runs', '', 'GET', undefined, s, config)).toEqual({ status: 200, body: { runs: [{ run: true }] } })
  })

  test('item prepare missing profile returns 404', async () => {
    const s = makeServices({ sandboxes: () => sandboxes, environment: () => ({}) })
    const res = await handle('/api/sandboxes/profile/missing/prepare-environment', '', 'POST', undefined, s, config)
    expect(res).toEqual({ status: 404, body: { error: 'sandbox profile not found' } })
  })

  test('item approve-environment is already approved', async () => {
    const s = makeServices({ sandboxes: () => sandboxes })
    expect(await handle('/api/sandboxes/profile/sb1/approve-environment', '', 'POST', undefined, s, config)).toEqual({ status: 200, body: { ok: true, alreadyApproved: true } })
  })

  test('item unknown action returns 404', async () => {
    const s = makeServices({ sandboxes: () => sandboxes })
    expect(await handle('/api/sandboxes/profile/sb1/unknown', '', 'GET', undefined, s, config)).toEqual({ status: 404, body: { error: 'unknown sandbox action' } })
  })
})

describe('legacy: agents', () => {
  const agents = {
    async listRepositoryAgents() { return [{ name: 'a1', description: 'd', model: 'm', tools: ['t'], systemPrompt: 'sp' }] },
    async createRepositoryAgent(_root: string, input: unknown) { return input },
    async updateRepositoryAgent(_root: string, name: string, input: unknown) { return { name, ...(input as object) } },
    async deleteRepositoryAgent() {},
  }

  test('list unmounted returns notMounted', async () => {
    expect(await handle('/api/agents', '', 'GET', undefined, makeServices(), config)).toEqual({ status: 200, body: { mounted: false } })
  })

  test('list without root returns empty', async () => {
    const s = makeServices({ agents: () => agents })
    expect(await handle('/api/agents', '', 'GET', undefined, s, { ...config, repositoryRoot: undefined })).toEqual({ status: 200, body: { activeAgents: [], allAgents: [] } })
  })

  test('list maps definitions', async () => {
    const s = makeServices({ agents: () => agents })
    const res = await handle('/api/agents', '?repositoryId=/r', 'GET', undefined, s, config)
    expect(res?.status).toBe(200)
    expect(res?.body.activeAgents.length).toBe(1)
    expect(res?.body.activeAgents[0].agentType).toBe('a1')
    expect(res?.body.activeAgents[0].source).toBe('repository')
  })

  test('repository GET lists raw records', async () => {
    const s = makeServices({ agents: () => agents })
    const res = await handle('/api/agents/repositories/builtin', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { agents: [{ name: 'a1', description: 'd', model: 'm', tools: ['t'], systemPrompt: 'sp' }] } })
  })

  test('repository POST creates', async () => {
    const s = makeServices({ agents: () => agents })
    const res = await handle('/api/agents/repositories/builtin', '', 'POST', { name: 'n', description: 'd', systemPrompt: 'sp', tools: ['t', 1], model: 'm' }, s, config)
    expect(res?.status).toBe(200)
    expect(res?.body.name).toBe('n')
    expect(res?.body.tools).toEqual(['t'])
  })

  test('repository item PUT/DELETE', async () => {
    const s = makeServices({ agents: () => agents })
    const upd = await handle('/api/agents/repositories/builtin/a1', '', 'PUT', { description: 'd2', systemPrompt: 'sp2' }, s, config)
    expect(upd).toEqual({ status: 200, body: { name: 'a1', description: 'd2', systemPrompt: 'sp2', tools: [] } })
    expect(await handle('/api/agents/repositories/builtin/a1', '', 'DELETE', undefined, s, config)).toEqual({ status: 200, body: { ok: true } })
  })

  test('repository missing root returns 500', async () => {
    const s = makeServices({ agents: () => agents })
    const res = await handle('/api/agents/repositories/builtin', '', 'GET', undefined, s, { ...config, repositoryRoot: undefined })
    expect(res).toEqual({ status: 500, body: { error: 'repository root is not configured' } })
  })
})

describe('legacy: settings/models/providers', () => {
  test('settings user GET/PUT', async () => {
    expect(await handle('/api/settings/user', '', 'GET', undefined, makeServices(), config)).toEqual({ status: 200, body: {} })
    expect(await handle('/api/settings/user', '', 'PUT', {}, makeServices(), config)).toEqual({ status: 200, body: { ok: true } })
    expect(await handle('/api/settings/user', '', 'DELETE', undefined, makeServices(), config)).toEqual({ status: 405, body: { error: 'method not allowed' } })
  })

  test('permissions mode reads and writes the dsh permission preset', async () => {
    let saved: object | undefined
    const s = makeServices({
      permissionPresets: () => ({ names: ['read-only', 'workspace-write', 'danger-full-access'], defaultPreset: 'workspace-write' }),
      settings: () => ({ get: () => ({ defaultPreset: 'workspace-write' }), update: async (_ns: string, patch: object) => { saved = patch } }),
    })
    expect(await handle('/api/permissions/mode', '', 'GET', undefined, s, config)).toEqual({ status: 200, body: { mode: 'workspace-write', available: ['read-only', 'workspace-write', 'danger-full-access'] } })
    expect(await handle('/api/permissions/mode', '', 'PUT', { mode: 'danger-full-access' }, s, config)).toEqual({ status: 200, body: { ok: true, mode: 'danger-full-access' } })
    expect(saved).toEqual({ defaultPreset: 'danger-full-access' })
  })

  test('permissions mode unmounted falls back to workspace-write', async () => {
    expect(await handle('/api/permissions/mode', '', 'GET', undefined, makeServices(), config)).toEqual({ status: 200, body: { mode: 'workspace-write', available: ['read-only', 'workspace-write', 'danger-full-access'] } })
  })

  test('permissions rules GET/POST/DELETE', async () => {
    expect(await handle('/api/permissions/rules', '', 'GET', undefined, makeServices(), config)).toEqual({ status: 200, body: { rules: [] } })
    expect(await handle('/api/permissions/rules', '', 'POST', {}, makeServices(), config)).toEqual({ status: 200, body: { ok: true, rule: { source: 'userSettings', behavior: 'ask', ruleString: '', toolName: '' } } })
    expect(await handle('/api/permissions/rules', '', 'DELETE', undefined, makeServices(), config)).toEqual({ status: 200, body: { ok: true } })
  })

  test('effort reads the default model reasoning effort and saves it', async () => {
    let saved: { provider: string; model: string; reasoningEffort?: string } | undefined
    const s = makeServices({
      agentDefaultModel: () => ({
        currentSelection: () => ({ provider: 'p1', model: 'm1' }),
        saveSelection: async (sel: { provider: string; model: string; reasoningEffort?: string }) => { saved = sel },
      }),
    })
    expect(await handle('/api/effort', '', 'GET', undefined, s, config)).toEqual({ status: 200, body: { level: 'medium', available: ['low', 'medium', 'high', 'max'] } })
    expect(await handle('/api/effort', '', 'PUT', { level: 'high' }, s, config)).toEqual({ status: 200, body: { ok: true, level: 'high' } })
    expect(saved).toEqual({ provider: 'p1', model: 'm1', reasoningEffort: 'high' })
  })

  test('effort unmounted returns 404', async () => {
    expect(await handle('/api/effort', '', 'GET', undefined, makeServices(), config)).toEqual({ status: 404, body: { error: 'no default model service mounted' } })
  })

  test('models unmounted returns empty', async () => {
    expect(await handle('/api/models', '', 'GET', undefined, makeServices(), config)).toEqual({ status: 200, body: { models: [], provider: null } })
  })

  test('models lists first provider models', async () => {
    const s = makeServices({ llm: () => ({ listProviders: () => [{ id: 'p1', name: 'P1' }], listModels: async () => [{ id: 'm1', name: 'M1' }] }) })
    const res = await handle('/api/models', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { models: [{ id: 'm1', name: 'M1', description: '', context: '0' }], provider: { id: 'p1', name: 'P1' } } })
  })

  test('models with no providers returns empty', async () => {
    const s = makeServices({ llm: () => ({ listProviders: () => [] }) })
    expect(await handle('/api/models', '', 'GET', undefined, s, config)).toEqual({ status: 200, body: { models: [], provider: null } })
  })

  test('models current reads the default model selection', async () => {
    const s = makeServices({
      agentDefaultModel: () => ({ currentSelection: () => ({ provider: 'p1', model: 'm1' }), saveSelection: async () => {} }),
      llm: () => ({ listProviders: () => [{ id: 'p1', name: 'P1' }], listModels: async () => [{ id: 'm1', name: 'M1' }] }),
    })
    const res = await handle('/api/models/current', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { model: { id: 'm1', name: 'M1', description: '', context: '0' } } })
  })

  test('models current saves a new selection', async () => {
    let saved: { provider: string; model: string; reasoningEffort?: string } | undefined
    const s = makeServices({
      agentDefaultModel: () => ({
        currentSelection: () => ({ provider: 'p1', model: 'm1', reasoningEffort: 'low' }),
        saveSelection: async (sel: { provider: string; model: string; reasoningEffort?: string }) => { saved = sel },
      }),
    })
    expect(await handle('/api/models/current', '', 'PUT', { modelId: 'm2' }, s, config)).toEqual({ status: 200, body: { ok: true, model: 'm2' } })
    expect(saved).toEqual({ provider: 'p1', model: 'm2', reasoningEffort: 'low' })
  })

  test('models current unmounted returns 404', async () => {
    expect(await handle('/api/models/current', '', 'GET', undefined, makeServices(), config)).toEqual({ status: 404, body: { error: 'no default model service mounted' } })
  })

  test('models current falls back to the model id when the llm has no name', async () => {
    const s = makeServices({
      agentDefaultModel: () => ({ currentSelection: () => ({ provider: 'p1', model: 'm1' }), saveSelection: async () => {} }),
      llm: () => ({ listProviders: () => [], listModels: async () => [] }),
    })
    const res = await handle('/api/models/current', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { model: { id: 'm1', name: 'm1', description: '', context: '0' } } })
  })

  test('providers presets', async () => {
    const res = await handle('/api/providers/presets', '', 'GET', undefined, makeServices(), config)
    expect(res?.status).toBe(200)
    expect(Array.isArray(res?.body.presets)).toBe(true)
    expect(res?.body.presets.length).toBeGreaterThanOrEqual(4)
  })

  test('providers GET empty store', async () => {
    const res = await handle('/api/providers', '', 'GET', undefined, makeServices(), config)
    expect(res).toEqual({ status: 200, body: { providers: [], activeId: null } })
  })

  test('providers POST writes provider', async () => {
    const res = await handle('/api/providers', '', 'POST', { name: 'P', presetId: 'openai', apiKey: 'secret123' }, makeServices(), config)
    expect(res?.status).toBe(200)
    expect(res?.body.provider.name).toBe('P')
    expect(res?.body.provider.apiKey).toBe('secret••••••')
    expect(res?.body.provider.presetId).toBe('openai')
  })

  test('providers POST non-object returns 400', async () => {
    expect(await handle('/api/providers', '', 'POST', 'x', makeServices(), config)).toEqual({ status: 400, body: { error: 'request body must be a JSON object' } })
  })

  test('providers wrong method returns 405', async () => {
    expect(await handle('/api/providers', '', 'DELETE', undefined, makeServices(), config)).toEqual({ status: 405, body: { error: 'method not allowed' } })
  })

  test('provider item activate/test/PUT/DELETE', async () => {
    await writeFile(join(rinHome, 'providers.json'), JSON.stringify({ activeId: null, providers: [{ id: 'p1', name: 'P1', apiKey: 'secret123' }] }))
    expect(await handle('/api/providers/p1/activate', '', 'POST', undefined, makeServices(), config)).toEqual({ status: 200, body: { ok: true } })
    const probe = makeServices({ providerProbe: () => ({ test: async () => ({ connectivity: { success: false, latencyMs: 0 } }) }) })
    const test = await handle('/api/providers/p1/test', '', 'POST', undefined, probe, config)
    expect(test?.body.result.connectivity.success).toBe(false)
    const upd = await handle('/api/providers/p1', '', 'PUT', { name: 'P2' }, makeServices(), config)
    expect(upd?.body.provider.name).toBe('P2')
    expect(await handle('/api/providers/p1', '', 'DELETE', undefined, makeServices(), config)).toEqual({ status: 200, body: { ok: true } })
  })

  test('provider item missing returns 404', async () => {
    await writeFile(join(rinHome, 'providers.json'), JSON.stringify({ activeId: null, providers: [] }))
    expect(await handle('/api/providers/nope/test', '', 'GET', undefined, makeServices(), config)).toEqual({ status: 404, body: { error: 'provider not found' } })
  })

  test('provider item wrong method returns 405', async () => {
    await writeFile(join(rinHome, 'providers.json'), JSON.stringify({ activeId: null, providers: [{ id: 'p1', name: 'P1' }] }))
    expect(await handle('/api/providers/p1', '', 'GET', undefined, makeServices(), config)).toEqual({ status: 405, body: { error: 'method not allowed' } })
  })

  test('providers settings returns empty', async () => {
    expect(await handle('/api/providers/settings', '', 'GET', undefined, makeServices(), config)).toEqual({ status: 200, body: {} })
  })
})

describe('legacy: auth status', () => {
  test('no credentials returns hasAuth false', async () => {
    const s = makeServices({ agentDefaultModel: () => ({ currentSelection: () => ({ provider: 'deepseek-official', model: 'm' }) }) })
    const res = await handle('/api/providers/auth-status', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { hasAuth: false, source: 'none' } })
  })

  test('unknown provider ref returns hasAuth false with activeProvider', async () => {
    const s = makeServices({
      credentials: () => ({}),
      agentDefaultModel: () => ({ currentSelection: () => ({ provider: 'other', model: 'm' }) }),
    })
    const res = await handle('/api/providers/auth-status', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { hasAuth: false, source: 'none', activeProvider: 'other' } })
  })

  test('env source', async () => {
    const s = makeServices({
      credentials: () => ({ async describe() { return { configured: true, source: 'env', writable: false } } }),
      agentDefaultModel: () => ({ currentSelection: () => ({ provider: 'deepseek-official', model: 'm' }) }),
    })
    const res = await handle('/api/providers/auth-status', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { hasAuth: true, source: 'env', activeProvider: 'deepseek-official' } })
  })

  test('file source maps to managed', async () => {
    const s = makeServices({
      credentials: () => ({ async describe() { return { configured: true, source: 'file', writable: true } } }),
      agentDefaultModel: () => ({ currentSelection: () => ({ provider: 'deepseek-official', model: 'm' }) }),
    })
    const res = await handle('/api/providers/auth-status', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { hasAuth: true, source: 'managed', activeProvider: 'deepseek-official' } })
  })

  test('describe failure returns 500', async () => {
    const s = makeServices({
      credentials: () => ({ async describe() { throw new Error('boom') } }),
      agentDefaultModel: () => ({ currentSelection: () => ({ provider: 'deepseek-official', model: 'm' }) }),
    })
    const res = await handle('/api/providers/auth-status', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 500, body: { error: 'boom' } })
  })
})

describe('legacy: mcp', () => {
  test('unmounted returns empty', async () => {
    expect(await handle('/api/mcp', '', 'GET', undefined, makeServices(), config)).toEqual({ status: 200, body: { servers: [] } })
  })

  test('lists and projects DTO', async () => {
    const s = makeServices({ mcp: () => ({ async list() { return [{ name: 'srv', transport: 'stdio', command: 'npx', args: ['-y', 'mcp'], env: {}, status: 'connected' }] } }) })
    const res = await handle('/api/mcp', '', 'GET', undefined, s, config)
    expect(res?.body.servers[0].name).toBe('srv')
    expect(res?.body.servers[0].statusLabel).toBe('Connected')
    expect(res?.body.servers[0].enabled).toBe(true)
    expect(res?.body.servers[0].summary).toBe('npx -y mcp')
  })

  test('http transport uses url as summary', async () => {
    const s = makeServices({ mcp: () => ({ async list() { return [{ name: 'srv', transport: 'http', command: 'x', args: [], env: {}, url: 'http://x', headers: { A: '1' }, status: 'failed' }] } }) })
    const res = await handle('/api/mcp', '', 'GET', undefined, s, config)
    expect(res?.body.servers[0].summary).toBe('http://x')
    expect(res?.body.servers[0].statusLabel).toBe('Unavailable')
    expect(res?.body.servers[0].enabled).toBe(true)
  })

  test('wrong method returns 405', async () => {
    expect(await handle('/api/mcp', '', 'PUT', {}, makeServices(), config)).toEqual({ status: 405, body: { error: 'method not allowed' } })
  })

  test('create requires the mcp service', async () => {
    expect(await handle('/api/mcp', '', 'POST', { name: 'srv', config: { type: 'stdio', command: 'x' } }, makeServices(), config)).toEqual({ status: 500, body: { error: 'mcp service is not mounted' } })
  })
})

describe('legacy: A/B/D services', () => {
  test('teams unmounted returns empty', async () => {
    expect(await handle('/api/teams', '', 'GET', undefined, makeServices(), config)).toEqual({ status: 200, body: { teams: [] } })
  })

  test('teams lists', async () => {
    const s = makeServices({ teams: () => ({ async list() { return [{ name: 'team-a' }] } }) })
    expect(await handle('/api/teams', '', 'GET', undefined, s, config)).toEqual({ status: 200, body: { teams: [{ name: 'team-a' }] } })
  })

  test('tasks unmounted returns empty', async () => {
    expect(await handle('/api/tasks', '', 'GET', undefined, makeServices(), config)).toEqual({ status: 200, body: { lists: [], tasks: [] } })
  })

  test('tasks and task lists', async () => {
    const s = makeServices({ tasks: () => ({ async listTasks() { return [{ id: '1' }] }, async listTaskLists() { return [{ id: 'l1' }] } }) })
    expect(await handle('/api/tasks', '', 'GET', undefined, s, config)).toEqual({ status: 200, body: { tasks: [{ id: '1' }] } })
    expect(await handle('/api/tasks/lists', '', 'GET', undefined, s, config)).toEqual({ status: 200, body: { lists: [{ id: 'l1' }] } })
  })

  test('teams wrong method returns 405', async () => {
    expect(await handle('/api/teams', '', 'POST', {}, makeServices(), config)).toEqual({ status: 405, body: { error: 'method not allowed' } })
  })

  test('team members list/add/remove', async () => {
    const base = [{ agentId: 'm1', name: 'Member 1', role: 'member', status: 'idle', joinedAt: 0, cwd: '' }]
    const s = makeServices({ teams: () => ({
      async listMembers() { return base },
      async addMember(_name: string, input: unknown) { return { name: _name, members: [...base, input] } },
      async removeMember(_name: string, agentId: string) { return { name: _name, members: base.filter(m => m.agentId !== agentId) } },
    }) })
    expect(await handle('/api/teams/t1/members', '', 'GET', undefined, s, config)).toEqual({ status: 200, body: { members: base } })
    expect(await handle('/api/teams/t1/members', '', 'POST', { agentId: 'm2', name: 'M2' }, s, config)).toEqual({ status: 200, body: { detail: { name: 't1', members: [...base, { agentId: 'm2', name: 'M2' }] } } })
    expect(await handle('/api/teams/t1/members/m1', '', 'DELETE', undefined, s, config)).toEqual({ status: 200, body: { detail: { name: 't1', members: [] } } })
  })

  test('session branch forks from an assistant message', async () => {
    const child = { id: 'session-child', events: [], header: { cwd: '/w' } }
    const source = { id: 's1', events: [
      { type: 'turn/start', seq: 0, time: 1, data: {} },
      { type: 'user/message', seq: 1, time: 2, data: { content: 'hi' } },
      { type: 'assistant/message', seq: 2, time: 3, data: { message: { content: [] } } },
      { type: 'turn/end', seq: 3, time: 4, data: {} },
    ], header: { cwd: '/w' } }
    let forkedBoundary: number | undefined
    const s = makeServices({ sessions: () => ({ get: () => source, fork: (_id: string, boundary?: number) => { forkedBoundary = boundary; return child } }) })
    const res = await handle('/api/sessions/s1/branch', '', 'POST', { targetAssistantMessageId: 'evt-2' }, s, config)
    expect(res?.status).toBe(201)
    expect(res?.body.sessionId).toBe('session-child')
    expect(res?.body.sourceSessionId).toBe('s1')
    expect(forkedBoundary).toBe(3)
  })

  test('session rewind preview and fork', async () => {
    const child = { id: 'session-rewound', events: [], header: { cwd: '/w' } }
    const source = { id: 's1', events: [
      { type: 'turn/start', seq: 0, time: 1, data: {} },
      { type: 'user/message', seq: 1, time: 2, data: { content: 'first' } },
      { type: 'assistant/message', seq: 2, time: 3, data: { message: { content: [] } } },
      { type: 'turn/end', seq: 3, time: 4, data: {} },
      { type: 'turn/start', seq: 4, time: 5, data: {} },
      { type: 'user/message', seq: 5, time: 6, data: { content: 'second' } },
      { type: 'assistant/message', seq: 6, time: 7, data: { message: { content: [] } } },
      { type: 'turn/end', seq: 7, time: 8, data: {} },
    ], header: { cwd: '/w' } }
    const s = makeServices({ sessions: () => ({ get: () => source, fork: () => child }) })
    const preview = await handle('/api/sessions/s1/rewind', '', 'POST', { targetUserMessageId: 'evt-5', dryRun: true }, s, config)
    expect(preview?.status).toBe(200)
    expect(preview?.body.conversation.messagesRemoved).toBe(2)
    expect(preview?.body.code.available).toBe(false)
    const executed = await handle('/api/sessions/s1/rewind', '', 'POST', { targetUserMessageId: 'evt-5' }, s, config)
    expect(executed?.status).toBe(200)
    expect(executed?.body.sessionId).toBe('session-rewound')
  })

  test('tasks wrong method returns 405', async () => {
    expect(await handle('/api/tasks', '', 'PUT', {}, makeServices(), config)).toEqual({ status: 405, body: { error: 'method not allowed' } })
    expect(await handle('/api/tasks/lists', '', 'DELETE', undefined, makeServices(), config)).toEqual({ status: 405, body: { error: 'method not allowed' } })
  })

  test('computer-use open-settings falls through to 404', async () => {
    expect(await handle('/api/computer-use/open-settings', '', 'POST', undefined, makeServices(), config)).toBeNull()
  })

  test('computer-use unmounted status', async () => {
    const res = await handle('/api/computer-use/status', '', 'GET', undefined, makeServices(), config)
    expect(res?.status).toBe(200)
    expect(res?.body.supported).toBe(false)
    expect(res?.body.platform).toBe(process.platform)
  })

  test('computer-use mounted', async () => {
    const s = makeServices({ computerUse: () => ({
      async getRuntimeStatus() {
        return {
          platform: 'darwin' as const,
          supported: true,
          python: { installed: true, version: '3.12.1', path: '/usr/bin/python3', command: 'python3', prefixArgs: [], source: 'system' as const },
          venv: { created: true, path: '~/.rin/computer-use/venv' },
          dependencies: { installed: true, requirementsFound: true, sha256: 'abc' },
          preflight: { status: 'ok' as const, accessibility: true, screenRecording: false, detail: null },
        }
      },
      async installRuntime() { return { success: true, steps: [{ name: 'venv', ok: true, message: 'created' }] } },
      async listAuthorizedApps() { return [{ bundleId: 'com.app' }] },
      async getGrantFlags() { return { clipboardRead: true } },
    }) })
    const status = await handle('/api/computer-use/status', '', 'GET', undefined, s, config)
    expect(status?.status).toBe(200)
    expect(status?.body).toEqual({
      platform: 'darwin',
      supported: true,
      python: { installed: true, version: '3.12.1', path: '/usr/bin/python3' },
      venv: { created: true, path: '~/.rin/computer-use/venv' },
      dependencies: { installed: true, requirementsFound: true },
      permissions: { accessibility: true, screenRecording: false },
    })
    expect(await handle('/api/computer-use/apps', '', 'GET', undefined, s, config)).toEqual({ status: 200, body: { apps: [{ bundleId: 'com.app' }] } })
    expect(await handle('/api/computer-use/authorized-apps', '', 'GET', undefined, s, config)).toEqual({ status: 200, body: { authorizedApps: [{ bundleId: 'com.app' }], grantFlags: { clipboardRead: true } } })
    expect(await handle('/api/computer-use/setup', '', 'POST', undefined, s, config)).toEqual({ status: 200, body: { success: true, steps: [{ name: 'venv', ok: true, message: 'created' }] } })
  })

  test('computer-use unmounted setup reports unavailable', async () => {
    expect(await handle('/api/computer-use/setup', '', 'POST', undefined, makeServices(), config)).toEqual({
      status: 200,
      body: { success: false, steps: [{ name: 'python-environment', ok: false, message: 'computer-use runtime setup is not available on this host yet' }] },
    })
    expect(await handle('/api/computer-use/setup', '', 'GET', undefined, makeServices(), config)).toEqual({ status: 405, body: { error: 'method not allowed' } })
  })

  test('agent-migration unmounted scan', async () => {
    const res = await handle('/api/agent-migration/scan', '', 'GET', undefined, makeServices(), config)
    expect(res?.status).toBe(200)
    expect(res?.body.targetAgentId).toBe('claude-code')
    expect(res?.body.agents).toEqual([])
  })

  test('agent-migration mounted', async () => {
    const s = makeServices({ agentMigration: () => ({ async scan() { return { targetAgentId: 'cc', agents: [{ id: 'a' }] } } }) })
    const res = await handle('/api/agent-migration', '', 'GET', undefined, s, config)
    expect(res).toEqual({ status: 200, body: { targetAgentId: 'cc', agents: [{ id: 'a' }] } })
  })
})

describe('legacy: status diagnostics', () => {
  test('diagnostics returns node/process info', async () => {
    const res = await handle('/api/status/diagnostics', '', 'GET', undefined, makeServices(), config)
    expect(res?.status).toBe(200)
    expect(res?.body.nodeVersion).toBe(process.version)
    expect(res?.body.platform).toBe(process.platform)
    expect(res?.body.memory).toEqual({ rss: 0, heapUsed: 0, heapTotal: 0 })
  })

  test('status user returns identity', async () => {
    const res = await handle('/api/status/user', '', 'GET', undefined, makeServices(), config)
    expect(res?.status).toBe(200)
    expect(res?.body.username).toBe('rin')
    expect(typeof res?.body.homeDir).toBe('string')
  })
})
