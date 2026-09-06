import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { MEMORY_COGNITION_PROTOCOL_VERSION } from '@rin/contracts'
import {
  FileMemoryStore,
  MemoryCognitionDatabase,
  MemoryMaterializer,
  createEvidenceId,
  createMemoryAuthorizationId,
  createMemoryCommand,
  createLinkId,
  createMemory,
  createMemoryCommandId,
  createMemoryCorrelationId,
  createMemoryEventId,
  createMemoryId,
  createMemoryLink,
  createMemoryTransaction,
  createMemoryTransactionId,
  createModelActor,
  createOwnerActor,
  createParticipantId,
  createRuntimeActor,
  memoryVersion,
  type MemoryCommand,
  type MemoryEvent,
  type MemoryLink,
  type MemoryTransaction,
  type RinMemory,
} from '../src/index.ts'

const AT = {
  seed: '2026-01-01T00:00:01.000Z',
  link: '2026-01-01T00:00:03.000Z',
  intent: '2026-01-01T00:05:00.000Z',
  commit: '2026-01-01T00:06:00.000Z',
}

function sceneMemory(id = createMemoryId('scene-1'), influence: RinMemory['state']['influence'] = 'blocked'): RinMemory {
  return createMemory({
    id,
    form: 'scene',
    data: {
      participants: [createParticipantId('user-1')],
      environment: 'workspace',
      goals: [],
      observations: ['user asked Rin to remember a scene'],
      interpretations: [],
      actions: [],
      outcomes: [],
      predictionErrors: [],
      affect: { valence: 0.2, arousal: 0.4, control: 0.7 },
    },
    state: {
      persistence: influence === 'permitted' ? 'durable' : 'transient',
      activation: 'dormant',
      integration: influence === 'permitted' ? 'integrated' : 'raw',
      epistemic: 'observed',
      influence,
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
      influenceSurfaces: influence === 'permitted' ? ['model-input'] : [],
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })
}

function structureMemory(id = createMemoryId('structure-1')): RinMemory {
  return createMemory({
    id,
    form: 'structure',
    data: {
      entities: ['user-1'],
      relations: [],
      concepts: ['remembering requests'],
      causalPatterns: ['asking Rin to remember leads to a stored scene'],
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

function observedTransaction(transactionId: string, commandId: string, memory: RinMemory): MemoryTransaction {
  const runtime = createRuntimeActor('runtime-1')
  const command: MemoryCommand = {
    kind: 'memory-command',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'observe',
    commandId: createMemoryCommandId(commandId),
    correlationId: createMemoryCorrelationId('correlation-' + commandId),
    actor: runtime,
    issuedAt: AT.seed,
    payload: { memory },
  }
  const event: MemoryEvent = {
    kind: 'memory-event',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'memory-observed',
    eventId: createMemoryEventId('event-' + commandId),
    transactionId: createMemoryTransactionId(transactionId),
    commandId: command.commandId,
    position: 0,
    actor: runtime,
    occurredAt: AT.seed,
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

function link(id: string, relation: MemoryLink['relation'], from: RinMemory, to: RinMemory): MemoryLink {
  return createMemoryLink({
    id: createLinkId(id),
    from: from.id,
    relation,
    to: to.id,
    fromVersion: memoryVersion(from),
    toVersion: memoryVersion(to),
    strength: 0.8,
    validity: { startsAt: '2026-01-01T00:00:00.000Z' },
    state: 'active',
    createdAt: AT.link,
    updatedAt: AT.link,
  })
}

function linkedTransaction(transactionId: string, commandId: string, links: readonly MemoryLink[]): MemoryTransaction {
  const runtime = createRuntimeActor('runtime-1')
  const command: MemoryCommand = {
    kind: 'memory-command',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'link',
    commandId: createMemoryCommandId(commandId),
    correlationId: createMemoryCorrelationId('correlation-' + commandId),
    actor: runtime,
    issuedAt: AT.link,
    payload: { links },
  }
  const event: MemoryEvent = {
    kind: 'memory-event',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'memory-linked',
    eventId: createMemoryEventId('event-' + commandId),
    transactionId: createMemoryTransactionId(transactionId),
    commandId: command.commandId,
    position: 0,
    actor: runtime,
    occurredAt: AT.link,
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

async function makeStore(prefix: string, memories: readonly RinMemory[] = [], links: readonly MemoryLink[] = []): Promise<{
  dbPath: string
  database: MemoryCognitionDatabase
  store: FileMemoryStore
}> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  const dbPath = join(root, 'memory.db')
  const database = new MemoryCognitionDatabase(dbPath)
  memories.forEach((memory, index) => {
    database.appendTransaction(observedTransaction(
      'tx-seed-' + index,
      'command-seed-' + index,
      memory,
    ))
  })
  if (links.length > 0) {
    database.appendTransaction(linkedTransaction('tx-seed-links', 'command-seed-links', links))
  }
  const store = new FileMemoryStore(new Context(), {
    dbPath,
    manifestPath: join(root, 'manifest.json'),
    homeRoot: root,
  })
  return { dbPath, database, store }
}

describe('M7-01 owner correction and influence control', () => {
  test('correctUnderstanding revises content in place, resets permitted influence, and keeps journal history', async () => {
    const { database, store } = await makeStore('rin-owner-correct-', [
      sceneMemory(createMemoryId('scene-1'), 'permitted'),
    ])
    const transaction = store.correctUnderstanding({
      memoryId: createMemoryId('scene-1'),
      replacement: {
        form: 'scene',
        data: {
          participants: [createParticipantId('user-1')],
          environment: 'workspace',
          goals: [],
          observations: ['user asked Rin to remember a different detail'],
          interpretations: [],
          actions: [],
          outcomes: [],
          predictionErrors: [],
          affect: { valence: 0.2, arousal: 0.4, control: 0.7 },
        },
      },
      evidenceIds: [createEvidenceId('correction-evidence-1')],
      explanation: 'the owner corrected what actually happened',
      ownerId: 'owner-1',
      at: AT.intent,
    })
    expect(transaction.command.type).toBe('correct')
    const state = store.readCognitionState()
    const corrected = state.memories.find(memory => String(memory.id) === 'scene-1')
    expect(corrected).toBeDefined()
    expect(corrected?.data.observations).toEqual(['user asked Rin to remember a different detail'])
    // A standing permit must not survive a content change.
    expect(corrected?.state.influence).toBe('blocked')
    expect(corrected?.updatedAt).toBe(AT.intent)
    expect(state.memories.filter(memory => String(memory.id) === 'scene-1')).toHaveLength(1)
    expect(database.listTransactions().some(tx => tx.command.type === 'correct')).toBe(true)
    expect(() => store.correctUnderstanding({
      memoryId: createMemoryId('unknown-memory'),
      replacement: { form: 'scene', data: sceneMemory().data },
      explanation: 'correction without a memory',
      ownerId: 'owner-1',
    })).toThrow('unknown memory')
  })

  test('restrictInfluence narrows surfaces and revokeInfluence is terminal', async () => {
    const { store } = await makeStore('rin-owner-influence-', [
      sceneMemory(createMemoryId('scene-1'), 'permitted'),
      sceneMemory(createMemoryId('scene-2'), 'permitted'),
    ])
    const restricted = store.restrictInfluence({
      memoryId: createMemoryId('scene-1'),
      surfaces: ['recall'],
      reason: 'the owner limits this memory to recall only',
      ownerId: 'owner-1',
      at: AT.intent,
    })
    expect(restricted.command.type).toBe('restrict-influence')
    const restrictedMemory = store.readCognitionState().memories.find(memory => String(memory.id) === 'scene-1')
    expect(restrictedMemory?.state.influence).toBe('restricted')
    expect(restrictedMemory?.dynamics.influenceSurfaces).toEqual(['recall'])
    const revoked = store.revokeInfluence({
      memoryId: createMemoryId('scene-2'),
      reason: 'the owner withdraws all behavioral influence',
      ownerId: 'owner-1',
      at: AT.intent,
    })
    expect(revoked.command.type).toBe('revoke-influence')
    const revokedMemory = store.readCognitionState().memories.find(memory => String(memory.id) === 'scene-2')
    expect(revokedMemory?.state.influence).toBe('revoked')
    expect(() => store.restrictInfluence({
      memoryId: createMemoryId('scene-2'),
      surfaces: ['recall'],
      reason: 'revoked influence cannot be reopened',
      ownerId: 'owner-1',
      at: AT.intent,
    })).toThrow()
    expect(() => store.restrictInfluence({
      memoryId: createMemoryId('unknown-memory'),
      surfaces: ['recall'],
      reason: 'restriction without a memory',
      ownerId: 'owner-1',
    })).toThrow('unknown memory')
  })

  test('model actors cannot sign owner-only intent commands', () => {
    const model = createModelActor('rin-model')
    expect(() => createMemoryCommand({
      kind: 'memory-command',
      protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
      type: 'erase-preview',
      commandId: createMemoryCommandId('model-erase-preview'),
      correlationId: createMemoryCorrelationId('model-erase-preview'),
      actor: model,
      issuedAt: AT.intent,
      payload: { memoryIds: ['scene-1'] },
    } as unknown as MemoryCommand)).toThrow('cannot issue erase-preview')
    expect(createOwnerActor('owner-1').kind).toBe('owner')
  })
})

describe('M7-02 erase preview', () => {
  test('computes support/derive dependents, retracted links, and the unaffected set', async () => {
    const scene1 = sceneMemory(createMemoryId('scene-1'))
    const structure1 = structureMemory(createMemoryId('structure-1'))
    const scene2 = sceneMemory(createMemoryId('scene-2'))
    const { store } = await makeStore('rin-erase-preview-', [scene1, structure1, scene2], [
      link('link-supports-1', 'supports', scene1, structure1),
      link('link-similar-1', 'similar-to', scene1, scene2),
    ])
    const preview = store.requestErasePreview([createMemoryId('scene-1')])
    expect(preview.rootMemoryIds).toEqual(['scene-1'])
    expect(preview.erasedMemoryIds).toEqual(['scene-1'])
    expect(preview.retractedLinkIds).toEqual(['link-similar-1', 'link-supports-1'])
    expect(preview.dependentMemoryIds).toEqual(['structure-1'])
    // E-14: a similar but unsupported scene is unaffected.
    expect(preview.unaffectedMemoryIds).toEqual(['scene-2'])
    expect(preview.scopeHash).toMatch(/^[0-9a-f]{64}$/)
    expect(() => store.requestErasePreview([createMemoryId('unknown-memory')])).toThrow('unknown memory')
  })
})

describe('M7-03 and M7-04 owner authorization and atomic erase commit', () => {
  test('authorizeErase persists the owner authorization bound to the computed scope', async () => {
    const scene1 = sceneMemory(createMemoryId('scene-1'))
    const { database, store } = await makeStore('rin-erase-authorize-', [scene1])
    const result = store.authorizeErase({
      rootMemoryIds: [createMemoryId('scene-1')],
      ownerId: 'owner-1',
      at: AT.intent,
    })
    expect(result.authorization.scopeHash).toBe(result.preview.scopeHash)
    expect(Date.parse(result.authorization.expiresAt)).toBeGreaterThan(Date.parse(AT.intent))
    expect(store.readCognitionState().eraseAuthorizations.map(authorization => authorization.authorizationId))
      .toContain(result.authorization.authorizationId)
    expect(database.listTransactions().some(tx => tx.command.type === 'authorize-erase')).toBe(true)
    expect(() => store.authorizeErase({
      rootMemoryIds: [createMemoryId('scene-1')],
      ownerId: 'owner-1',
      ttlMinutes: 0,
      at: AT.intent,
    })).toThrow('ttl')
  })

  test('commitAuthorizedErase erases only the authorized scope and invalidates projections', async () => {
    const scene1 = sceneMemory(createMemoryId('scene-1'))
    const structure1 = structureMemory(createMemoryId('structure-1'))
    const scene2 = sceneMemory(createMemoryId('scene-2'))
    const { database, store } = await makeStore('rin-erase-commit-', [scene1, structure1, scene2], [
      link('link-supports-1', 'supports', scene1, structure1),
    ])
    // Seed a clean checkpoint so the commit must invalidate it (M7-05).
    const before = store.readCognitionState()
    store.markProjectionCleanAtCurrent('canonical', before.version, 'seed-state-hash', AT.link)
    const authorized = store.authorizeErase({
      rootMemoryIds: [createMemoryId('scene-1')],
      ownerId: 'owner-1',
      at: AT.intent,
    })
    const committed = store.commitAuthorizedErase({
      authorizationId: authorized.authorization.authorizationId,
      ownerId: 'owner-1',
      at: AT.commit,
    })
    expect(committed.erasedMemoryIds).toEqual(['scene-1'])
    const state = store.readCognitionState()
    // E-13: only the authorized scene is removed; its dependent survives blocked.
    expect(state.memories.map(memory => String(memory.id))).toEqual(['scene-2', 'structure-1'])
    expect(state.erasedMemoryIds).toEqual(['scene-1'])
    expect(state.links.filter(item => item.id === 'link-supports-1').map(item => item.state))
      .toEqual(['retracted'])
    expect(store.getProjectionCheckpoint('canonical').status).toBe('dirty')
    expect(new MemoryMaterializer().replay(database.listTransactions())).toEqual(state)
  })

  test('commit rejects unknown, expired, replayed, and drifted authorizations', async () => {
    const scene1 = sceneMemory(createMemoryId('scene-1'))
    const structure1 = structureMemory(createMemoryId('structure-1'))
    const { store } = await makeStore('rin-erase-reject-', [scene1, structure1])
    expect(() => store.commitAuthorizedErase({
      authorizationId: createMemoryAuthorizationId('auth-unknown'),
      ownerId: 'owner-1',
      at: AT.intent,
    })).toThrow('unknown authorization')
    const expired = store.authorizeErase({
      rootMemoryIds: [createMemoryId('scene-1')],
      ownerId: 'owner-1',
      ttlMinutes: 1,
      at: AT.intent,
    })
    expect(() => store.commitAuthorizedErase({
      authorizationId: expired.authorization.authorizationId,
      ownerId: 'owner-1',
      at: '2026-01-01T00:30:00.000Z',
    })).toThrow('expired')
    const authorized = store.authorizeErase({
      rootMemoryIds: [createMemoryId('scene-1')],
      ownerId: 'owner-1',
      at: AT.intent,
    })
    store.commitAuthorizedErase({
      authorizationId: authorized.authorization.authorizationId,
      ownerId: 'owner-1',
      at: AT.commit,
    })
    expect(() => store.commitAuthorizedErase({
      authorizationId: authorized.authorization.authorizationId,
      ownerId: 'owner-1',
      at: '2026-01-01T00:07:00.000Z',
    })).toThrow('already consumed')
  })

  test('commit rejects authorization when derived evidence drifted after the preview', async () => {
    const scene1 = sceneMemory(createMemoryId('scene-1'))
    const structure1 = structureMemory(createMemoryId('structure-1'))
    const { database, store } = await makeStore('rin-erase-drift-', [scene1, structure1])
    const authorized = store.authorizeErase({
      rootMemoryIds: [createMemoryId('scene-1')],
      ownerId: 'owner-1',
      at: AT.intent,
    })
    // New derived evidence appears after the preview was computed.
    database.appendTransaction(linkedTransaction('tx-drift-link', 'command-drift-link', [
      link('link-drift-supports', 'supports', scene1, structure1),
    ]))
    expect(() => store.commitAuthorizedErase({
      authorizationId: authorized.authorization.authorizationId,
      ownerId: 'owner-1',
      at: AT.commit,
    })).toThrow('drifted')
  })
})

describe('M7-07 cognition journal export and replay restore', () => {
  test('exports the journal in order and restores it into an empty store', async () => {
    const scene1 = sceneMemory(createMemoryId('scene-1'))
    const structure1 = structureMemory(createMemoryId('structure-1'))
    const { database, store } = await makeStore('rin-erase-journal-', [scene1, structure1], [
      link('link-supports-1', 'supports', scene1, structure1),
    ])
    const authorized = store.authorizeErase({
      rootMemoryIds: [createMemoryId('scene-1')],
      ownerId: 'owner-1',
      at: AT.intent,
    })
    store.commitAuthorizedErase({
      authorizationId: authorized.authorization.authorizationId,
      ownerId: 'owner-1',
      at: AT.commit,
    })
    const journal = store.exportCognitionJournal()
    expect(journal.length).toBe(database.listTransactions().length)

    // Restore into a fresh store and confirm the erased state replays identically.
    const restoreRoot = await mkdtemp(join(tmpdir(), 'rin-erase-restore-'))
    const restoredStore = new FileMemoryStore(new Context(), {
      dbPath: join(restoreRoot, 'memory.db'),
      manifestPath: join(restoreRoot, 'manifest.json'),
      homeRoot: restoreRoot,
    })
    expect(restoredStore.restoreCognitionJournal(journal)).toBe(journal.length)
    expect(restoredStore.readCognitionState()).toEqual(store.readCognitionState())
    expect(restoredStore.readCognitionState().erasedMemoryIds).toEqual(['scene-1'])
    // A restore into a non-empty journal is refused.
    expect(() => restoredStore.restoreCognitionJournal(journal)).toThrow('requires an empty store')
  })
})
