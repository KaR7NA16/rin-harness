import { mkdtemp } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { MEMORY_COGNITION_STORAGE_VERSION, MEMORY_COGNITION_PROTOCOL_VERSION } from '@rin/contracts'
import {
  createModelActor,
  createModelProposalTransaction,
  createBackgroundActor,
  createLinkId,
  createGoalId,
  createMemory,
  decayMemory,
  createEvidenceId,
  createMemoryDecayTransaction,
  createMemoryPredictionTransaction,
  createMemoryActionTransaction,
  createMemoryOutcomeTransaction,
  createMemoryFeedbackTransaction,
  createMemoryBehaviorTransaction,
  createMemoryDispositionLearningTransaction,
  createMemoryAuthorizationId,
  createMemoryCommandId,
  createMemoryCorrelationId,
  createMemoryEventId,
  createMemoryId,
  createPredictionId,
  createActionId,
  createOutcomeId,
  createFeedbackId,
  createMemoryLink,
  createMemoryTransaction,
  createMemoryUseTransaction,
  createEmptyCurrentField,
  createMemoryTransactionId,
  createOwnerActor,
  createParticipantId,
  createRuntimeActor,
  hashModelInput,
  createWorkspaceCycleId,
  hashMaterializedState,
  MemoryCognitionDatabase,
  RuntimeCognitionIngestor,
  FileMemoryStore,
  MemoryMaterializer,
  memoryVersion,
  queryMaterializedLinks,
  transitionMemory,
  type MemoryLink,
  type RinMemory,
  learnDispositionFromFeedback,
} from '../src/index.ts'
import type { MemoryUseTrace } from '../src/consolidation.ts'
import type { MemoryCommand, MemoryEvent, MemoryTransaction } from '../src/events.ts'
import { MEMORY_RECALL_SCHEMA_VERSION } from '../src/recall.ts'
import type { MemoryRecallRecord } from '../src/recall.ts'

function expectReplayPrefixes(transactions: readonly MemoryTransaction[]): void {
  const materializer = new MemoryMaterializer()
  let previous = materializer.replay([])
  for (let index = 0; index < transactions.length; index += 1) {
    const snapshot = JSON.stringify(previous)
    const next = materializer.apply(transactions[index]!, previous)
    expect(JSON.stringify(previous)).toBe(snapshot)
    expect(Object.isFrozen(next.memories)).toBe(true)
    expect(materializer.apply(transactions[index]!, next)).toBe(next)
    expect(materializer.replay(transactions.slice(0, index + 1))).toEqual(next)
    previous = next
  }
}

function eraseTransaction(transactionId: string, commandId: string, targetMemoryId = createMemoryId('memory-1')): MemoryTransaction {
  const owner = createOwnerActor('owner-1')
  const authorizationId = createMemoryAuthorizationId('auth-1')
  const correlationId = createMemoryCorrelationId('correlation-1')
  const command: MemoryCommand = {
    kind: 'memory-command',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'authorize-erase',
    commandId: createMemoryCommandId(commandId),
    correlationId,
    actor: owner,
    issuedAt: '2026-01-01T00:00:01.000Z',
    payload: {
      authorizationId,
      memoryIds: [targetMemoryId],
      expiresAt: '2026-01-02T00:00:00.000Z',
      scopeHash: 'scope-hash-fixtures',
    },
  }
  const event: MemoryEvent = {
    kind: 'memory-event',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'erase-authorized',
    eventId: createMemoryEventId('event-' + commandId),
    transactionId: createMemoryTransactionId(transactionId),
    commandId: command.commandId,
    position: 0,
    actor: owner,
    occurredAt: '2026-01-01T00:00:02.000Z',
    payload: {
      authorizationId,
      memoryIds: [targetMemoryId],
      expiresAt: '2026-01-02T00:00:00.000Z',
      scopeHash: 'scope-hash-fixtures',
    },
  }
  return createMemoryTransaction({
    transactionId: event.transactionId,
    commandId: command.commandId,
    correlationId,
    actor: owner,
    openedAt: command.issuedAt,
    committedAt: event.occurredAt,
    command,
    events: [event],
  })
}

function eraseCommitTransaction(transactionId: string, commandId: string, targetMemoryId = createMemoryId('memory-1')): MemoryTransaction {
  const owner = createOwnerActor('owner-1')
  const authorizationId = createMemoryAuthorizationId('auth-1')
  const correlationId = createMemoryCorrelationId('correlation-' + commandId)
  const command: MemoryCommand = {
    kind: 'memory-command',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'commit-erase',
    commandId: createMemoryCommandId(commandId),
    correlationId,
    actor: owner,
    issuedAt: '2026-01-01T00:00:04.000Z',
    payload: { authorizationId },
  }
  const event: MemoryEvent = {
    kind: 'memory-event',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'erase-committed',
    eventId: createMemoryEventId('event-' + commandId),
    transactionId: createMemoryTransactionId(transactionId),
    commandId: command.commandId,
    position: 0,
    actor: owner,
    occurredAt: '2026-01-01T00:00:04.000Z',
    payload: { authorizationId, memoryIds: [targetMemoryId] },
  }
  return createMemoryTransaction({
    transactionId: event.transactionId,
    commandId: command.commandId,
    correlationId,
    actor: owner,
    openedAt: command.issuedAt,
    committedAt: event.occurredAt,
    command,
    events: [event],
  })
}

function sceneMemory(id = createMemoryId('scene-1')): RinMemory {
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
      persistence: 'transient',
      activation: 'dormant',
      integration: 'raw',
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

function observedTransaction(transactionId: string, commandId: string, memory = sceneMemory()): MemoryTransaction {
  const runtime = createRuntimeActor('runtime-1')
  const command: MemoryCommand = {
    kind: 'memory-command',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'observe',
    commandId: createMemoryCommandId(commandId),
    correlationId: createMemoryCorrelationId('correlation-' + commandId),
    actor: runtime,
    issuedAt: '2026-01-01T00:00:01.000Z',
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

function encodedTransaction(memory: RinMemory): MemoryTransaction {
  const runtime = createRuntimeActor('runtime-1')
  const transition = { type: 'encode' as const, at: '2026-01-01T00:00:02.000Z' }
  const next = transitionMemory(memory, transition)
  const command: MemoryCommand = {
    kind: 'memory-command',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'transition',
    commandId: createMemoryCommandId('command-encode'),
    correlationId: createMemoryCorrelationId('correlation-encode'),
    actor: runtime,
    issuedAt: '2026-01-01T00:00:02.000Z',
    payload: { memoryId: memory.id, transition },
  }
  const event: MemoryEvent = {
    kind: 'memory-event',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'memory-transitioned',
    eventId: createMemoryEventId('event-encode'),
    transactionId: createMemoryTransactionId('tx-encode'),
    commandId: command.commandId,
    position: 0,
    actor: runtime,
    occurredAt: transition.at,
    payload: { memoryId: memory.id, memory: next, transition },
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
function memoryLink(
  id: string,
  relation: MemoryLink['relation'],
  from: RinMemory,
  to: RinMemory,
  state: MemoryLink['state'] = 'active',
  fromVersion = memoryVersion(from),
  toVersion = memoryVersion(to),
  validity: MemoryLink['validity'] = { startsAt: '2026-01-01T00:00:00.000Z' },
): MemoryLink {
  return createMemoryLink({
    id: createLinkId(id),
    from: from.id,
    relation,
    to: to.id,
    fromVersion,
    toVersion,
    strength: 0.8,
    validity,
    state,
    createdAt: '2026-01-01T00:00:03.000Z',
    updatedAt: '2026-01-01T00:00:03.000Z',
  })
}

function linkedTransaction(transactionId: string, commandId: string, links: readonly MemoryLink[]): MemoryTransaction {
  const runtime = createRuntimeActor('runtime-1')
  const correlationId = createMemoryCorrelationId('correlation-' + commandId)
  const command: MemoryCommand = {
    kind: 'memory-command',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'link',
    commandId: createMemoryCommandId(commandId),
    correlationId,
    actor: runtime,
    issuedAt: '2026-01-01T00:00:03.000Z',
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
    occurredAt: '2026-01-01T00:00:03.000Z',
    payload: { links },
  }
  return createMemoryTransaction({
    transactionId: event.transactionId,
    commandId: command.commandId,
    correlationId,
    actor: runtime,
    openedAt: command.issuedAt,
    committedAt: event.occurredAt,
    command,
    events: [event],
  })
}

function countRows(path: string, table: string): number {
  const db = new DatabaseSync(path)
  try {
    const row = db.prepare('SELECT COUNT(*) AS count FROM ' + table).get() as { count: number }
    return row.count
  } finally {
    db.close()
  }
}

describe('M1-03 cognition journal', () => {
  test('commits and reloads one immutable transaction with its event row', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-cognition-'))
    const path = join(root, 'memory.db')
    const database = new MemoryCognitionDatabase(path)
    const transaction = eraseTransaction('tx-1', 'command-1')

    const committed = database.appendTransaction(transaction)

    expect(committed).toEqual(transaction)
    expect(database.getTransaction('tx-1')).toEqual(transaction)
    expect(database.listTransactions()).toEqual([transaction])
    expect(database.listEvents('tx-1')).toEqual(transaction.events)
    expect(countRows(path, 'memory_cognition_transactions')).toBe(1)
    expect(countRows(path, 'memory_cognition_events')).toBe(1)
  })

  test('rolls back the transaction row and event row together after injected failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-cognition-fault-'))
    const path = join(root, 'memory.db')
    const database = new MemoryCognitionDatabase(path)

    for (const stage of ['transaction-row', 'event-row'] as const) {
      const transaction = eraseTransaction('tx-' + stage, 'command-' + stage)
      expect(() => database.appendTransaction(transaction, context => {
        if (context.stage === stage) throw new Error('injected ' + stage)
      })).toThrow('injected ' + stage)
      expect(database.getTransaction(transaction.transactionId)).toBeUndefined()
      expect(database.listEvents(transaction.transactionId)).toEqual([])
      expect(countRows(path, 'memory_cognition_transactions')).toBe(0)
      expect(countRows(path, 'memory_cognition_events')).toBe(0)
    }
  })

  test('is idempotent for the same transaction and rejects command rebinding', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-cognition-idempotency-'))
    const path = join(root, 'memory.db')
    const database = new MemoryCognitionDatabase(path)
    const transaction = eraseTransaction('tx-idempotent', 'command-idempotent')

    expect(database.appendTransaction(transaction)).toEqual(transaction)
    expect(database.appendTransaction(transaction)).toEqual(transaction)
    expect(database.listTransactions()).toHaveLength(1)
    expect(database.listEvents(transaction.transactionId)).toHaveLength(1)

    const rebinding = eraseTransaction('tx-rebound', 'command-idempotent')
    expect(() => database.appendTransaction(rebinding)).toThrow('command is already bound')
  })

  test('migrates the previous cognition schema and rejects newer or unversioned schemas', async () => {
    const olderRoot = await mkdtemp(join(tmpdir(), 'rin-cognition-older-'))
    const olderPath = join(olderRoot, 'memory.db')
    const seeded = new MemoryCognitionDatabase(olderPath)
    seeded.listTransactions()
    const older = new DatabaseSync(olderPath)
    older.exec('DROP TABLE memory_cognition_workspace_members; DROP TABLE memory_cognition_recall_cycles; DROP TABLE memory_cognition_model_inputs')
    older.prepare('UPDATE memory_cognition_meta SET schema_version = ? WHERE id = 1').run(MEMORY_COGNITION_STORAGE_VERSION - 1)
    older.close()
    const migrated = new MemoryCognitionDatabase(olderPath)
    expect(migrated.listTransactions()).toEqual([])
    const migratedMeta = new DatabaseSync(olderPath)
    expect((migratedMeta.prepare('SELECT schema_version FROM memory_cognition_meta WHERE id = 1').get() as { schema_version: number }).schema_version).toBe(MEMORY_COGNITION_STORAGE_VERSION)
    migratedMeta.close()

    const newerRoot = await mkdtemp(join(tmpdir(), 'rin-cognition-newer-'))
    const newerPath = join(newerRoot, 'memory.db')
    const newer = new DatabaseSync(newerPath)
    newer.exec('CREATE TABLE memory_cognition_meta (id INTEGER PRIMARY KEY, schema_version INTEGER NOT NULL, protocol_version INTEGER NOT NULL)')
    newer.prepare('INSERT INTO memory_cognition_meta VALUES (?, ?, ?)').run(1, MEMORY_COGNITION_STORAGE_VERSION + 1, MEMORY_COGNITION_PROTOCOL_VERSION)
    newer.close()
    expect(() => new MemoryCognitionDatabase(newerPath).listTransactions()).toThrow('database schema is newer')

    const unversionedRoot = await mkdtemp(join(tmpdir(), 'rin-cognition-unversioned-'))
    const unversionedPath = join(unversionedRoot, 'memory.db')
    const unversioned = new DatabaseSync(unversionedPath)
    unversioned.exec('CREATE TABLE memory_cognition_events (id INTEGER PRIMARY KEY)')
    unversioned.close()
    expect(() => new MemoryCognitionDatabase(unversionedPath).listTransactions()).toThrow('unversioned cognition journal')
  })
  test('replays the journal into the same deterministic materialized state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-materializer-'))
    const path = join(root, 'memory.db')
    const database = new MemoryCognitionDatabase(path)
    const memory = sceneMemory()
    const observed = observedTransaction('tx-observed', 'command-observed', memory)
    const encoded = encodedTransaction(memory)
    database.appendTransaction(observed)
    database.appendTransaction(encoded)

    const materializer = new MemoryMaterializer()
    const fromDatabase = materializer.replayFrom(database)
    const fromStream = materializer.replay(JSON.parse(JSON.stringify([observed, encoded])) as MemoryTransaction[])

    expect(fromDatabase).toEqual(fromStream)
    expect(hashMaterializedState(fromDatabase)).toBe(hashMaterializedState(fromStream))
    expect(fromDatabase.version).toBe(2)
    expect(fromDatabase.eventCount).toBe(2)
    expect(fromDatabase.memories[0].state.persistence).toBe('encoded')
    expect(Object.isFrozen(fromDatabase)).toBe(true)
    expect(Object.isFrozen(fromDatabase.memories)).toBe(true)
  })

  test('a failed transaction leaves the prior snapshot and later replays intact', () => {
    const memory = sceneMemory()
    const observed = observedTransaction('immutable-observe', 'immutable-command', memory)
    const encoded = encodedTransaction(memory)
    const event = encoded.events[0] as Extract<MemoryEvent, { type: 'memory-transitioned' }>
    const invalid = { ...encoded, events: [{ ...event, payload: { ...event.payload, memory } }] }
    const materializer = new MemoryMaterializer()
    const previous = materializer.replay([observed])
    const snapshot = JSON.stringify(previous)
    expect(() => materializer.apply(invalid, previous)).toThrow('result does not match deterministic transition')
    expect(() => materializer.replay([observed, invalid])).toThrow('result does not match deterministic transition')
    expect(JSON.stringify(previous)).toBe(snapshot)
    expect(materializer.replay([observed, encoded])).toEqual(materializer.apply(encoded, previous))
    expectReplayPrefixes([observed, observed, encoded])
  })

  test('rejects a transitioned result that diverges from the deterministic model', () => {
    const memory = sceneMemory()
    const observed = observedTransaction('tx-observed-mismatch', 'command-observed-mismatch', memory)
    const encoded = encodedTransaction(memory)
    const transitionEvent = encoded.events[0] as Extract<MemoryEvent, { type: 'memory-transitioned' }>
    const badEvent: MemoryEvent = {
      ...transitionEvent,
      payload: { ...transitionEvent.payload, memory: sceneMemory() },
    }
    const badTransaction: MemoryTransaction = { ...encoded, events: [badEvent] }

    expect(() => new MemoryMaterializer().replay([observed, badTransaction])).toThrow('result does not match deterministic transition')
  })
  test('materializes and queries typed support, contradiction, and supersession edges', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-links-'))
    const path = join(root, 'memory.db')
    const database = new MemoryCognitionDatabase(path)
    const source = sceneMemory(createMemoryId('memory-source'))
    const target = sceneMemory(createMemoryId('memory-target'))
    const links = [
      memoryLink('link-derives', 'derives', source, target),
      memoryLink('link-contradicts', 'contradicts', target, source),
      memoryLink('link-supersedes', 'supersedes', source, target),
    ]
    database.appendTransaction(observedTransaction('tx-source', 'command-source', source))
    database.appendTransaction(observedTransaction('tx-target', 'command-target', target))
    database.appendTransaction(linkedTransaction('tx-links', 'command-links', links))

    const state = new MemoryMaterializer().replayFrom(database)
    expect(state.links).toHaveLength(3)
    expect(queryMaterializedLinks(state, { relation: 'derives' })).toEqual([links[0]])
    expect(queryMaterializedLinks(state, { relation: 'contradicts' })).toEqual([links[1]])
    expect(queryMaterializedLinks(state, { relation: 'supersedes' })).toEqual([links[2]])
    expect(state.links.map(link => link.id)).toEqual(['link-contradicts', 'link-derives', 'link-supersedes'])
  })

  test('rejects a link whose endpoint version is stale', () => {
    const source = sceneMemory(createMemoryId('memory-stale-source'))
    const target = sceneMemory(createMemoryId('memory-stale-target'))
    const stale = memoryLink('link-stale', 'supports', source, target, 'active', 'stale-version')
    const observedSource = observedTransaction('tx-stale-source', 'command-stale-source', source)
    const observedTarget = observedTransaction('tx-stale-target', 'command-stale-target', target)
    const linked = linkedTransaction('tx-stale-link', 'command-stale-link', [stale])

    expect(() => new MemoryMaterializer().replay([observedSource, observedTarget, linked])).toThrow('source version does not match')
  })
  test('isolates simulates links to declared prospect targets', () => {
    const target = sceneMemory(createMemoryId('simulation-target'))
    const other = sceneMemory(createMemoryId('simulation-other'))
    const prospect = createMemory({
      ...target,
      id: createMemoryId('simulation-prospect'),
      form: 'prospect',
      data: {
        kind: 'counterfactual',
        premise: 'the scope changes before the next action',
        possibleOutcomes: ['Rin asks for clarification'],
        relatedMemoryIds: [target.id],
      },
      state: {
        persistence: 'transient',
        activation: 'active',
        integration: 'raw',
        epistemic: 'hypothesized',
        influence: 'blocked',
      },
      dynamics: { ...target.dynamics, influenceSurfaces: [] },
    })
    const proposal = createModelProposalTransaction({
      actor: createModelActor('model-simulation'),
      candidate: {
        memory: prospect,
        basis: 'model-proposal',
        evidenceIds: [],
        rationale: 'This is an explicit simulation, not an observed scene.',
      },
      commandId: createMemoryCommandId('command-simulation-proposal'),
      eventId: createMemoryEventId('event-simulation-proposal'),
      transactionId: createMemoryTransactionId('transaction-simulation-proposal'),
      correlationId: createMemoryCorrelationId('correlation-simulation-proposal'),
      issuedAt: '2026-01-01T00:00:01.000Z',
    })
    const valid = memoryLink('link-simulation-valid', 'simulates', prospect, target)
    const invalidSource = memoryLink('link-simulation-source', 'simulates', target, prospect)
    const invalidTarget = memoryLink('link-simulation-target', 'simulates', prospect, other)
    const targetObserved = observedTransaction('tx-simulation-target', 'command-simulation-target', target)
    const otherObserved = observedTransaction('tx-simulation-other', 'command-simulation-other', other)
    const materializer = new MemoryMaterializer()
    const validState = materializer.replay([
      targetObserved,
      proposal,
      linkedTransaction('tx-simulation-valid', 'command-simulation-valid', [valid]),
    ])
    expect(validState.links).toEqual([valid])
    expect(new Set(validState.memories.map(memory => memory.id))).toEqual(new Set([target.id, prospect.id]))
    expect(() => materializer.replay([
      targetObserved,
      proposal,
      linkedTransaction('tx-simulation-source', 'command-simulation-source', [invalidSource]),
    ])).toThrow('simulates link source must be a prospect')
    expect(() => materializer.replay([
      targetObserved,
      otherObserved,
      proposal,
      linkedTransaction('tx-simulation-invalid-target', 'command-simulation-invalid-target', [invalidTarget]),
    ])).toThrow('simulates link target must be declared by the prospect')
  })


  test('retracts active links when an authorized root memory is erased', () => {
    const source = sceneMemory(createMemoryId('memory-1'))
    const target = sceneMemory(createMemoryId('memory-erase-target'))
    const link = memoryLink('link-erase', 'supports', source, target)
    const materializer = new MemoryMaterializer()
    const state = materializer.replay([
      observedTransaction('tx-erase-source', 'command-erase-source', source),
      observedTransaction('tx-erase-target', 'command-erase-target', target),
      linkedTransaction('tx-erase-link', 'command-erase-link', [link]),
      eraseTransaction('tx-erase-authorize', 'command-erase-authorize'),
    ])

    const committed = eraseCommitTransaction('tx-erase-commit', 'command-erase-commit')
    const erased = materializer.apply(committed, state)
    expect(erased.memories.some(memory => memory.id === source.id)).toBe(false)
    expect(queryMaterializedLinks(erased, { state: 'active' })).toEqual([])
    const retracted = queryMaterializedLinks(erased, { state: 'retracted' })
    expect(retracted).toHaveLength(1)
    expect(retracted[0]?.id).toBe(link.id)
    expect(retracted[0]?.updatedAt).toBe(committed.events[0]?.occurredAt)
  })

  test('marks projection checkpoints dirty and gates stale model input', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-projection-checkpoints-'))
    const path = join(root, 'memory.db')
    const database = new MemoryCognitionDatabase(path)
    const initial = database.listProjectionCheckpoints()
    expect(initial).toHaveLength(6)
    expect(initial.every(checkpoint => checkpoint.status === 'clean')).toBe(true)

    const transaction = observedTransaction('tx-projection-dirty', 'command-projection-dirty')
    database.appendTransaction(transaction)
    const dirty = database.getProjectionCheckpoint('prompt-memory')
    expect(dirty.status).toBe('dirty')
    expect(dirty.lastEventSeq).toBe(0)
    expect(dirty.dirtySinceEventSeq).toBe(1)
    expect(() => database.requireProjectionReady('prompt-memory')).toThrow('is dirty')
    expect(() => database.markProjectionClean('prompt-memory', 1, 0, 'stale-state-hash')).toThrow('materialized version')

    const clean = database.markProjectionClean(
      'prompt-memory',
      1,
      1,
      'prompt-state-hash',
      '2026-01-01T00:00:02.000Z',
    )
    expect(clean.status).toBe('clean')
    expect(clean.lastEventSeq).toBe(1)
    expect(clean.stateHash).toBe('prompt-state-hash')
    expect(database.requireProjectionReady('prompt-memory')).toEqual(clean)
    expect(() => database.markProjectionClean('notes', 0, 1, 'notes-state-hash')).toThrow('current journal event sequence')

    const dirtyAgain = database.markProjectionDirty('prompt-memory', '2026-01-01T00:00:03.000Z')
    expect(dirtyAgain.status).toBe('dirty')
    expect(dirtyAgain.dirtySinceEventSeq).toBe(1)
    expect(() => database.requireProjectionReady('prompt-memory')).toThrow('is dirty')
  })

})
  test('persists model input sequence and exact snapshot hash fields', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-model-input-log-'))
    const database = new MemoryCognitionDatabase(join(root, 'memory.db'))
    const first = database.appendModelInput({
      id: 'model-input-1',
      cycleId: 'cycle-1',
      sequence: 0,
      sessionId: 'session-1',
      createdAt: '2026-01-01T00:00:01.000Z',
      workspaceHash: 'workspace-hash',
      inputHash: hashModelInput({ messages: [{ role: 'system', content: 'first' }] }),
      input: { messages: [{ role: 'system', content: 'first' }] },
    })
    const second = database.appendModelInput({
      id: 'model-input-2',
      cycleId: 'cycle-1',
      sequence: 0,
      sessionId: 'session-1',
      createdAt: '2026-01-01T00:00:02.000Z',
      workspaceHash: 'workspace-hash',
      inputHash: hashModelInput({ messages: [{ role: 'user', content: 'second' }] }),
      input: { messages: [{ role: 'user', content: 'second' }] },
    })
    expect(first.sequence).toBe(0)
    expect(second.sequence).toBe(1)
    expect(database.listModelInputs('cycle-1')).toEqual([first, second])
    expect(() => database.appendModelInput({
      ...first,
      id: 'model-input-invalid',
      inputHash: 'not-a-hash',
    })).toThrow('hash does not match')
    const raw = new DatabaseSync(join(root, 'memory.db'))
    raw.prepare('UPDATE memory_cognition_model_inputs SET input_json = ? WHERE record_id = ?').run(JSON.stringify({ messages: [{ role: 'system', content: 'tampered' }] }), first.id)
    raw.close()
    expect(() => database.listModelInputs('cycle-1')).toThrow('stored snapshot')
  })

  test('rebinds one persisted session recall after a store restart without guessing among multiple', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-model-input-restart-'))
    const dbPath = join(root, 'memory.db')
    const config = {
      dbPath,
      manifestPath: join(root, 'manifest.json'),
      homeRoot: root,
    }
    const makeStore = () => new FileMemoryStore(new Context(), config)
    const first = makeStore()
    const only = await first.recall({
      cycleId: 'restart-session-recall',
      query: { sessionId: 'restart-session', text: 'restart binding' },
      budget: { maxItems: 2, maxTokens: 256 },
    })

    const restarted = makeStore()
    const rebound = restarted.recordModelInput({
      sessionId: 'restart-session',
      input: { messages: [{ role: 'system', content: 'rebound after restart' }] },
    })
    expect(rebound.cycleId).toBe(only.trace.cycleId)
    expect(rebound.workspaceHash).toBe(only.workspace.hash)

    await restarted.recall({
      cycleId: 'restart-session-ambiguous-a',
      query: { sessionId: 'restart-session', text: 'ambiguous a' },
      budget: { maxItems: 2, maxTokens: 256 },
    })
    await restarted.recall({
      cycleId: 'restart-session-ambiguous-b',
      query: { sessionId: 'restart-session', text: 'ambiguous b' },
      budget: { maxItems: 2, maxTokens: 256 },
    })
    const secondRestart = makeStore()
    const ambiguous = secondRestart.recordModelInput({
      sessionId: 'restart-session',
      input: { messages: [{ role: 'system', content: 'do not guess' }] },
    })
    expect(ambiguous.cycleId).toMatch(/^unbound-/)
    expect(ambiguous.workspaceHash).toBeUndefined()
  })

  test('persists and validates recall workspace records with member rows', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-recall-record-'))
    const database = new MemoryCognitionDatabase(join(root, 'memory.db'))
    const cycleId = 'recall-cycle'
    const budget = { maxItems: 1, maxTokens: 128, usedItems: 0, usedTokens: 0 }
    const unsignedWorkspace: Omit<MemoryRecallRecord['workspace'], 'hash'> = {
      schemaVersion: MEMORY_RECALL_SCHEMA_VERSION,
      cycleId,
      materializedVersion: 0,
      query: { text: 'recall' },
      budget,
      currentField: createEmptyCurrentField(),
      items: [],
      links: [],
      uncertainty: [],
    }
    const trace: MemoryRecallRecord['trace'] = {
      schemaVersion: MEMORY_RECALL_SCHEMA_VERSION,
      cycleId,
      materializedVersion: 0,
      query: { text: 'recall' },
      budget,
      sources: [],
      candidates: [],
      suppressed: [],
      selectedIds: [],
      selection: [],
    }
    const record: MemoryRecallRecord = {
      cycleId,
      createdAt: '2026-01-01T00:00:01.000Z',
      workspace: { ...unsignedWorkspace, hash: hashModelInput(unsignedWorkspace) },
      trace,
    }
    expect(database.appendRecallRecord(record)).toEqual(record)
    expect(database.getRecallRecord(cycleId)).toEqual(record)
    expect(database.listRecallRecords()).toEqual([record])
    expect(database.appendRecallRecord(record)).toEqual(record)
    expect(() => database.appendRecallRecord({ ...record, createdAt: '2026-01-01T00:00:02.000Z' })).toThrow('different content')
  })


  test('persists actual use traces in the cognition journal without mutating memory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-use-trace-'))
    const database = new MemoryCognitionDatabase(join(root, 'memory.db'))
    const memory = sceneMemory()
    const observed = observedTransaction('tx-use-memory', 'command-use-memory', memory)
    database.appendTransaction(observed)
    const use: MemoryUseTrace = {
      id: 'use-trace-1',
      cycleId: 'recall-cycle-1',
      memoryId: memory.id,
      memoryVersion: memory.updatedAt,
      surface: 'model-input',
      purpose: 'answer',
      usedAt: '2026-01-01T00:01:00.000Z',
    }
    const transaction = createMemoryUseTransaction({
      actor: createRuntimeActor('runtime-use'),
      use,
      commandId: createMemoryCommandId('command-use-trace'),
      eventId: createMemoryEventId('event-use-trace'),
      transactionId: createMemoryTransactionId('tx-use-trace'),
      correlationId: createMemoryCorrelationId('correlation-use-trace'),
      issuedAt: use.usedAt,
    })
    database.appendTransaction(transaction)
    expect(database.listMemoryUseTraces()).toEqual([use])
    expect(database.listMemoryUseTraces(memory.id, use.cycleId)).toEqual([use])
    expect(database.listEvents(transaction.transactionId)[0]?.type).toBe('memory-used')
    const state = new MemoryMaterializer().replayFrom(database)
    expect(state.memories).toEqual([memory])
    expect(state.eventCount).toBe(2)
    const replayed = new MemoryMaterializer().replay([observed, transaction])
    expect(hashMaterializedState(state)).toBe(hashMaterializedState(replayed))
  })

  test('rejects a store use trace outside the memory validity interval', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-use-validity-'))
    const dbPath = join(root, 'memory.db')
    const database = new MemoryCognitionDatabase(dbPath)
    const source = sceneMemory(createMemoryId('use-validity-memory'))
    const memory = createMemory({
      ...source,
      state: {
        ...source.state,
        persistence: 'durable',
        integration: 'integrated',
        influence: 'permitted',
      },
      dynamics: {
        ...source.dynamics,
        influenceSurfaces: ['model-input'],
        validity: {
          startsAt: '2026-01-01T00:00:00.000Z',
          endsAt: '2026-01-01T00:00:30.000Z',
        },
      },
    })
    database.appendTransaction(observedTransaction(
      'tx-use-validity-memory',
      'command-use-validity-memory',
      memory,
    ))
    const cycleId = 'recall-use-validity'
    const budget = { maxItems: 1, maxTokens: 128, usedItems: 0, usedTokens: 0 }
    const unsignedWorkspace: Omit<MemoryRecallRecord['workspace'], 'hash'> = {
      schemaVersion: MEMORY_RECALL_SCHEMA_VERSION,
      cycleId,
      materializedVersion: 1,
      query: { text: 'validity' },
      budget,
      currentField: createEmptyCurrentField(),
      items: [],
      links: [],
      uncertainty: [],
    }
    const trace: MemoryRecallRecord['trace'] = {
      schemaVersion: MEMORY_RECALL_SCHEMA_VERSION,
      cycleId,
      materializedVersion: 1,
      query: { text: 'validity' },
      budget,
      sources: [],
      candidates: [],
      suppressed: [],
      selectedIds: [],
      selection: [],
    }
    database.appendRecallRecord({
      cycleId,
      createdAt: '2026-01-01T00:00:02.000Z',
      workspace: { ...unsignedWorkspace, hash: hashModelInput(unsignedWorkspace) },
      trace,
    })
    const store = new FileMemoryStore(new Context(), {
      dbPath,
      manifestPath: join(root, 'manifest.json'),
      homeRoot: root,
    })
    expect(() => store.recordMemoryUse({
      id: 'use-validity-expired',
      cycleId,
      memoryId: memory.id,
      memoryVersion: memory.updatedAt,
      surface: 'model-input',
      purpose: 'answer',
      usedAt: '2026-01-01T00:01:00.000Z',
    })).toThrow('outside the memory validity interval')
    expect(store.listMemoryUseTraces()).toEqual([])
  })

  test('records selected recall memories when a model-input record binds the workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-model-input-use-'))
    const dbPath = join(root, 'memory.db')
    const database = new MemoryCognitionDatabase(dbPath)
    const source = sceneMemory(createMemoryId('model-input-use-memory'))
    const memory = createMemory({
      ...source,
      state: { ...source.state, persistence: 'durable', integration: 'integrated', influence: 'permitted' },
      dynamics: { ...source.dynamics, influenceSurfaces: ['model-input', 'action-selection', 'relationship-expression'] },
    })
    const modelOnly = createMemory({
      ...source,
      id: createMemoryId('model-input-only-memory'),
      data: { ...source.data, observations: ['model-only memory is visible to answers'] },
      state: { ...source.state, persistence: 'durable', integration: 'integrated', influence: 'permitted' },
      dynamics: { ...source.dynamics, influenceSurfaces: ['model-input'] },
    })
    database.appendTransaction(observedTransaction(
      'tx-model-input-use-memory',
      'command-model-input-use-memory',
      memory,
    ))
    database.appendTransaction(observedTransaction(
      'tx-model-input-only-memory',
      'command-model-input-only-memory',
      modelOnly,
    ))
    const store = new FileMemoryStore(new Context(), {
      dbPath,
      manifestPath: join(root, 'manifest.json'),
      homeRoot: root,
    })
    const recall = await store.recall({
      cycleId: 'model-input-use-cycle',
      query: { text: 'remember a scene' },
      budget: { maxItems: 4, maxTokens: 600 },
    })
    expect(recall.workspace.items.some(item => item.memory?.id === modelOnly.id)).toBe(true)
    expect(recall.workspace.items.some(item => item.memory?.id === memory.id)).toBe(true)
    const modelInput = store.recordModelInput({
      cycleId: recall.trace.cycleId,
      input: { messages: [{ role: 'system', content: 'Rin memory workspace' }] },
    })
    const uses = store.listMemoryUseTraces(undefined, recall.trace.cycleId)
    const memoryUses = uses.filter(use => use.memoryId === memory.id)
    expect(modelInput.workspaceHash).toBe(recall.workspace.hash)
    expect(memoryUses).toEqual([{
      id: 'memory-use-model-input-' + modelInput.id + '-' + String(memory.id),
      cycleId: recall.trace.cycleId,
      memoryId: memory.id,
      memoryVersion: memory.updatedAt,
      surface: 'model-input',
      purpose: 'answer',
      usedAt: modelInput.createdAt,
    }])
    const expressionTransactions = store.recordRelationshipExpression({
      expressionId: 'assistant-expression-1',
      cycleId: recall.trace.cycleId,
      workspaceHash: recall.workspace.hash,
      memoryIds: [memory.id],
      usedAt: modelInput.createdAt,
    })
    expect(expressionTransactions).toHaveLength(1)
    expect(store.listMemoryUseTraces(undefined, recall.trace.cycleId).filter(use =>
      use.surface === 'relationship-expression',
    )).toEqual([{
      id: 'memory-use-relationship-expression-assistant-expression-1-' + String(memory.id),
      cycleId: recall.trace.cycleId,
      memoryId: memory.id,
      memoryVersion: memory.updatedAt,
      surface: 'relationship-expression',
      purpose: 'relationship-expression',
      usedAt: modelInput.createdAt,
    }])
    expect(() => store.recordRelationshipExpression({
      expressionId: 'assistant-expression-not-permitted',
      cycleId: recall.trace.cycleId,
      workspaceHash: recall.workspace.hash,
      memoryIds: [modelOnly.id],
      usedAt: modelInput.createdAt,
    })).toThrow('relationship expression surface is not permitted')
    const action = {
      id: createActionId('model-input-use-action'),
      cycleId: recall.trace.cycleId,
      sessionId: 'model-input-use-session',
      workspaceHash: recall.workspace.hash,
      actor: createParticipantId('rin'),
      description: 'act from the recalled memory',
      goalIds: [],
      sourceMemoryIds: [memory.id, modelOnly.id],
      predictionIds: [],
      occurredAt: modelInput.createdAt,
    } as const
    store.recordAction(action)
    const actionUses = store.listMemoryUseTraces(undefined, recall.trace.cycleId)
      .filter(use => use.surface === 'action-selection')
    expect(actionUses).toEqual([{
      id: 'memory-use-action-selection-' + String(action.id) + '-' + String(memory.id),
      cycleId: action.cycleId,
      memoryId: memory.id,
      memoryVersion: memory.updatedAt,
      surface: 'action-selection',
      purpose: 'action',
      usedAt: action.occurredAt,
    }])
    expect(store.readCognitionState().memories).toEqual([modelOnly, memory])
  })

  test('permits behavioral influence only through a version-bound owner transaction', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-influence-permission-'))
    const dbPath = join(root, 'memory.db')
    const database = new MemoryCognitionDatabase(dbPath)
    let eligible = sceneMemory(createMemoryId('owner-permission-memory'))
    eligible = transitionMemory(eligible, { type: 'encode', at: '2026-01-01T00:00:01.000Z' })
    eligible = transitionMemory(eligible, { type: 'durable', at: '2026-01-01T00:00:02.000Z' })
    eligible = transitionMemory(eligible, { type: 'link', at: '2026-01-01T00:00:03.000Z' })
    eligible = transitionMemory(eligible, { type: 'consolidate', at: '2026-01-01T00:00:04.000Z' })
    eligible = transitionMemory(eligible, { type: 'integrate', at: '2026-01-01T00:00:05.000Z' })
    database.appendTransaction(observedTransaction(
      'tx-owner-permission-memory',
      'command-owner-permission-memory',
      eligible,
    ))
    const store = new FileMemoryStore(new Context(), {
      dbPath,
      manifestPath: join(root, 'manifest.json'),
      homeRoot: root,
    })

    const transaction = store.permitInfluence({
      memoryId: eligible.id,
      previousVersion: eligible.updatedAt,
      surfaces: ['action-selection'],
      reason: 'owner explicitly permits this disposition to guide action selection',
      ownerId: 'owner-1',
      at: '2026-01-01T00:00:06.000Z',
    })
    expect(transaction.actor.kind).toBe('owner')
    expect(transaction.events[0]?.type).toBe('influence-permitted')
    const state = store.readCognitionState()
    const permitted = state.memories.find(memory => memory.id === eligible.id)
    expect(permitted?.state.influence).toBe('permitted')
    expect(permitted?.dynamics.influenceSurfaces).toEqual(['action-selection'])
    expect(() => store.permitInfluence({
      memoryId: eligible.id,
      previousVersion: eligible.updatedAt,
      surfaces: ['action-selection'],
      reason: 'stale owner request',
      ownerId: 'owner-1',
      at: '2026-01-01T00:00:07.000Z',
    })).toThrow('source version is stale')

    const replayed = new MemoryMaterializer().replayFrom(database)
    expect(hashMaterializedState(state)).toBe(hashMaterializedState(replayed))
  })

  test('commits reconsolidation only after persisted use and replays it atomically', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-consolidation-'))
    const dbPath = join(root, 'memory.db')
    const database = new MemoryCognitionDatabase(dbPath)
    const memory = sceneMemory(createMemoryId('memory-consolidation'))
    const observed = observedTransaction('tx-consolidation-memory', 'command-consolidation-memory', memory)
    database.appendTransaction(observed)
    const use: MemoryUseTrace = {
      id: 'use-consolidation-1',
      cycleId: 'recall-consolidation-1',
      memoryId: memory.id,
      memoryVersion: memory.updatedAt,
      surface: 'model-input',
      purpose: 'answer',
      usedAt: '2026-01-01T00:01:00.000Z',
    }
    const useTransaction = createMemoryUseTransaction({
      actor: createRuntimeActor('runtime-consolidation'),
      use,
      commandId: createMemoryCommandId('command-consolidation-use'),
      eventId: createMemoryEventId('event-consolidation-use'),
      transactionId: createMemoryTransactionId('tx-consolidation-use'),
      correlationId: createMemoryCorrelationId('correlation-consolidation-use'),
      issuedAt: use.usedAt,
    })
    database.appendTransaction(useTransaction)
    const store = new FileMemoryStore(new Context(), {
      dbPath,
      manifestPath: join(root, 'manifest.json'),
      homeRoot: root,
    })
    const schedule = store.planConsolidation('2026-01-01T00:02:00.000Z', 4)
    const item = schedule.items.find(candidate => candidate.memoryId === memory.id)
    if (item === undefined) throw new Error('missing consolidation schedule item')
    const decision = {
      memoryId: item.memoryId,
      memoryVersion: item.memoryVersion,
      useTraceId: item.useTraceId,
      operation: 'reinforce' as const,
      basis: 'new-evidence' as const,
      evidenceIds: [createEvidenceId('evidence-consolidation')],
      at: '2026-01-01T00:02:00.000Z',
      explanation: 'a new observation supports the existing representation',
    }
    expect(() => store.commitConsolidationDecision(schedule, {
      ...decision,
      memoryVersion: 'stale-memory-version',
    })).toThrow('not bound')
    const consolidation = store.commitConsolidationDecision(schedule, decision)
    const committedAt = store.readCognitionState().memories
      .find(candidate => candidate.id === memory.id)?.updatedAt
    if (committedAt === undefined) throw new Error('missing consolidated source')
    const state = new MemoryMaterializer().replayFrom(database)
    expect(state.memories[0]?.updatedAt).toBe(committedAt)
    expect(state.memories[0]?.dynamics.accessibility).toBeGreaterThan(memory.dynamics.accessibility)
    expect(state.eventCount).toBe(3)
    expect(database.listEvents(consolidation.transactionId)[0]?.type).toBe('memory-consolidated')


    const replayed = new MemoryMaterializer().replay([observed, useTransaction, consolidation])
    expect(hashMaterializedState(state)).toBe(hashMaterializedState(replayed))
  })

  test('replays decay as a dynamic-only version change and updates active link endpoints', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-decay-'))
    const database = new MemoryCognitionDatabase(join(root, 'memory.db'))
    const transientSource = sceneMemory(createMemoryId('memory-decay-journal'))
    const memory = createMemory({
      ...transientSource,
      state: {
        ...transientSource.state,
        persistence: 'durable',
        activation: 'active',
        integration: 'integrated',
        influence: 'permitted',
      },
      dynamics: { ...transientSource.dynamics, influenceSurfaces: ['model-input'] },
    })
    const target = sceneMemory(createMemoryId('memory-decay-target-journal'))
    const sourceObserved = observedTransaction('tx-decay-source', 'command-decay-source', memory)
    const targetObserved = observedTransaction('tx-decay-target', 'command-decay-target', target)
    const link = memoryLink('link-decay-journal', 'supports', memory, target)
    const linked = linkedTransaction('tx-decay-link', 'command-decay-link', [link])
    database.appendTransaction(sourceObserved)
    database.appendTransaction(targetObserved)
    database.appendTransaction(linked)
    const result = decayMemory({
      memory,
      links: [link],
      elapsedMs: 24 * 60 * 60 * 1_000,
      at: '2026-01-02T00:00:00.000Z',
      explanation: 'background accessibility maintenance',
    })
    const decay = createMemoryDecayTransaction({
      actor: createBackgroundActor('rin-decay-test'),
      result,
      commandId: createMemoryCommandId('command-decay'),
      eventId: createMemoryEventId('event-decay'),
      transactionId: createMemoryTransactionId('tx-decay'),
      correlationId: createMemoryCorrelationId('correlation-decay'),
      issuedAt: result.previousVersion,
      committedAt: result.memory.updatedAt,
    })
    database.appendTransaction(decay)
    const state = new MemoryMaterializer().replayFrom(database)
    const current = state.memories.find(item => item.id === memory.id)
    expect(current?.updatedAt).toBe(result.memory.updatedAt)
    expect(current?.dynamics.accessibility).toBeLessThan(memory.dynamics.accessibility)
    expect(current?.dynamics.confidence).toBe(memory.dynamics.confidence)
    expect(current?.state).toEqual(memory.state)
    expect(current?.data).toEqual(memory.data)
    expect(state.links[0]?.strength).toBeLessThan(link.strength)
    expect(state.links[0]?.fromVersion).toBe(result.memory.updatedAt)
    expect(database.listEvents(decay.transactionId)[0]?.type).toBe('memory-decayed')
    expect(state.eventCount).toBe(4)
    const replayed = new MemoryMaterializer().replay([sourceObserved, targetObserved, linked, decay])
    expect(hashMaterializedState(state)).toBe(hashMaterializedState(replayed))
  })

test('replays one behavior chain in the cognition journal and erases its derived references', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rin-behavior-chain-'))
  const database = new MemoryCognitionDatabase(join(root, 'memory.db'))
  const memory = sceneMemory(createMemoryId('memory-1'))
  const survivor = sceneMemory(createMemoryId('memory-survivor'))
  const observed = observedTransaction('tx-behavior-scene', 'command-behavior-scene', memory)
  const observedSurvivor = observedTransaction('tx-behavior-survivor', 'command-behavior-survivor', survivor)
  database.appendTransaction(observed)
  database.appendTransaction(observedSurvivor)

  const cycleId = 'behavior-cycle-1'
  const prediction = {
    id: createPredictionId('behavior-prediction-1'),
    cycleId,
    statement: 'the tool result will preserve the requested scope',
    sourceMemoryIds: [memory.id, survivor.id],
    expectedOutcome: 'requested scope is preserved',
    epistemic: 'hypothesized',
    createdAt: '2026-01-01T00:00:02.000Z',
  } as const
  const action = {
    id: createActionId('behavior-action-1'),
    cycleId,
    sessionId: 'behavior-session-1',
    workspaceHash: 'behavior-workspace-hash',
    actor: createParticipantId('rin'),
    description: 'read the scoped workspace file',
    goalIds: [],
    sourceMemoryIds: [memory.id, survivor.id],
    predictionIds: [prediction.id],
    occurredAt: '2026-01-01T00:00:03.000Z',
  } as const
  const outcome = {
    id: createOutcomeId('behavior-outcome-1'),
    cycleId,
    sessionId: 'behavior-session-1',
    actionId: action.id,
    predictionId: prediction.id,
    status: 'observed',
    description: 'the requested scope was preserved',
    occurredAt: '2026-01-01T00:00:04.000Z',
    delayed: false,
  } as const
  const feedback = {
    id: createFeedbackId('behavior-feedback-1'),
    cycleId,
    sessionId: 'behavior-session-1',
    kind: 'accept',
    actionId: action.id,
    outcomeId: outcome.id,
    taskOutcome: 0.8,
    actionCost: 0.2,
    factualCorrection: 'the requested scope was narrower than expected',
    explanation: 'the result matched the requested scope',
    occurredAt: '2026-01-01T00:00:05.000Z',
    delayed: false,
  } as const
  const behaviorTransaction = createMemoryBehaviorTransaction({
    actor: createRuntimeActor('runtime-behavior'),
    prediction,
    action,
    outcome,
    feedback,
    commandId: createMemoryCommandId('command-behavior'),
    eventId: createMemoryEventId('event-behavior'),
    transactionId: createMemoryTransactionId('tx-behavior'),
    correlationId: createMemoryCorrelationId('correlation-behavior'),
    issuedAt: prediction.createdAt,
    committedAt: feedback.occurredAt,
  })
  database.appendTransaction(behaviorTransaction)
  expect(behaviorTransaction.command.type).toBe('record-behavior')
  expect(behaviorTransaction.events.map(event => event.type)).toEqual([
    'prediction-recorded', 'action-recorded', 'outcome-recorded', 'feedback-recorded',
  ])

  const beforeErase = new MemoryMaterializer().replayFrom(database)
  expect(beforeErase.memories).toHaveLength(2)
  expect(beforeErase.predictions).toEqual([prediction])
  expect(beforeErase.actions).toEqual([action])
  expect(beforeErase.outcomes).toEqual([outcome])
  expect(beforeErase.feedback).toEqual([feedback])
  expect(beforeErase.eventCount).toBe(6)
  const materializedScene = beforeErase.memories.find(item => item.id === memory.id)
  expect(materializedScene).toMatchObject({
    data: {
      predictionErrors: [{
        expected: prediction.expectedOutcome,
        actual: outcome.description,
        magnitude: 0.5,
      }, {
        expected: prediction.expectedOutcome,
        actual: feedback.factualCorrection,
        magnitude: 1,
      }],
    },
  })
  expect(hashMaterializedState(beforeErase)).toBe(hashMaterializedState(new MemoryMaterializer().replay([
    observed,
    observedSurvivor,
    behaviorTransaction,
  ])))

  // A later record sorts before the earlier record in the next snapshot.
  // Derived error order must remain identical between bulk and stepwise replay.
  const lateOutcome = {
    ...outcome,
    id: createOutcomeId('behavior-outcome-0'),
    description: 'a delayed result contradicted the first outcome',
    occurredAt: '2026-01-01T00:00:06.000Z',
    delayed: true,
  }
  database.appendTransaction(createMemoryOutcomeTransaction({
    actor: createRuntimeActor('runtime-behavior'),
    outcome: lateOutcome,
    commandId: createMemoryCommandId('command-late-outcome'),
    eventId: createMemoryEventId('event-late-outcome'),
    transactionId: createMemoryTransactionId('tx-late-outcome'),
    correlationId: createMemoryCorrelationId('correlation-late-outcome'),
    issuedAt: lateOutcome.occurredAt,
    committedAt: lateOutcome.occurredAt,
  }))
  const afterLateOutcome = new MemoryMaterializer().replayFrom(database)
  const sceneAfterLateOutcome = afterLateOutcome.memories.find(item => item.id === memory.id)
  expect(sceneAfterLateOutcome?.data.predictionErrors).toEqual([
    { expected: prediction.expectedOutcome, actual: outcome.description, magnitude: 0.5 },
    { expected: prediction.expectedOutcome, actual: lateOutcome.description, magnitude: 0.5 },
    { expected: prediction.expectedOutcome, actual: feedback.factualCorrection, magnitude: 1 },
  ])

  const authorization = eraseTransaction('tx-behavior-erase-authorize', 'command-behavior-erase-authorize')
  const commit = eraseCommitTransaction('tx-behavior-erase-commit', 'command-behavior-erase-commit')
  database.appendTransaction(authorization)
  const afterAuthorization = new MemoryMaterializer().replayFrom(database)
  const authorizedScene = afterAuthorization.memories.find(item => item.id === memory.id)
  expect(authorizedScene?.data.predictionErrors).toEqual([
    { expected: prediction.expectedOutcome, actual: lateOutcome.description, magnitude: 0.5 },
    { expected: prediction.expectedOutcome, actual: outcome.description, magnitude: 0.5 },
    { expected: prediction.expectedOutcome, actual: feedback.factualCorrection, magnitude: 1 },
  ])
  expect(JSON.stringify(beforeErase)).not.toContain(lateOutcome.description)
  database.appendTransaction(commit)
  expectReplayPrefixes(database.listAllTransactions())
  const erased = new MemoryMaterializer().replayFrom(database)
  expect(erased.memories).toEqual([survivor])
  expect(erased.memories[0]?.data.predictionErrors).toEqual([])
  expect(erased.predictions).toEqual([])
  expect(erased.actions).toEqual([])


  expect(erased.outcomes).toEqual([])
  expect(erased.feedback).toEqual([])
  expect(erased.erasedMemoryIds).toEqual([memory.id])
})
test('rejects feedback whose action, prediction, and outcome bindings disagree', () => {
  const cycleId = 'feedback-binding-cycle'
  const actor = createRuntimeActor('runtime-feedback-binding')
  const identity = (prefix: string, occurredAt: string) => ({
    actor,
    commandId: createMemoryCommandId('command-' + prefix),
    eventId: createMemoryEventId('event-' + prefix),
    transactionId: createMemoryTransactionId('tx-' + prefix),
    correlationId: createMemoryCorrelationId('correlation-' + prefix),
    issuedAt: occurredAt,
    committedAt: occurredAt,
  })
  const predictionA = {
    id: createPredictionId('feedback-binding-prediction-a'),
    cycleId,
    statement: 'the first action will preserve scope',
    sourceMemoryIds: [],
    expectedOutcome: 'scope is preserved',
    epistemic: 'hypothesized',
    createdAt: '2026-01-01T00:00:01.000Z',
  } as const
  const predictionB = {
    ...predictionA,
    id: createPredictionId('feedback-binding-prediction-b'),
    statement: 'the second action will preserve scope',
  } as const
  const actionA = {
    id: createActionId('feedback-binding-action-a'),
    cycleId,
    sessionId: 'feedback-binding-session',
    workspaceHash: 'feedback-binding-workspace',
    actor: createParticipantId('rin'),
    description: 'perform the first action',
    goalIds: [],
    sourceMemoryIds: [],
    predictionIds: [predictionA.id],
    occurredAt: '2026-01-01T00:00:02.000Z',
  } as const
  const actionB = {
    ...actionA,
    id: createActionId('feedback-binding-action-b'),
    description: 'perform the second action',
    predictionIds: [predictionB.id],
  } as const
  const outcomeA = {
    id: createOutcomeId('feedback-binding-outcome-a'),
    cycleId,
    sessionId: actionA.sessionId,
    actionId: actionA.id,
    predictionId: predictionA.id,
    status: 'observed',
    description: 'the first action preserved scope',
    occurredAt: '2026-01-01T00:00:03.000Z',
    delayed: false,
  } as const
  const outcomeB = {
    ...outcomeA,
    id: createOutcomeId('feedback-binding-outcome-b'),
    actionId: actionB.id,
    predictionId: predictionB.id,
    description: 'the second action preserved scope',
  } as const
  const baseTransactions = [
    createMemoryPredictionTransaction({ ...identity('prediction-a', predictionA.createdAt), prediction: predictionA }),
    createMemoryPredictionTransaction({ ...identity('prediction-b', predictionB.createdAt), prediction: predictionB }),
    createMemoryActionTransaction({ ...identity('action-a', actionA.occurredAt), action: actionA }),
    createMemoryActionTransaction({ ...identity('action-b', actionB.occurredAt), action: actionB }),
    createMemoryOutcomeTransaction({ ...identity('outcome-a', outcomeA.occurredAt), outcome: outcomeA }),
    createMemoryOutcomeTransaction({ ...identity('outcome-b', outcomeB.occurredAt), outcome: outcomeB }),
  ]
  const feedbackBase = {
    id: createFeedbackId('feedback-binding-base'),
    cycleId,
    kind: 'accept',
    taskOutcome: 0.8,
    actionCost: 0.2,
    explanation: 'the observed result was evaluated',
    occurredAt: '2026-01-01T00:00:04.000Z',
    delayed: false,
  } as const
  const invalidPrediction = {
    ...feedbackBase,
    id: createFeedbackId('feedback-binding-invalid-prediction'),
    actionId: actionA.id,
    predictionId: predictionB.id,
  } as const
  expect(() => new MemoryMaterializer().replay([
    ...baseTransactions,
    createMemoryFeedbackTransaction({
      ...identity('feedback-invalid-prediction', invalidPrediction.occurredAt),
      feedback: invalidPrediction,
    }),
  ])).toThrow('feedback-recorded prediction is not one of the action predictions')

  const invalidOutcome = {
    ...feedbackBase,
    id: createFeedbackId('feedback-binding-invalid-outcome'),
    actionId: actionA.id,
    outcomeId: outcomeB.id,
  } as const
  expect(() => new MemoryMaterializer().replay([
    ...baseTransactions,
    createMemoryFeedbackTransaction({
      ...identity('feedback-invalid-outcome', invalidOutcome.occurredAt),
      feedback: invalidOutcome,
    }),
  ])).toThrow('feedback-recorded outcome does not belong to the action')

  const invalidPredictionOutcome = {
    ...feedbackBase,
    id: createFeedbackId('feedback-binding-invalid-prediction-outcome'),
    predictionId: predictionA.id,
    outcomeId: outcomeB.id,
  } as const
  expect(() => new MemoryMaterializer().replay([
    ...baseTransactions,
    createMemoryFeedbackTransaction({
      ...identity('feedback-invalid-prediction-outcome', invalidPredictionOutcome.occurredAt),
      feedback: invalidPredictionOutcome,
    }),
  ])).toThrow('feedback-recorded prediction does not match the outcome')
})
test('commits deterministic disposition learning into the cognition journal and replays it atomically', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rin-disposition-learning-'))
  const database = new MemoryCognitionDatabase(join(root, 'memory.db'))
  const disposition = createMemory({
    id: createMemoryId('journal-disposition'),
    form: 'disposition',
    data: {
      triggeringContexts: ['ambiguous request'],
      intendedGoal: createGoalId('journal-goal'),
      actionPattern: ['ask before acting'],
      expectedOutcomes: ['shared understanding'],
      observedOutcomes: [],
      applicabilityConditions: ['high uncertainty'],
      failureModes: [],
      utilityByGoal: [],
    },
    state: {
      persistence: 'durable',
      activation: 'active',
      integration: 'integrated',
      epistemic: 'inferred',
      influence: 'permitted',
    },
    dynamics: {
      activation: 0.7,
      accessibility: 0.5,
      salience: 0.5,
      stability: 0.4,
      confidence: 0.6,
      integrationStrength: 0.7,
      novelty: 0.2,
      surprise: 0.1,
      affect: { valence: 0, arousal: 0.2, control: 0.7 },
      validity: { startsAt: '2026-01-01T00:00:00.000Z' },
      utilityByGoal: [],
      inhibition: 0.1,
      influenceSurfaces: ['action-selection'],
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })
  const observed = observedTransaction('tx-journal-disposition', 'command-journal-disposition', disposition)
  database.appendTransaction(observed)

  const cycleId = createWorkspaceCycleId('journal-learning-cycle')
  const action = {
    id: createActionId('journal-learning-action'),
    cycleId,
    sessionId: 'journal-session',
    correlationKey: 'journal-correlation',
    workspaceHash: 'journal-workspace-hash',
    actor: createParticipantId('rin'),
    description: 'ask before acting',
    goalIds: [],
    sourceMemoryIds: [],
    predictionIds: [],
    occurredAt: '2026-01-01T00:00:02.000Z',
  } as const
  const outcome = {
    id: createOutcomeId('journal-learning-outcome'),
    cycleId,
    sessionId: 'journal-session',
    correlationKey: 'journal-correlation',
    actionId: action.id,
    status: 'observed',
    description: 'the user confirmed the shared scope',
    occurredAt: '2026-01-01T00:00:03.000Z',
    delayed: false,
  } as const
  const feedback = {
    id: createFeedbackId('journal-learning-feedback'),
    cycleId,
    sessionId: 'journal-session',
    kind: 'accept',
    actionId: action.id,
    outcomeId: outcome.id,
    dispositionId: disposition.id,
    taskOutcome: 0.8,
    actionCost: 0.2,
    explanation: 'the accepted result supports asking before acting',
    occurredAt: '2026-01-01T00:00:04.000Z',
    delayed: false,
  } as const
  const transactions = [
    createMemoryActionTransaction({
      actor: createRuntimeActor('runtime-journal'),
      action,
      commandId: createMemoryCommandId('command-journal-action'),
      eventId: createMemoryEventId('event-journal-action'),
      transactionId: createMemoryTransactionId('tx-journal-action'),
      correlationId: createMemoryCorrelationId('correlation-journal-action'),
      issuedAt: action.occurredAt,
      committedAt: action.occurredAt,
    }),
    createMemoryOutcomeTransaction({
      actor: createRuntimeActor('runtime-journal'),
      outcome,
      commandId: createMemoryCommandId('command-journal-outcome'),
      eventId: createMemoryEventId('event-journal-outcome'),
      transactionId: createMemoryTransactionId('tx-journal-outcome'),
      correlationId: createMemoryCorrelationId('correlation-journal-outcome'),
      issuedAt: outcome.occurredAt,
      committedAt: outcome.occurredAt,
    }),
    createMemoryFeedbackTransaction({
      actor: createRuntimeActor('runtime-journal'),
      feedback,
      commandId: createMemoryCommandId('command-journal-feedback'),
      eventId: createMemoryEventId('event-journal-feedback'),
      transactionId: createMemoryTransactionId('tx-journal-feedback'),
      correlationId: createMemoryCorrelationId('correlation-journal-feedback'),
      issuedAt: feedback.occurredAt,
      committedAt: feedback.occurredAt,
    }),
  ]
  for (const transaction of transactions) database.appendTransaction(transaction)

  const result = learnDispositionFromFeedback({
    disposition,
    action,
    outcomes: [outcome],
    feedback: [feedback],
    at: '2026-01-01T00:00:05.000Z',
    explanation: 'one accepted outcome updates support without stabilizing a long-term semantic tendency',
  })
  expect(result.stable).toBe(false)
  const learning = createMemoryDispositionLearningTransaction({
    actor: createBackgroundActor('rin-disposition-learning-test'),
    result,
    commandId: createMemoryCommandId('command-journal-learning'),
    eventId: createMemoryEventId('event-journal-learning'),
    transactionId: createMemoryTransactionId('tx-journal-learning'),
    correlationId: createMemoryCorrelationId('correlation-journal-learning'),
    issuedAt: result.previousVersion,
    committedAt: result.memory.updatedAt,
  })
  database.appendTransaction(learning)

  const state = new MemoryMaterializer().replayFrom(database)
  const current = state.memories.find(memory => memory.id === disposition.id)
  expect(current?.updatedAt).toBe(result.memory.updatedAt)
  expect(current?.form).toBe('disposition')
  expect(current?.data).toEqual(result.memory.data)
  expect(state.actions).toEqual([action])
  expect(state.outcomes).toEqual([outcome])
  expect(state.feedback).toEqual([feedback])
  expect(state.eventCount).toBe(5)
  expect(hashMaterializedState(state)).toBe(hashMaterializedState(new MemoryMaterializer().replay([
    observed,
    ...transactions,
    learning,
  ])))
})


test('runs background disposition maintenance from persisted feedback and is idempotent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rin-background-maintenance-'))
  const dbPath = join(root, 'memory.db')
  const database = new MemoryCognitionDatabase(dbPath)
  const disposition = createMemory({
    id: createMemoryId('maintenance-disposition'),
    form: 'disposition',
    data: {
      triggeringContexts: ['uncertain scope'],
      intendedGoal: createGoalId('maintenance-goal'),
      actionPattern: ['ask before acting'],
      expectedOutcomes: ['scope is shared'],
      observedOutcomes: [],
      applicabilityConditions: ['high uncertainty'],
      failureModes: [],
      utilityByGoal: [],
    },
    state: {
      persistence: 'durable',
      activation: 'active',
      integration: 'integrated',
      epistemic: 'inferred',
      influence: 'permitted',
    },
    dynamics: {
      activation: 0.7,
      accessibility: 0.5,
      salience: 0.5,
      stability: 0.4,
      confidence: 0.6,
      integrationStrength: 0.7,
      novelty: 0.2,
      surprise: 0.1,
      affect: { valence: 0, arousal: 0.2, control: 0.7 },
      validity: { startsAt: '2026-01-01T00:00:00.000Z' },
      utilityByGoal: [],
      inhibition: 0.1,
      influenceSurfaces: ['action-selection'],
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })
  database.appendTransaction(observedTransaction('tx-maintenance-disposition', 'command-maintenance-disposition', disposition))
  const cycleId = createWorkspaceCycleId('maintenance-cycle')
  const action = {
    id: createActionId('maintenance-action'),
    cycleId,
    sessionId: 'maintenance-session',
    workspaceHash: 'maintenance-workspace',
    actor: createParticipantId('rin'),
    description: 'ask before acting',
    goalIds: [],
    sourceMemoryIds: [disposition.id],
    predictionIds: [],
    occurredAt: '2026-01-01T00:00:02.000Z',
  } as const
  const outcome = {
    id: createOutcomeId('maintenance-outcome'),
    cycleId,
    sessionId: 'maintenance-session',
    actionId: action.id,
    status: 'observed',
    description: 'the user shared the scope',
    occurredAt: '2026-01-01T00:00:03.000Z',
    delayed: false,
  } as const
  const feedback = {
    id: createFeedbackId('maintenance-feedback'),
    cycleId,
    sessionId: 'maintenance-session',
    kind: 'accept',
    outcomeId: outcome.id,
    taskOutcome: 0.8,
    actionCost: 0.2,
    explanation: 'the user accepted the scoped result',
    occurredAt: '2026-01-01T00:00:04.000Z',
    delayed: false,
  } as const
  database.appendTransaction(createMemoryActionTransaction({
    actor: createRuntimeActor('runtime-maintenance'),
    action,
    commandId: createMemoryCommandId('command-maintenance-action'),
    eventId: createMemoryEventId('event-maintenance-action'),
    transactionId: createMemoryTransactionId('tx-maintenance-action'),
    correlationId: createMemoryCorrelationId('correlation-maintenance-action'),
    issuedAt: action.occurredAt,
    committedAt: action.occurredAt,
  }))
  database.appendTransaction(createMemoryOutcomeTransaction({
    actor: createRuntimeActor('runtime-maintenance'),
    outcome,
    commandId: createMemoryCommandId('command-maintenance-outcome'),
    eventId: createMemoryEventId('event-maintenance-outcome'),
    transactionId: createMemoryTransactionId('tx-maintenance-outcome'),
    correlationId: createMemoryCorrelationId('correlation-maintenance-outcome'),
    issuedAt: outcome.occurredAt,
    committedAt: outcome.occurredAt,
  }))
  database.appendTransaction(createMemoryFeedbackTransaction({
    actor: createRuntimeActor('runtime-maintenance'),
    feedback,
    commandId: createMemoryCommandId('command-maintenance-feedback'),
    eventId: createMemoryEventId('event-maintenance-feedback'),
    transactionId: createMemoryTransactionId('tx-maintenance-feedback'),
    correlationId: createMemoryCorrelationId('correlation-maintenance-feedback'),
    issuedAt: feedback.occurredAt,
    committedAt: feedback.occurredAt,
  }))

  const store = new FileMemoryStore(new Context(), {
    dbPath,
    manifestPath: join(root, 'manifest.json'),
    homeRoot: root,
  })
  const first = store.runCognitionMaintenance('2026-01-01T00:00:05.000Z', 4)
  expect(first.dispositionLearning).toHaveLength(1)
  expect(first.dispositionLearning[0]?.stable).toBe(false)
  expect(first.consolidation.items).toEqual([])
  const learned = store.readCognitionState().memories.find(memory => memory.id === disposition.id)
  expect(learned?.form).toBe('disposition')
  expect(learned?.data.supportingFeedbackIds).toEqual([feedback.id])
  const version = learned?.updatedAt
  const second = store.runBackgroundMaintenance('2026-01-01T00:00:06.000Z')
  expect(second).toEqual([])
  expect(store.readCognitionState().memories.find(memory => memory.id === disposition.id)?.updatedAt).toBe(version)
  const outcomeOnly = {
    ...outcome,
    id: createOutcomeId('maintenance-outcome-only'),
    sessionId: 'maintenance-session-later',
    occurredAt: '2026-01-01T00:00:07.000Z',
    delayed: true,
    description: 'the user confirmed the scope in a later session',
  } as const
  store.recordOutcome(outcomeOnly)
  const third = store.runBackgroundMaintenance('2026-01-01T00:00:08.000Z')
  expect(third).toHaveLength(1)
  expect(store.readCognitionState().memories.find(memory => memory.id === disposition.id)?.data.supportingOutcomeIds).toContain(outcomeOnly.id)
  const directFeedback = {
    id: createFeedbackId('maintenance-direct-disposition-feedback'),
    cycleId: action.cycleId,
    sessionId: 'maintenance-session-review',
    kind: 'correct' as const,
    dispositionId: disposition.id,
    taskOutcome: -0.6,
    actionCost: 0.1,
    explanation: 'the disposition needs a narrower applicability condition',
    occurredAt: '2026-01-01T00:00:09.000Z',
    delayed: true,
  }
  store.recordFeedback(directFeedback)
  const fourth = store.runBackgroundMaintenance('2026-01-01T00:00:10.000Z')
  expect(fourth).toHaveLength(1)
  expect(fourth[0]?.actionId).toBe(action.id)
  expect(store.readCognitionState().memories.find(memory => memory.id === disposition.id)?.data.supportingFeedbackIds).toContain(directFeedback.id)
})
test('maintenance binds direct disposition feedback through an explicit action source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rin-direct-disposition-maintenance-'))
  const dbPath = join(root, 'memory.db')
  const database = new MemoryCognitionDatabase(dbPath)
  const disposition = createMemory({
    id: createMemoryId('direct-only-disposition'),
    form: 'disposition',
    data: {
      triggeringContexts: ['uncertain scope'],
      intendedGoal: createGoalId('direct-only-goal'),
      actionPattern: ['ask before acting'],
      expectedOutcomes: ['scope is shared'],
      observedOutcomes: [],
      applicabilityConditions: ['high uncertainty'],
      failureModes: [],
      utilityByGoal: [],
    },
    state: {
      persistence: 'transient',
      activation: 'active',
      integration: 'raw',
      epistemic: 'inferred',
      influence: 'blocked',
    },
    dynamics: {
      activation: 0.6,
      accessibility: 0.5,
      salience: 0.5,
      stability: 0.4,
      confidence: 0.6,
      integrationStrength: 0.1,
      novelty: 0.2,
      surprise: 0.1,
      affect: { valence: 0, arousal: 0.2, control: 0.7 },
      validity: { startsAt: '2026-01-01T00:00:00.000Z' },
      utilityByGoal: [],
      inhibition: 0,
      influenceSurfaces: [],
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })
  database.appendTransaction(observedTransaction('tx-direct-only-disposition', 'command-direct-only-disposition', disposition))
  const action = {
    id: createActionId('direct-only-action'),
    cycleId: createWorkspaceCycleId('direct-only-cycle'),
    sessionId: 'direct-only-session',
    workspaceHash: 'direct-only-workspace',
    actor: createParticipantId('rin'),
    description: 'ask before acting',
    goalIds: [],
    sourceMemoryIds: [disposition.id],
    predictionIds: [],
    occurredAt: '2026-01-01T00:00:02.000Z',
  } as const
  database.appendTransaction(createMemoryActionTransaction({
    actor: createRuntimeActor('runtime-direct-only'),
    action,
    commandId: createMemoryCommandId('command-direct-only-action'),
    eventId: createMemoryEventId('event-direct-only-action'),
    transactionId: createMemoryTransactionId('tx-direct-only-action'),
    correlationId: createMemoryCorrelationId('correlation-direct-only-action'),
    issuedAt: action.occurredAt,
    committedAt: action.occurredAt,
  }))
  const store = new FileMemoryStore(new Context(), {
    dbPath,
    manifestPath: join(root, 'manifest.json'),
    homeRoot: root,
  })
  const directFeedback = {
    id: createFeedbackId('direct-only-feedback'),
    cycleId: action.cycleId,
    sessionId: 'direct-only-review-session',
    kind: 'correct' as const,
    dispositionId: disposition.id,
    taskOutcome: -0.4,
    actionCost: 0.1,
    explanation: 'the disposition needs a narrower applicability condition',
    occurredAt: '2026-01-01T00:00:03.000Z',
    delayed: true,
  }
  store.recordFeedback(directFeedback)
  const maintenance = store.runBackgroundMaintenance('2026-01-01T00:00:04.000Z')
  expect(maintenance).toHaveLength(1)
  expect(maintenance[0]?.actionId).toBe(action.id)
  expect(store.readCognitionState().memories.find(memory => memory.id === disposition.id)?.data.supportingFeedbackIds).toContain(directFeedback.id)
})

test('maintenance derives disposition formation from persisted canonical behavior', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rin-derived-maintenance-'))
  const dbPath = join(root, 'memory.db')
  const database = new MemoryCognitionDatabase(dbPath)
  const goal = createGoalId('derived-maintenance-goal')
  const firstBase = sceneMemory(createMemoryId('derived-maintenance-scene-a')) as Extract<RinMemory, { form: 'scene' }>
  const secondBase = sceneMemory(createMemoryId('derived-maintenance-scene-b')) as Extract<RinMemory, { form: 'scene' }>
  const first = createMemory({ ...firstBase, data: { ...firstBase.data, goals: [goal], environment: 'ambiguous request' } })
  const second = createMemory({ ...secondBase, data: { ...secondBase.data, goals: [goal], environment: 'ambiguous request' } })
  database.appendTransaction(observedTransaction('tx-derived-maintenance-scene-a', 'command-derived-maintenance-scene-a', first))
  database.appendTransaction(observedTransaction('tx-derived-maintenance-scene-b', 'command-derived-maintenance-scene-b', second))
  const actionA = {
    id: createActionId('derived-maintenance-action-a'),
    cycleId: createWorkspaceCycleId('derived-maintenance-cycle-a'),
    sessionId: 'derived-maintenance-session-a',
    workspaceHash: 'derived-maintenance-workspace-a',
    actor: createParticipantId('rin'),
    description: 'ask before acting',
    goalIds: [goal],
    sourceMemoryIds: [first.id],
    predictionIds: [],
    occurredAt: '2026-01-01T00:00:02.000Z',
  } as const
  const actionB = {
    ...actionA,
    id: createActionId('derived-maintenance-action-b'),
    cycleId: createWorkspaceCycleId('derived-maintenance-cycle-b'),
    sessionId: 'derived-maintenance-session-b',
    workspaceHash: 'derived-maintenance-workspace-b',
    sourceMemoryIds: [second.id],
    occurredAt: '2026-01-01T00:00:03.000Z',
  } as const
  const outcomeA = {
    id: createOutcomeId('derived-maintenance-outcome-a'),
    cycleId: actionA.cycleId,
    actionId: actionA.id,
    sessionId: actionA.sessionId,
    status: 'observed',
    description: 'scope became explicit',
    occurredAt: '2026-01-01T00:00:04.000Z',
    delayed: false,
  } as const
  const outcomeB = {
    ...outcomeA,
    id: createOutcomeId('derived-maintenance-outcome-b'),
    cycleId: actionB.cycleId,
    actionId: actionB.id,
    sessionId: actionB.sessionId,
    description: 'next exchange stayed in scope',
    occurredAt: '2026-01-01T00:00:05.000Z',
    delayed: true,
  } as const
  const feedbackA = {
    id: createFeedbackId('derived-maintenance-feedback-a'),
    cycleId: actionA.cycleId,
    sessionId: actionA.sessionId,
    kind: 'accept',
    actionId: actionA.id,
    outcomeId: outcomeA.id,
    taskOutcome: 0.8,
    actionCost: 0.1,
    explanation: 'scope was accepted',
    occurredAt: '2026-01-01T00:00:06.000Z',
    delayed: false,
  } as const
  const feedbackB = {
    ...feedbackA,
    id: createFeedbackId('derived-maintenance-feedback-b'),
    cycleId: actionB.cycleId,
    sessionId: actionB.sessionId,
    actionId: actionB.id,
    outcomeId: outcomeB.id,
    taskOutcome: 0.7,
    occurredAt: '2026-01-01T00:00:07.000Z',
    delayed: true,
  } as const
  database.appendTransaction(createMemoryActionTransaction({
    actor: createRuntimeActor('runtime-derived-maintenance'),
    action: actionA,
    commandId: createMemoryCommandId('command-derived-maintenance-action-a'),
    eventId: createMemoryEventId('event-derived-maintenance-action-a'),
    transactionId: createMemoryTransactionId('tx-derived-maintenance-action-a'),
    correlationId: createMemoryCorrelationId('correlation-derived-maintenance-action-a'),
    issuedAt: actionA.occurredAt,
    committedAt: actionA.occurredAt,
  }))
  database.appendTransaction(createMemoryActionTransaction({
    actor: createRuntimeActor('runtime-derived-maintenance'),
    action: actionB,
    commandId: createMemoryCommandId('command-derived-maintenance-action-b'),
    eventId: createMemoryEventId('event-derived-maintenance-action-b'),
    transactionId: createMemoryTransactionId('tx-derived-maintenance-action-b'),
    correlationId: createMemoryCorrelationId('correlation-derived-maintenance-action-b'),
    issuedAt: actionB.occurredAt,
    committedAt: actionB.occurredAt,
  }))
  database.appendTransaction(createMemoryOutcomeTransaction({
    actor: createRuntimeActor('runtime-derived-maintenance'),
    outcome: outcomeA,
    commandId: createMemoryCommandId('command-derived-maintenance-outcome-a'),
    eventId: createMemoryEventId('event-derived-maintenance-outcome-a'),
    transactionId: createMemoryTransactionId('tx-derived-maintenance-outcome-a'),
    correlationId: createMemoryCorrelationId('correlation-derived-maintenance-outcome-a'),
    issuedAt: outcomeA.occurredAt,
    committedAt: outcomeA.occurredAt,
  }))
  database.appendTransaction(createMemoryOutcomeTransaction({
    actor: createRuntimeActor('runtime-derived-maintenance'),
    outcome: outcomeB,
    commandId: createMemoryCommandId('command-derived-maintenance-outcome-b'),
    eventId: createMemoryEventId('event-derived-maintenance-outcome-b'),
    transactionId: createMemoryTransactionId('tx-derived-maintenance-outcome-b'),
    correlationId: createMemoryCorrelationId('correlation-derived-maintenance-outcome-b'),
    issuedAt: outcomeB.occurredAt,
    committedAt: outcomeB.occurredAt,
  }))
  database.appendTransaction(createMemoryFeedbackTransaction({
    actor: createRuntimeActor('runtime-derived-maintenance'),
    feedback: feedbackA,
    commandId: createMemoryCommandId('command-derived-maintenance-feedback-a'),
    eventId: createMemoryEventId('event-derived-maintenance-feedback-a'),
    transactionId: createMemoryTransactionId('tx-derived-maintenance-feedback-a'),
    correlationId: createMemoryCorrelationId('correlation-derived-maintenance-feedback-a'),
    issuedAt: feedbackA.occurredAt,
    committedAt: feedbackA.occurredAt,
  }))
  database.appendTransaction(createMemoryFeedbackTransaction({
    actor: createRuntimeActor('runtime-derived-maintenance'),
    feedback: feedbackB,
    commandId: createMemoryCommandId('command-derived-maintenance-feedback-b'),
    eventId: createMemoryEventId('event-derived-maintenance-feedback-b'),
    transactionId: createMemoryTransactionId('tx-derived-maintenance-feedback-b'),
    correlationId: createMemoryCorrelationId('correlation-derived-maintenance-feedback-b'),
    issuedAt: feedbackB.occurredAt,
    committedAt: feedbackB.occurredAt,
  }))
  const store = new FileMemoryStore(new Context(), { dbPath, manifestPath: join(root, 'manifest.json'), homeRoot: root })
  const result = store.runCognitionMaintenance('2026-01-01T00:01:00.000Z')
  expect(result.representationFormation.map(candidate => candidate.memory.form)).toEqual(['disposition', 'self-model'])
  const formation = result.representationFormation.find(candidate => candidate.memory.form === 'disposition')
  if (formation === undefined) throw new Error('derived maintenance formation is missing')
  expect(formation.readiness).toBe('ready-for-consolidation')
  expect(formation.memory.form).toBe('disposition')
  expect(formation.memory.state.influence).toBe('blocked')
  expect(store.readCognitionState().memories.some(memory => memory.id === formation.memory.id)).toBe(false)
  const repeated = store.deriveRepresentationFormation('2026-01-01T00:01:00.000Z')
  expect(repeated.find(candidate => candidate.memory.form === 'disposition')?.memory.id).toBe(formation.memory.id)
  expect(repeated.find(candidate => candidate.memory.form === 'disposition')?.memory.data).toEqual(formation.memory.data)
})
test('accepts a stable representation through one formation transaction before owner permission', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rin-canonical-formation-commit-'))
  const dbPath = join(root, 'memory.db')
  const database = new MemoryCognitionDatabase(dbPath)
  const first = sceneMemory(createMemoryId('formation-commit-scene-a'))
  const second = sceneMemory(createMemoryId('formation-commit-scene-b'))
  database.appendTransaction(observedTransaction('tx-formation-commit-scene-a', 'command-formation-commit-scene-a', first))
  database.appendTransaction(observedTransaction('tx-formation-commit-scene-b', 'command-formation-commit-scene-b', second))
  const store = new FileMemoryStore(new Context(), {
    dbPath,
    manifestPath: join(root, 'manifest.json'),
    homeRoot: root,
  })
  const evidenceIds = [
    createEvidenceId('formation-commit-evidence-a'),
    createEvidenceId('formation-commit-evidence-b'),
  ]
  const candidate = createMemory({
    id: createMemoryId('formation-commit-self'),
    form: 'self-model',
    data: {
      values: ['preserve continuity'],
      abilities: ['track explicit constraints'],
      tendencies: ['ask before acting'],
      historicalChanges: [],
    },
    state: { persistence: 'transient', activation: 'active', integration: 'raw', epistemic: 'inferred', influence: 'blocked' },
    dynamics: {
      activation: 0.4, accessibility: 0.3, salience: 0.4, stability: 0.1, confidence: 0.4,
      integrationStrength: 0, novelty: 0.5, surprise: 0.2, affect: { valence: 0, arousal: 0.2, control: 0.5 },
      validity: { startsAt: '2026-01-01T00:00:00.000Z' }, utilityByGoal: [], inhibition: 0, influenceSurfaces: [],
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })
  store.proposeRepresentationFormation({
    candidate: {
      memory: candidate,
      basis: 'model-inference',
      evidenceIds,
      rationale: 'two observed scenes support a self-model candidate',
    },
    sourceSceneIds: [first.id, second.id],
    at: '2026-01-01T00:00:02.000Z',
  })
  const transaction = store.commitRepresentationFormation({
    memoryId: candidate.id,
    previousVersion: candidate.updatedAt,
    sourceSceneIds: [first.id, second.id],
    evidenceIds,
    independentEvidenceIds: evidenceIds,
    explanation: 'controller accepted the stable candidate without granting influence',
    at: '2026-01-01T00:00:05.000Z',
  })
  expect(transaction.command.type).toBe('form')
  expect(transaction.events[0]?.type).toBe('memory-formed')
  const state = store.readCognitionState()
  const formed = state.memories.find(memory => memory.id === candidate.id)
  expect(formed?.state.persistence).toBe('durable')
  expect(formed?.state.integration).toBe('integrated')
  expect(formed?.state.influence).toBe('blocked')
  expect(formed?.dynamics.influenceSurfaces).toEqual([])
  const supports = queryMaterializedLinks(state, {
    to: candidate.id,
    relation: 'supports',
    state: 'active',
  })
  expect(supports).toHaveLength(2)
  expect(supports.every(link => link.toVersion === '2026-01-01T00:00:05.000Z')).toBe(true)
  expect(hashMaterializedState(state)).toBe(
    hashMaterializedState(new MemoryMaterializer().replayFrom(new MemoryCognitionDatabase(dbPath))),
  )
  const permitted = store.permitInfluence({
    memoryId: candidate.id,
    previousVersion: '2026-01-01T00:00:05.000Z',
    surfaces: ['model-input', 'action-selection'],
    reason: 'owner explicitly permitted the formed self-model',
    ownerId: 'owner-formation-commit',
    at: '2026-01-01T00:00:06.000Z',
  })
  expect(permitted.actor.kind).toBe('owner')
  expect(store.readCognitionState().memories.find(memory => memory.id === candidate.id)?.state.influence).toBe('permitted')
})

test('rejects formation when a proposed source scene advances before commit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rin-canonical-formation-stale-source-'))
  const dbPath = join(root, 'memory.db')
  const database = new MemoryCognitionDatabase(dbPath)
  const runtime = new RuntimeCognitionIngestor(database)
  const base = 1767225600000
  runtime.ingest('formation-source-a', {
    type: 'user/message',
    seq: 1,
    time: base + 1000,
    data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'first formation source' }] },
  }, { continuityKey: 'formation-source-a' })
  runtime.ingest('formation-source-b', {
    type: 'user/message',
    seq: 1,
    time: base + 2000,
    data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'second formation source' }] },
  }, { continuityKey: 'formation-source-b' })
  const store = new FileMemoryStore(new Context(), {
    dbPath,
    manifestPath: join(root, 'manifest.json'),
    homeRoot: root,
  })
  const initial = store.readCognitionState()
  const first = initial.memories.find(memory =>
    memory.form === 'scene' && memory.data.lifecycle?.continuityKey === 'formation-source-a',
  )
  const second = initial.memories.find(memory =>
    memory.form === 'scene' && memory.data.lifecycle?.continuityKey === 'formation-source-b',
  )
  if (first?.form !== 'scene' || second?.form !== 'scene') throw new Error('expected two runtime source scenes')
  const candidate = createMemory({
    id: createMemoryId('stale-source-self-model'),
    form: 'self-model',
    data: {
      values: ['preserve source continuity'],
      abilities: ['track evolving scene evidence'],
      tendencies: ['recheck before formation'],
      historicalChanges: [],
    },
    state: { persistence: 'transient', activation: 'active', integration: 'raw', epistemic: 'inferred', influence: 'blocked' },
    dynamics: {
      activation: 0.4, accessibility: 0.3, salience: 0.4, stability: 0.1, confidence: 0.4,
      integrationStrength: 0, novelty: 0.5, surprise: 0.2, affect: { valence: 0, arousal: 0.2, control: 0.5 },
      validity: { startsAt: '2026-01-01T00:00:00.000Z' }, utilityByGoal: [], inhibition: 0, influenceSurfaces: [],
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })
  const evidenceIds = [
    createEvidenceId('stale-source-evidence-a'),
    createEvidenceId('stale-source-evidence-b'),
  ]
  store.proposeRepresentationFormation({
    candidate: {
      memory: candidate,
      basis: 'model-inference',
      evidenceIds,
      rationale: 'the candidate was inferred from two materialized scenes',
    },
    sourceSceneIds: [first.id, second.id],
    at: new Date(base + 3000).toISOString(),
  })
  const proposedSourceVersion = first.updatedAt
  runtime.ingest('formation-source-a', {
    type: 'user/message',
    seq: 2,
    time: base + 4000,
    data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'new evidence after proposal' }] },
  }, { continuityKey: 'formation-source-a' })
  const advanced = store.readCognitionState().memories.find(memory => memory.id === first.id)
  expect(advanced?.updatedAt).not.toBe(proposedSourceVersion)
  expect(() => store.commitRepresentationFormation({
    memoryId: candidate.id,
    previousVersion: candidate.updatedAt,
    sourceSceneIds: [first.id, second.id],
    evidenceIds,
    independentEvidenceIds: evidenceIds,
    explanation: 'must not accept a proposal after its source scene changed',
    at: new Date(base + 5000).toISOString(),
  })).toThrow('source scene version is stale')
})

test('forms from canonical scenes and persists only the blocked proposal in the cognition journal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rin-canonical-formation-'))
  const dbPath = join(root, 'memory.db')
  const database = new MemoryCognitionDatabase(dbPath)
  const first = sceneMemory(createMemoryId('canonical-scene-a'))
  const second = sceneMemory(createMemoryId('canonical-scene-b'))
  database.appendTransaction(observedTransaction('tx-canonical-scene-a', 'command-canonical-scene-a', first))
  database.appendTransaction(observedTransaction('tx-canonical-scene-b', 'command-canonical-scene-b', second))
  const store = new FileMemoryStore(new Context(), {
    dbPath,
    manifestPath: join(root, 'manifest.json'),
    homeRoot: root,
  })
  const candidate = createMemory({
    id: createMemoryId('canonical-self-candidate'),
    form: 'self-model',
    data: {
      values: ['preserve continuity'],
      abilities: ['track explicit constraints'],
      tendencies: ['ask before acting'],
      historicalChanges: [],
    },
    state: { persistence: 'transient', activation: 'active', integration: 'raw', epistemic: 'inferred', influence: 'blocked' },
    dynamics: {
      activation: 0.4, accessibility: 0.3, salience: 0.4, stability: 0.1, confidence: 0.4,
      integrationStrength: 0, novelty: 0.5, surprise: 0.2, affect: { valence: 0, arousal: 0.2, control: 0.5 },
      validity: { startsAt: '2026-01-01T00:00:00.000Z' }, utilityByGoal: [], inhibition: 0, influenceSurfaces: [],
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })
  const proposal = store.proposeRepresentationFormation({
    candidate: {
      memory: candidate,
      basis: 'model-inference',
      evidenceIds: [createEvidenceId('canonical-scene-a'), createEvidenceId('canonical-scene-b')],
      rationale: 'two materialized scenes support a blocked self-model candidate',
    },
    sourceSceneIds: [first.id, second.id],
    at: '2026-01-01T00:00:05.000Z',
  })
  expect(proposal.formation.readiness).toBe('ready-for-consolidation')
  expect(proposal.formation.stable).toBe(true)
  const transaction = proposal.transaction
  expect(transaction.actor.kind).toBe('model')
  const proposalEvent = transaction.events[0]
  if (proposalEvent?.type !== 'memory-proposed') throw new Error('formation proposal event is missing')
  expect(proposalEvent.payload.candidate.sourceMemoryIds).toEqual([first.id, second.id])
  const current = store.readCognitionState()
  const supportLinks = queryMaterializedLinks(current, { to: candidate.id, relation: 'supports', state: 'active' })
  expect(supportLinks).toHaveLength(2)
  expect(supportLinks.map(link => String(link.from)).sort()).toEqual([String(first.id), String(second.id)].sort())
  expect(supportLinks.every(link => link.toVersion === candidate.updatedAt)).toBe(true)
  const persisted = current.memories.find(memory => memory.id === candidate.id)
  expect(persisted?.state.epistemic).toBe('inferred')
  expect(persisted?.state.influence).toBe('blocked')
  expect(persisted?.state.persistence).toBe('transient')
  database.appendTransaction(eraseTransaction('tx-formation-erase-authorize', 'command-formation-erase-authorize', first.id))
  database.appendTransaction(eraseCommitTransaction('tx-formation-erase-commit', 'command-formation-erase-commit', first.id))
  const erased = store.readCognitionState()
  expect(erased.memories.find(memory => memory.id === candidate.id)?.state.influence).toBe('blocked')
  expect(queryMaterializedLinks(erased, { to: candidate.id, relation: 'supports', state: 'active' })).toHaveLength(1)
  const retractedSourceLinks = queryMaterializedLinks(erased, { to: candidate.id, relation: 'supports', state: 'retracted' })
  expect(retractedSourceLinks).toHaveLength(1)
  expect(retractedSourceLinks[0]?.from).toBe(first.id)
  expect(() => store.permitInfluence({
    memoryId: candidate.id,
    previousVersion: candidate.updatedAt,
    surfaces: ['model-input', 'action-selection'],
    reason: 'cannot permit a candidate whose source was erased',
    ownerId: 'owner-1',
    at: '2026-01-01T00:00:05.000Z',
  })).toThrow('retracted support dependency')
  expect(hashMaterializedState(erased)).toBe(hashMaterializedState(new MemoryMaterializer().replayFrom(new MemoryCognitionDatabase(dbPath))))
})

test('rebuilds the current coalition from current-version links across representations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rin-current-coalition-'))
  const database = new MemoryCognitionDatabase(join(root, 'memory.db'))
  const runtime = new RuntimeCognitionIngestor(database)
  runtime.ingest('coalition-session', {
    type: 'user/message',
    seq: 1,
    time: Date.parse('2026-01-01T00:00:00.000Z'),
    data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'current coalition scene' }] },
  }, { continuityKey: 'current-coalition-scene' })
  let state = new MemoryMaterializer().replayFrom(database)
  const scene = state.memories.find(memory =>
    memory.form === 'scene' && memory.data.lifecycle?.continuityKey === 'current-coalition-scene',
  )
  if (scene?.form !== 'scene') throw new Error('expected coalition scene')
  const modelState = {
    persistence: 'durable' as const,
    activation: 'active' as const,
    integration: 'integrated' as const,
    epistemic: 'inferred' as const,
    influence: 'permitted' as const,
  }
  const modelDynamics = {
    ...scene.dynamics,
    influenceSurfaces: ['model-input'] as const,
  }
  const selfModel = createMemory({
    id: createMemoryId('current-coalition-self'),
    form: 'self-model',
    data: { values: ['continuity'], abilities: ['reasoning'], tendencies: ['careful'], historicalChanges: [] },
    state: modelState,
    dynamics: modelDynamics,
    createdAt: scene.createdAt,
    updatedAt: scene.updatedAt,
  })
  const relationshipModel = createMemory({
    id: createMemoryId('current-coalition-relationship'),
    form: 'relationship-model',
    data: {
      participants: [createParticipantId('user-1'), createParticipantId('rin-1')],
      sharedMemoryIds: [scene.id],
      commitments: ['preserve the agreed scope'],
      boundaries: ['ask before expanding scope'],
      conflicts: [],
      expectations: ['clarity'],
      distance: 0.2,
    },
    state: modelState,
    dynamics: modelDynamics,
    createdAt: scene.createdAt,
    updatedAt: scene.updatedAt,
  })
  database.appendTransaction(observedTransaction('tx-coalition-self', 'command-coalition-self', selfModel))
  database.appendTransaction(observedTransaction('tx-coalition-relationship', 'command-coalition-relationship', relationshipModel))
  const expiredRepresentation = createMemory({
    ...selfModel,
    id: createMemoryId('current-coalition-expired'),
    dynamics: {
      ...selfModel.dynamics,
      validity: { startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2026-01-01T00:00:02.000Z' },
    },
  })
  database.appendTransaction(observedTransaction(
    'tx-coalition-expired',
    'command-coalition-expired',
    expiredRepresentation,
  ))
  state = new MemoryMaterializer().replayFrom(database)
  const currentScene = state.memories.find(memory => memory.id === scene.id)
  if (currentScene?.form !== 'scene') throw new Error('expected current coalition scene')
  database.appendTransaction(linkedTransaction('tx-coalition-links', 'command-coalition-links', [
    memoryLink('link-coalition-self', 'supports', currentScene, selfModel),
    memoryLink('link-coalition-relationship', 'supports', currentScene, relationshipModel),
    memoryLink('link-coalition-expired', 'supports', currentScene, expiredRepresentation),
  ]))
  const linkedState = new MemoryMaterializer().replayFrom(database)
  expect(linkedState.currentField.activeMemoryCoalition).toEqual([
    currentScene.id,
    relationshipModel.id,
    selfModel.id,
  ])
  expect(linkedState.currentField.activeMemoryCoalition).not.toEqual([currentScene.id])
})

test('excludes expired current-version links from coalition and action candidates', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rin-expired-link-boundary-'))
  const database = new MemoryCognitionDatabase(join(root, 'memory.db'))
  const runtime = new RuntimeCognitionIngestor(database)
  runtime.ingest('expired-link-session', {
    type: 'user/message',
    seq: 1,
    time: Date.parse('2026-01-01T00:00:00.000Z'),
    data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'expired link scene' }] },
  }, { continuityKey: 'expired-link-scene' })
  let state = new MemoryMaterializer().replayFrom(database)
  const scene = state.memories.find(memory =>
    memory.form === 'scene' && memory.data.lifecycle?.continuityKey === 'expired-link-scene',
  )
  if (scene?.form !== 'scene') throw new Error('expected expired link scene')
  const disposition = createMemory({
    id: createMemoryId('expired-link-disposition'),
    form: 'disposition',
    data: {
      triggeringContexts: ['this context never matches'],
      intendedGoal: createGoalId('expired-link-goal'),
      actionPattern: ['use only a live link'],
      expectedOutcomes: [],
      observedOutcomes: [],
      applicabilityConditions: [],
      failureModes: [],
      utilityByGoal: [],
    },
    state: {
      persistence: 'durable',
      activation: 'active',
      integration: 'integrated',
      epistemic: 'inferred',
      influence: 'permitted',
    },
    dynamics: {
      ...scene.dynamics,
      validity: { startsAt: '2026-01-01T00:00:00.000Z' },
      influenceSurfaces: ['model-input', 'action-selection'] as const,
    },
    createdAt: scene.createdAt,
    updatedAt: scene.updatedAt,
  })
  database.appendTransaction(observedTransaction(
    'tx-expired-link-disposition',
    'command-expired-link-disposition',
    disposition,
  ))
  state = new MemoryMaterializer().replayFrom(database)
  const currentScene = state.memories.find(memory => memory.id === scene.id)
  if (currentScene?.form !== 'scene') throw new Error('expected current expired link scene')
  database.appendTransaction(linkedTransaction(
    'tx-expired-link',
    'command-expired-link',
    [memoryLink(
      'link-expired-disposition',
      'supports',
      currentScene,
      disposition,
      'active',
      memoryVersion(currentScene),
      memoryVersion(disposition),
      { startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2026-01-01T00:00:02.000Z' },
    )],
  ))
  const linkedState = new MemoryMaterializer().replayFrom(database)
  expect(linkedState.currentField.activeMemoryCoalition).toEqual([currentScene.id])
  expect(linkedState.currentField.candidateActions).toEqual([])
  expect(linkedState.currentField.candidateActionSources).toEqual([])
})

test('gates contextual person models by the active scene context', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rin-contextual-person-coalition-'))
  const database = new MemoryCognitionDatabase(join(root, 'memory.db'))
  const runtime = new RuntimeCognitionIngestor(database)
  runtime.ingest('contextual-person-session', {
    type: 'user/message',
    seq: 1,
    time: Date.parse('2026-01-01T00:00:00.000Z'),
    data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'contextual person scene' }] },
  }, { continuityKey: 'contextual-person-scene' })
  let state = new MemoryMaterializer().replayFrom(database)
  const scene = state.memories.find(memory =>
    memory.form === 'scene' && memory.data.lifecycle?.continuityKey === 'contextual-person-scene',
  )
  if (scene?.form !== 'scene') throw new Error('expected contextual person scene')
  const modelState = {
    persistence: 'durable' as const,
    activation: 'active' as const,
    integration: 'integrated' as const,
    epistemic: 'inferred' as const,
    influence: 'permitted' as const,
  }
  const modelDynamics = {
    ...scene.dynamics,
    influenceSurfaces: ['model-input'] as const,
  }
  const matchingPerson = createMemory({
    id: createMemoryId('contextual-person-matching'),
    form: 'person-model',
    data: {
      subject: createParticipantId('user-1'),
      claims: ['the current context is familiar'],
      observedPatterns: [],
      currentState: ['present'],
      lastObservedAt: scene.updatedAt,
      contextConditions: [scene.data.environment],
    },
    state: modelState,
    dynamics: modelDynamics,
    createdAt: scene.createdAt,
    updatedAt: scene.updatedAt,
  })
  const unrelatedPerson = createMemory({
    ...matchingPerson,
    id: createMemoryId('contextual-person-unrelated'),
    data: {
      ...matchingPerson.data,
      contextConditions: ['an unrelated environment that is not active'],
    },
  })
  database.appendTransaction(observedTransaction(
    'tx-contextual-person-matching',
    'command-contextual-person-matching',
    matchingPerson,
  ))
  database.appendTransaction(observedTransaction(
    'tx-contextual-person-unrelated',
    'command-contextual-person-unrelated',
    unrelatedPerson,
  ))
  state = new MemoryMaterializer().replayFrom(database)
  const currentScene = state.memories.find(memory => memory.id === scene.id)
  if (currentScene?.form !== 'scene') throw new Error('expected current contextual person scene')
  database.appendTransaction(linkedTransaction(
    'tx-contextual-person-links',
    'command-contextual-person-links',
    [
      memoryLink('link-contextual-person-matching', 'supports', currentScene, matchingPerson),
      memoryLink('link-contextual-person-unrelated', 'supports', currentScene, unrelatedPerson),
    ],
  ))
  const linkedState = new MemoryMaterializer().replayFrom(database)
  expect(linkedState.currentField.activeMemoryCoalition).toEqual([
    currentScene.id,
    matchingPerson.id,
  ])
})

test('derives permitted disposition actions into the current field and replays them', async () => {

  const root = await mkdtemp(join(tmpdir(), 'rin-current-actions-'))
  const dbPath = join(root, 'memory.db')
  const database = new MemoryCognitionDatabase(dbPath)
  const goal = createGoalId('current-action-goal')
  const runtime = new RuntimeCognitionIngestor(database)
  runtime.ingest('current-action-session', {
    type: 'user/message',
    seq: 1,
    time: Date.parse('2026-01-01T00:00:00.000Z'),
    data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'current action scene' }] },
  }, { continuityKey: 'current-action-scene' })
  const disposition = createMemory({
    id: createMemoryId('current-action-disposition'),
    form: 'disposition',
    data: {
      triggeringContexts: ['current action scene'],
      intendedGoal: goal,
      actionPattern: ['ask before acting'],
      expectedOutcomes: ['shared understanding'],
      observedOutcomes: ['the user confirmed the scope'],
      applicabilityConditions: ['the request is ambiguous'],
      failureModes: ['acting before clarifying'],
      utilityByGoal: [],
    },
    state: { persistence: 'durable', activation: 'active', integration: 'integrated', epistemic: 'inferred', influence: 'permitted' },
    dynamics: {
      activation: 0.7, accessibility: 0.6, salience: 0.5, stability: 0.6, confidence: 0.7,
      integrationStrength: 0.7, novelty: 0.1, surprise: 0.1, affect: { valence: 0, arousal: 0.2, control: 0.7 },
      validity: { startsAt: '2026-01-01T00:00:00.000Z' }, utilityByGoal: [], inhibition: 0,
      influenceSurfaces: ['model-input', 'action-selection'],
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })
  database.appendTransaction(observedTransaction('tx-current-action-disposition', 'command-current-action-disposition', disposition))
  const actionOnly = createMemory({
    ...disposition,
    id: createMemoryId('current-action-only-disposition'),
    data: { ...disposition.data, actionPattern: ['action-only memory'] },
    dynamics: { ...disposition.dynamics, influenceSurfaces: ['action-selection'] },
  })
  database.appendTransaction(observedTransaction(
    'tx-current-action-only-disposition',
    'command-current-action-only-disposition',
    actionOnly,
  ))
  const expiredAction = createMemory({
    ...disposition,
    id: createMemoryId('current-action-expired-disposition'),
    data: { ...disposition.data, actionPattern: ['expired action'] },
    dynamics: {
      ...disposition.dynamics,
      validity: { startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2026-01-01T00:00:00.500Z' },
    },
  })
  database.appendTransaction(observedTransaction(
    'tx-current-action-expired-disposition',
    'command-current-action-expired-disposition',
    expiredAction,
  ))
  const state = new MemoryMaterializer().replayFrom(database)
  expect(state.currentField.candidateActions).toEqual(['ask before acting'])
  expect(state.currentField.candidateActionSources).toEqual([{
    action: 'ask before acting',
    sourceMemoryIds: [disposition.id],
    utility: 0,
    inhibition: 0,
    selectionValue: 0.25,
    reasons: ['contextual utility=0.00', 'accessibility=0.60', 'salience=0.50'],
  }])
  expect(String(state.currentField.sceneId)).toBe('runtime-scene-current-action-scene')
  const replayed = new MemoryMaterializer().replay(database.listTransactions())
  expect(replayed.currentField).toEqual(state.currentField)
  const store = new FileMemoryStore(new Context(), {
    dbPath,
    manifestPath: join(root, 'manifest.json'),
    homeRoot: root,
  })
  const recall = await store.recall({
    cycleId: 'current-action-recall',
    query: 'current action scene',
    budget: { maxItems: 8, maxTokens: 1_000 },
  })
  const modelInput = store.recordModelInput({
    cycleId: recall.trace.cycleId,
    input: { messages: [{ role: 'system', content: 'current field action test' }] },
  })
  const fieldUses = store.listMemoryUseTraces(undefined, modelInput.cycleId)
    .filter(use => use.surface === 'model-input')
  expect(fieldUses.some(use => use.memoryId === disposition.id)).toBe(true)
  expect(fieldUses.some(use => use.memoryId === actionOnly.id)).toBe(false)
  const action = {
    id: createActionId('current-action-record'),
    cycleId: recall.trace.cycleId,
    sessionId: 'current-action-session',
    workspaceHash: recall.workspace.hash,
    actor: createParticipantId('rin'),
    description: 'ask before acting',
    goalIds: [],
    sourceMemoryIds: [disposition.id],
    predictionIds: [],
    occurredAt: modelInput.createdAt,
  } as const
  store.recordAction(action)
  const actionUses = store.listMemoryUseTraces(undefined, action.cycleId)
    .filter(use => use.surface === 'action-selection')
  expect(actionUses.some(use => use.memoryId === disposition.id)).toBe(true)
  expect(actionUses.some(use => use.memoryId === actionOnly.id)).toBe(false)
})

test('does not turn a conflicting disposition link into an action candidate', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rin-conflicting-disposition-link-'))
  const database = new MemoryCognitionDatabase(join(root, 'memory.db'))
  const runtime = new RuntimeCognitionIngestor(database)
  runtime.ingest('conflicting-link-session', {
    type: 'user/message',
    seq: 1,
    time: Date.parse('2026-01-01T00:00:00.000Z'),
    data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'conflicting link scene' }] },
  }, { continuityKey: 'conflicting-link-scene' })
  let state = new MemoryMaterializer().replayFrom(database)
  const scene = state.memories.find(memory =>
    memory.form === 'scene' && memory.data.lifecycle?.continuityKey === 'conflicting-link-scene',
  )
  if (scene?.form !== 'scene') throw new Error('expected conflicting link scene')
  const disposition = createMemory({
    id: createMemoryId('conflicting-link-disposition'),
    form: 'disposition',
    data: {
      triggeringContexts: ['this context never matches'],
      intendedGoal: createGoalId('conflicting-link-goal'),
      actionPattern: ['use the contradicted action'],
      expectedOutcomes: ['the action should not be selected'],
      observedOutcomes: [],
      applicabilityConditions: [],
      failureModes: [],
      utilityByGoal: [],
    },
    state: {
      persistence: 'durable', activation: 'active', integration: 'integrated',
      epistemic: 'inferred', influence: 'permitted',
    },
    dynamics: {
      ...scene.dynamics,
      influenceSurfaces: ['model-input', 'action-selection'] as const,
    },
    createdAt: scene.createdAt,
    updatedAt: scene.updatedAt,
  })
  database.appendTransaction(observedTransaction(
    'tx-conflicting-link-disposition',
    'command-conflicting-link-disposition',
    disposition,
  ))
  state = new MemoryMaterializer().replayFrom(database)
  const currentScene = state.memories.find(memory => memory.id === scene.id)
  if (currentScene?.form !== 'scene') throw new Error('expected current conflicting link scene')
  database.appendTransaction(linkedTransaction(
    'tx-conflicting-link',
    'command-conflicting-link',
    [memoryLink('link-conflicting-disposition', 'contradicts', currentScene, disposition)],
  ))
  const linkedState = new MemoryMaterializer().replayFrom(database)
  expect(linkedState.currentField.activeMemoryCoalition).toContain(disposition.id)
  expect(linkedState.currentField.candidateActions).toEqual([])
  expect(linkedState.currentField.candidateActionSources).toEqual([])
})

test('reorders competing permitted actions after feedback while preserving replay determinism', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rin-action-competition-'))
  const dbPath = join(root, 'memory.db')
  const database = new MemoryCognitionDatabase(dbPath)
  const goal = createGoalId('competition-goal')
  const runtime = new RuntimeCognitionIngestor(database)
  runtime.ingest('competition-session', {
    type: 'user/message',
    seq: 1,
    time: Date.parse('2026-01-01T00:00:00.000Z'),
    data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'competing action scene' }] },
  }, { continuityKey: 'competition-scene' })
  const disposition = (id: string, action: string, utility: number) => createMemory({
    id: createMemoryId(id),
    form: 'disposition',
    data: {
      triggeringContexts: ['competing action scene'],
      intendedGoal: goal,
      actionPattern: [action],
      expectedOutcomes: ['the requested scope is preserved'],
      observedOutcomes: [],
      applicabilityConditions: ['the request is ambiguous'],
      failureModes: ['acting without checking scope'],
      utilityByGoal: [{ goalId: goal, value: utility }],
    },
    state: {
      persistence: 'durable',
      activation: 'active',
      integration: 'integrated',
      epistemic: 'inferred',
      influence: 'permitted',
    },
    dynamics: {
      activation: 0.8,
      accessibility: 0.7,
      salience: 0.5,
      stability: 0.6,
      confidence: 0.8,
      integrationStrength: 0.8,
      novelty: 0.1,
      surprise: 0.1,
      affect: { valence: 0, arousal: 0.2, control: 0.7 },
      validity: { startsAt: '2026-01-01T00:00:00.000Z' },
      utilityByGoal: [{ goalId: goal, value: utility }],
      inhibition: 0.05,
      influenceSurfaces: ['model-input', 'action-selection'],
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })
  const preferred = disposition('competition-preferred', 'ask before acting', 0.9)
  const alternative = disposition('competition-alternative', 'proceed with a narrow safe action', 0.2)
  database.appendTransaction(observedTransaction('tx-competition-preferred', 'command-competition-preferred', preferred))
  database.appendTransaction(observedTransaction('tx-competition-alternative', 'command-competition-alternative', alternative))

  const before = new MemoryMaterializer().replayFrom(database)
  expect(before.currentField.candidateActions).toEqual([
    'ask before acting',
    'proceed with a narrow safe action',
  ])
  expect(before.currentField.candidateActionSources?.[0]).toEqual(expect.objectContaining({
    action: 'ask before acting',
    utility: 0.9,
  }))
  expect(before.currentField.candidateActionSources?.[0]?.selectionValue).toBeGreaterThan(
    before.currentField.candidateActionSources?.[1]?.selectionValue ?? 1,
  )

  const cycleId = createWorkspaceCycleId('competition-cycle')
  const action = {
    id: createActionId('competition-action'),
    cycleId,
    sessionId: 'competition-session-a',
    workspaceHash: 'competition-workspace',
    actor: createParticipantId('rin'),
    description: 'ask before acting',
    goalIds: [goal],
    sourceMemoryIds: [preferred.id],
    predictionIds: [],
    occurredAt: '2026-01-01T00:00:02.000Z',
  } as const
  const outcome = {
    id: createOutcomeId('competition-outcome'),
    cycleId,
    sessionId: 'competition-session-a',
    actionId: action.id,
    status: 'failed' as const,
    description: 'the action still exceeded the requested scope',
    occurredAt: '2026-01-01T00:00:03.000Z',
    delayed: false,
  }
  const feedback = {
    id: createFeedbackId('competition-feedback'),
    cycleId,
    sessionId: 'competition-session-a',
    kind: 'reject' as const,
    actionId: action.id,
    outcomeId: outcome.id,
    dispositionId: preferred.id,
    taskOutcome: -0.9,
    actionCost: 0.2,
    userResponse: 'rejected' as const,
    explanation: 'the preferred action did not preserve scope',
    occurredAt: '2026-01-01T00:00:04.000Z',
    delayed: false,
  }
  database.appendTransaction(createMemoryActionTransaction({
    actor: createRuntimeActor('runtime-competition'),
    action,
    commandId: createMemoryCommandId('command-competition-action'),
    eventId: createMemoryEventId('event-competition-action'),
    transactionId: createMemoryTransactionId('tx-competition-action'),
    correlationId: createMemoryCorrelationId('correlation-competition-action'),
    issuedAt: action.occurredAt,
    committedAt: action.occurredAt,
  }))
  database.appendTransaction(createMemoryOutcomeTransaction({
    actor: createRuntimeActor('runtime-competition'),
    outcome,
    commandId: createMemoryCommandId('command-competition-outcome'),
    eventId: createMemoryEventId('event-competition-outcome'),
    transactionId: createMemoryTransactionId('tx-competition-outcome'),
    correlationId: createMemoryCorrelationId('correlation-competition-outcome'),
    issuedAt: outcome.occurredAt,
    committedAt: outcome.occurredAt,
  }))
  database.appendTransaction(createMemoryFeedbackTransaction({
    actor: createRuntimeActor('runtime-competition'),
    feedback,
    commandId: createMemoryCommandId('command-competition-feedback'),
    eventId: createMemoryEventId('event-competition-feedback'),
    transactionId: createMemoryTransactionId('tx-competition-feedback'),
    correlationId: createMemoryCorrelationId('correlation-competition-feedback'),
    issuedAt: feedback.occurredAt,
    committedAt: feedback.occurredAt,
  }))
  const learning = learnDispositionFromFeedback({
    disposition: preferred,
    action,
    outcomes: [outcome],
    feedback: [feedback],
    at: '2026-01-01T00:00:05.000Z',
    explanation: 'the failed and rejected result must suppress the formerly preferred action',
  })
  const learningTransaction = createMemoryDispositionLearningTransaction({
    actor: createBackgroundActor('background-competition'),
    result: learning,
    commandId: createMemoryCommandId('command-competition-learning'),
    eventId: createMemoryEventId('event-competition-learning'),
    transactionId: createMemoryTransactionId('tx-competition-learning'),
    correlationId: createMemoryCorrelationId('correlation-competition-learning'),
    issuedAt: learning.previousVersion,
    committedAt: learning.memory.updatedAt,
  })
  database.appendTransaction(learningTransaction)

  const after = new MemoryMaterializer().replayFrom(database)
  expect(after.currentField.candidateActions).toEqual([
    'proceed with a narrow safe action',
    'ask before acting',
  ])
  const afterSources = after.currentField.candidateActionSources ?? []
  expect(afterSources[0]?.action).toBe('proceed with a narrow safe action')
  expect(afterSources[1]?.action).toBe('ask before acting')
  expect(afterSources[0]?.selectionValue).toBeGreaterThan(afterSources[1]?.selectionValue ?? 1)
  expect(afterSources[1]?.inhibition).toBeGreaterThan(before.currentField.candidateActionSources?.[0]?.inhibition ?? 0)
  expect(afterSources[1]?.reasons.some(reason => reason.startsWith('inhibition='))).toBe(true)
  expect(after.currentField.sceneId).toBe(before.currentField.sceneId)
  expect(hashMaterializedState(after)).toBe(
    hashMaterializedState(new MemoryMaterializer().replay(database.listTransactions())),
  )
})

test('applies configured runtime scene defaults to the real store ingest path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rin-runtime-defaults-'))
  const dbPath = join(root, 'memory.db')
  const user = createParticipantId('configured-user')
  const rin = createParticipantId('configured-rin')
  const goal = createGoalId('configured-goal')
  const store = new FileMemoryStore(new Context(), {
    dbPath,
    manifestPath: join(root, 'manifest.json'),
    homeRoot: root,
    runtimeSceneDefaults: {
      participants: { user, rin },
      goals: [goal],
    },
  })

  store.ingestRuntimeEvent('configured-session', {
    type: 'user/message',
    seq: 1,
    time: Date.parse('2026-01-01T00:00:00.000Z'),
    data: {
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'configured runtime scene' }],
    },
  }, { continuityKey: 'configured-scene' })
  store.ingestRuntimeEvent('configured-session', {
    type: 'assistant/message',
    seq: 2,
    time: Date.parse('2026-01-01T00:00:01.000Z'),
    data: {
      message: { content: [{ type: 'text', text: 'configured context continues' }] },
    },
  }, { continuityKey: 'configured-scene' })

  const scene = store.readCognitionState().memories.find(memory =>
    memory.form === 'scene' && memory.data.lifecycle?.continuityKey === 'configured-scene',
  )
  if (scene?.form !== 'scene') throw new Error('expected configured runtime scene')
  expect(scene.data.participants).toEqual([user, rin])
  expect(scene.data.goals).toEqual([goal])
  expect(store.getCurrentField().goals).toEqual([goal])
})



test('evaluates a persisted recall-to-behavior chain across feedback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rin-persisted-behavior-evaluation-'))
  const dbPath = join(root, 'memory.db')
  const database = new MemoryCognitionDatabase(dbPath)
  const goal = createGoalId('persisted-evaluation-goal')
  const runtime = new RuntimeCognitionIngestor(database)
  runtime.ingest('persisted-evaluation-session', {
    type: 'user/message',
    seq: 1,
    time: Date.parse('2026-01-01T00:00:00.000Z'),
    data: {
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'persisted evaluation scene' }],
    },
  }, { continuityKey: 'persisted-evaluation-scene' })

  const disposition = (id: string, action: string, utility: number): RinMemory => createMemory({
    id: createMemoryId(id),
    form: 'disposition',
    data: {
      triggeringContexts: ['persisted evaluation scene'],
      intendedGoal: goal,
      actionPattern: [action],
      expectedOutcomes: ['the requested scope is preserved'],
      observedOutcomes: [],
      applicabilityConditions: ['the request is ambiguous'],
      failureModes: ['acting without checking scope'],
      utilityByGoal: [{ goalId: goal, value: utility }],
    },
    state: {
      persistence: 'durable',
      activation: 'active',
      integration: 'integrated',
      epistemic: 'inferred',
      influence: 'permitted',
    },
    dynamics: {
      activation: 0.8,
      accessibility: 0.7,
      salience: 0.5,
      stability: 0.6,
      confidence: 0.8,
      integrationStrength: 0.8,
      novelty: 0.1,
      surprise: 0.1,
      affect: { valence: 0, arousal: 0.2, control: 0.7 },
      validity: { startsAt: '2026-01-01T00:00:00.000Z' },
      utilityByGoal: [{ goalId: goal, value: utility }],
      inhibition: 0.05,
      influenceSurfaces: ['model-input', 'action-selection'],
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })
  const preferred = disposition('persisted-evaluation-preferred', 'ask before acting', 0.9)
  const alternative = disposition('persisted-evaluation-alternative', 'proceed with a narrow safe action', 0.2)
  database.appendTransaction(observedTransaction(
    'tx-persisted-evaluation-preferred',
    'command-persisted-evaluation-preferred',
    preferred,
  ))
  database.appendTransaction(observedTransaction(
    'tx-persisted-evaluation-alternative',
    'command-persisted-evaluation-alternative',
    alternative,
  ))

  const store = new FileMemoryStore(new Context(), {
    dbPath,
    manifestPath: join(root, 'manifest.json'),
    homeRoot: root,
  })
  const before = await store.recall({
    cycleId: 'persisted-evaluation-before',
    query: 'persisted evaluation scene',
    budget: { maxItems: 8, maxTokens: 1_000 },
  })
  expect(before.workspace.currentField.candidateActionSources?.map(source => source.action)).toEqual([
    'ask before acting',
    'proceed with a narrow safe action',
  ])
  const modelInput = store.recordModelInput({
    cycleId: before.trace.cycleId,
    input: { messages: [{ role: 'system', content: 'persisted evaluator input' }] },
  })
  const action = {
    id: createActionId('persisted-evaluation-action'),
    cycleId: before.trace.cycleId,
    sessionId: 'persisted-evaluation-session',
    workspaceHash: before.workspace.hash,
    actor: createParticipantId('persisted-evaluation-rin'),
    description: 'ask before acting',
    goalIds: [goal],
    sourceMemoryIds: [preferred.id],
    predictionIds: [],
    occurredAt: modelInput.createdAt,
  } as const
  store.recordAction(action)
  const outcome = {
    id: createOutcomeId('persisted-evaluation-outcome'),
    cycleId: before.trace.cycleId,
    sessionId: 'persisted-evaluation-session',
    actionId: action.id,
    status: 'failed' as const,
    description: 'the action crossed the requested scope',
    occurredAt: '2026-01-01T00:00:02.000Z',
    delayed: false,
  } as const
  store.recordOutcome(outcome)
  store.recordFeedback({
    id: createFeedbackId('persisted-evaluation-feedback'),
    cycleId: before.trace.cycleId,
    sessionId: 'persisted-evaluation-session',
    kind: 'reject',
    actionId: action.id,
    outcomeId: outcome.id,
    dispositionId: preferred.id,
    taskOutcome: -0.9,
    actionCost: 0.2,
    userResponse: 'rejected',
    explanation: 'the preferred action did not preserve scope',
    occurredAt: '2026-01-01T00:00:03.000Z',
    delayed: false,
  })
  expect(store.runBackgroundMaintenance('2026-01-01T00:00:04.000Z')).toHaveLength(1)

  const after = await store.recall({
    cycleId: 'persisted-evaluation-after',
    query: 'persisted evaluation scene',
    budget: { maxItems: 8, maxTokens: 1_000 },
  })
  expect(after.workspace.currentField.candidateActionSources?.[0]?.action).toBe(
    'proceed with a narrow safe action',
  )

  const evaluation = store.evaluatePersistedRecallBehavior({
    beforeCycleId: before.trace.cycleId,
    afterCycleId: after.trace.cycleId,
    actionId: action.id,
    choices: [
      {
        id: 'persisted-evaluation-preferred-choice',
        description: 'ask before acting',
        sourceMemoryIds: [preferred.id],
      },
      {
        id: 'persisted-evaluation-alternative-choice',
        description: 'proceed with a narrow safe action',
        sourceMemoryIds: [alternative.id],
      },
    ],
  })
  expect(evaluation.actionPhase).toBe('before')
  expect(evaluation.executedChoiceId).toBe('persisted-evaluation-preferred-choice')
  expect(evaluation.actionSourceBound).toBe(true)
  expect(evaluation.modelInputBound).toBe(true)
  expect(evaluation.materializationAdvanced).toBe(true)
  expect(evaluation.actionSelectionUseIds.length).toBeGreaterThan(0)
  expect(evaluation.outcomeIds).toEqual([String(outcome.id)])
  expect(evaluation.feedbackIds).toEqual(['persisted-evaluation-feedback'])
  expect(evaluation.chainComplete).toBe(true)
  expect(evaluation.recall.afterChoiceId).toBe('persisted-evaluation-alternative-choice')
  expect(evaluation.passed).toBe(true)

  const afterModelInput = store.recordModelInput({
    cycleId: after.trace.cycleId,
    input: { messages: [{ role: 'system', content: 'persisted after-phase evaluator input' }] },
  })
  const afterAction = {
    id: createActionId('persisted-evaluation-after-action'),
    cycleId: after.trace.cycleId,
    sessionId: 'persisted-evaluation-after-session',
    workspaceHash: after.workspace.hash,
    actor: createParticipantId('persisted-evaluation-after-rin'),
    description: 'proceed with a narrow safe action',
    goalIds: [goal],
    sourceMemoryIds: [alternative.id],
    predictionIds: [],
    occurredAt: afterModelInput.createdAt,
  } as const
  store.recordAction(afterAction)
  const afterOutcome = {
    id: createOutcomeId('persisted-evaluation-after-outcome'),
    cycleId: after.trace.cycleId,
    sessionId: 'persisted-evaluation-after-session',
    actionId: afterAction.id,
    status: 'observed' as const,
    description: 'the narrow action preserved scope',
    occurredAt: '2026-01-01T00:00:05.000Z',
    delayed: false,
  } as const
  store.recordOutcome(afterOutcome)
  const afterFeedback = {
    id: createFeedbackId('persisted-evaluation-after-feedback'),
    cycleId: after.trace.cycleId,
    sessionId: 'persisted-evaluation-after-session',
    kind: 'correct' as const,
    actionId: afterAction.id,
    outcomeId: afterOutcome.id,
    dispositionId: alternative.id,
    taskOutcome: 0.6,
    actionCost: 0.1,
    explanation: 'the alternative preserved the requested scope',
    occurredAt: '2026-01-01T00:00:06.000Z',
    delayed: false,
  } as const
  store.recordFeedback(afterFeedback)

  const afterPhaseEvaluation = store.evaluatePersistedRecallBehavior({
    beforeCycleId: before.trace.cycleId,
    afterCycleId: after.trace.cycleId,
    actionId: afterAction.id,
    choices: [
      {
        id: 'persisted-evaluation-preferred-choice',
        description: 'ask before acting',
        sourceMemoryIds: [preferred.id],
      },
      {
        id: 'persisted-evaluation-alternative-choice',
        description: 'proceed with a narrow safe action',
        sourceMemoryIds: [alternative.id],
      },
    ],
    actionPhase: 'after',
  })
  expect(afterPhaseEvaluation.actionPhase).toBe('after')
  expect(afterPhaseEvaluation.executedChoiceId).toBe('persisted-evaluation-alternative-choice')
  expect(afterPhaseEvaluation.recall.beforeChoiceAvailable).toBe(true)
  expect(afterPhaseEvaluation.recall.afterChoiceAvailable).toBe(true)
  expect(afterPhaseEvaluation.actionSourceBound).toBe(true)
  expect(afterPhaseEvaluation.modelInputBound).toBe(true)
  expect(afterPhaseEvaluation.materializationAdvanced).toBe(true)
  expect(afterPhaseEvaluation.actionSelectionUseIds.length).toBeGreaterThan(0)
  expect(afterPhaseEvaluation.outcomeIds).toEqual([String(afterOutcome.id)])
  expect(afterPhaseEvaluation.feedbackIds).toEqual([String(afterFeedback.id)])
  expect(afterPhaseEvaluation.passed).toBe(true)
})
test('does not invent prediction errors for an ambiguous multi-prediction action', () => {
  const memory = sceneMemory(createMemoryId('ambiguous-prediction-scene'))
  const cycleId = createWorkspaceCycleId('ambiguous-prediction-cycle')
  const predictionA = {
    id: createPredictionId('ambiguous-prediction-a'),
    cycleId,
    statement: 'the first hypothesis will hold',
    sourceMemoryIds: [memory.id],
    expectedOutcome: 'the first hypothesis holds',
    epistemic: 'hypothesized' as const,
    createdAt: '2026-01-01T00:00:01.000Z',
  }
  const predictionB = {
    ...predictionA,
    id: createPredictionId('ambiguous-prediction-b'),
    statement: 'the second hypothesis will hold',
    expectedOutcome: 'the second hypothesis holds',
  }
  const action = {
    id: createActionId('ambiguous-prediction-action'),
    cycleId,
    sessionId: 'ambiguous-prediction-session',
    workspaceHash: 'ambiguous-prediction-workspace',
    actor: createParticipantId('rin'),
    description: 'perform one action with two hypotheses',
    goalIds: [],
    sourceMemoryIds: [memory.id],
    predictionIds: [predictionA.id, predictionB.id],
    occurredAt: '2026-01-01T00:00:02.000Z',
  }
  const outcome = {
    id: createOutcomeId('ambiguous-prediction-outcome'),
    cycleId,
    sessionId: 'ambiguous-prediction-session',
    actionId: action.id,
    status: 'observed' as const,
    description: 'one result arrived without a hypothesis binding',
    occurredAt: '2026-01-01T00:00:03.000Z',
    delayed: false,
  }
  const feedback = {
    id: createFeedbackId('ambiguous-prediction-feedback'),
    cycleId,
    sessionId: 'ambiguous-prediction-session',
    kind: 'correct' as const,
    actionId: action.id,
    taskOutcome: -0.4,
    actionCost: 0.1,
    factualCorrection: 'the correction target is ambiguous',
    explanation: 'the correction did not name a hypothesis',
    occurredAt: '2026-01-01T00:00:04.000Z',
    delayed: false,
  }
  const identity = (prefix: string, at: string) => ({
    actor: createRuntimeActor('ambiguous-prediction-runtime'),
    commandId: createMemoryCommandId('ambiguous-prediction-command-' + prefix),
    eventId: createMemoryEventId('ambiguous-prediction-event-' + prefix),
    transactionId: createMemoryTransactionId('ambiguous-prediction-transaction-' + prefix),
    correlationId: createMemoryCorrelationId('ambiguous-prediction-correlation-' + prefix),
    issuedAt: at,
    committedAt: at,
  })
  const state = new MemoryMaterializer().replay([
    observedTransaction('tx-ambiguous-prediction-scene', 'command-ambiguous-prediction-scene', memory),
    createMemoryPredictionTransaction({ ...identity('prediction-a', predictionA.createdAt), prediction: predictionA }),
    createMemoryPredictionTransaction({ ...identity('prediction-b', predictionB.createdAt), prediction: predictionB }),
    createMemoryActionTransaction({ ...identity('action', action.occurredAt), action }),
    createMemoryOutcomeTransaction({ ...identity('outcome', outcome.occurredAt), outcome }),
    createMemoryFeedbackTransaction({ ...identity('feedback', feedback.occurredAt), feedback }),
  ])
  const scene = state.memories.find(item => item.id === memory.id)
  expect(scene?.form === 'scene' ? scene.data.predictionErrors : undefined).toEqual([])
})
