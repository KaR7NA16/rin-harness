import { describe, expect, test } from 'vitest'
import {
  createActionId, createCurrentField, createEmptyCurrentField, createFeedbackId, createGoalId, createLinkId, createMemory, createMemoryId,
  createMemoryLink, createParticipantId,
  createOutcomeId, createPredictionId,
  transitionMemory,
} from '../src/model.ts'
import { evaluateRecallBehavior, MemoryRecallEngine, renderMemoryWorkspace, toMemoryWorkspaceDto } from '../src/recall.ts'
import type { MemoryMaterializedState } from '../src/store.ts'
import type { MemoryLink, MemoryState, RinMemory } from '../src/model.ts'

const user = createParticipantId('user')
const rin = createParticipantId('rin')
const goal = createGoalId('continuity')
const baseState: MemoryState = { persistence: 'durable', activation: 'active', integration: 'integrated', epistemic: 'observed', influence: 'permitted' }

function memory(id: string, text: string, epistemic: MemoryState['epistemic'] = 'observed', confidence = epistemic === 'contested' ? 0.35 : 0.9): RinMemory {
  const state = { ...baseState, epistemic, influence: epistemic === 'hypothesized' ? 'restricted' : 'permitted' }
  return createMemory({
    id: createMemoryId(id), form: 'scene', state,
    data: {
      participants: [user, rin], environment: 'workspace', goals: [goal],
      observations: [text], interpretations: ['continuity matters'],
      actions: [{ actor: user, description: 'continued work' }],
      affect: { valence: 0.2, arousal: 0.4, control: 0.7 },
      outcomes: [{ description: 'work continued', status: 'observed' }],
      predictionErrors: [],
    },
    dynamics: {
      activation: 0.8, accessibility: 0.8, salience: 0.7, stability: 0.7,
      confidence, integrationStrength: 0.8,
      novelty: 0.2, surprise: 0.2, affect: { valence: 0.2, arousal: 0.4, control: 0.7 },
      validity: { startsAt: '2026-01-01T00:00:00.000Z' }, utilityByGoal: [{ goalId: goal, value: 0.7 }],
      inhibition: 0.1, influenceSurfaces: ['model-input'],
    },
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  })
}

function openLoop(id: string, relatedMemoryId: RinMemory['id']): RinMemory {
  return createMemory({
    id: createMemoryId(id), form: 'open-loop',
    data: {
      goal,
      description: 'the plan remains open',
      relatedMemoryIds: [relatedMemoryId],
      status: 'open',
    },
    state: baseState,
    dynamics: {
      activation: 0.9, accessibility: 0.9, salience: 0.8, stability: 0.4,
      confidence: 0.9, integrationStrength: 0.5, novelty: 0.4, surprise: 0.3,
      affect: { valence: 0.1, arousal: 0.5, control: 0.5 },
      validity: { startsAt: '2026-01-01T00:00:00.000Z' },
      utilityByGoal: [{ goalId: goal, value: 0.9 }],
      inhibition: 0.05, influenceSurfaces: ['model-input'],
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })
}

function link(id: string, from: RinMemory, relation: 'supports' | 'contradicts', to: RinMemory, validity: MemoryLink['validity'] = { startsAt: '2026-01-01T00:00:00.000Z' }) {
  return createMemoryLink({
    id: createLinkId(id), from: from.id, relation, to: to.id,
    fromVersion: from.updatedAt, toVersion: to.updatedAt, strength: 0.9,
    validity,
    state: relation === 'contradicts' ? 'contested' : 'active',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  })
}

function state(memories: RinMemory[], links: ReturnType<typeof link>[] = []): MemoryMaterializedState {
  const anchor = memories[0]
  if (!anchor) throw new Error('anchor required')
  return {
    version: 3, eventCount: 3,
    currentField: createCurrentField({
      ownerId: 'rin', version: 3, updatedAt: '2026-01-01T00:00:03.000Z',
      sceneId: anchor.id, sceneVersion: anchor.updatedAt, sceneStatus: 'open',
      participants: [user, rin], goals: [goal], affect: { valence: 0.2, arousal: 0.4, control: 0.7 },
      predictions: [], predictionErrors: [], activeOpenLoops: [], candidateActions: ['continue'],
      activeMemoryCoalition: [anchor.id], uncertainty: ['next outcome is not observed'],
    }), memories, links, erasedMemoryIds: [], eraseAuthorizations: [], appliedTransactionIds: [],
  }
}

describe('Wave 3 Rin recall dynamics', () => {
  test('typed links recall a neighbor without a lexical hit', async () => {
    const anchor = memory('anchor', 'the user continued memory work')
    const neighbor = memory('neighbor', 'the linked structure explains continuity')
    const result = await new MemoryRecallEngine().recall(state([anchor, neighbor], [link('support', anchor, 'supports', neighbor)]), { cycleId: 'typed', query: 'unmatched-cue' })
    expect(result.trace.sources.find(source => source.kind === 'typed-link')?.candidateIds).toContain(neighbor.id)
    expect(result.workspace.items.map(item => item.id)).toContain(neighbor.id)
    expect(result.workspace.currentField.candidateActions).toEqual(['continue'])
    expect(renderMemoryWorkspace(result.workspace)).toContain('candidate actions: continue')
    expect(toMemoryWorkspaceDto(result.workspace).currentField.candidateActions).toEqual(['continue'])
  })

  test('does not traverse an active link whose endpoint version is stale', async () => {
    const anchor = memory('stale-anchor', 'the current anchor version')
    const neighbor = memory('stale-neighbor', 'the old linked structure')
    const updatedAnchor = createMemory({ ...anchor, updatedAt: '2026-01-02T00:00:00.000Z' })
    const staleLink = link('stale-support', anchor, 'supports', neighbor)
    const result = await new MemoryRecallEngine().recall(
      state([updatedAnchor, neighbor], [staleLink]),
      { cycleId: 'stale-link', query: 'unmatched-cue' },
    )
    expect(result.trace.sources.find(source => source.kind === 'typed-link')?.candidateIds ?? [])
      .not.toContain(neighbor.id)
    expect(result.workspace.links).toEqual([])
  })

  test('does not traverse an expired active current-version link', async () => {
    const anchor = memory('expired-anchor', 'the current anchor version')
    const neighbor = memory('expired-neighbor', 'the expired linked structure')
    const expiredLink = link(
      'expired-support',
      anchor,
      'supports',
      neighbor,
      { startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2026-01-01T00:00:02.000Z' },
    )
    const result = await new MemoryRecallEngine().recall(
      state([anchor, neighbor], [expiredLink]),
      { cycleId: 'expired-link', query: 'unmatched-cue' },
    )
    expect(result.trace.sources.find(source => source.kind === 'typed-link')?.candidateIds ?? [])
      .not.toContain(neighbor.id)
    expect(result.workspace.links).toEqual([])
  })

  test('excludes an expired representation from current recall but keeps explicit history access', async () => {
    const anchor = memory('expired-memory-anchor', 'the current anchor version')
    const expiredBase = memory('expired-representation', 'the expired representation')
    const expired = createMemory({
      ...expiredBase,
      dynamics: {
        ...expiredBase.dynamics,
        validity: { startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2026-01-01T00:00:02.000Z' },
      },
    })
    const engine = new MemoryRecallEngine()
    const current = await engine.recall(state([anchor, expired]), {
      cycleId: 'expired-memory-current',
      query: 'expired representation',
    })
    expect(current.trace.candidates.map(candidate => candidate.id)).not.toContain(expired.id)
    expect(current.workspace.items.map(item => item.id)).not.toContain(expired.id)
    const historical = await engine.recall(state([anchor, expired]), {
      cycleId: 'expired-memory-history',
      query: { text: 'expired representation', mode: 'history' },
    })
    expect(historical.workspace.items.map(item => item.id)).toContain(expired.id)
  })

  test('keeps a contextual person model out of an unrelated current scene but allows history access', async () => {
    const anchor = memory('context-person-anchor', 'the current workspace scene')
    const personBase = memory('context-person-base', 'the person model base')
    const person = createMemory({
      ...personBase,
      id: createMemoryId('context-person-model'),
      form: 'person-model',
      data: {
        subject: user,
        claims: ['prefers a calm exchange'],
        observedPatterns: ['responds carefully'],
        currentState: ['calm'],
        lastObservedAt: '2026-01-01T00:00:00.000Z',
        contextConditions: ['quiet room'],
      },
    })
    const links = [link('context-person-link', anchor, 'supports', person)]
    const engine = new MemoryRecallEngine()
    const current = await engine.recall(state([anchor, person], links), {
      cycleId: 'context-person-current',
      query: 'calm exchange',
    })
    expect(current.trace.candidates.map(candidate => candidate.id)).not.toContain(person.id)
    expect(current.workspace.items.map(item => item.id)).not.toContain(person.id)
    const historical = await engine.recall(state([anchor, person], links), {
      cycleId: 'context-person-history',
      query: { text: 'calm exchange', mode: 'history' },
    })
    expect(historical.workspace.items.map(item => item.id)).toContain(person.id)
  })

  test('blocked current-field representations cannot seed typed-link recall', async () => {
    const anchor = memory('blocked-seed-anchor', 'the active current scene')
    const blocked = createMemory({
      ...anchor,
      id: createMemoryId('blocked-seed-representation'),
      form: 'self-model',
      data: {
        values: [],
        abilities: [],
        tendencies: ['blocked hypothesis'],
        historicalChanges: [],
      },
      state: {
        persistence: 'transient',
        activation: 'active',
        integration: 'raw',
        epistemic: 'inferred',
        influence: 'blocked',
      },
      dynamics: {
        ...anchor.dynamics,
        activation: 0.1,
        accessibility: 0.1,
        salience: 0.1,
        surprise: 0.1,
        utilityByGoal: [],
        influenceSurfaces: [],
      },
    })
    const target = createMemory({
      ...anchor,
      id: createMemoryId('blocked-seed-target'),
      data: {
        ...anchor.data,
        participants: [rin],
        environment: 'unrelated environment',
        goals: [],
        observations: ['isolated target'],
        interpretations: [],
        actions: [],
        outcomes: [],
      },
      dynamics: {
        ...anchor.dynamics,
        activation: 0.1,
        accessibility: 0.1,
        salience: 0.1,
        surprise: 0.1,
        utilityByGoal: [],
      },
    })
    const base = state([anchor, blocked, target], [link('blocked-seed-link', blocked, 'supports', target)])
    const seededState: MemoryMaterializedState = {
      ...base,
      currentField: {
        ...base.currentField,
        activeMemoryCoalition: [anchor.id, blocked.id],
      },
    }
    const result = await new MemoryRecallEngine().recall(
      seededState,
      { cycleId: 'blocked-seed', query: 'no matching cue' },
    )
    expect(result.trace.sources.find(source => source.kind === 'typed-link')?.candidateIds ?? [])
      .not.toContain(target.id)
    expect(result.workspace.items.map(item => item.id)).not.toContain(target.id)
  })

  test('trace exposes all score components', async () => {
    const anchor = memory('score', 'score trace cue')
    const result = await new MemoryRecallEngine().recall(state([anchor]), { cycleId: 'score', query: 'score trace' })
    const score = result.trace.candidates.find(candidate => candidate.id === anchor.id)?.score
    expect(Object.keys(score ?? {}).sort()).toEqual([
      'accessibility', 'contextualFit', 'contradictionCost', 'cueFit', 'inhibition',
      'invalidityPenalty', 'openLoopPressure', 'predictionRelevance', 'relationRelevance',
      'salience', 'total', 'uncertaintyPenalty', 'utility',
    ])
  })
  test('scopes recall utility to the active goal', async () => {
    const unrelatedGoal = createGoalId('unrelated-recall-goal')
    const base = memory('goal-scoped-utility', 'goal-scoped utility record')
    const scoped = createMemory({
      ...base,
      dynamics: {
        ...base.dynamics,
        utilityByGoal: [{ goalId: unrelatedGoal, value: 1 }],
      },
    })
    const current = await new MemoryRecallEngine().recall(
      state([scoped]),
      { cycleId: 'goal-scoped-current', query: 'goal-scoped utility' },
    )
    const currentScore = current.trace.candidates.find(candidate => candidate.id === scoped.id)?.score
    expect(currentScore?.utility).toBe(0)
    const explicit = await new MemoryRecallEngine().recall(
      state([scoped]),
      { cycleId: 'goal-scoped-explicit', query: { goalIds: [unrelatedGoal] } },
    )
    const explicitScore = explicit.trace.candidates.find(candidate => candidate.id === scoped.id)?.score
    expect(explicitScore?.utility).toBe(1)
  })


  test('participant and goal cues generate contextual candidates without a text cue', async () => {
    const anchor = memory('context-anchor', 'the active scene')
    const contextual = memory('context-only', 'a sentence with no matching lexical cue')
    const result = await new MemoryRecallEngine().recall(state([anchor, contextual]), {
      cycleId: 'contextual',
      query: { participantIds: [user], goalIds: [goal] },
    })
    expect(result.trace.sources.find(source => source.kind === 'contextual')?.candidateIds).toContain(contextual.id)
    expect(result.trace.candidates.find(candidate => candidate.id === contextual.id)?.score.contextualFit).toBeGreaterThan(0)
    expect(result.workspace.items.map(item => item.id)).toContain(contextual.id)
  })
  test('duplicate summaries are suppressed while a linked conflict remains', async () => {
    const original = memory('original', 'the plan is still active')
    const duplicate = memory('duplicate', 'the plan is still active', 'contested')
    const conflict = memory('conflict', 'the plan was canceled', 'contested')
    const result = await new MemoryRecallEngine().recall(state([original, duplicate, conflict], [link('conflict-link', original, 'contradicts', conflict)]), { cycleId: 'conflict', query: 'plan', budget: { maxItems: 4 } })
    expect(result.trace.suppressed.some(item => item.id === duplicate.id && item.keptId === original.id)).toBe(true)
    expect(result.workspace.items.map(item => item.id)).toEqual(expect.arrayContaining([original.id, conflict.id]))
    expect(result.workspace.items.find(item => item.id === conflict.id)?.epistemic).toBe('contested')
  })


  test('retains same-text memories when a typed conflict connects the duplicate group', async () => {
    const anchor = memory('same-text-anchor', 'an unrelated current scene')
    const left = memory('same-text-left', 'the plan remains active')
    const right = memory('same-text-right', 'the plan remains active', 'contested')
    const result = await new MemoryRecallEngine().recall(state([anchor, left, right], [link('same-text-conflict', left, 'contradicts', right)]), { cycleId: 'same-text-conflict', query: 'plan' })
    expect(result.trace.suppressed.some(item => item.id === right.id && item.keptId === left.id)).toBe(false)
    expect(result.workspace.items.map(item => item.id)).toEqual(expect.arrayContaining([left.id, right.id]))
    expect(result.workspace.links.some(item => item.relation === 'contradicts')).toBe(true)
  })
  test('indexed evidence enters the same typed workspace', async () => {
    const anchor = memory('evidence-anchor', 'session continuity')
    const engine = new MemoryRecallEngine()
    engine.registerSource({ id: 'session-search', kind: 'session-search', query: () => [{
      id: 'session-search:old', source: 'session-search', content: 'An earlier session established continuity.',
      confidence: 0.65, reference: { memoryId: anchor.id },
    }] })
    const result = await engine.recall(state([anchor]), { cycleId: 'evidence', query: 'continuity' })
    expect(result.workspace.items.find(item => item.id === 'session-search:old')?.kind).toBe('indexed-evidence')
    expect(result.workspace.links.some(item => item.relation === 'evidence-for')).toBe(true)
    expect(renderMemoryWorkspace(result.workspace)).toContain('epistemic=observed')
    const dto = toMemoryWorkspaceDto(result.workspace)
    expect(dto.items.find(item => item.id === 'session-search:old')?.content).toContain('earlier session')
  })


  test('does not select an oversized candidate beyond the hard token budget', async () => {
    const anchor = memory('budget-anchor', 'the budget anchor')
    const engine = new MemoryRecallEngine()
    engine.registerSource({ id: 'oversized-source', kind: 'external', query: () => [{
      id: 'external:oversized', source: 'external', content: 'oversized '.repeat(300), confidence: 1, scoreHint: 1,
    }] })
    const result = await engine.recall(state([anchor]), {
      cycleId: 'hard-budget', query: 'budget', budget: { maxItems: 8, maxTokens: 128 },
    })
    expect(result.workspace.budget.usedTokens).toBeLessThanOrEqual(128)
    expect(result.workspace.items.map(item => item.id)).not.toContain('external:oversized')
    expect(result.trace.suppressed.some(item => item.id === 'external:oversized' && item.reason === 'candidate exceeds the hard token budget')).toBe(true)
  })
  test('keeps support, conflict, open-loop, and low-confidence critical items in one coalition', async () => {
    const anchor = memory('golden-anchor', 'the plan is active')
    const support = memory('golden-support', 'the plan is supported by prior work')
    const conflict = memory('golden-conflict', 'the plan was canceled', 'contested')
    const uncertain = memory('golden-uncertain', 'the plan may need a safer route', 'hypothesized', 0.2)
    const loop = openLoop('golden-open-loop', anchor.id)
    const links = [
      link('golden-support-link', anchor, 'supports', support),
      link('golden-conflict-link', anchor, 'contradicts', conflict),
    ]
    const base = state([anchor, support, conflict, uncertain, loop], links)
    const goldenState: MemoryMaterializedState = {
      ...base,
      currentField: createCurrentField({
        ...base.currentField,
        activeOpenLoops: [loop.id],
        activeMemoryCoalition: [anchor.id],
      }),
    }
    const result = await new MemoryRecallEngine().recall(goldenState, {
      cycleId: 'golden-coalition',
      query: { text: 'plan', participantIds: [user], goalIds: [goal] },
      budget: { maxItems: 8, maxTokens: 1500 },
    })
    const roles = new Set(result.workspace.items.map(item => item.role))
    expect([...roles]).toEqual(expect.arrayContaining(['support', 'conflict', 'open-loop', 'critical']))
    const critical = result.workspace.items.find(item => item.role === 'critical')
    expect(critical?.epistemic).toBe('hypothesized')
    expect(critical?.confidence).toBe(0.2)
    expect(critical?.uncertainty).toContain('confidence=0.20')
    expect(result.workspace.links.some(item => item.relation === 'supports')).toBe(true)
    expect(result.workspace.links.some(item => item.relation === 'contradicts')).toBe(true)
    expect(result.trace.selection).toHaveLength(result.workspace.items.length)
    const criticalDecision = result.trace.selection.find(item => item.id === critical?.id)
    expect(criticalDecision?.finalValue).toBeCloseTo(
      (criticalDecision?.baseScore ?? 0) + (criticalDecision?.priorityBoost ?? 0)
        + (criticalDecision?.relationBoost ?? 0) + (criticalDecision?.anchorBoost ?? 0),
    )
    expect(result.workspace.items.some(item => item.selectionReasons.some(reason => reason.startsWith('grounding/form priority')))).toBe(true)
  })

  test('keeps archived memories out of current recall but exposes explicit history only', async () => {
    const active = memory('history-active', 'the current continuity record')
    const archived = transitionMemory(
      memory('history-archived', 'the archived history record'),
      { type: 'archive', at: '2026-01-02T00:00:00.000Z' },
    )
    const engine = new MemoryRecallEngine()
    const current = await engine.recall(state([active, archived]), {
      cycleId: 'history-current',
      query: 'archived history record',
    })
    expect(current.workspace.items.map(item => item.id)).not.toContain(archived.id)
    const historical = await engine.recall(state([active, archived]), {
      cycleId: 'history-explicit',
      query: { text: 'archived history record', mode: 'history' },
    })
    const item = historical.workspace.items.find(candidate => candidate.id === archived.id)
    expect(item?.influence).toBe('blocked')
    expect(item?.uncertainty).toContain('historical archive; not behaviorally active')
    expect(historical.trace.query.mode).toBe('history')
  })
test('behavior records alter the next recall coalition while preserving memory truth', async () => {
  const anchor = memory('behavior-anchor', 'the action context remains explicit')
  const actionId = createActionId('behavior-recall-action')
  const outcomeId = createOutcomeId('behavior-recall-outcome')
  const behaviorState: MemoryMaterializedState = {
    ...state([anchor]),
    actions: [{
      id: actionId, cycleId: 'behavior-recall-cycle', workspaceHash: 'behavior-recall-workspace',
      actor: rin, description: 'act within the explicit context', goalIds: [],
      sourceMemoryIds: [anchor.id], predictionIds: [], occurredAt: '2026-01-01T00:00:01.000Z',
    }],
    outcomes: [{
      id: outcomeId, cycleId: 'behavior-recall-cycle', actionId, status: 'failed',
      description: 'the action crossed the context boundary', occurredAt: '2026-01-01T00:00:02.000Z', delayed: true,
    }],
    feedback: [{
      id: createFeedbackId('behavior-recall-feedback'), cycleId: 'behavior-recall-cycle', kind: 'boundary',
      actionId, outcomeId, taskOutcome: -0.6, actionCost: 0.4, boundaryRespect: 'crossed',
      explanation: 'the boundary was not respected', occurredAt: '2026-01-01T00:00:03.000Z', delayed: true,
    }],
  }
  const result = await new MemoryRecallEngine().recall(behaviorState, { cycleId: 'behavior-next-recall', query: 'action context' })
  const candidate = result.trace.candidates.find(item => item.id === anchor.id)
  expect(result.trace.sources.find(source => source.kind === 'behavior')?.candidateIds).toContain(anchor.id)
  expect(candidate?.score.inhibition).toBeGreaterThan(0.2)
  expect(candidate?.reasons).toEqual(expect.arrayContaining(['linked action', 'delayed outcome', 'behavior feedback', 'boundary/rejection inhibition']))
  expect(candidate?.memory?.data).toEqual(anchor.data)
})

  test('routes feedback dimensions into recall-specific pressures', async () => {
    const anchor = memory('feedback-dimensions-anchor', 'the action context remains explicit')
    const cycleId = 'feedback-dimensions-cycle'
    const predictionId = createPredictionId('feedback-dimensions-prediction')
    const actionId = createActionId('feedback-dimensions-action')
    const prediction = {
      id: predictionId,
      cycleId,
      statement: 'the action will preserve the requested scope',
      sourceMemoryIds: [anchor.id],
      expectedOutcome: 'the requested scope is preserved',
      epistemic: 'hypothesized' as const,
      createdAt: '2026-01-01T00:00:01.000Z',
    }
    const action = {
      id: actionId,
      cycleId,
      workspaceHash: 'feedback-dimensions-workspace',
      actor: rin,
      description: 'act within the explicit context',
      goalIds: [],
      sourceMemoryIds: [anchor.id],
      predictionIds: [predictionId],
      occurredAt: '2026-01-01T00:00:02.000Z',
    }
    const base = state([anchor])
    const beforeState: MemoryMaterializedState = { ...base, predictions: [prediction], actions: [action] }
    const afterState: MemoryMaterializedState = {
      ...beforeState,
      feedback: [{
        id: createFeedbackId('feedback-dimensions-feedback'),
        cycleId,
        kind: 'correct',
        actionId,
        predictionId,
        taskOutcome: -0.8,
        actionCost: 0.4,
        factualCorrection: 'the result exceeded the requested scope',
        predictionAccuracy: -0.9,
        userResponse: 'corrected',
        relationshipConsequence: -0.7,
        boundaryRespect: 'crossed',
        autonomyEffect: -0.6,
        safetyEffect: -0.8,
        delayedConsequence: 'the correction remained relevant in the next session',
        explanation: 'the result crossed the requested scope',
        occurredAt: '2026-01-01T00:00:03.000Z',
        delayed: true,
      }],
    }
    const engine = new MemoryRecallEngine()
    const before = await engine.recall(beforeState, { cycleId: 'feedback-dimensions-before', query: 'action context' })
    const after = await engine.recall(afterState, { cycleId: 'feedback-dimensions-after', query: 'action context' })
    const beforeCandidate = before.trace.candidates.find(item => item.id === anchor.id)
    const afterCandidate = after.trace.candidates.find(item => item.id === anchor.id)
    expect(afterCandidate?.score.inhibition).toBeGreaterThan(beforeCandidate?.score.inhibition ?? 0)
    expect(afterCandidate?.score.inhibition).toBeCloseTo(0.592, 6)
    expect(afterCandidate?.score.contradictionCost).toBeGreaterThan(beforeCandidate?.score.contradictionCost ?? 0)
    expect(afterCandidate?.score.uncertaintyPenalty).toBeGreaterThan(beforeCandidate?.score.uncertaintyPenalty ?? 0)
    expect(afterCandidate?.score.predictionRelevance).toBeCloseTo(0.714, 6)
    expect(afterCandidate?.score.total).toBeLessThan(beforeCandidate?.score.total ?? 1)
    expect(afterCandidate?.reasons).toEqual(expect.arrayContaining([
      'correction pressure',
      'prediction mismatch pressure',
      'relationship/boundary pressure',
      'autonomy/safety pressure',
      'delayed feedback',
    ]))
  })

  test('joint recall-behavior evaluation detects a feedback-driven choice change', async () => {
    const anchor = memory('joint-anchor', 'the action context remains explicit')
    const fallbackBase = memory('joint-fallback', 'the action context has a neutral fallback')
    const fallback = createMemory({
      ...fallbackBase, dynamics: { ...fallbackBase.dynamics, accessibility: 1, salience: 1, surprise: 1, inhibition: 0, utilityByGoal: [{ goalId: goal, value: 1 }] },
    })
    const beforeBase = state([anchor, fallback])
    const beforeState: MemoryMaterializedState = {
      ...beforeBase,
      currentField: createCurrentField({
        ...beforeBase.currentField,
        candidateActions: ['reuse the explicit context', 'use the neutral fallback'],
        candidateActionSources: [
          {
            action: 'reuse the explicit context',
            sourceMemoryIds: [anchor.id],
            utility: 0.8,
            inhibition: 0.1,
            selectionValue: 0.8,
            reasons: ['pre-feedback candidate'],
          },
          {
            action: 'use the neutral fallback',
            sourceMemoryIds: [fallback.id],
            utility: 0.4,
            inhibition: 0.1,
            selectionValue: 0.4,
            reasons: ['pre-feedback alternative'],
          },
        ],
      }),
    }
    const actionId = createActionId('joint-action')
    const outcomeId = createOutcomeId('joint-outcome')
    const afterState: MemoryMaterializedState = {
      ...beforeState,
      currentField: createCurrentField({
        ...beforeState.currentField,
        candidateActions: ['reuse the explicit context', 'use the neutral fallback'],
        candidateActionSources: [
          {
            action: 'reuse the explicit context',
            sourceMemoryIds: [anchor.id],
            utility: 0.1,
            inhibition: 0.8,
            selectionValue: 0.1,
            reasons: ['post-feedback inhibition'],
          },
          {
            action: 'use the neutral fallback',
            sourceMemoryIds: [fallback.id],
            utility: 0.4,
            inhibition: 0.1,
            selectionValue: 0.6,
            reasons: ['post-feedback alternative'],
          },
        ],
      }),
      actions: [{
        id: actionId, cycleId: 'joint-cycle', sessionId: 'joint-session-a', workspaceHash: 'joint-workspace',
        actor: rin, description: 'act within the explicit context', goalIds: [],
        sourceMemoryIds: [anchor.id], predictionIds: [], occurredAt: '2026-01-01T00:00:01.000Z',
      }],
      outcomes: [{
        id: outcomeId, cycleId: 'joint-cycle', actionId, status: 'failed',
        description: 'the action crossed the context boundary', occurredAt: '2026-01-01T00:00:02.000Z', delayed: true,
      }],
      feedback: [{
        id: createFeedbackId('joint-feedback'), cycleId: 'joint-cycle', kind: 'boundary',
        actionId, outcomeId, taskOutcome: -0.8, actionCost: 0.5, boundaryRespect: 'crossed',
        explanation: 'the boundary was not respected', occurredAt: '2026-01-01T00:00:03.000Z', delayed: true,
      }],
    }
    const engine = new MemoryRecallEngine()
    const before = await engine.recall(beforeState, {
      cycleId: 'joint-before',
      query: { text: 'action context', sessionId: 'joint-session-a' },
      budget: { maxItems: 4, maxTokens: 600 },
    })
    const after = await engine.recall(afterState, {
      cycleId: 'joint-after',
      query: { text: 'action context', sessionId: 'joint-session-b' },
      budget: { maxItems: 4, maxTokens: 600 },
    })
    const evaluation = evaluateRecallBehavior({
      before,
      after,
      choices: [
        { id: 'reuse-explicit-context', description: 'reuse the explicit context', sourceMemoryIds: [anchor.id] },
        { id: 'use-neutral-fallback', description: 'use the neutral fallback', sourceMemoryIds: [fallback.id] },
      ],
    })
    expect(evaluation.behaviorAffectedMemoryIds).toContain(anchor.id)
    expect(evaluation.beforeChoiceScores['reuse-explicit-context']).toBe(0.8)
    expect(evaluation.afterChoiceScores['reuse-explicit-context']).toBe(0.1)
    expect(evaluation.afterChoiceScores['use-neutral-fallback']).toBe(0.6)
    expect(evaluation.recallChanged).toBe(true)
    expect(evaluation.choiceChanged).toBe(true)
    expect(evaluation.passed).toBe(true)
  })
  test('propagates unresolved open-loop pressure and withdraws it after closure', async () => {
    const anchor = memory('open-loop-pressure-anchor', 'current anchor')
    const relatedBase = memory('open-loop-pressure-related', 'quiet related scene')
    const related = createMemory({
      ...relatedBase,
      dynamics: {
        ...relatedBase.dynamics,
        activation: 0.1,
        accessibility: 0.2,
        salience: 0.1,
        surprise: 0,
        utilityByGoal: [],
      },
    })
    const loopBase = openLoop('open-loop-pressure-loop', related.id)
    const pending = createMemory({
      ...loopBase,
      state: {
        persistence: 'transient',
        activation: 'active',
        integration: 'raw',
        epistemic: 'observed',
        influence: 'blocked',
      },
      dynamics: { ...loopBase.dynamics, influenceSurfaces: [] },
    })
    const base = state([anchor, related, pending])
    const withPendingLoop: MemoryMaterializedState = {
      ...base,
      currentField: createCurrentField({
        ...base.currentField,
        activeOpenLoops: [pending.id],
      }),
    }
    const withoutLoop = await new MemoryRecallEngine().recall(
      state([anchor, related]),
      { cycleId: 'open-loop-pressure-without', query: 'unmatched cue' },
    )
    expect(withoutLoop.workspace.items.map(item => item.id)).not.toContain(related.id)
    const recalled = await new MemoryRecallEngine().recall(withPendingLoop, {
      cycleId: 'open-loop-pressure-open',
      query: 'unmatched cue',
    })
    const relatedCandidate = recalled.trace.candidates.find(candidate => candidate.id === related.id)
    expect(relatedCandidate?.sources).toContain('dynamics')
    expect(relatedCandidate?.score.openLoopPressure).toBeGreaterThan(0)
    expect(relatedCandidate?.reasons.some(reason =>
      reason.startsWith('unresolved open-loop consequence pressure='),
    )).toBe(true)
    const resolved = createMemory({
      ...pending,
      data: {
        ...pending.data,
        status: 'resolved',
        resolution: {
          description: 'completed',
          status: 'observed',
          occurredAt: '2026-01-01T00:00:04.000Z',
        },
      },
    })
    const afterClose = await new MemoryRecallEngine().recall(
      state([anchor, related, resolved]),
      { cycleId: 'open-loop-pressure-closed', query: 'unmatched cue' },
    )
    expect(afterClose.workspace.items.map(item => item.id)).not.toContain(related.id)
  })
  test('does not treat pre-existing behavior as a new recall effect', async () => {
    const anchor = memory('pre-existing-behavior-anchor', 'the existing action context')
    const fallback = memory('pre-existing-behavior-fallback', 'the neutral alternative')
    const actionId = createActionId('pre-existing-behavior-action')
    const behaviorState: MemoryMaterializedState = {
      ...state([anchor, fallback]),
      actions: [{
        id: actionId,
        cycleId: 'pre-existing-behavior-cycle',
        sessionId: 'pre-existing-behavior-session',
        workspaceHash: 'pre-existing-behavior-workspace',
        actor: rin,
        description: 'use the existing action context',
        goalIds: [],
        sourceMemoryIds: [anchor.id],
        predictionIds: [],
        occurredAt: '2026-01-01T00:00:01.000Z',
      }],
    }
    const result = await new MemoryRecallEngine().recall(behaviorState, {
      cycleId: 'pre-existing-behavior-recall',
      query: 'action context',
    })
    const evaluation = evaluateRecallBehavior({
      before: result,
      after: result,
      choices: [
        { id: 'reuse-existing-context', description: 'reuse existing context', sourceMemoryIds: [anchor.id] },
        { id: 'use-neutral-alternative', description: 'use neutral alternative', sourceMemoryIds: [fallback.id] },
      ],
    })
    expect(evaluation.behaviorAffectedMemoryIds).toEqual([])
    expect(evaluation.recallChanged).toBe(false)
    expect(evaluation.choiceChanged).toBe(false)
    expect(evaluation.passed).toBe(false)
  })

  test('records withdrawal of a behavior-linked candidate as a recall effect', async () => {
    const anchorBase = memory('withdrawn-behavior-anchor', 'a quiet anchor')
    const anchor = createMemory({
      ...anchorBase,
      dynamics: {
        ...anchorBase.dynamics,
        activation: 0.1,
        accessibility: 0.1,
        salience: 0.1,
        surprise: 0,
        utilityByGoal: [],
        inhibition: 0,
      },
    })
    const actionId = createActionId('withdrawn-behavior-action')
    const outcomeId = createOutcomeId('withdrawn-behavior-outcome')
    const beforeState: MemoryMaterializedState = {
      ...state([anchor]),
      currentField: createEmptyCurrentField(),
      actions: [{
        id: actionId,
        cycleId: 'withdrawn-behavior-cycle',
        workspaceHash: 'withdrawn-behavior-workspace',
        actor: rin,
        description: 'use the quiet anchor',
        goalIds: [],
        sourceMemoryIds: [anchor.id],
        predictionIds: [],
        occurredAt: '2026-01-01T00:00:01.000Z',
      }],
      outcomes: [{
        id: outcomeId,
        cycleId: 'withdrawn-behavior-cycle',
        actionId,
        status: 'observed',
        description: 'the quiet anchor informed the action',
        occurredAt: '2026-01-01T00:00:02.000Z',
        delayed: false,
      }],
      feedback: [{
        id: createFeedbackId('withdrawn-behavior-feedback'),
        cycleId: 'withdrawn-behavior-cycle',
        kind: 'correct',
        actionId,
        outcomeId,
        taskOutcome: 0.7,
        actionCost: 0.2,
        userResponse: 'accepted',
        explanation: 'the anchor was used as intended',
        occurredAt: '2026-01-01T00:00:03.000Z',
        delayed: false,
      }],
    }
    const afterState: MemoryMaterializedState = {
      ...beforeState,
      actions: [],
      outcomes: [],
      feedback: [],
    }
    const engine = new MemoryRecallEngine()
    const before = await engine.recall(beforeState, { cycleId: 'withdrawn-behavior-before', query: 'unmatched cue' })
    const after = await engine.recall(afterState, { cycleId: 'withdrawn-behavior-after', query: 'unmatched cue' })
    expect(before.trace.candidates.find(candidate => candidate.id === anchor.id)?.sources).toContain('behavior')
    expect(after.trace.candidates.find(candidate => candidate.id === anchor.id)).toBeUndefined()

    const evaluation = evaluateRecallBehavior({
      before,
      after,
      choices: [
        { id: 'withdrawn-behavior-choice', description: 'use the quiet anchor', sourceMemoryIds: [anchor.id] },
        { id: 'withdrawn-neutral-choice', description: 'use a neutral fallback', sourceMemoryIds: [createMemoryId('withdrawn-neutral-source')] },
      ],
    })
    expect(evaluation.behaviorAffectedMemoryIds).toEqual([anchor.id])
    expect(evaluation.recallChanged).toBe(true)
    expect(evaluation.beforeChoiceAvailable).toBe(true)
    expect(evaluation.afterChoiceAvailable).toBe(false)
    expect(evaluation.passed).toBe(false)
  })
})
