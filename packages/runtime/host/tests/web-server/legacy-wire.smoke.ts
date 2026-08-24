/**
 * rin web-server — legacy endpoint wiring strip-types smoke.
 *
 * Exercises the legacy.ts dispatcher directly with fake services, asserting
 * each newly wired A/B/D endpoint returns real (fake) data instead of the old
 * empty-state stubs. Run from the package directory:
 *
 *   node --experimental-strip-types tests/legacy-wire.smoke.ts
 *
 * The fake services are plain objects (no cordis, no @rin runtime modules).
 */

import assert from 'node:assert/strict'
import { inspect } from 'node:util'
import { handle } from '../../src/web-server/routes/legacy.ts'

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

const config = {}

/** Fake dsh shell: returns canned git output per command. */
const shell = {
  resolve(request) {
    return request
  },
  async run(spec) {
    if (spec.command.includes('rev-parse --abbrev-ref')) {
      return { exitCode: 0, stdout: { text: 'main\n' } }
    }
    if (spec.command.includes('remote get-url origin')) {
      return { exitCode: 0, stdout: { text: 'https://github.com/user/repo.git\n' } }
    }
    if (spec.command.includes('status --porcelain')) {
      return { exitCode: 0, stdout: { text: 'M file.txt\n' } }
    }
    return { exitCode: 1, stdout: { text: '' } }
  },
}

const services = {
  repository: () => undefined,
  environment: () => undefined,
  smartPruning: () => undefined,
  knowledge: () => undefined,
  sessionSearch: () => undefined,
  evolution: () => undefined,
  skillMemory: () => undefined,
  agents: () => undefined,
  sandboxes: () => undefined,
  tokenOptimization: () => undefined,
  sessionPersistence: () => undefined,
  llm: () => undefined,
  promptMemory: () => ({
    async getStatus() {
      return {
        files: {
          user: { entries: ['Call me Alice'] },
          brief: { entries: ['[workflow] Run tests first'] },
        },
      }
    },
    async readReviewLogs(_limit) {
      return [
        {
          timestamp: '2026-01-01T00:00:00.000Z',
          trigger: 'explicit',
          target: 'user',
          changed: true,
          content: 'Call me Alice',
          message: 'added',
        },
      ]
    },
  }),
  notes: () => ({
    async listSnapshots(path) {
      return [{ id: 'snap-1', createdAt: '2026-01-01T00:00:00.000Z', sizeBytes: 10, notePath: path }]
    },
    async readSnapshot(path, id) {
      return { path, name: 'hello', title: 'Hello', content: 'snapshot ' + id, modifiedAt: '2026-01-01T00:00:00.000Z', tags: [], links: [], sizeBytes: 4, folder: '' }
    },
  }),
  tasks: () => ({
    async listTaskLists() {
      return [{ id: 'list-1', taskCount: 2, completedCount: 1, inProgressCount: 1, pendingCount: 0 }]
    },
    async listTasks() {
      return [{ id: '1', subject: 'do thing', description: '', status: 'pending', blocks: [], blockedBy: [], taskListId: 'list-1' }]
    },
  }),
  teams: () => ({
    async list() {
      return [{ name: 'team-a', memberCount: 1, activeMemberCount: 1, createdAt: 0, updatedAt: 0 }]
    },
  }),
  mcp: () => ({
    async list() {
      return [{ name: 'srv', transport: 'stdio', command: 'npx', args: ['-y', 'mcp'], env: {}, status: 'checking' }]
    },
  }),
  computerUse: () => ({
    async getRuntimeStatus() {
      return {
        platform: process.platform,
        supported: true,
        python: { installed: true, version: '3.12', path: '/usr/bin/python3' },
        venv: { created: true, path: '/tmp/rin-cu-venv' },
        dependencies: { installed: true, requirementsFound: true, sha256: 'abc123' },
        preflight: { accessibility: true, screenRecording: true },
      }
    },
    async listAuthorizedApps() {
      return [{ bundleId: 'com.app', displayName: 'App', authorizedAt: '2026-01-01T00:00:00.000Z' }]
    },
    async getGrantFlags() {
      return { clipboardRead: true, clipboardWrite: false, systemKeyCombos: false }
    },
  }),
  agentMigration: () => ({
    async scan() {
      return {
        scannedAt: '2026-01-01T00:00:00.000Z',
        targetAgentId: 'claude-code',
        agents: [{ id: 'claude-code', name: 'Claude Code', source: '/home', status: 'detected' }],
      }
    },
  }),
  credentials: () => ({
    async describe(ref) {
      if (ref === 'DEEPSEEK_API_KEY') return { configured: true, source: 'env', writable: false }
      return { configured: false, writable: false }
    },
  }),
  agentDefaultModel: () => ({
    currentSelection() {
      return { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
    },
  }),
  workspaceRegistry: () => ({
    list() {
      return [
        {
          id: 'w1',
          path: '/tmp/proj',
          title: 'proj',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
          sessionIds: ['s1', 's2'],
          status: async () => 'ok',
        },
      ]
    },
  }),
  sessions: () => ({
    list() {
      return []
    },
    get(id) {
      return { id, events: [], header: { cwd: '/tmp/proj' }, seq: 0 }
    },
    create() {
      return { id: 's-new', events: [] }
    },
  }),
  dshAgents: () => ({
    async create() {
      throw new Error('not used')
    },
    get(id) {
      return {
        id,
        session: { id },
        ctx: { on() { return () => {} } },
        followup() {},
        cancel() {},
        whenIdle() { return Promise.resolve() },
      }
    },
  }),
  commands: () => ({
    list(_agent) {
      return [{ name: 'test-cmd', description: 'A test command' }]
    },
  }),
  tokenMeter: () => ({
    measure(_session) {
      return { totalTokens: 42, surfaceTokens: 10, baseline: { kind: 'estimated', tokens: 42 } }
    },
  }),
  sessionProjections: () => ({
    snapshot(_session) {
      return {
        asOfSeq: 0,
        values: {
          tokenUsage: { uncachedInputTokens: 10, outputTokens: 5, cacheReadTokens: 3, cacheWriteTokens: 2 },
          contextPressure: { pressureTokens: 12, projectedTokens: 15, contextWindow: 100 },
        },
      }
    },
  }),
  shell: () => shell,
}

async function main() {
  let res

  // B2 prompt-memory insights → real insight array + stats
  res = await handle('/api/prompt-memory/insights', '', 'GET', undefined, services, config)
  expect('insights status', res.status, 200)
  expect('insights count', res.body.insights.length, 2)
  expect('insights stats total', res.body.stats.total, 2)
  expect('insights has explicit user', res.body.insights.some(i => i.target === 'user' && i.source === 'explicit'), true)

  // B1 notes snapshots + snapshot
  res = await handle('/api/notes/snapshots', '?path=hello.md', 'GET', undefined, services, config)
  expect('snapshots status', res.status, 200)
  expect('snapshots list', res.body.snapshots, [{ id: 'snap-1', createdAt: '2026-01-01T00:00:00.000Z', sizeBytes: 10, notePath: 'hello.md' }])

  res = await handle('/api/notes/snapshot', '?path=hello.md&id=snap-1', 'GET', undefined, services, config)
  expect('snapshot status', res.status, 200)
  expect('snapshot content', res.body.content, 'snapshot snap-1')

  res = await handle('/api/notes/snapshot', '', 'GET', undefined, services, config)
  expect('snapshot missing params', res.status, 400)

  // A1 tasks + task lists
  res = await handle('/api/tasks', '', 'GET', undefined, services, config)
  expect('tasks status', res.status, 200)
  expect('tasks list length', res.body.tasks.length, 1)
  expect('tasks first subject', res.body.tasks[0].subject, 'do thing')

  res = await handle('/api/tasks/lists', '', 'GET', undefined, services, config)
  expect('task lists status', res.status, 200)
  expect('task lists first id', res.body.lists[0].id, 'list-1')

  // A2 teams
  res = await handle('/api/teams', '', 'GET', undefined, services, config)
  expect('teams status', res.status, 200)
  expect('teams first name', res.body.teams[0].name, 'team-a')

  // A3 mcp with desktop DTO projection
  res = await handle('/api/mcp', '', 'GET', undefined, services, config)
  expect('mcp status', res.status, 200)
  expect('mcp first name', res.body.servers[0].name, 'srv')
  expect('mcp scope', res.body.servers[0].scope, 'user')
  expect('mcp enabled', res.body.servers[0].enabled, true)
  expect('mcp statusLabel', res.body.servers[0].statusLabel, 'Checking')
  expect('mcp summary', res.body.servers[0].summary, 'npx -y mcp')
  expect('mcp canEdit', res.body.servers[0].canEdit, true)

  // A4 computer-use
  res = await handle('/api/computer-use/status', '', 'GET', undefined, services, config)
  expect('computer-use status supported', res.body.supported, true)
  expect('computer-use status permissions accessibility', res.body.permissions.accessibility, true)
  expect('computer-use status permissions screenRecording', res.body.permissions.screenRecording, true)

  res = await handle('/api/computer-use/apps', '', 'GET', undefined, services, config)
  expect('computer-use apps length', res.body.apps.length, 1)
  expect('computer-use apps bundleId', res.body.apps[0].bundleId, 'com.app')

  res = await handle('/api/computer-use/authorized-apps', '', 'GET', undefined, services, config)
  expect('computer-use authorized-apps length', res.body.authorizedApps.length, 1)
  expect('computer-use grantFlags clipboardRead', res.body.grantFlags.clipboardRead, true)

  // A5 agent-migration
  res = await handle('/api/agent-migration/scan', '', 'GET', undefined, services, config)
  expect('agent-migration targetAgentId', res.body.targetAgentId, 'claude-code')
  expect('agent-migration agents length', res.body.agents.length, 1)

  // D auth-status
  res = await handle('/api/providers/auth-status', '', 'GET', undefined, services, config)
  expect('auth-status hasAuth', res.body.hasAuth, true)
  expect('auth-status source', res.body.source, 'env')
  expect('auth-status activeProvider', res.body.activeProvider, 'deepseek-official')

  // D recent-projects
  res = await handle('/api/sessions/recent-projects', '?limit=5', 'GET', undefined, services, config)
  expect('recent-projects length', res.body.projects.length, 1)
  expect('recent-projects name', res.body.projects[0].projectName, 'proj')
  expect('recent-projects isGit', res.body.projects[0].isGit, true)
  expect('recent-projects repoName', res.body.projects[0].repoName, 'repo')
  expect('recent-projects branch', res.body.projects[0].branch, 'main')
  expect('recent-projects sessionCount', res.body.projects[0].sessionCount, 2)

  // D git-info
  res = await handle('/api/sessions/s1/git-info', '', 'GET', undefined, services, config)
  expect('git-info status', res.status, 200)
  expect('git-info branch', res.body.branch, 'main')
  expect('git-info repoName', res.body.repoName, 'repo')
  expect('git-info workDir', res.body.workDir, '/tmp/proj')
  expect('git-info changedFiles', res.body.changedFiles, 1)

  // D usage
  res = await handle('/api/sessions/s1/usage', '', 'GET', undefined, services, config)
  expect('usage status', res.status, 200)
  expect('usage totalInputTokens', res.body.usage.totalInputTokens, 15)
  expect('usage totalOutputTokens', res.body.usage.totalOutputTokens, 5)
  expect('usage context model', res.body.context.model, 'deepseek-v4-flash')
  expect('usage context usedTokens', res.body.context.usedTokens, 15)
  expect('usage context percentage', res.body.context.percentage, 15)

  // D slash-commands
  res = await handle('/api/sessions/s1/slash-commands', '', 'GET', undefined, services, config)
  expect('slash-commands status', res.status, 200)
  expect('slash-commands list', res.body.commands, [{ name: 'test-cmd', description: 'A test command' }])

  // fallback: unmounted service keeps the old empty-state shape
  const emptyServices = { ...services, tasks: () => undefined }
  res = await handle('/api/tasks', '', 'GET', undefined, emptyServices, config)
  expect('tasks unmounted fallback', res.body, { lists: [], tasks: [] })

  if (failures > 0) {
    console.error('legacy-wire smoke: ' + failures + ' failure(s)')
    process.exitCode = 1
  } else {
    console.log('legacy-wire smoke: all assertions passed')
    console.log('LEGACY-WIRE-SMOKE-OK')
  }
}

await main()
