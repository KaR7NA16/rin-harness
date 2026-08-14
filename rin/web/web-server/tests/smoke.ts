/**
 * rin web-server — strip-types smoke script.
 *
 * Exercises the pure HTTP helpers, static-path resolution, and — via a real
 * createWebServer bound to an ephemeral port — the new agents/notes/sandboxes/
 * token/smart-pruning write endpoints against injected fake services. Run with:
 *
 *   node --experimental-strip-types tests/smoke.ts
 *
 * The fake services are plain objects (not the real @rin stores), so this
 * script imports no cordis and no @rin runtime modules.
 */

import assert from 'node:assert/strict'
import { inspect } from 'node:util'
import { basename, dirname, join, relative, resolve as resolvePath } from 'node:path'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import {
  RIN_WEB_NAME,
  RIN_WEB_VERSION,
  parseBoolean,
  parseRepositoryQuery,
  parseEnvironmentPlanQuery,
  queryParam,
  parsePositiveInt,
  parsePromptMemoryTarget,
  healthResponse,
  error,
  smartPruningStatusResponse,
  notMounted,
  mounted,
  mountedValue,
  errorMessage,
  isSmartPruningLevel,
  isResponseStyle,
  asRecord,
  stringField,
  booleanField,
} from '../src/http.ts'
import { resolveStaticPath } from '../src/static.ts'
import { createWebServer } from '../src/server.ts'
import type { RinServiceRefs } from '../src/routes.ts'

let failures = 0
function expect(label, actual, expected) {
  try {
    assert.deepStrictEqual(actual, expected)
    console.log('PASS ' + label)
  } catch (err) {
    failures += 1
    console.error('FAIL ' + label)
    console.error('  expected:', inspect(expected))
    console.error('  actual:  ', inspect(actual))
  }
}

// product identity
expect('RIN_WEB_NAME', RIN_WEB_NAME, 'rin-web')
expect('RIN_WEB_VERSION', RIN_WEB_VERSION, '0.1.0')

// parseBoolean
expect('parseBoolean "true"', parseBoolean('true'), true)
expect('parseBoolean "TRUE"', parseBoolean('TRUE'), true)
expect('parseBoolean "1"', parseBoolean('1'), true)
expect('parseBoolean "yes"', parseBoolean('yes'), true)
expect('parseBoolean "on"', parseBoolean('on'), true)
expect('parseBoolean "false"', parseBoolean('false'), false)
expect('parseBoolean "0"', parseBoolean('0'), false)
expect('parseBoolean "no"', parseBoolean('no'), false)
expect('parseBoolean ""', parseBoolean(''), false)
expect('parseBoolean null', parseBoolean(null), false)

// parseRepositoryQuery
expect('parseRepositoryQuery root', parseRepositoryQuery('?root=C%3A%5Cfoo'), { root: 'C:\\foo' })
expect('parseRepositoryQuery empty', parseRepositoryQuery(''), { root: undefined })
expect('parseRepositoryQuery blank root', parseRepositoryQuery('?root='), { root: undefined })

// parseEnvironmentPlanQuery
expect('parseEnvironmentPlanQuery full', parseEnvironmentPlanQuery(
  '?profile=p1&root=r1&platform=linux&apt=true&python=1&pip=yes&r=on&npm=false&tlmgr=true',
  'win32',
), {
  profile: 'p1',
  root: 'r1',
  platform: 'linux',
  apt: true,
  python: true,
  pip: true,
  r: true,
  npm: false,
  tlmgr: true,
})
expect('parseEnvironmentPlanQuery defaults', parseEnvironmentPlanQuery('', 'darwin'), {
  profile: undefined,
  root: undefined,
  platform: 'darwin',
  apt: false,
  python: false,
  pip: false,
  r: false,
  npm: false,
  tlmgr: false,
})

// queryParam / parsePositiveInt / parsePromptMemoryTarget
expect('queryParam value', queryParam('?db=/tmp/kb', 'db'), '/tmp/kb')
expect('queryParam missing', queryParam('', 'db'), undefined)
expect('queryParam blank', queryParam('?db=', 'db'), undefined)
expect('parsePositiveInt 10', parsePositiveInt('?limit=10', 'limit'), 10)
expect('parsePositiveInt zero', parsePositiveInt('?limit=0', 'limit'), undefined)
expect('parsePositiveInt negative', parsePositiveInt('?limit=-1', 'limit'), undefined)
expect('parsePositiveInt non-numeric', parsePositiveInt('?limit=abc', 'limit'), undefined)
expect('parsePositiveInt missing', parsePositiveInt('', 'limit'), undefined)
expect('parsePromptMemoryTarget brief', parsePromptMemoryTarget('?target=brief'), 'brief')
expect('parsePromptMemoryTarget user', parsePromptMemoryTarget('?target=user'), 'user')
expect('parsePromptMemoryTarget soul', parsePromptMemoryTarget('?target=soul'), 'soul')
expect('parsePromptMemoryTarget invalid', parsePromptMemoryTarget('?target=bad'), undefined)
expect('parsePromptMemoryTarget missing', parsePromptMemoryTarget(''), undefined)

// new validation guards
expect('isSmartPruningLevel conservative', isSmartPruningLevel('conservative'), true)
expect('isSmartPruningLevel balanced', isSmartPruningLevel('balanced'), true)
expect('isSmartPruningLevel aggressive', isSmartPruningLevel('aggressive'), true)
expect('isSmartPruningLevel bogus', isSmartPruningLevel('bogus'), false)
expect('isSmartPruningLevel number', isSmartPruningLevel(1), false)
expect('isResponseStyle off', isResponseStyle('off'), true)
expect('isResponseStyle caveman', isResponseStyle('caveman'), true)
expect('isResponseStyle ponytail', isResponseStyle('ponytail'), true)
expect('isResponseStyle rtk', isResponseStyle('rtk'), false)
expect('asRecord object', asRecord({ a: 1 }), { a: 1 })
expect('asRecord array', asRecord([1, 2]), undefined)
expect('asRecord null', asRecord(null), undefined)
expect('asRecord string', asRecord('x'), undefined)
expect('stringField present', stringField({ a: 'v' }, 'a'), 'v')
expect('stringField absent', stringField({}, 'a'), undefined)
expect('stringField non-string', stringField({ a: 1 }, 'a'), undefined)
expect('booleanField true', booleanField({ b: true }, 'b'), true)
expect('booleanField non-bool', booleanField({ b: 'yes' }, 'b'), undefined)

// response shaping
expect('healthResponse', healthResponse({
  repository: true,
  environment: false,
  smartPruning: true,
  knowledge: false,
  sessionSearch: true,
  promptMemory: false,
  evolution: true,
  skillMemory: false,
  agents: true,
  notes: true,
  sandboxes: false,
  tokenOptimization: true,
}), {
  status: 200,
  body: {
    ok: true,
    name: 'rin-web',
    version: '0.1.0',
    services: {
      repository: true,
      environment: false,
      smartPruning: true,
      knowledge: false,
      sessionSearch: true,
      promptMemory: false,
      evolution: true,
      skillMemory: false,
      agents: true,
      notes: true,
      sandboxes: false,
      tokenOptimization: true,
    },
  },
})
expect('error envelope', error(400, 'repository root not configured; pass ?root='), {
  status: 400,
  body: { error: 'repository root not configured; pass ?root=' },
})
expect('smart-pruning not mounted', smartPruningStatusResponse({ mounted: false }), {
  status: 200,
  body: { mounted: false },
})
expect('smart-pruning mounted', smartPruningStatusResponse({ mounted: true, enabled: true, level: 'balanced', mode: 'deterministic' }), {
  status: 200,
  body: { mounted: true, enabled: true, level: 'balanced', mode: 'deterministic' },
})
expect('notMounted', notMounted(), { status: 200, body: { mounted: false } })
expect('mounted object', mounted({ a: 1, b: 'x' }), { status: 200, body: { mounted: true, a: 1, b: 'x' } })
expect('mountedValue array', mountedValue('sources', [{ id: 's1' }]), {
  status: 200,
  body: { mounted: true, sources: [{ id: 's1' }] },
})
expect('errorMessage Error', errorMessage(new Error('boom')), 'boom')
expect('errorMessage string', errorMessage('plain'), 'plain')

// static path resolution
const root = resolvePath('smoke-web-root')
expect('static index', resolveStaticPath(root, '/'), join(root, 'index.html'))
expect('static nested', resolveStaticPath(root, '/assets/app.js'), join(root, 'assets', 'app.js'))
expect('static traversal', resolveStaticPath(root, '/../secret.txt'), null)
expect('static nested traversal', resolveStaticPath(root, '/a/../../b'), null)
expect('static encoded traversal', resolveStaticPath(root, '/%2e%2e/secret.txt'), null)
expect('static encoded backslash', resolveStaticPath(root, '/a%5Cb'), null)
expect('static encoded null byte', resolveStaticPath(root, '/a%00b'), null)
expect('static dot segment', resolveStaticPath(root, '/a/./b'), null)
expect('static empty segment', resolveStaticPath(root, '/a//b'), null)

// ---------------------------------------------------------------------------
// Live server smoke over injected fake services.
// ---------------------------------------------------------------------------

/** A minimal file-backed notes fake exercising the real tmp filesystem. */
class FakeNotes {
  constructor(vault) {
    this.vault = vault
  }
  async write(path, content) {
    await mkdir(dirname(join(this.vault, path)), { recursive: true })
    await writeFile(join(this.vault, path), content, 'utf8')
    return this.read(path)
  }
  async read(path) {
    const content = await readFile(join(this.vault, path), 'utf8')
    const name = basename(path, '.md')
    return {
      path,
      name,
      folder: dirname(path),
      title: (content.split('\n')[0] ?? '').replace(/^#+\s*/, '') || name,
      sizeBytes: Buffer.byteLength(content),
      modifiedAt: new Date().toISOString(),
      tags: [],
      links: [],
      content,
    }
  }
  async delete(path) {
    await rm(join(this.vault, path), { force: true })
  }
  async list() {
    const out = []
    const walk = async (dir) => {
      let entries
      try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) await walk(full)
        else if (entry.name.endsWith('.md')) {
          const rel = relative(this.vault, full).split('\\').join('/')
          const name = basename(entry.name, '.md')
          out.push({
            path: rel,
            name,
            folder: dirname(rel),
            title: name,
            sizeBytes: 0,
            modifiedAt: new Date().toISOString(),
            tags: [],
            links: [],
          })
        }
      }
    }
    await walk(this.vault)
    return out
  }
  async search(query) {
    const q = query.toLowerCase()
    const files = []
    const walk = async (dir) => {
      let entries
      try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) await walk(full)
        else if (entry.name.endsWith('.md')) files.push(full)
      }
    }
    await walk(this.vault)
    const results = []
    for (const file of files) {
      const content = await readFile(file, 'utf8')
      if (content.toLowerCase().includes(q) || basename(file, '.md').toLowerCase().includes(q)) {
        results.push({
          path: relative(this.vault, file).split('\\').join('/'),
          name: basename(file, '.md'),
          title: '',
          snippet: '',
          score: 1,
        })
      }
    }
    return results
  }
  async graph() { return { nodes: [], edges: [] } }
  async todos() { return [] }
  async templates() { return [] }
  async backupSession(title, content) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    return this.write('backups/' + stamp + '-' + title + '.md', '# ' + title + '\n\n' + content)
  }
}

/** A minimal agents fake over a tmp repository root. */
class FakeAgents {
  constructor() {}
  async listRepositoryAgents() { return [] }
  async listRuntimeAgents() { return [] }
  async createRepositoryAgent(_root, input) {
    return { ...input, version: 2, kind: 'AgentConfiguration', tools: input.tools ?? [], revision: '0123456789ab' }
  }
  async updateRepositoryAgent(_root, name, input) {
    return { ...input, name, version: 2, kind: 'AgentConfiguration', tools: input.tools ?? [], revision: 'fedcba987654' }
  }
  async deleteRepositoryAgent() {
    return undefined
  }
  async projectRepositoryAgents(_root, options) {
    const presetRoot = options && typeof options.presetRoot === 'string' ? options.presetRoot : undefined
    if (presetRoot) {
      await mkdir(presetRoot, { recursive: true })
      await writeFile(join(presetRoot, 'agent.cordis.yml'), '# projected\n', 'utf8')
    }
    return { ids: ['projected-agent'] }
  }
  async proposeAgent(instructions) {
    if (instructions === 'boom') throw new Error('rin agents: no proposal adapter')
    return { name: 'proposed', description: 'drafted', systemPrompt: instructions, tools: [] }
  }
}

/** A minimal sandboxes fake over an in-memory profile map. */
class FakeSandboxes {
  constructor() {
    this.profiles = new Map()
  }
  async list() { return [...this.profiles.values()] }
  async get(id) { return this.profiles.get(id) ?? null }
  async create(input) {
    const profile = {
      id: 'sbx-1',
      name: input.name,
      type: input.type,
      isDefault: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    this.profiles.set(profile.id, profile)
    return profile
  }
  async update(id, patch) {
    const existing = this.profiles.get(id)
    if (!existing) throw new Error('profile not found')
    const next = { ...existing, ...patch, updatedAt: new Date().toISOString() }
    this.profiles.set(id, next)
    return next
  }
  async remove(id) { return this.profiles.delete(id) }
  async setDefault(id) {
    const existing = this.profiles.get(id)
    if (!existing) throw new Error('profile not found')
    const next = { ...existing, isDefault: true, updatedAt: new Date().toISOString() }
    this.profiles.set(id, next)
    return next
  }
  async probeCapabilities() {
    return { platform: 'linux', runtimes: { apt: true, python: true, pip: true, r: false, npm: true, tlmgr: false } }
  }
  async executeEnvironmentPlan(profile, repositoryId, environmentProfileId, plan) {
    const now = new Date().toISOString()
    return {
      id: 'run-1',
      sandboxProfileId: profile.id,
      repositoryId,
      environmentProfileId,
      status: 'ready',
      plan,
      logs: [],
      createdAt: now,
      updatedAt: now,
    }
  }
}

async function getJson(base, path) {
  const response = await fetch(base + path, { headers: { Accept: 'application/json' } })
  return { status: response.status, body: await response.json() }
}

async function postJson(base, path, body) {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

async function runHttpSmoke() {
  const tmp = await mkdtemp(join(tmpdir(), 'rin-web-smoke-'))
  try {
    const notes = new FakeNotes(join(tmp, 'vault'))
    const agents = new FakeAgents()
    const sandboxes = new FakeSandboxes()
    const token = {
      state: { responseStyle: 'off', cleanPrompt: false },
      getStatus() { return { ...this.state } },
      setResponseStyle(style) { this.state.responseStyle = style; return this.getStatus() },
      setCleanPrompt(value) { this.state.cleanPrompt = value; return this.getStatus() },
    }
    const smartPruning = {
      state: { enabled: false, level: 'balanced', mode: 'deterministic' },
      getStatus() { return { ...this.state } },
      setEnabled(value) { this.state.enabled = value; return this.getStatus() },
      setLevel(value) { this.state.level = value; return this.getStatus() },
    }
    const environment = {
      async plan(_root, profileId, _capabilities) {
        return { profileId, profileVersion: '1.0.0', status: 'ready', packageCount: 0, preflight: [], stages: [] }
      },
    }

    const services = {
      repository: () => undefined,
      environment: () => environment,
      smartPruning: () => smartPruning,
      knowledge: () => undefined,
      sessionSearch: () => undefined,
      promptMemory: () => undefined,
      evolution: () => undefined,
      skillMemory: () => undefined,
      agents: () => agents,
      notes: () => notes,
      sandboxes: () => sandboxes,
      tokenOptimization: () => token,
    }

    const server = createWebServer(
      { port: 0, host: '127.0.0.1', enabled: true, repositoryRoot: join(tmp, 'repo') },
      services,
    )
    const address = await server.listen(0, '127.0.0.1')
    const base = 'http://127.0.0.1:' + address.port
    try {
      await runEndpointAssertions(base, tmp)
    } finally {
      await server.close()
    }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

async function runEndpointAssertions(base, tmp) {
  // health reports the four new services
  let res = await getJson(base, '/api/health')
  expect('health status', res.status, 200)
  expect('health services', res.body.services, {
    repository: false,
    environment: true,
    smartPruning: true,
    knowledge: false,
    sessionSearch: false,
    promptMemory: false,
    evolution: false,
    skillMemory: false,
    agents: true,
    notes: true,
    sandboxes: true,
    tokenOptimization: true,
  })

  // notes: write / read / search / list / backup / delete
  res = await postJson(base, '/api/notes/write', { path: 'hello.md', content: '# Hello\nworld' })
  expect('notes write status', res.status, 200)
  expect('notes write mounted', res.body.mounted, true)
  expect('notes write path', res.body.note.path, 'hello.md')
  expect('notes write content', res.body.note.content, '# Hello\nworld')

  res = await getJson(base, '/api/notes/read?path=hello.md')
  expect('notes read status', res.status, 200)
  expect('notes read content', res.body.note.content, '# Hello\nworld')

  res = await getJson(base, '/api/notes/search?query=world')
  expect('notes search status', res.status, 200)
  expect('notes search count', res.body.results.length, 1)
  expect('notes search path', res.body.results[0].path, 'hello.md')

  res = await getJson(base, '/api/notes')
  expect('notes list contains write', res.body.notes.some(n => n.path === 'hello.md'), true)

  res = await getJson(base, '/api/notes/graph')
  expect('notes graph status', res.status, 200)
  expect('notes graph empty', res.body.graph, { nodes: [], edges: [] })

  res = await postJson(base, '/api/notes/backup', { title: 'Session One', content: 'backup body' })
  expect('notes backup status', res.status, 200)
  expect('notes backup prefix', res.body.note.path.startsWith('backups/'), true)

  res = await postJson(base, '/api/notes/delete', { path: 'hello.md' })
  expect('notes delete status', res.status, 200)
  expect('notes delete flag', res.body.deleted, true)

  res = await getJson(base, '/api/notes/read?path=hello.md')
  expect('notes read missing status', res.status, 404)

  // agents: create / list / runtime / project / propose (+ propose error)
  res = await postJson(base, '/api/agents', { input: { name: 'a1', description: 'd', systemPrompt: 'sp' } })
  expect('agents create status', res.status, 200)
  expect('agents create name', res.body.agent.name, 'a1')
  expect('agents create revision', res.body.agent.revision, '0123456789ab')

  res = await getJson(base, '/api/agents')
  expect('agents list status', res.status, 200)
  expect('agents list array', Array.isArray(res.body.agents), true)

  res = await getJson(base, '/api/agents/runtime')
  expect('agents runtime status', res.status, 200)
  expect('agents runtime array', Array.isArray(res.body.agents), true)

  res = await postJson(base, '/api/agents/project', { presetRoot: join(tmp, 'presets') })
  expect('agents project status', res.status, 200)
  expect('agents project ids', res.body.ids, ['projected-agent'])

  res = await postJson(base, '/api/agents/propose', { instructions: 'make me an agent' })
  expect('agents propose status', res.status, 200)
  expect('agents propose name', res.body.proposal.name, 'proposed')

  res = await postJson(base, '/api/agents/propose', { instructions: 'boom' })
  expect('agents propose error status', res.status, 500)
  expect('agents propose error message', res.body.error, 'rin agents: no proposal adapter')

  res = await postJson(base, '/api/agents', { input: { name: 'x' } })
  expect('agents create missing fields status', res.status, 400)

  res = await postJson(base, '/api/agents/a1/update', { input: { description: 'd2', systemPrompt: 'sp2' } })
  expect('agents update status', res.status, 200)
  expect('agents update name', res.body.agent.name, 'a1')
  expect('agents update description', res.body.agent.description, 'd2')

  res = await postJson(base, '/api/agents/a1/delete', {})
  expect('agents delete status', res.status, 200)
  expect('agents delete flag', res.body.deleted, true)

  // sandboxes: create / list / update / default / probe / execute / remove
  res = await postJson(base, '/api/sandboxes', { name: 'local', type: 'local-sandbox' })
  expect('sandboxes create status', res.status, 200)
  expect('sandboxes create id', res.body.sandbox.id, 'sbx-1')
  expect('sandboxes create name', res.body.sandbox.name, 'local')

  res = await getJson(base, '/api/sandboxes')
  expect('sandboxes list status', res.status, 200)
  expect('sandboxes list length', res.body.sandboxes.length, 1)

  res = await postJson(base, '/api/sandboxes/sbx-1/update', { name: 'renamed' })
  expect('sandboxes update status', res.status, 200)
  expect('sandboxes update name', res.body.sandbox.name, 'renamed')

  res = await postJson(base, '/api/sandboxes/sbx-1/default', {})
  expect('sandboxes default status', res.status, 200)
  expect('sandboxes default flag', res.body.sandbox.isDefault, true)

  res = await postJson(base, '/api/sandboxes/sbx-1/probe', {})
  expect('sandboxes probe status', res.status, 200)
  expect('sandboxes probe platform', res.body.capabilities.platform, 'linux')

  res = await postJson(base, '/api/sandboxes/execute', {
    profileId: 'sbx-1',
    repositoryId: 'repo-1',
    environmentProfileId: 'env-1',
    root: join(tmp, 'repo'),
  })
  expect('sandboxes execute status', res.status, 200)
  expect('sandboxes execute run id', res.body.run.id, 'run-1')
  expect('sandboxes execute run status', res.body.run.status, 'ready')

  res = await postJson(base, '/api/sandboxes/sbx-1/remove', {})
  expect('sandboxes remove status', res.status, 200)
  expect('sandboxes remove flag', res.body.removed, true)

  res = await postJson(base, '/api/sandboxes', { name: 'bad', type: 'nope' })
  expect('sandboxes invalid type status', res.status, 400)

  // token: status / set / validation
  res = await getJson(base, '/api/token-optimization/status')
  expect('token status 200', res.status, 200)
  expect('token status body', res.body, { mounted: true, responseStyle: 'off', cleanPrompt: false })

  res = await postJson(base, '/api/token-optimization/set', { responseStyle: 'ponytail' })
  expect('token set style status', res.status, 200)
  expect('token set style value', res.body.responseStyle, 'ponytail')

  res = await postJson(base, '/api/token-optimization/set', { cleanPrompt: true })
  expect('token set clean status', res.status, 200)
  expect('token set clean value', res.body.cleanPrompt, true)

  res = await postJson(base, '/api/token-optimization/set', { responseStyle: 'bogus' })
  expect('token invalid style status', res.status, 400)

  res = await postJson(base, '/api/token-optimization/set', {})
  expect('token empty body status', res.status, 400)

  // smart-pruning: status / set / validation
  res = await getJson(base, '/api/smart-pruning/status')
  expect('smart-pruning status 200', res.status, 200)
  expect('smart-pruning status level', res.body.level, 'balanced')

  res = await postJson(base, '/api/smart-pruning/set', { enabled: true, level: 'aggressive' })
  expect('smart-pruning set status', res.status, 200)
  expect('smart-pruning set enabled', res.body.enabled, true)
  expect('smart-pruning set level', res.body.level, 'aggressive')

  res = await postJson(base, '/api/smart-pruning/set', { level: 'bogus' })
  expect('smart-pruning invalid level status', res.status, 400)

  res = await postJson(base, '/api/smart-pruning/set', {})
  expect('smart-pruning empty body status', res.status, 400)

  // POST body guard: invalid JSON → 400; non-API POST → 405
  const badJson = await fetch(base + '/api/token-optimization/set', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{ not json',
  })
  expect('invalid JSON body status', badJson.status, 400)

  const nonApiPost = await fetch(base + '/index.html', { method: 'POST', body: 'x' })
  expect('non-API POST status', nonApiPost.status, 405)

  console.log('')
  console.log('sample health body:', inspect(healthResponse({
    repository: false,
    environment: true,
    smartPruning: true,
    knowledge: false,
    sessionSearch: false,
    promptMemory: false,
    evolution: false,
    skillMemory: false,
    agents: true,
    notes: true,
    sandboxes: true,
    tokenOptimization: true,
  }).body))
}

await runHttpSmoke()

if (failures > 0) {
  console.error('smoke: ' + failures + ' failure(s)')
  process.exitCode = 1
} else {
  console.log('smoke: all assertions passed')
  console.log('SMOKE-OK')
}
