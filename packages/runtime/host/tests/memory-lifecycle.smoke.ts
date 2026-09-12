/**
 * @rin/host — real memory lifecycle smoke (Wave 8 acceptance: E-13 / E-16 / E-18).
 *
 * Boots the actual host assembly against one isolated RIN_HOME and verifies,
 * through the real services and the real cognition journal:
 *
 * - E-13: an owner-authorized erasure removes exactly the authorized root,
 *   leaves its direct support/derive dependent present but evidence-retracted,
 *   and keeps unrelated scenes fully intact; the consumed authorization cannot
 *   commit again.
 * - E-16: a crash injected between the transaction row and the event rows of a
 *   projection update rolls back atomically (no half transaction in the real
 *   journal), and the next committed transaction marks projections dirty so
 *   stale projections cannot enter model input until they are rebuilt; the
 *   real prompt seam assembles again after recovery.
 * - E-18: given a reply cycle, the actual model input order and hash
 *   reconstruct from the persisted journal — the persisted recall workspace,
 *   its item order, the workspace hash, the stored input snapshot, and its
 *   SHA-256 input hash all match a full journal replay of the live host state.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { isDeepStrictEqual } from 'node:util'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  MemoryCognitionDatabase,
  MemoryMaterializer,
  createLinkId,
  createMemory,
  createMemoryCommandId,
  createMemoryCorrelationId,
  createMemoryEventId,
  createMemoryId,
  createMemoryLink,
  createMemoryTransaction,
  createMemoryTransactionId,
  createParticipantId,
  createRuntimeActor,
  hashMaterializedState,
  hashModelInput,
  memoryVersion,
  type MemoryCommand,
  type MemoryEvent,
  type MemoryLink,
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

function buildPatches() {
  return [
    ...loadOverlayPatches('rin', baseBundlePatchPath()),
    {
      id: 'web-server',
      config: { ...defaultConfig['web-server'], enabled: false, port: 0 },
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

async function bootRinHost() {
  return boot(
    'rin',
    configPath(),
    buildPatches(),
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

async function publishUserMessage(ctx: Awaited<ReturnType<typeof bootRinHost>>, id: string, text: string) {
  const session = ctx.sessions.prepare(id)
  const detach = ctx.sessions.enter(session)
  ctx.sessions.announce(session)
  session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    }),
    { surfaceOp: 'append' },
  )
  await new Promise<void>(resolve => setImmediate(resolve))
  await ctx.sessions.flush(session)
  return { session, detach }
}

function sceneMemory(id: string, observation: string): RinMemory {
  return createMemory({
    id: createMemoryId(id),
    form: 'scene',
    data: {
      participants: [createParticipantId('user-1')],
      environment: 'lifecycle-smoke',
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

function structureMemory(id: string): RinMemory {
  return createMemory({
    id: createMemoryId(id),
    form: 'structure',
    data: {
      entities: ['user-1'],
      relations: [],
      concepts: ['lifecycle smoke pattern'],
      causalPatterns: ['the scoped erase keeps evidence-backed dependents alive but blocked'],
      validity: { startsAt: '2026-01-01T00:00:00.000Z' },
    },
    state: {
      persistence: 'durable',
      activation: 'dormant',
      integration: 'integrated',
      epistemic: 'inferred',
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

function observeTransaction(memory: RinMemory): MemoryTransaction {
  const runtime = createRuntimeActor('lifecycle-smoke-runtime')
  const command: MemoryCommand = {
    kind: 'memory-command',
    protocolVersion: 1,
    type: 'observe',
    commandId: createMemoryCommandId('lifecycle-command-' + String(memory.id)),
    correlationId: createMemoryCorrelationId('lifecycle-correlation-' + String(memory.id)),
    actor: runtime,
    issuedAt: '2026-01-01T00:00:01.000Z',
    payload: { memory },
  }
  const event: MemoryEvent = {
    kind: 'memory-event',
    protocolVersion: 1,
    type: 'memory-observed',
    eventId: createMemoryEventId('lifecycle-event-' + String(memory.id)),
    transactionId: createMemoryTransactionId('lifecycle-transaction-' + String(memory.id)),
    commandId: command.commandId,
    position: 0,
    actor: runtime,
    occurredAt: '2026-01-01T00:00:01.000Z',
    payload: { memory },
  }
  return createMemoryTransaction({
    transactionId: event.transactionId,
    commandId: command.commandId,
    correlationId: command.correlationId,
    actor: runtime,
    openedAt: command.issuedAt,
    committedAt: event.occurredAt,
    command,
    events: [event],
  })
}

function supportLink(id: string, from: RinMemory, to: RinMemory): MemoryLink {
  return createMemoryLink({
    id: createLinkId(id),
    from: from.id,
    relation: 'supports',
    to: to.id,
    fromVersion: memoryVersion(from),
    toVersion: memoryVersion(to),
    strength: 0.8,
    validity: { startsAt: '2026-01-01T00:00:00.000Z' },
    state: 'active',
    createdAt: '2026-01-01T00:00:02.000Z',
    updatedAt: '2026-01-01T00:00:02.000Z',
  })
}

function linkTransaction(links: readonly MemoryLink[]): MemoryTransaction {
  const runtime = createRuntimeActor('lifecycle-smoke-runtime')
  const command: MemoryCommand = {
    kind: 'memory-command',
    protocolVersion: 1,
    type: 'link',
    commandId: createMemoryCommandId('lifecycle-command-links'),
    correlationId: createMemoryCorrelationId('lifecycle-correlation-links'),
    actor: runtime,
    issuedAt: '2026-01-01T00:00:02.000Z',
    payload: { links },
  }
  const event: MemoryEvent = {
    kind: 'memory-event',
    protocolVersion: 1,
    type: 'memory-linked',
    eventId: createMemoryEventId('lifecycle-event-links'),
    transactionId: createMemoryTransactionId('lifecycle-transaction-links'),
    commandId: command.commandId,
    position: 0,
    actor: runtime,
    occurredAt: '2026-01-01T00:00:02.000Z',
    payload: { links },
  }
  return createMemoryTransaction({
    transactionId: event.transactionId,
    commandId: command.commandId,
    correlationId: command.correlationId,
    actor: runtime,
    openedAt: command.issuedAt,
    committedAt: event.occurredAt,
    command,
    events: [event],
  })
}

async function main(): Promise<void> {
  const sandbox = await mkdtemp(join(tmpdir(), 'rin-memory-lifecycle-'))
  const previous = {
    RIN_HOME: process.env.RIN_HOME,
    DSH_HOME: process.env.DSH_HOME,
  }
  process.env.RIN_HOME = join(sandbox, 'rin-home')
  process.env.DSH_HOME = join(sandbox, 'dsh-home')

  let ctx: Awaited<ReturnType<typeof bootRinHost>> | undefined
  let firstDetach: (() => unknown) | undefined
  try {
    ctx = await bootRinHost()
    await registerRinPromptMemorySeam(ctx)
    const first = await publishUserMessage(ctx, 'lifecycle-session-a', 'lifecycle first session observation')
    firstDetach = first.detach
    const runtimeSceneCount = ctx.memory.readCognitionState().memories
      .filter(memory => memory.form === 'scene').length
    assert(runtimeSceneCount === 1, 'the real session must open exactly one runtime scene')

    // ---- E-18: reconstruct the actual model input order and hash for one cycle
    const e18Recall = await ctx.memory.recall({
      cycleId: 'lifecycle-e18-cycle',
      query: { sessionId: 'lifecycle-session-a', text: 'lifecycle first session observation' },
      budget: { maxItems: 4, maxTokens: 600 },
    })
    try {
      const stream = ctx.llm.stream({
        provider: 'lifecycle-smoke-provider',
        model: 'lifecycle-smoke-model',
        messages: [],
        sessionId: 'lifecycle-session-a' as never,
      })
      for await (const _chunk of stream) {}
    } catch {}
    const modelInputs = ctx.memory.listModelInputs('lifecycle-e18-cycle')
    assert(modelInputs.length === 1, 'the reply cycle must have exactly one model-input record')
    assert(
      modelInputs[0]?.inputHash === hashModelInput(modelInputs[0].input),
      'the stored input snapshot must reproduce its recorded SHA-256 input hash',
    )
    assert(
      modelInputs[0]?.workspaceHash === e18Recall.workspace.hash,
      'the model-input record must bind the recalled workspace hash',
    )
    const persistedRecall = ctx.memory.getRecallRecord('lifecycle-e18-cycle')
    assert(persistedRecall !== undefined, 'the recall cycle must be persisted')
    assert(
      persistedRecall.workspace.hash === e18Recall.workspace.hash,
      'the persisted recall workspace hash must match the live recall result',
    )
    assert(
      isDeepStrictEqual(
        persistedRecall.workspace.items.map(item => item.id),
        e18Recall.workspace.items.map(item => item.id),
      ),
      'the persisted workspace must reconstruct the exact model-visible item order',
    )
    const journalForReplay = new MemoryCognitionDatabase(rinHome('memory/memory.db')).listTransactions(10_000)
    const replayedState = new MemoryMaterializer().replay(journalForReplay)
    assert(
      isDeepStrictEqual(replayedState, ctx.memory.readCognitionState()),
      'a full journal replay must reconstruct the exact live cognition state',
    )

    // ---- E-13: authorized erasure clears exactly the authorized scope
    const cognition = new MemoryCognitionDatabase(rinHome('memory/memory.db'))
    const rootScene = sceneMemory('e13-root-scene', 'the scene the owner wants erased')
    const dependent = structureMemory('e13-dependent')
    const unrelated = sceneMemory('e13-unrelated-scene', 'a similar but unsupported scene')
    cognition.appendTransaction(observeTransaction(rootScene))
    cognition.appendTransaction(observeTransaction(dependent))
    cognition.appendTransaction(observeTransaction(unrelated))
    cognition.appendTransaction(linkTransaction([supportLink('e13-supports', rootScene, dependent)]))

    const preview = ctx.memory.requestErasePreview([createMemoryId('e13-root-scene')])
    assert(
      isDeepStrictEqual([...preview.erasedMemoryIds], ['e13-root-scene']),
      'the preview must erase exactly the authorized root',
    )
    assert(
      isDeepStrictEqual([...preview.dependentMemoryIds], ['e13-dependent']),
      'the preview must list the direct support dependent as affected',
    )
    assert(
      preview.unaffectedMemoryIds.includes('e13-unrelated-scene'),
      'the preview must keep the unrelated scene in the unaffected set',
    )
    const authorized = ctx.memory.authorizeErase({
      expectedScopeHash: preview.scopeHash,
      rootMemoryIds: [createMemoryId('e13-root-scene')],
      ownerId: 'lifecycle-owner',
      at: '2026-01-01T00:10:00.000Z',
    })
    assert(
      authorized.authorization.scopeHash === preview.scopeHash,
      'the authorization must bind the computed preview scope hash',
    )
    const committed = ctx.memory.commitAuthorizedErase({
      authorizationId: authorized.authorization.authorizationId,
      ownerId: 'lifecycle-owner',
      at: '2026-01-01T00:11:00.000Z',
    })
    assert(
      isDeepStrictEqual([...committed.erasedMemoryIds], ['e13-root-scene']),
      'the committed erasure must remove exactly the authorized scope',
    )
    const afterErase = ctx.memory.readCognitionState()
    assert(
      isDeepStrictEqual([...afterErase.erasedMemoryIds].filter(id => String(id).startsWith('e13-')), ['e13-root-scene']),
      'only the authorized root may be erased',
    )
    assert(
      !afterErase.memories.some(memory => String(memory.id) === 'e13-root-scene'),
      'the erased root must leave the materialized state',
    )
    const survivingDependent = afterErase.memories.find(memory => String(memory.id) === 'e13-dependent')
    assert(survivingDependent !== undefined, 'the evidence-dependent representation must survive the erase')
    const dependentEdge = afterErase.links.find(link => link.id === 'e13-supports')
    assert(dependentEdge?.state === 'retracted', 'the erased root must retract its active support edge')
    const survivingUnrelated = afterErase.memories.find(memory => String(memory.id) === 'e13-unrelated-scene')
    assert(survivingUnrelated !== undefined, 'the unrelated scene must survive the scoped erase intact')
    let replayRejected = false
    try {
      ctx.memory.commitAuthorizedErase({
        authorizationId: authorized.authorization.authorizationId,
        ownerId: 'lifecycle-owner',
        at: '2026-01-01T00:12:00.000Z',
      })
    } catch (error) {
      replayRejected = String(error).includes('already consumed')
    }
    assert(replayRejected, 'a consumed erase authorization must not commit twice')

    // ---- E-16: crashed projection update rolls back; stale projections cannot enter model input
    const beforeCrash = ctx.memory.readCognitionState()
    ctx.memory.markProjectionCleanAtCurrent('canonical', beforeCrash.version, hashMaterializedState(beforeCrash))
    const crashTarget = sceneMemory('e16-crash-scene', 'a scene whose projection update will crash')
    let crashed = false
    try {
      cognition.appendTransaction(observeTransaction(crashTarget), () => {
        throw new Error('injected projection crash')
      })
    } catch (error) {
      crashed = String(error).includes('injected projection crash')
    }
    assert(crashed, 'the fault injector must abort the projection update')
    const probe = new DatabaseSync(rinHome('memory/memory.db'))
    let crashedRows = -1
    try {
      const row = probe.prepare(
        'SELECT COUNT(*) AS count FROM memory_cognition_transactions WHERE transaction_id = ?',
      ).get(String(createMemoryTransactionId('lifecycle-transaction-' + String(crashTarget.id)))) as { count: number }
      crashedRows = row.count
    } finally {
      probe.close()
    }
    assert(crashedRows === 0, 'the crashed update must roll back without leaving a half transaction')
    assert(
      !ctx.memory.readCognitionState().memories.some(memory => String(memory.id) === 'e16-crash-scene'),
      'the crashed transaction must not leak into the materialized state',
    )
    // The next successful commit marks the projections dirty.
    const second = await publishUserMessage(ctx, 'lifecycle-session-b', 'lifecycle second session observation')
    second.detach()
    const canonicalCheckpoint = ctx.memory.getProjectionCheckpoint('canonical')
    assert(canonicalCheckpoint.status === 'dirty', 'a committed transaction must mark the projection dirty')
    let canonicalBlocked = false
    try {
      ctx.memory.requireProjectionReady('canonical')
    } catch {
      canonicalBlocked = true
    }
    assert(canonicalBlocked, 'a dirty projection must not pass the model-input gate')
    let promptBlocked = false
    try {
      ctx.memory.requireProjectionReady('prompt-memory')
    } catch {
      promptBlocked = true
    }
    assert(promptBlocked, 'the stale prompt projection must not pass the model-input gate either')
    // Rebuild canonical from canonical state, then let the real prompt seam
    // repair its own projection through the assemble waterfall.
    const recoveredState = ctx.memory.readCognitionState()
    ctx.memory.markProjectionCleanAtCurrent('canonical', recoveredState.version, hashMaterializedState(recoveredState))
    assert(
      ctx.memory.requireProjectionReady('canonical').status === 'clean',
      'the rebuilt canonical checkpoint must pass the model-input gate again',
    )
    const assembly = await ctx.systemPrompt.assemble()
    const section = assembly.sections.find(item => item.name === 'rin:prompt-memory')
    assert(section !== undefined, 'the real Host assembly must include rin:prompt-memory after recovery')
    const promptCheckpoint = ctx.memory.getProjectionCheckpoint('prompt-memory')
    assert(
      promptCheckpoint.status === 'clean'
        && promptCheckpoint.materializedVersion === ctx.memory.readCognitionState().version,
      'the prompt projection checkpoint must be clean at the current materialized version after recovery',
    )

    console.log('REAL-HOST-MEMORY-LIFECYCLE-SMOKE-OK', JSON.stringify({
      erasedScope: committed.erasedMemoryIds,
      dependentsRetracted: dependentEdge?.state,
      crashedRolledBack: crashedRows === 0,
      dirtyGateEnforced: canonicalBlocked && promptBlocked,
      modelInputCycle: modelInputs[0]?.cycleId,
      modelInputHash: modelInputs[0]?.inputHash.slice(0, 12),
      promptCheckpointRecovered: promptCheckpoint.status,
    }))
  } finally {
    if (firstDetach !== undefined) await firstDetach()
    if (ctx !== undefined) await ctx.fiber.dispose()
    if (previous.RIN_HOME === undefined) delete process.env.RIN_HOME
    else process.env.RIN_HOME = previous.RIN_HOME
    if (previous.DSH_HOME === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous.DSH_HOME
    await rm(sandbox, { recursive: true, force: true })
  }
}

await main()
