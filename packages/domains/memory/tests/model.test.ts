import { describe, expect, test } from 'vitest'
import {
  createEvidenceId,
  createCurrentField,
  createGoalId,
  createMemory,
  createMemoryId,
  createParticipantId,
  transitionMemory,
} from '../src/model.ts'
import type {
  MemoryDynamics,
  MemoryState,
  RinMemory,
} from '../src/model.ts'

const participantA = createParticipantId('user')
const participantB = createParticipantId('rin')
const goal = createGoalId('goal-1')
const evidence = createEvidenceId('evidence-1')

const baseDynamics: MemoryDynamics = {
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
  utilityByGoal: [{ goalId: goal, value: 0.6 }],
  inhibition: 0.2,
  influenceSurfaces: [],
}

const observedTransientState: MemoryState = {
  persistence: 'transient',
  activation: 'dormant',
  integration: 'raw',
  epistemic: 'observed',
  influence: 'blocked',
}

function sceneMemory(id = 'scene-1', state = observedTransientState): RinMemory {
  return createMemory({
    id: createMemoryId(id),
    form: 'scene',
    data: {
      participants: [participantA, participantB],
      environment: 'workspace',
      goals: [goal],
      observations: ['the user asked for a design'],
      interpretations: ['the request has a long horizon'],
      actions: [{ actor: participantA, description: 'asked for a model' }],
      outcomes: [{ description: 'model was drafted', status: 'observed' }],
      predictionErrors: [],
      affect: { valence: 0.2, arousal: 0.4, control: 0.7 },
    },
    state,
    dynamics: baseDynamics,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })
}

describe('M1-01 unified memory model', () => {
  test('constructs all eight forms inside the same memory envelope', () => {
    const common = {
      id: createMemoryId('form-test'),
      state: observedTransientState,
      dynamics: baseDynamics,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const forms: Array<Parameters<typeof createMemory>[0]> = [
      { ...common, form: 'scene', data: sceneMemory().data },
      { ...common, form: 'structure', data: { entities: ['user'], relations: [], concepts: ['memory'], causalPatterns: [], validity: { startsAt: '2026-01-01T00:00:00.000Z' } } },
      { ...common, form: 'self-model', data: { values: ['continuity'], abilities: ['reasoning'], tendencies: ['careful'], historicalChanges: [] } },
      { ...common, form: 'person-model', data: { subject: participantA, claims: ['prefers precision'], observedPatterns: [], currentState: ['focused'], lastObservedAt: '2026-01-01T00:00:00.000Z' } },
      { ...common, form: 'relationship-model', data: { participants: [participantA, participantB], sharedMemoryIds: [], commitments: [], boundaries: ['respect autonomy'], conflicts: [], expectations: ['clarity'], distance: 0.3 } },
      { ...common, form: 'disposition', data: { triggeringContexts: ['ambiguous request'], intendedGoal: goal, actionPattern: ['ask a clarifying question'], expectedOutcomes: ['shared understanding'], observedOutcomes: [], applicabilityConditions: ['high uncertainty'], failureModes: ['overconfidence'], utilityByGoal: [{ goalId: goal, value: 0.7 }] } },
      { ...common, form: 'open-loop', data: { goal, description: 'finish the model', relatedMemoryIds: [], status: 'open' } },
      { ...common, form: 'prospect', data: { kind: 'plan', premise: 'the model is implemented', possibleOutcomes: ['evaluate W1'], relatedMemoryIds: [] }, state: { ...observedTransientState, epistemic: 'hypothesized' } },
    ]
    for (const [index, form] of forms.entries()) {
      expect(createMemory({ ...form, id: createMemoryId('form-' + index) }).form).toBe(form.form)
    }
  })

  test('rejects illegal combinations at construction', () => {
    expect(() => sceneMemory('archived', {
      ...observedTransientState,
      persistence: 'archived',
      activation: 'active',
    })).toThrow('archived memory must be dormant')

    expect(() => sceneMemory('permitted', {
      ...observedTransientState,
      persistence: 'transient',
      influence: 'permitted',
    })).toThrow('transient memory cannot influence behavior')

    expect(() => createMemory({
      ...sceneMemory('prospect-observed'),
      id: createMemoryId('prospect-observed'),
      form: 'prospect',
      data: { kind: 'dream', premise: 'future', possibleOutcomes: ['x'], relatedMemoryIds: [] },
    })).toThrow('prospect memory must remain hypothesized')
  })

  test('brands IDs and keeps returned memory immutable', () => {
    expect(() => createMemoryId('')).toThrow('memory id')
    const memory = sceneMemory()
    expect(() => { (memory as { id: string }).id = 'raw' }).toThrow()
    expect(memory.id).toBe('scene-1')
  })

  test('enforces legal transition paths without changing confidence during recall activation', () => {
    let memory = sceneMemory()
    expect(() => transitionMemory(memory, { type: 'durable', at: '2026-01-01T00:00:01.000Z' })).toThrow('durable requires encoded')
    memory = transitionMemory(memory, { type: 'encode', at: '2026-01-01T00:00:01.000Z' })
    memory = transitionMemory(memory, { type: 'durable', at: '2026-01-01T00:00:02.000Z' })
    memory = transitionMemory(memory, { type: 'link', at: '2026-01-01T00:00:03.000Z' })
    memory = transitionMemory(memory, { type: 'consolidate', at: '2026-01-01T00:00:04.000Z' })
    memory = transitionMemory(memory, { type: 'integrate', at: '2026-01-01T00:00:05.000Z' })
    memory = transitionMemory(memory, { type: 'prime', at: '2026-01-01T00:00:06.000Z' })
    memory = transitionMemory(memory, { type: 'activate', at: '2026-01-01T00:00:07.000Z' })
    const confidence = memory.dynamics.confidence
    memory = transitionMemory(memory, { type: 'workspace', at: '2026-01-01T00:00:08.000Z' })
    expect(memory.dynamics.confidence).toBe(confidence)
    expect(memory.state.activation).toBe('workspace')
    expect(memory.state.persistence).toBe('durable')
    memory = transitionMemory(memory, {
      type: 'influence',
      to: 'permitted',
      surfaces: ['model-input'],
      at: '2026-01-01T00:00:09.000Z',
    })
    expect(memory.state.influence).toBe('permitted')
    expect(memory.dynamics.influenceSurfaces).toEqual(['model-input'])
  })

  test('does not let model output promote a hypothesis to an observed fact', () => {
    const memory = sceneMemory('hypothesis', {
      ...observedTransientState,
      epistemic: 'hypothesized',
    })
    expect(() => transitionMemory(memory, {
      type: 'epistemic',
      to: 'observed',
      basis: 'model-proposal',
      evidenceIds: [evidence],
      at: '2026-01-01T00:00:01.000Z',
    })).toThrow('model output cannot create an observed fact')
  })

  test('keeps prospects hypothesized even when an evidence transition is requested', () => {
    const memory = createMemory({
      ...sceneMemory('prospect'),
      id: createMemoryId('prospect'),
      form: 'prospect',
      data: { kind: 'counterfactual', premise: 'if the user changes scope', possibleOutcomes: ['replan'], relatedMemoryIds: [] },
      state: { ...observedTransientState, epistemic: 'hypothesized' },
    })
    expect(() => transitionMemory(memory, {
      type: 'epistemic',
      to: 'observed',
      basis: 'new-evidence',
      evidenceIds: [evidence],
      at: '2026-01-01T00:00:01.000Z',
    })).toThrow('prospect memory cannot become observed')
  })

  test('constructs one validated current cognition field per materialized version', () => {
    const memory = sceneMemory()
    const field = createCurrentField({
      ownerId: 'rin',
      version: 1,
      updatedAt: memory.updatedAt,
      sceneId: memory.id,
      sceneVersion: memory.updatedAt,
      sceneStatus: 'open',
      participants: [...memory.data.participants],
      goals: [...memory.data.goals],
      affect: { ...memory.data.affect },
      predictions: [],
      predictionErrors: [],
      activeOpenLoops: [],
      candidateActions: [],
      activeMemoryCoalition: [memory.id],
      uncertainty: [],
    })

    expect(field.sceneId).toBe(memory.id)
    expect(field.activeMemoryCoalition).toEqual([memory.id])
    expect(Object.isFrozen(field)).toBe(true)
    expect(Object.isFrozen(field.participants)).toBe(true)
    expect(() => createCurrentField({ ...field, version: -1 })).toThrow('version')
    expect(() => createCurrentField({
      ...field,
      sceneId: undefined,
      sceneVersion: memory.updatedAt,
    } as unknown as Parameters<typeof createCurrentField>[0])).toThrow('scene metadata')
  })
})
