/**
 * @rin/host — real HTTP intent-route smoke (Wave 7 owner controls end-to-end).
 *
 * Boots the actual host assembly with the web server enabled and drives the
 * owner intent routes over real HTTP: erase preview → authorize → commit
 * (scoped erasure), corrections, influence restrict/revoke, and the journal
 * export that must expose every committed intent transaction. This is the
 * HTTP-layer complement to memory-lifecycle.smoke.ts, which exercises the
 * same commands at service level.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer as createNetServer } from 'node:net'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  MemoryCognitionDatabase,
  createMemory,
  createMemoryId,
  createParticipantId,
  type MemoryTransaction,
  type RinMemory,
} from '@rin/memory'
import { registerRinPromptMemorySeam } from '../src/host.ts'
import {
  baseBundlePatchPath,
  builtinRepositoryRoot,
  configPath,
  defaultConfig,
  credentialsPath,
  dshHome,
  rinHome,
  sessionRoot,
  settingsPath,
  webUiDistRoot,
} from '@rin/host'

process.env.RIN_PACKAGED_RUNTIME = '1'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => resolve(port))
    })
    server.on('error', reject)
  })
}

function buildPatches(port: number) {
  return [
    ...loadOverlayPatches('rin', baseBundlePatchPath()),
    {
      id: 'web-server',
      config: { ...defaultConfig['web-server'], enabled: true, host: '127.0.0.1', port },
    },
    { id: 'session-persistence-jsonl', config: { root: sessionRoot() } },
    { id: 'settings', config: { path: settingsPath(), dshHome: dshHome() } },
    { id: 'credentials', config: { path: credentialsPath(), dshHome: dshHome() } },
    {
      id: 'session-query-sqlite',
      config: { path: rinHome('sessions/search.sqlite'), openAt: 'first-search' },
    },
    { id: 'tools', config: { mode: 'both' } },
    { id: 'tool-bash', disabled: true },
    { id: 'hmr', disabled: true },
  ]
}

async function bootRinHost(port: number) {
  return boot(
    'rin',
    configPath(),
    buildPatches(port),
    hostCtx => {
      hostCtx.provide('rinHome', rinHome)
      hostCtx.provide('dshHome', dshHome)
      hostCtx.provide('sessionRoot', sessionRoot)
      hostCtx.provide('settingsPath', settingsPath)
      hostCtx.provide('credentialsPath', credentialsPath)
      hostCtx.provide('builtinRepositoryRoot', builtinRepositoryRoot)
      hostCtx.provide('webUiDistRoot', webUiDistRoot)
    },
    undefined,
  )
}

type Json = Record<string, unknown>

async function api(port: number, method: string, path: string, body?: unknown): Promise<{ status: number; body: Json }> {
  const response = await fetch('http://127.0.0.1:' + port + path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() as Json }
}

async function waitUntilReady(port: number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await api(port, 'GET', '/api/memory/manifest')
      if (response.status === 200) return
    } catch {
      // The listener may not be accepting yet; retry.
    }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error('memory manifest endpoint never became ready on port ' + port)
}

function sceneMemory(id: string, observation: string): RinMemory {
  return createMemory({
    id: createMemoryId(id),
    form: 'scene',
    data: {
      participants: [createParticipantId('user-1')],
      environment: 'http-smoke',
      goals: [],
      observations: [observation],
      interpretations: [],
      actions: [],
      outcomes: [],
      predictionErrors: [],
      affect: { valence: 0.2, arousal: 0.4, control: 0.7 },
    },
    state: {
      persistence: 'durable',
      activation: 'dormant',
      integration: 'integrated',
      epistemic: 'observed',
      influence: 'blocked',
    },
    dynamics: {
      activation: 0.1,
      accessibility: 0.4,
      salience: 0.6,
      stability: 0.2,
      confidence: 0.8,
      integrationStrength: 0.1,
      novelty: 0.7,
      surprise: 0.5,
      affect: { valence: 0.2, arousal: 0.4, control: 0.7 },
      validity: { startsAt: '2026-01-01T00:00:00.000Z' },
      utilityByGoal: [],
      inhibition: 0.2,
      influenceSurfaces: [],
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })
}

async function main(): Promise<void> {
  const sandbox = await mkdtemp(join(tmpdir(), 'rin-memory-http-'))
  const port = await freePort()
  const previous = {
    RIN_HOME: process.env.RIN_HOME,
    DSH_HOME: process.env.DSH_HOME,
  }
  process.env.RIN_HOME = join(sandbox, 'rin-home')
  process.env.DSH_HOME = join(sandbox, 'dsh-home')

  let ctx: Awaited<ReturnType<typeof bootRinHost>> | undefined
  let detach: (() => unknown) | undefined
  try {
    ctx = await bootRinHost(port)
    await registerRinPromptMemorySeam(ctx)
    await waitUntilReady(port)

    const session = ctx.sessions.prepare('http-smoke-session')
    detach = ctx.sessions.enter(session)
    ctx.sessions.announce(session)
    session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: 'http intent smoke observation' }],
        source: { kind: 'user' },
      }),
      { surfaceOp: 'append' },
    )
    await new Promise<void>(resolve => setImmediate(resolve))
    await ctx.sessions.flush(session)

    // Seed one erasable root scene and one unrelated survivor through the
    // cognition journal, exactly as the runtime would have stored them.
    const cognition = new MemoryCognitionDatabase(rinHome('memory/memory.db'))
    const seedScene = (id: string, observation: string): void => {
      const memory = sceneMemory(id, observation)
      const runtime = { kind: 'runtime' as const, id: 'http-smoke-runtime' }
      cognition.appendTransaction({
        kind: 'memory-transaction',
        protocolVersion: 1,
        transactionId: 'http-tx-' + id,
        commandId: 'http-command-' + id,
        correlationId: 'http-correlation-' + id,
        actor: runtime,
        openedAt: '2026-01-01T00:00:01.000Z',
        committedAt: '2026-01-01T00:00:01.000Z',
        command: {
          kind: 'memory-command',
          protocolVersion: 1,
          type: 'observe',
          commandId: 'http-command-' + id,
          correlationId: 'http-correlation-' + id,
          actor: runtime,
          issuedAt: '2026-01-01T00:00:01.000Z',
          payload: { memory },
        },
        events: [{
          kind: 'memory-event',
          protocolVersion: 1,
          type: 'memory-observed',
          eventId: 'http-event-' + id,
          transactionId: 'http-tx-' + id,
          commandId: 'http-command-' + id,
          position: 0,
          actor: runtime,
          occurredAt: '2026-01-01T00:00:01.000Z',
          payload: { memory },
        }],
      } as MemoryTransaction)
    }
    seedScene('http-root-scene', 'the scene the owner erases over http')
    seedScene('http-unrelated-scene', 'a similar but unsupported scene over http')

    // ---- scoped erasure over HTTP: preview → authorize → commit
    const preview = await api(port, 'POST', '/api/memory/erase/preview', {
      rootMemoryIds: ['http-root-scene'],
    })
    assert(preview.status === 200, 'erase preview must return 200')
    const previewBody = preview.body as { mounted: boolean; preview?: { erasedMemoryIds: string[]; unaffectedMemoryIds: string[]; scopeHash: string } }
    assert(previewBody.mounted === true && previewBody.preview !== undefined, 'erase preview must be mounted with a scope')
    assert(
      JSON.stringify(previewBody.preview?.erasedMemoryIds) === JSON.stringify(['http-root-scene']),
      'the preview must erase exactly the authorized root over HTTP',
    )
    assert(
      previewBody.preview?.unaffectedMemoryIds.includes('http-unrelated-scene') === true,
      'the preview must keep the unrelated scene unaffected',
    )

    const authorized = await api(port, 'POST', '/api/memory/erase/authorize', {
      rootMemoryIds: ['http-root-scene'],
      ownerId: 'http-owner',
    })
    assert(authorized.status === 200, 'erase authorize must return 200')
    const authorizationId = (authorized.body as { authorization?: { authorization?: { authorizationId?: string } } }).authorization?.authorization?.authorizationId
    assert(
      typeof authorizationId === 'string' && authorizationId.length > 0,
      'erase authorize must return an authorization id',
    )

    const committed = await api(port, 'POST', '/api/memory/erase/commit', {
      authorizationId,
      ownerId: 'http-owner',
    })
    assert(committed.status === 200, 'erase commit must return 200')
    const erased = (committed.body as { commit?: { erasedMemoryIds?: string[] } }).commit?.erasedMemoryIds
    assert(
      JSON.stringify(erased) === JSON.stringify(['http-root-scene']),
      'the committed erasure must report exactly the authorized scope',
    )

    const scenes = await api(port, 'GET', '/api/memory/scenes')
    assert(scenes.status === 200, 'scenes query must return 200')
    const sceneIds = ((scenes.body as { scenes?: Array<{ id: string }> }).scenes ?? []).map(scene => scene.id)
    assert(!sceneIds.includes('http-root-scene'), 'the erased root must disappear from the scenes query')
    assert(sceneIds.includes('http-unrelated-scene'), 'the unrelated scene must survive in the scenes query')

    const replay = await api(port, 'POST', '/api/memory/erase/commit', { authorizationId, ownerId: 'http-owner' })
    assert(replay.status === 409, 'a consumed authorization must answer 409 over HTTP')

    // ---- correction over HTTP: replace one observation of the survivor
    const correctedData = {
      ...sceneMemory('http-unrelated-scene', 'ignored').data,
      observations: ['the owner corrected the scene over http'],
    }
    const correction = await api(port, 'POST', '/api/memory/corrections', {
      memoryId: 'http-unrelated-scene',
      replacement: { form: 'scene', data: correctedData },
      explanation: 'the owner corrected what happened',
      ownerId: 'http-owner',
    })
    assert(correction.status === 200, 'the correction intent must return 200 over HTTP')

    // ---- influence restrict and revoke over HTTP
    const restrict = await api(port, 'POST', '/api/memory/influence/restrict', {
      memoryId: 'http-unrelated-scene',
      surfaces: ['recall'],
      reason: 'the owner restricts this scene over http',
      ownerId: 'http-owner',
    })
    assert(restrict.status === 200, 'influence restrict must return 200 over HTTP')
    const revoke = await api(port, 'POST', '/api/memory/influence/revoke', {
      memoryId: 'http-unrelated-scene',
      reason: 'the owner revokes this scene over http',
      ownerId: 'http-owner',
    })
    assert(revoke.status === 200, 'influence revoke must return 200 over HTTP')

    // ---- the journal export must expose every committed intent transaction
    const journal = await api(port, 'GET', '/api/memory/journal')
    assert(journal.status === 200, 'journal export must return 200 over HTTP')
    const transactions = (journal.body as { transactions?: Array<{ command: { type: string } }> }).transactions ?? []
    const types = new Set(transactions.map(transaction => transaction.command.type))
    for (const expected of ['authorize-erase', 'commit-erase', 'correct', 'restrict-influence', 'revoke-influence']) {
      assert(types.has(expected), 'the journal export must contain the ' + expected + ' intent transaction')
    }

    console.log('REAL-HTTP-MEMORY-INTENT-SMOKE-OK', JSON.stringify({
      port,
      erasedScope: erased,
      correctionCommitted: types.has('correct'),
      restrictCommitted: types.has('restrict-influence'),
      revokeCommitted: types.has('revoke-influence'),
      journalTransactions: transactions.length,
    }))
  } finally {
    if (detach !== undefined) await detach()
    if (ctx !== undefined) await ctx.fiber.dispose()
    if (previous.RIN_HOME === undefined) delete process.env.RIN_HOME
    else process.env.RIN_HOME = previous.RIN_HOME
    if (previous.DSH_HOME === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous.DSH_HOME
    await rm(sandbox, { recursive: true, force: true })
  }
}

await main()
