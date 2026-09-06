import { describe, expect, test } from 'vitest'
import {
  assertMemoryCommand,
  assertMemoryEvent,
  assertMemoryTransaction,
  createMemoryAuthorizationId,
  createModelCandidate,
  createModelProposalTransaction,
  createMemoryCommand,
  createMemoryCommandId,
  createMemoryCorrelationId,
  createMemoryEventId,
  createMemoryTransaction,
  createMemoryTransactionId,
  createModelActor,
  createOwnerActor,
  createRuntimeActor,
  createParticipantId,
  createMemory,
  MemoryMaterializer,
  createMemoryId,
} from '../src/index.ts'
import { MEMORY_COGNITION_PROTOCOL_VERSION } from '@rin/contracts'
import type {
  MemoryDynamics,
  MemoryState,
  RinMemory,
} from '../src/model.ts'
import type {
  MemoryCommand,
  MemoryEvent,
} from '../src/events.ts'

const model = createModelActor('model-1')
const owner = createOwnerActor('owner-1')
const participant = createParticipantId('user-1')
const memoryId = createMemoryId('scene-1')
const baseState: MemoryState = {
  persistence: 'transient',
  activation: 'dormant',
  integration: 'raw',
  epistemic: 'hypothesized',
  influence: 'blocked',
}
const dynamics: MemoryDynamics = {
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
}

function hypothesis(id = memoryId): RinMemory {
  return createMemory({
    id,
    form: 'scene',
    data: {
      participants: [participant],
      environment: 'workspace',
      goals: [],
      observations: ['the model proposed a plan'],
      interpretations: ['the plan may be useful'],
      actions: [],
      outcomes: [],
      predictionErrors: [],
      affect: { valence: 0.2, arousal: 0.4, control: 0.7 },
    },
    state: baseState,
    dynamics,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })
}

function proposalCommand(candidate: ReturnType<typeof createModelCandidate>): MemoryCommand {
  return {
    kind: 'memory-command',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'propose',
    commandId: createMemoryCommandId('cmd-propose'),
    correlationId: createMemoryCorrelationId('corr-propose'),
    actor: model,
    issuedAt: '2026-01-01T00:00:01.000Z',
    payload: { candidate },
  }
}

describe('M1-02 memory protocol', () => {
  test('keeps model candidates non-observed and blocked from every influence surface', () => {
    const candidate = createModelCandidate(model, {
      memory: hypothesis(),
      basis: 'model-inference',
      evidenceIds: [],
      rationale: 'The output is a proposal, not an observed fact.',
    })
    const command = createMemoryCommand(proposalCommand(candidate))
    expect(command.type).toBe('propose')
    expect(command.payload.candidate.memory.state.epistemic).toBe('hypothesized')
    expect(command.payload.candidate.memory.state.influence).toBe('blocked')
    expect(Object.isFrozen(command)).toBe(true)
    expect(Object.isFrozen(command.payload.candidate.memory)).toBe(true)
  })
  test('forms an online model interpretation as a raw replayable proposal', () => {
    const candidate = {
      memory: hypothesis(createMemoryId('hypothesis-online')),
      basis: 'model-inference' as const,
      evidenceIds: [],
      rationale: 'The current scene may imply a useful plan; this remains unverified.',
    }
    const transaction = createModelProposalTransaction({
      actor: model,
      candidate,
      commandId: createMemoryCommandId('cmd-proposal-online'),
      eventId: createMemoryEventId('event-proposal-online'),
      transactionId: createMemoryTransactionId('tx-proposal-online'),
      correlationId: createMemoryCorrelationId('corr-proposal-online'),
      issuedAt: '2026-01-01T00:00:01.000Z',
    })
    const state = new MemoryMaterializer().apply(transaction)

    expect(transaction.events.map(event => event.type)).toEqual(['memory-proposed'])
    expect(state.memories).toEqual([candidate.memory])
    expect(state.memories[0]?.state).toMatchObject({
      persistence: 'transient',
      integration: 'raw',
      epistemic: 'hypothesized',
      influence: 'blocked',
    })
    expect(state.currentField.sceneId).toBeUndefined()
    expect(state.currentField.activeMemoryCoalition).toEqual([])
  })

  test('rejects a model proposal that tries to pre-integrate or influence memory', () => {
    expect(() => createModelProposalTransaction({
      actor: model,
      candidate: {
        memory: createMemory({
          ...hypothesis(createMemoryId('hypothesis-integrated')),
          state: { ...baseState, persistence: 'durable', integration: 'integrated' },
        }),
        basis: 'model-proposal',
        evidenceIds: [],
        rationale: 'This must remain a candidate.',
      },
      commandId: createMemoryCommandId('cmd-proposal-integrated'),
      eventId: createMemoryEventId('event-proposal-integrated'),
      transactionId: createMemoryTransactionId('tx-proposal-integrated'),
      correlationId: createMemoryCorrelationId('corr-proposal-integrated'),
      issuedAt: '2026-01-01T00:00:01.000Z',
    })).toThrow('must remain transient and raw')
  })

  test('rejects model output attempting to issue owner-only commands', () => {
    const forged = {
      kind: 'memory-command',
      protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
      type: 'correct',
      commandId: createMemoryCommandId('cmd-forged'),
      correlationId: createMemoryCorrelationId('corr-forged'),
      actor: model,
      issuedAt: '2026-01-01T00:00:01.000Z',
      payload: {
        memoryId,
        replacement: hypothesis(),
        evidenceIds: [],
        explanation: 'forged owner correction',
      },
    }
    expect(() => assertMemoryCommand(forged)).toThrow('cannot issue correct')
  })

  test('accepts owner-only influence revocation and binds its event atomically', () => {
    const command: MemoryCommand = {
      kind: 'memory-command',
      protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
      type: 'revoke-influence',
      commandId: createMemoryCommandId('cmd-revoke'),
      correlationId: createMemoryCorrelationId('corr-revoke'),
      actor: owner,
      issuedAt: '2026-01-01T00:00:01.000Z',
      payload: { memoryId, reason: 'owner requested no behavioral influence' },
    }
    const transactionId = createMemoryTransactionId('tx-revoke')
    const event: MemoryEvent = {
      kind: 'memory-event',
      protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
      type: 'influence-revoked',
      eventId: createMemoryEventId('event-revoke'),
      transactionId,
      commandId: command.commandId,
      position: 0,
      actor: owner,
      occurredAt: '2026-01-01T00:00:02.000Z',
      payload: { memoryId, state: 'revoked', reason: 'owner requested no behavioral influence' },
    }
    const transaction = createMemoryTransaction({
      transactionId,
      commandId: command.commandId,
      correlationId: command.correlationId,
      actor: owner,
      openedAt: '2026-01-01T00:00:01.000Z',
      committedAt: '2026-01-01T00:00:02.000Z',
      command,
      events: [event],
    })
    expect(transaction.events).toHaveLength(1)
    expect(transaction.events[0].type).toBe('influence-revoked')
    expect(Object.isFrozen(transaction)).toBe(true)
    assertMemoryTransaction(transaction)
    expect(() => assertMemoryTransaction({
      ...transaction,
      commandId: createMemoryCommandId('tx-command-drift'),
    })).toThrow('transaction identity does not match its command')
    expect(Object.isFrozen(transaction.events)).toBe(true)
  })

  test('rejects a runtime influence transition that tries to grant behavioral permission', () => {
    const forged = {
      kind: 'memory-command',
      protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
      type: 'transition',
      commandId: createMemoryCommandId('cmd-runtime-permit'),
      correlationId: createMemoryCorrelationId('corr-runtime-permit'),
      actor: createRuntimeActor('runtime-1'),
      issuedAt: '2026-01-01T00:00:01.000Z',
      payload: {
        memoryId,
        transition: {
          type: 'influence',
          to: 'permitted',
          surfaces: ['action-selection'],
          at: '2026-01-01T00:00:02.000Z',
        },
      },
    }
    expect(() => assertMemoryCommand(forged)).toThrow('owner permit-influence command')
  })

  test('rejects invalid protocol versions and invalid model candidates at parser boundaries', () => {

    const candidate = createModelCandidate(model, {
      memory: hypothesis(),
      basis: 'model-proposal',
      evidenceIds: [],
      rationale: 'A test candidate.',
    })
    const command = proposalCommand(candidate)
    expect(() => assertMemoryCommand({ ...command, protocolVersion: 99 })).toThrow('unsupported cognition protocol version')
    expect(() => createModelCandidate(model, {
      memory: createMemory({
        ...hypothesis('observed-candidate'),
        state: { ...baseState, epistemic: 'observed' },
      }),
      basis: 'model-proposal',
      evidenceIds: [],
      rationale: 'This must fail.',
    })).toThrow('model candidate cannot be observed')
  })

  test('does not let a prospect enter observed history through the observe command', () => {
    const prospect = createMemory({
      ...hypothesis(createMemoryId('prospect-observed-history')),
      form: 'prospect',
      data: {
        kind: 'dream',
        premise: 'a future scene could unfold this way',
        possibleOutcomes: ['the scene changes'],
        relatedMemoryIds: [],
      },
    })
    const forged = {
      kind: 'memory-command',
      protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
      type: 'observe',
      commandId: createMemoryCommandId('cmd-observe-prospect'),
      correlationId: createMemoryCorrelationId('corr-observe-prospect'),
      actor: createRuntimeActor('runtime-1'),
      issuedAt: '2026-01-01T00:00:01.000Z',
      payload: { memory: prospect },
    }
    expect(() => assertMemoryCommand(forged)).toThrow('prospect cannot enter observed history')
    const event: MemoryEvent = {
      kind: 'memory-event',
      protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
      type: 'memory-observed',
      eventId: createMemoryEventId('event-observe-prospect'),
      transactionId: createMemoryTransactionId('tx-observe-prospect'),
      commandId: createMemoryCommandId('cmd-observe-prospect-event'),
      position: 0,
      actor: createRuntimeActor('runtime-1'),
      occurredAt: '2026-01-01T00:00:02.000Z',
      payload: { memory: prospect },
    }
    expect(() => assertMemoryEvent(event)).toThrow('prospect cannot enter observed history')
  })

  test('rejects event authority drift and non-contiguous transaction positions', () => {
    const command: MemoryCommand = {
      kind: 'memory-command',
      protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
      type: 'authorize-erase',
      commandId: createMemoryCommandId('cmd-authorize'),
      correlationId: createMemoryCorrelationId('corr-authorize'),
      actor: owner,
      issuedAt: '2026-01-01T00:00:01.000Z',
      payload: {
        authorizationId: createMemoryAuthorizationId('auth-1'),
        memoryIds: [memoryId],
        expiresAt: '2026-01-02T00:00:00.000Z',
        scopeHash: 'scope-hash-auth-1',
      },
    }
    const transactionId = createMemoryTransactionId('tx-authorize')
    const event: MemoryEvent = {
      kind: 'memory-event',
      protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
      type: 'erase-authorized',
      eventId: createMemoryEventId('event-authorize'),
      transactionId,
      commandId: command.commandId,
      position: 1,
      actor: owner,
      occurredAt: '2026-01-01T00:00:02.000Z',
      payload: {
        authorizationId: createMemoryAuthorizationId('auth-1'),
        memoryIds: [memoryId],
        expiresAt: '2026-01-02T00:00:00.000Z',
        scopeHash: 'scope-hash-auth-1',
      },
    }
    expect(() => assertMemoryEvent({ ...event, actor: model })).toThrow('cannot emit erase-authorized')
    expect(() => createMemoryTransaction({
      transactionId,
      commandId: command.commandId,
      correlationId: command.correlationId,
      actor: owner,
      openedAt: '2026-01-01T00:00:01.000Z',
      committedAt: '2026-01-01T00:00:02.000Z',
      command,
      events: [event],
    })).toThrow('positions must be contiguous')
  })
})
