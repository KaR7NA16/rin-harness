import { describe, expect, test } from 'vitest'
import {
  consolidateMemory,
  decayMemory,
  deriveMemoryRepresentationCandidates,
  formMemoryRepresentations,
  learnDispositionFromFeedback,
  projectDispositionToSkill,
  openLabileWindow,
  planConsolidationSchedule,
  type MemoryConsolidationInput,
  type MemoryUseTrace,
} from '../src/consolidation.ts'
import {
  createActionId,
  createFeedbackId,
  createGoalId,
  createLinkId,
  createEvidenceId,
  createMemory,
  createMemoryId,
  createMemoryLink,
  createOutcomeId,
  createParticipantId,
  createWorkspaceCycleId,
  type RinMemory,
} from '../src/model.ts'

const createdAt = '2026-08-28T00:00:00.000Z'
const usedAt = '2026-08-28T00:30:00.000Z'
const consolidatedAt = '2026-08-28T01:00:00.000Z'

function scene(id: string, text = 'the original interpretation'): RinMemory {
  return createMemory({
    id: createMemoryId(id),
    form: 'scene',
    data: {
      participants: [createParticipantId('user')],
      environment: 'workspace',
      goals: [],
      observations: ['an observed event'],
      interpretations: [text],
      actions: [],
      outcomes: [],
      predictionErrors: [],
      affect: { valence: 0, arousal: 0.2, control: 0.7 },
      lifecycle: {
        continuityKey: 'task',
        status: 'closed',
        startedAt: createdAt,
        endedAt: usedAt,
      },
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
      salience: 0.6,
      stability: 0.4,
      confidence: 0.6,
      integrationStrength: 0.7,
      novelty: 0.3,
      surprise: 0.2,
      affect: { valence: 0, arousal: 0.2, control: 0.7 },
      validity: { startsAt: createdAt },
      utilityByGoal: [],
      inhibition: 0.1,
      influenceSurfaces: ['model-input', 'planning'],
    },
    createdAt,
    updatedAt: usedAt,
  })
}

function useTrace(memory: RinMemory): MemoryUseTrace {
  return {
    id: 'use-1',
    cycleId: 'recall-1',
    memoryId: memory.id,
    memoryVersion: memory.updatedAt,
    surface: 'model-input',
    purpose: 'answer',
    usedAt,
  }
}

function labile(memory: RinMemory) {
  return openLabileWindow(memory, useTrace(memory), usedAt, 2 * 60 * 60 * 1_000)
}

function input(memory: RinMemory, operation: MemoryConsolidationInput['operation'], extra: Partial<MemoryConsolidationInput> = {}): MemoryConsolidationInput {
  return {
    memory,
    labile: labile(memory),
    operation,
    basis: 'new-evidence',
    evidenceIds: [createEvidenceId('evidence-1')],
    at: consolidatedAt,
    explanation: operation + ' from a new independent observation',
    ...extra,
  }
}

describe('Wave 4 labile and reconsolidation controller', () => {
  test('opens only from an actual use trace for the exact memory version', () => {
    const memory = scene('memory-1')
    const window = labile(memory)
    expect(window.memoryId).toBe(memory.id)
    expect(window.memoryVersion).toBe(memory.updatedAt)
    expect(window.useTraceId).toBe('use-1')
    expect(() => openLabileWindow(memory, { ...useTrace(memory), memoryVersion: createdAt })).toThrow('stale memory version')
    expect(() => openLabileWindow(memory, { ...useTrace(memory), surface: 'recall' as never })).toThrow('invalid use surface')
  })

  test('reinforce increases accessibility and stability without new independent evidence', () => {
    const memory = scene('memory-2')
    const result = consolidateMemory(input(memory, 'reinforce'))
    expect(result.resultingMemories).toHaveLength(1)
    const reinforced = result.resultingMemories[0]
    expect(reinforced?.dynamics.accessibility).toBeGreaterThan(memory.dynamics.accessibility)
    expect(reinforced?.dynamics.stability).toBeGreaterThan(memory.dynamics.stability)
    expect(reinforced?.dynamics.confidence).toBe(memory.dynamics.confidence)
    expect(result.confidenceChanged).toBe(false)
  })

  test('independent evidence is the only reinforce path that raises confidence', () => {
    const memory = scene('memory-3')
    const result = consolidateMemory(input(memory, 'reinforce', {
      independentEvidenceIds: [createEvidenceId('evidence-1')],
    }))
    expect(result.resultingMemories[0]?.dynamics.confidence).toBeGreaterThan(memory.dynamics.confidence)
    expect(result.confidenceChanged).toBe(true)
  })

  test('revise preserves identity but rejects a model-created observed result', () => {
    const memory = scene('memory-4')
    const replacement = createMemory({
      ...memory,
      state: { ...memory.state, epistemic: 'inferred' },
      data: { ...memory.data, interpretations: ['a revised interpretation'] },
      updatedAt: consolidatedAt,
    })
    const result = consolidateMemory(input(memory, 'revise', { replacement }))
    expect(result.resultingMemories[0]?.id).toBe(memory.id)
    expect(result.resultingMemories[0]?.data).not.toBe(memory.data)

    const observed = createMemory({
      ...replacement,
      state: { ...replacement.state, epistemic: 'observed' },
    })
    expect(() => consolidateMemory(input(memory, 'revise', {
      basis: 'model-inference',
      replacement: observed,
    }))).toThrow('cannot create observed')
  })

  test('contest retains the representation while making uncertainty explicit', () => {
    const memory = scene('memory-5')
    const result = consolidateMemory(input(memory, 'contest'))
    const contested = result.resultingMemories[0]
    expect(contested?.state.epistemic).toBe('contested')
    expect(contested?.dynamics.confidence).toBe(0.55)
    expect(contested?.dynamics.inhibition).toBeGreaterThan(memory.dynamics.inhibition)
    expect(() => consolidateMemory(input(contested!, 'contest'))).toThrow('needs a new resolution')
  })

  test('supersede creates a new identity and blocks the old representation', () => {
    const memory = scene('memory-6')
    const replacement = scene('memory-6-replacement', 'the replacement interpretation')
    const result = consolidateMemory(input(memory, 'supersede', { replacement }))
    expect(result.resultingMemories.map(item => item.id)).toEqual([memory.id, replacement.id])
    expect(result.resultingMemories[0]?.state.epistemic).toBe('superseded')
    expect(result.resultingMemories[0]?.state.influence).toBe('blocked')
    expect(result.resultingMemories[0]?.dynamics.influenceSurfaces).toEqual([])
    expect(() => consolidateMemory(input(memory, 'supersede'))).toThrow('requires a replacement')
    expect(() => consolidateMemory(input(memory, 'supersede', { replacement: memory }))).toThrow('new identity')
  })

  test('split creates multiple identities and never accepts duplicate parts', () => {
    const memory = scene('memory-7')
    const partA = scene('memory-7-a', 'context A')
    const partB = scene('memory-7-b', 'context B')
    const result = consolidateMemory(input(memory, 'split', { parts: [partA, partB] }))
    expect(result.resultingMemories.map(item => item.id)).toEqual([memory.id, partA.id, partB.id])
    expect(result.resultingMemories[0]?.state.epistemic).toBe('superseded')
    expect(() => consolidateMemory(input(memory, 'split', { parts: [partA, partA] }))).toThrow('distinct new identities')
  })

  test('reject is terminal and removes all influence surfaces', () => {
    const memory = scene('memory-8')
    const result = consolidateMemory(input(memory, 'reject', { basis: 'user-correction' }))
    const rejected = result.resultingMemories[0]
    expect(rejected?.state.epistemic).toBe('rejected')
    expect(rejected?.state.influence).toBe('blocked')
    expect(rejected?.dynamics.influenceSurfaces).toEqual([])
    expect(() => consolidateMemory(input(rejected!, 'reinforce'))).toThrow('terminal epistemic')
  })

  test('requires evidence and refuses a stale or expired labile window', () => {
    const memory = scene('memory-9')
    expect(() => consolidateMemory(input(memory, 'reinforce', { evidenceIds: [] }))).toThrow('evidenceIds')
    expect(() => consolidateMemory(input(memory, 'reinforce', { at: '2026-08-28T03:00:01.000Z' }))).toThrow('outside the labile window')
    expect(() => consolidateMemory(input(memory, 'reinforce', {
      labile: { ...labile(memory), memoryVersion: createdAt },
    }))).toThrow('stale memory version')
  })
})

test('plans linked scene memories from actual use and groups cross-scene pressure', () => {
  const first = scene('memory-scheduled-a')
  const second = scene('memory-scheduled-b')
  const unused = scene('memory-scheduled-unused')
  const firstUse: MemoryUseTrace = { ...useTrace(first), id: 'use-scheduled-a', cycleId: 'cycle-scheduled-a' }
  const secondUse: MemoryUseTrace = { ...useTrace(second), id: 'use-scheduled-b', cycleId: 'cycle-scheduled-b' }
  const link = createMemoryLink({
    id: createLinkId('link-scheduled-scenes'),
    from: first.id,
    relation: 'context-of',
    to: second.id,
    fromVersion: first.updatedAt,
    toVersion: second.updatedAt,
    strength: 0.8,
    validity: { startsAt: createdAt },
    state: 'active',
    createdAt,
    updatedAt: usedAt,
  })
  const schedule = planConsolidationSchedule({
    memories: [first, second, unused],
    links: [link],
    useTraces: [firstUse, secondUse],
    at: consolidatedAt,
  })
  expect(schedule.items.map(item => String(item.memoryId))).toEqual([
    'memory-scheduled-a',
    'memory-scheduled-b',
  ])
  expect(schedule.items.every(item => item.confidenceNeedsIndependentEvidence)).toBe(true)
  expect(schedule.items.every(item => item.priorities.includes('cross-scene'))).toBe(true)
  expect(schedule.groups).toEqual([{
    id: 'consolidation-group:memory-scheduled-a,memory-scheduled-b',
    memoryIds: [first.id, second.id],
    crossScene: true,
    reasons: ['linked scene memories scheduled together'],
  }])
})

test('repeated use raises scheduling pressure without upgrading epistemic state', () => {
  const memory = scene('memory-repeated-use')
  const firstUse: MemoryUseTrace = { ...useTrace(memory), id: 'use-repeated-a', cycleId: 'cycle-repeated-a' }
  const secondUse: MemoryUseTrace = {
    ...firstUse,
    id: 'use-repeated-b',
    cycleId: 'cycle-repeated-b',
    usedAt: '2026-08-28T00:45:00.000Z',
  }
  const schedule = planConsolidationSchedule({
    memories: [memory],
    links: [],
    useTraces: [firstUse, secondUse],
    at: consolidatedAt,
  })
  expect(schedule.items[0]?.repetitionCount).toBe(2)
  expect(schedule.items[0]?.useTraceId).toBe(secondUse.id)
  expect(schedule.items[0]?.reasons.some(reason => reason.includes('cannot upgrade epistemic state'))).toBe(true)
  expect(memory.state.epistemic).toBe('inferred')
})

test('decay updates accessibility and incident links without changing epistemic state', () => {
  const memory = scene('memory-decay')
  const target = scene('memory-decay-target')
  const link = createMemoryLink({
    id: createLinkId('link-decay'),
    from: memory.id,
    relation: 'supports',
    to: target.id,
    fromVersion: memory.updatedAt,
    toVersion: target.updatedAt,
    strength: 0.8,
    validity: { startsAt: createdAt },
    state: 'active',
    createdAt,
    updatedAt: usedAt,
  })
  const result = decayMemory({
    memory,
    links: [link],
    elapsedMs: 24 * 60 * 60 * 1_000,
    at: '2026-08-29T00:30:00.000Z',
    explanation: 'background accessibility maintenance',
  })
  expect(result.memory.dynamics.accessibility).toBeLessThan(memory.dynamics.accessibility)
  expect(result.memory.dynamics.confidence).toBe(memory.dynamics.confidence)
  expect(result.memory.state).toEqual(memory.state)
  expect(result.memory.data).toEqual(memory.data)
  expect(result.links[0]?.strength).toBeLessThan(link.strength)
  expect(result.links[0]?.fromVersion).toBe(result.memory.updatedAt)
  expect(() => decayMemory({ memory, links: [link], elapsedMs: 1, at: '2026-08-29T00:30:00.000Z', explanation: 'invalid elapsed delta' })).toThrow('time delta')
})


test('separates user correction, source contradiction, context difference, and time change', () => {
  const corrected = scene('gate-correction', 'the corrected interpretation')
  const userCorrection = consolidateMemory(input(corrected, 'revise', {
    basis: 'user-correction',
    replacement: scene('gate-correction', 'the corrected interpretation'),
  }))
  const contradiction = consolidateMemory(input(scene('gate-contradiction'), 'contest', {
    explanation: 'source contradiction requires explicit uncertainty',
  }))
  const split = consolidateMemory(input(scene('gate-context'), 'split', {
    parts: [scene('gate-context-a', 'context A'), scene('gate-context-b', 'context B')],
  }))
  const timeChange = consolidateMemory(input(scene('gate-time'), 'supersede', {
    replacement: scene('gate-time-new', 'the time-updated interpretation'),
  }))
  expect(userCorrection.operation).toBe('revise')
  expect(userCorrection.resultingMemories[0]?.state.epistemic).toBe('inferred')
  expect(contradiction.operation).toBe('contest')
  expect(contradiction.resultingMemories[0]?.state.epistemic).toBe('contested')
  expect(split.operation).toBe('split')
  expect(split.resultingMemories).toHaveLength(3)
  expect(timeChange.operation).toBe('supersede')
  expect(timeChange.resultingMemories[0]?.state.epistemic).toBe('superseded')
  expect(new Set([userCorrection.operation, contradiction.operation, split.operation, timeChange.operation]).size).toBe(4)
})

function candidateMemory(id: string, form: RinMemory['form'], data: unknown): RinMemory {
  return createMemory({
    id: createMemoryId(id),
    form,
    data,
    state: { persistence: 'transient', activation: 'active', integration: 'raw', epistemic: form === 'prospect' ? 'hypothesized' : 'inferred', influence: 'blocked' },
    dynamics: {
      activation: 0.4, accessibility: 0.3, salience: 0.4, stability: 0.1, confidence: 0.4,
      integrationStrength: 0, novelty: 0.5, surprise: 0.2,
      affect: { valence: 0, arousal: 0.2, control: 0.5 }, validity: { startsAt: createdAt },
      utilityByGoal: [], inhibition: 0, influenceSurfaces: [],
    },
    createdAt, updatedAt: createdAt,
  } as RinMemory)
}

test('forms long-term candidates from scenes and behavior without granting influence', () => {
  const first = scene('formation-scene-a')
  const second = scene('formation-scene-b')
  const action = {
    id: createActionId('formation-action'), cycleId: createWorkspaceCycleId('formation-cycle'),
    workspaceHash: 'formation-hash', actor: createParticipantId('user'),
    description: 'ask for the missing constraint', goalIds: [], sourceMemoryIds: [first.id],
    predictionIds: [], occurredAt: usedAt, sessionId: 'formation-session-a',
  } as const
  const outcomes = [
    { id: createOutcomeId('formation-outcome-a'), cycleId: action.cycleId, actionId: action.id, status: 'observed', description: 'constraint became explicit', occurredAt: usedAt, delayed: false, sessionId: 'formation-session-a' },
    { id: createOutcomeId('formation-outcome-b'), cycleId: action.cycleId, actionId: action.id, status: 'observed', description: 'next exchange stayed in scope', occurredAt: consolidatedAt, delayed: true, sessionId: 'formation-session-b' },
  ] as const
  const self = candidateMemory('formation-self', 'self-model', { values: ['keep continuity'], abilities: ['reason about constraints'], tendencies: ['ask before acting'], historicalChanges: [] })
  const person = candidateMemory('formation-person', 'person-model', { subject: createParticipantId('user'), claims: ['prefers explicit scope'], observedPatterns: [], currentState: ['focused'], lastObservedAt: usedAt })
  const disposition = candidateMemory('formation-disposition', 'disposition', {
    triggeringContexts: ['ambiguous request'], intendedGoal: createGoalId('formation-goal'), actionPattern: ['ask for the missing constraint'],
    supportingActionIds: [action.id], supportingOutcomeIds: outcomes.map(outcome => outcome.id), sampleCount: 2,
    expectedOutcomes: ['shared understanding'], observedOutcomes: [], applicabilityConditions: ['high uncertainty'], failureModes: [], utilityByGoal: [],
  })
  const prospect = candidateMemory('formation-prospect', 'prospect', { kind: 'prediction', premise: 'next exchange preserves scope', possibleOutcomes: ['scope is preserved'], relatedMemoryIds: [first.id] })
  const formed = formMemoryRepresentations({
    scenes: [first, second], links: [], actions: [action], outcomes,
    candidates: [
      { memory: self, sourceSceneIds: [first.id, second.id] },
      { memory: person, sourceSceneIds: [first.id] },
      { memory: disposition, sourceSceneIds: [first.id, second.id] },
      { memory: prospect, sourceSceneIds: [first.id] },
    ], at: consolidatedAt,
  })
  expect(formed.find(candidate => candidate.memory.form === 'self-model')?.readiness).toBe('ready-for-consolidation')
  expect(formed.find(candidate => candidate.memory.form === 'self-model')?.memory.state.influence).toBe('blocked')
  expect(formed.find(candidate => candidate.memory.form === 'person-model')?.stable).toBe(false)
  expect(formed.find(candidate => candidate.memory.form === 'person-model')?.reasons.some(reason => reason.includes('context'))).toBe(true)
  expect(formed.find(candidate => candidate.memory.form === 'disposition')?.stable).toBe(true)
  expect(formed.find(candidate => candidate.memory.form === 'prospect')?.readiness).toBe('candidate')
  expect(formed.find(candidate => candidate.memory.form === 'prospect')?.reasons.some(reason => reason.includes('never enters observed history'))).toBe(true)
})

test('treats an explicitly contextual current person state as formation-ready', () => {
  const first = scene('formation-context-a')
  const second = scene('formation-context-b')
  const person = candidateMemory('formation-context-person', 'person-model', {
    subject: createParticipantId('user'),
    claims: ['prefers explicit scope'],
    observedPatterns: [],
    currentState: ['focused'],
    lastObservedAt: usedAt,
    contextConditions: ['workspace'],
  })
  const formed = formMemoryRepresentations({
    scenes: [first, second],
    links: [],
    candidates: [{
      memory: person,
      sourceSceneIds: [first.id, second.id],
      independentEvidenceIds: [
        createEvidenceId('formation-context-evidence-a'),
        createEvidenceId('formation-context-evidence-b'),
      ],
    }],
    at: consolidatedAt,
  })
  expect(formed).toHaveLength(1)
  expect(formed[0]?.stable).toBe(true)
  expect(formed[0]?.readiness).toBe('ready-for-consolidation')
})
  test('gates self, person, and relationship formation by evidence shape', () => {
    const user = createParticipantId('user')
    const rin = createParticipantId('rin')
    const userOnly = scene('formation-gate-user')
    const bothBase = scene('formation-gate-both')
    const both = createMemory({
      ...bothBase,
      data: { ...bothBase.data, participants: [user, rin] },
    })
    const otherBase = scene('formation-gate-other')
    const other = createMemory({
      ...otherBase,
      data: { ...otherBase.data, participants: [rin] },
    })
    const emptyBase = scene('formation-gate-empty-a')
    const emptyA = createMemory({
      ...emptyBase,
      data: {
        ...emptyBase.data,
        observations: [],
        actions: [],
        outcomes: [],
        predictionErrors: [],
      },
    })
    const emptyBBase = scene('formation-gate-empty-b')
    const emptyB = createMemory({
      ...emptyBBase,
      data: {
        ...emptyBBase.data,
        observations: [],
        actions: [],
        outcomes: [],
        predictionErrors: [],
      },
    })
    const self = candidateMemory('formation-gate-self', 'self-model', {
      values: ['keep continuity'],
      abilities: ['reason about constraints'],
      tendencies: ['ask before acting'],
      historicalChanges: [],
    })
    const person = candidateMemory('formation-gate-person', 'person-model', {
      subject: user,
      claims: ['prefers explicit scope'],
      observedPatterns: [],
      currentState: [],
      lastObservedAt: usedAt,
    })
    const relationship = candidateMemory('formation-gate-relationship', 'relationship-model', {
      participants: [user, rin],
      sharedMemoryIds: [],
      commitments: [],
      boundaries: [],
      conflicts: [],
      expectations: [],
      distance: 0.5,
    })
    const formed = formMemoryRepresentations({
      scenes: [emptyA, emptyB, userOnly, other, both],
      links: [],
      candidates: [
        { memory: self, sourceSceneIds: [emptyA.id, emptyB.id] },
        { memory: person, sourceSceneIds: [userOnly.id, other.id] },
        { memory: relationship, sourceSceneIds: [both.id, userOnly.id] },
      ],
      at: consolidatedAt,
    })
    const selfResult = formed.find(candidate => candidate.memory.form === 'self-model')
    const personResult = formed.find(candidate => candidate.memory.form === 'person-model')
    const relationshipResult = formed.find(candidate => candidate.memory.form === 'relationship-model')
    expect(selfResult?.stable).toBe(false)
    expect(selfResult?.reasons.some(reason => reason.includes('observable scene'))).toBe(true)
    expect(personResult?.stable).toBe(false)
    expect(personResult?.reasons.some(reason => reason.includes('repeated observations'))).toBe(true)
    expect(relationshipResult?.stable).toBe(false)
    expect(relationshipResult?.reasons.some(reason => reason.includes('repeated co-occurrence'))).toBe(true)
    expect(relationshipResult?.reasons.some(reason => reason.includes('explicit commitment'))).toBe(true)
  })


test('derives a blocked disposition candidate from canonical behavior evidence', () => {
  const goal = createGoalId('derived-formation-goal')
  const firstBase = scene('derived-formation-scene-a') as Extract<RinMemory, { form: 'scene' }>
  const secondBase = scene('derived-formation-scene-b') as Extract<RinMemory, { form: 'scene' }>
  const first = createMemory({
    ...firstBase,
    data: { ...firstBase.data, environment: 'ambiguous request', goals: [goal] },
  })
  const second = createMemory({
    ...secondBase,
    data: { ...secondBase.data, environment: 'ambiguous request', goals: [goal] },
  })
  const actionA = {
    id: createActionId('derived-formation-action-a'),
    cycleId: createWorkspaceCycleId('derived-formation-cycle-a'),
    sessionId: 'derived-formation-session-a',
    workspaceHash: 'derived-formation-workspace-a',
    actor: createParticipantId('rin'),
    description: 'ask before acting',
    goalIds: [goal],
    sourceMemoryIds: [first.id],
    predictionIds: [],
    occurredAt: usedAt,
  } as const
  const actionB = {
    ...actionA,
    id: createActionId('derived-formation-action-b'),
    cycleId: createWorkspaceCycleId('derived-formation-cycle-b'),
    sessionId: 'derived-formation-session-b',
    workspaceHash: 'derived-formation-workspace-b',
    sourceMemoryIds: [second.id],
    occurredAt: consolidatedAt,
  } as const
  const outcomeA = {
    id: createOutcomeId('derived-formation-outcome-a'),
    cycleId: actionA.cycleId,
    actionId: actionA.id,
    sessionId: actionA.sessionId,
    status: 'observed',
    description: 'scope became explicit',
    occurredAt: usedAt,
    delayed: false,
  } as const
  const outcomeB = {
    ...outcomeA,
    id: createOutcomeId('derived-formation-outcome-b'),
    cycleId: actionB.cycleId,
    actionId: actionB.id,
    sessionId: actionB.sessionId,
    description: 'next exchange stayed in scope',
    occurredAt: consolidatedAt,
    delayed: true,
  } as const
  const feedbackA = {
    id: createFeedbackId('derived-formation-feedback-a'),
    cycleId: actionA.cycleId,
    sessionId: actionA.sessionId,
    kind: 'accept',
    actionId: actionA.id,
    outcomeId: outcomeA.id,
    taskOutcome: 0.8,
    actionCost: 0.1,
    explanation: 'scope was accepted',
    occurredAt: usedAt,
    delayed: false,
  } as const
  const feedbackB = {
    ...feedbackA,
    id: createFeedbackId('derived-formation-feedback-b'),
    cycleId: actionB.cycleId,
    sessionId: actionB.sessionId,
    actionId: actionB.id,
    outcomeId: outcomeB.id,
    taskOutcome: 0.7,
    occurredAt: consolidatedAt,
    delayed: true,
  } as const
  const input = {
    scenes: [first, second],
    links: [],
    actions: [actionA, actionB],
    outcomes: [outcomeA, outcomeB],
    feedback: [feedbackA, feedbackB],
    at: '2026-08-28T02:00:00.000Z',
  }
  const candidates = deriveMemoryRepresentationCandidates(input)
  expect(candidates.map(candidate => candidate.memory.form)).toEqual(['disposition', 'self-model'])
  const candidate = candidates.find(candidate => candidate.memory.form === 'disposition')
  if (candidate === undefined) throw new Error('derived formation candidate is missing')
  expect(candidate.sourceSceneIds).toEqual([first.id, second.id])
  expect(candidate.independentEvidenceIds).toHaveLength(2)
  expect(candidate.independentEvidenceIds).toEqual([
    'session:derived-formation-session-a',
    'session:derived-formation-session-b',
  ])
  expect(candidate.memory.form).toBe('disposition')
  expect(candidate.memory.data.actionPattern).toEqual(['ask before acting'])
  expect(candidate.memory.data.supportingActionIds).toEqual([actionA.id, actionB.id])
  expect(candidate.memory.data.supportingOutcomeIds).toEqual([outcomeA.id, outcomeB.id])
  expect(candidate.memory.data.utilityByGoal[0]?.goalId).toBe(goal)
  expect(candidate.memory.state).toEqual({
    persistence: 'transient',
    activation: 'active',
    integration: 'raw',
    epistemic: 'inferred',
    influence: 'blocked',
  })
  const formed = formMemoryRepresentations({ ...input, candidates })
  expect(formed.find(candidate => candidate.memory.form === 'disposition')?.readiness).toBe('ready-for-consolidation')
  const actionOnlyCandidates = deriveMemoryRepresentationCandidates({ ...input, outcomes: [], feedback: [] })
  expect(actionOnlyCandidates.some(candidate => candidate.memory.form === 'disposition')).toBe(false)
  const crossedOutcome = candidateMemory('derived-crossed-outcome', 'disposition', {
    ...candidate.memory.data,
    supportingActionIds: [actionA.id],
    supportingOutcomeIds: [outcomeB.id],
    supportingFeedbackIds: [feedbackA.id],
    sampleCount: 1,
  })
  expect(() => formMemoryRepresentations({
    ...input,
    candidates: [{ memory: crossedOutcome, sourceSceneIds: [first.id, second.id] }],
  })).toThrow('outcome record does not belong to a supporting action')
  const crossedFeedback = candidateMemory('derived-crossed-feedback', 'disposition', {
    ...candidate.memory.data,
    supportingActionIds: [actionA.id],
    supportingOutcomeIds: [outcomeA.id],
    supportingFeedbackIds: [feedbackB.id],
    sampleCount: 1,
  })
  expect(() => formMemoryRepresentations({
    ...input,
    candidates: [{ memory: crossedFeedback, sourceSceneIds: [first.id, second.id] }],
  })).toThrow('feedback record does not belong to a supporting action or outcome')
})
test('derives self, person, relationship, and prospect candidates from one canonical evidence stream', () => {
  const user = createParticipantId('stable-user')
  const rin = createParticipantId('rin')
  const firstBase = scene('derived-forms-scene-a')
  const secondBase = scene('derived-forms-scene-b')
  const first = createMemory({
    ...firstBase,
    data: {
      ...firstBase.data,
      participants: [user, rin],
      actions: [{ actor: rin, description: 'responded to scope' }],
    },
  })
  const second = createMemory({
    ...secondBase,
    data: {
      ...secondBase.data,
      participants: [user, rin],
      actions: [{ actor: rin, description: 'responded to scope' }],
    },
  })
  const userActionA = {
    id: createActionId('derived-person-action-a'),
    cycleId: createWorkspaceCycleId('derived-person-cycle-a'),
    sessionId: 'derived-person-session-a',
    workspaceHash: 'derived-person-workspace-a',
    actor: user,
    description: 'confirmed the boundary',
    goalIds: [],
    sourceMemoryIds: [first.id],
    predictionIds: [],
    occurredAt: usedAt,
  } as const
  const userActionB = {
    ...userActionA,
    id: createActionId('derived-person-action-b'),
    cycleId: createWorkspaceCycleId('derived-person-cycle-b'),
    sessionId: 'derived-person-session-b',
    workspaceHash: 'derived-person-workspace-b',
    sourceMemoryIds: [second.id],
    occurredAt: consolidatedAt,
  } as const
  const rinActionA = {
    id: createActionId('derived-self-action-a'),
    cycleId: createWorkspaceCycleId('derived-self-cycle-a'),
    sessionId: 'derived-self-session-a',
    workspaceHash: 'derived-self-workspace-a',
    actor: rin,
    description: 'responded to scope',
    goalIds: [],
    sourceMemoryIds: [first.id],
    predictionIds: [],
    occurredAt: usedAt,
  } as const
  const rinActionB = {
    ...rinActionA,
    id: createActionId('derived-self-action-b'),
    cycleId: createWorkspaceCycleId('derived-self-cycle-b'),
    sessionId: 'derived-self-session-b',
    workspaceHash: 'derived-self-workspace-b',
    sourceMemoryIds: [second.id],
    occurredAt: consolidatedAt,
  } as const
  const userOutcomeA = {
    id: createOutcomeId('derived-person-outcome-a'),
    cycleId: userActionA.cycleId,
    actionId: userActionA.id,
    sessionId: userActionA.sessionId,
    status: 'observed',
    description: 'the boundary was understood',
    occurredAt: usedAt,
    delayed: false,
  } as const
  const userOutcomeB = {
    ...userOutcomeA,
    id: createOutcomeId('derived-person-outcome-b'),
    cycleId: userActionB.cycleId,
    actionId: userActionB.id,
    sessionId: userActionB.sessionId,
    description: 'the boundary remained understood',
    occurredAt: consolidatedAt,
    delayed: true,
  } as const
  const rinOutcomeA = {
    id: createOutcomeId('derived-self-outcome-a'),
    cycleId: rinActionA.cycleId,
    actionId: rinActionA.id,
    sessionId: rinActionA.sessionId,
    status: 'observed',
    description: 'scope stayed explicit',
    occurredAt: usedAt,
    delayed: false,
  } as const
  const rinOutcomeB = {
    ...rinOutcomeA,
    id: createOutcomeId('derived-self-outcome-b'),
    cycleId: rinActionB.cycleId,
    actionId: rinActionB.id,
    sessionId: rinActionB.sessionId,
    description: 'scope stayed explicit again',
    occurredAt: consolidatedAt,
    delayed: true,
  } as const
  const prediction = {
    id: createMemoryId('derived-prospect-prediction'),
    cycleId: createWorkspaceCycleId('derived-prospect-cycle'),
    statement: 'the next exchange preserves the boundary',
    sourceMemoryIds: [first.id],
    expectedOutcome: 'the boundary remains understood',
    epistemic: 'hypothesized',
    createdAt: usedAt,
  } as const
  const input = {
    scenes: [first, second],
    links: [],
    actions: [userActionA, userActionB, rinActionA, rinActionB],
    outcomes: [userOutcomeA, userOutcomeB, rinOutcomeA, rinOutcomeB],
    predictions: [prediction],
    at: '2026-08-28T02:00:00.000Z',
  }
  const candidates = deriveMemoryRepresentationCandidates(input)
  expect(candidates.map(candidate => candidate.memory.form).sort()).toEqual([
    'person-model',
    'prospect',
    'relationship-model',
    'self-model',
  ])
  for (const candidate of candidates) {
    expect(candidate.memory.state.persistence).toBe('transient')
    expect(candidate.memory.state.integration).toBe('raw')
    expect(candidate.memory.state.influence).toBe('blocked')
  }
  const person = candidates.find(candidate => candidate.memory.form === 'person-model')
  const relationship = candidates.find(candidate => candidate.memory.form === 'relationship-model')
  const prospect = candidates.find(candidate => candidate.memory.form === 'prospect')
  expect(person?.sourceSceneIds).toEqual([first.id, second.id])
  expect(person?.memory.data.subject).toBe(user)
  expect(person?.memory.data.observedPatterns).toEqual(['confirmed the boundary'])
  expect(relationship?.sourceSceneIds).toEqual([first.id, second.id])
  expect(relationship?.memory.data.sharedMemoryIds).toEqual([first.id, second.id])
  expect(relationship?.memory.data.distance).toBe(0.5)
  expect(prospect?.sourceSceneIds).toEqual([first.id])
  expect(prospect?.memory.data.premise).toBe(prediction.statement)
  expect(prospect?.memory.data.possibleOutcomes).toEqual([prediction.expectedOutcome])
  const formed = formMemoryRepresentations({ ...input, candidates })
  expect(formed.find(candidate => candidate.memory.form === 'self-model')?.stable).toBe(true)
  expect(formed.find(candidate => candidate.memory.form === 'person-model')?.stable).toBe(true)
  expect(formed.find(candidate => candidate.memory.form === 'relationship-model')?.stable).toBe(true)
  expect(formed.find(candidate => candidate.memory.form === 'prospect')?.stable).toBe(false)
})
test('learns disposition feedback as a gated candidate and requires independent session outcomes for semantic change', () => {
  const disposition = createMemory({
    id: createMemoryId('learning-disposition'), form: 'disposition',
    data: { triggeringContexts: ['ambiguous request'], intendedGoal: createGoalId('learning-goal'), actionPattern: ['ask before acting'], expectedOutcomes: ['shared understanding'], observedOutcomes: [], applicabilityConditions: ['high uncertainty'], failureModes: [], utilityByGoal: [] },
    state: { persistence: 'durable', activation: 'active', integration: 'integrated', epistemic: 'inferred', influence: 'permitted' },
    dynamics: { activation: 0.7, accessibility: 0.5, salience: 0.5, stability: 0.4, confidence: 0.6, integrationStrength: 0.7, novelty: 0.2, surprise: 0.1, affect: { valence: 0, arousal: 0.2, control: 0.7 }, validity: { startsAt: createdAt }, utilityByGoal: [], inhibition: 0.1, influenceSurfaces: ['action-selection'] },
    createdAt, updatedAt: usedAt,
  })
  const action = { id: createActionId('learning-action'), cycleId: createWorkspaceCycleId('learning-cycle'), workspaceHash: 'learning-hash', actor: createParticipantId('user'), description: 'ask before acting', goalIds: [], sourceMemoryIds: [], predictionIds: [], occurredAt: consolidatedAt } as const
  const outcomeA = { id: createOutcomeId('learning-outcome-a'), cycleId: action.cycleId, actionId: action.id, status: 'observed', description: 'user confirmed scope', occurredAt: consolidatedAt, delayed: false, sessionId: 'learning-session-a' } as const
  const outcomeB = { id: createOutcomeId('learning-outcome-b'), cycleId: action.cycleId, actionId: action.id, status: 'observed', description: 'user confirmed next scope', occurredAt: '2026-08-28T02:00:00.000Z', delayed: true, sessionId: 'learning-session-b' } as const
  const feedbackA = { id: createFeedbackId('learning-feedback-a'), cycleId: action.cycleId, kind: 'accept', actionId: action.id, outcomeId: outcomeA.id, taskOutcome: 0.8, actionCost: 0.2, explanation: 'user accepted result', occurredAt: consolidatedAt, delayed: false } as const
  const feedbackB = { id: createFeedbackId('learning-feedback-b'), cycleId: action.cycleId, kind: 'accept', actionId: action.id, outcomeId: outcomeB.id, taskOutcome: 0.7, actionCost: 0.2, explanation: 'delayed result was accepted', occurredAt: '2026-08-28T02:00:00.000Z', delayed: true } as const
  const first = learnDispositionFromFeedback({ disposition, action, outcomes: [outcomeA], feedback: [feedbackA], at: '2026-08-28T01:00:00.000Z', explanation: 'one result remains insufficient for a stable tendency' })
  expect(first.stable).toBe(false)
  expect(first.semanticFieldsChanged).toBe(false)
  expect(first.memory.data.actionPattern).toEqual(disposition.data.actionPattern)
  expect(first.memory.data.sampleCount).toBe(1)
  expect(first.feedbackIds).toEqual([feedbackA.id])
  expect(first.memory.dynamics.accessibility).toBeGreaterThan(disposition.dynamics.accessibility)
  expect(first.memory.data.utilityByGoal[0]?.goalId).toBe(createGoalId('learning-goal'))
  expect(first.memory.data.utilityByGoal[0]?.value).toBeCloseTo(0.73)
  expect(first.memory.dynamics.utilityByGoal[0]?.goalId).toBe(createGoalId('learning-goal'))
  expect(first.memory.dynamics.utilityByGoal[0]?.value).toBeCloseTo(0.73)
  const expensiveFeedback = { ...feedbackA, id: createFeedbackId('learning-feedback-expensive'), actionCost: 1 }
  const expensive = learnDispositionFromFeedback({ disposition, action, outcomes: [outcomeA], feedback: [expensiveFeedback], at: '2026-08-28T01:30:00.000Z', explanation: 'the same result required too much action cost' })
  expect(expensive.memory.dynamics.utilityByGoal[0]?.value).toBeCloseTo(0.45)
  expect(expensive.memory.dynamics.utilityByGoal[0]?.value).toBeLessThan(first.memory.dynamics.utilityByGoal[0]?.value ?? 1)
  expect(expensive.memory.dynamics.inhibition).toBeGreaterThan(first.memory.dynamics.inhibition)
  const second = learnDispositionFromFeedback({ disposition: first.memory, action, outcomes: [outcomeA, outcomeB], feedback: [feedbackA, feedbackB], at: '2026-08-28T03:00:00.000Z', explanation: 'independent session outcomes support the action tendency' })
  expect(second.stable).toBe(true)
  expect(second.semanticFieldsChanged).toBe(true)
  expect(second.independentOutcomeIds).toEqual([outcomeA.id, outcomeB.id])
  expect(second.memory.data.actionPattern).toContain(action.description)
  expect(second.memory.data.sampleCount).toBe(2)
  expect(second.memory.data.utilityByGoal[0]?.value).toBeCloseTo(0.68)
  expect(second.feedbackIds).toEqual([feedbackB.id])
  expect(second.memory.dynamics.utilityByGoal[0]?.value).toBeCloseTo(0.68)
  const correctionFeedback = {
    ...feedbackA,
    id: createFeedbackId('learning-feedback-correction'),
    kind: 'accept' as const,
    taskOutcome: 0.1,
    factualCorrection: 'acting without confirmation crossed the requested boundary',
  } as const
  const corrected = learnDispositionFromFeedback({
    disposition: second.memory, action, outcomes: [outcomeA, outcomeB], feedback: [feedbackA, feedbackB, correctionFeedback],
    at: '2026-08-28T05:00:00.000Z', explanation: 'stable outcomes now carry the explicit correction into failure modes',
  })
  expect(corrected.memory.data.failureModes).toContain('acting without confirmation crossed the requested boundary')
  expect(() => learnDispositionFromFeedback({ disposition: second.memory, action, outcomes: [outcomeA, outcomeB], feedback: [feedbackA, feedbackB], at: '2026-08-28T04:00:00.000Z', explanation: 'replaying the same chain must be a no-op' })).toThrow('no new outcome or feedback')
})


test('rebuilds the skill projection deterministically from one disposition version', () => {
  const disposition = candidateMemory('skill-projection-disposition', 'disposition', {
    triggeringContexts: ['uncertain scope'],
    intendedGoal: createGoalId('skill-projection-goal'),
    actionPattern: ['ask before acting'],
    expectedOutcomes: ['shared scope'],
    observedOutcomes: ['scope confirmed'],
    applicabilityConditions: ['high uncertainty'],
    failureModes: ['acting without clarification'],
    utilityByGoal: [],
  })
  expect(() => projectDispositionToSkill(disposition)).toThrow('skill source must be durable')
  const approved = createMemory({
    ...disposition,
    state: {
      persistence: 'durable',
      activation: 'active',
      integration: 'integrated',
      epistemic: 'inferred',
      influence: 'permitted',
    },
    dynamics: { ...disposition.dynamics, influenceSurfaces: ['action-selection'] },
  })
  const first = projectDispositionToSkill(approved)
  const second = projectDispositionToSkill(approved)
  expect(first).toEqual(second)
  expect(first.name).toBe('rin-skill-projection-disposition')
  expect(first.markdown).toContain('source_memory_id: skill-projection-disposition')
  expect(first.markdown).toContain('## Action pattern')
  expect(first.markdown).toContain('- ask before acting')
  const revised = projectDispositionToSkill({ ...approved, updatedAt: consolidatedAt })
  expect(revised.sourceVersion).toBe(consolidatedAt)
  expect(revised.markdown).not.toBe(first.markdown)
})
test('derives explicit relationship feedback into a blocked relationship candidate', () => {
  const user = createParticipantId('relationship-user')
  const rin = createParticipantId('relationship-rin')
  const firstBase = scene('relationship-feedback-a')
  const first = createMemory({
    ...firstBase,
    data: {
      ...firstBase.data,
      participants: [user, rin],
      actions: [{ actor: user, description: 'shared boundary exchange' }],
    },
  })
  const secondBase = scene('relationship-feedback-b')
  const second = createMemory({
    ...secondBase,
    data: {
      ...secondBase.data,
      participants: [user, rin],
      actions: [{ actor: user, description: 'second shared boundary exchange' }],
    },
  })
  const action = {
    id: createActionId('relationship-feedback-action'),
    cycleId: createWorkspaceCycleId('relationship-feedback-cycle'),
    workspaceHash: 'relationship-feedback-workspace',
    actor: rin,
    description: 'act within the explicit scope',
    goalIds: [],
    sourceMemoryIds: [first.id],
    predictionIds: [],
    occurredAt: usedAt,
    sessionId: 'relationship-feedback-session',
  } as const
  const feedback = {
    id: createFeedbackId('relationship-feedback-vector'),
    cycleId: action.cycleId,
    kind: 'boundary',
    actionId: action.id,
    sceneId: first.id,
    taskOutcome: -0.4,
    actionCost: 0.2,
    relationshipConsequence: -0.7,
    boundaryRespect: 'crossed',
    explanation: 'the user indicated the agreed scope',
    occurredAt: consolidatedAt,
    delayed: false,
  } as const
  const candidates = deriveMemoryRepresentationCandidates({
    scenes: [first, second],
    links: [],
    actions: [action],
    feedback: [feedback],
    at: '2026-08-28T02:00:00.000Z',
  })
  const relationship = candidates.find(candidate => candidate.memory.form === 'relationship-model')
  if (relationship === undefined || relationship.memory.form !== 'relationship-model') {
    throw new Error('relationship feedback candidate is missing')
  }
  expect(relationship.memory.data.boundaries).toEqual([
    'boundary crossed: the user indicated the agreed scope',
  ])
  expect(relationship.memory.data.conflicts).toEqual([
    'relationship conflict: the user indicated the agreed scope',
  ])
  expect(relationship.independentEvidenceIds).toContain('feedback:' + feedback.id)
  expect(relationship.memory.state.persistence).toBe('transient')
  expect(relationship.memory.state.influence).toBe('blocked')
})
