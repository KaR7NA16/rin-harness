import { createHash } from 'node:crypto'

/**
 * Rin Wave 4 consolidation controller.
 *
 * The labile window and reconsolidation operations live in one domain surface.
 * A use trace is evidence that a representation actually participated in an
 * explanation, prediction, plan, or action; recall selection alone never opens
 * this path. The controller produces immutable results for a later atomic
 * cognition transaction and never mutates the original representation.
 *
 * @module @rin/memory
 */

import {
  createMemoryLink,
  createMemory,
  createMemoryId,
  transitionMemory,
  type EpistemicBasis,
  type EvidenceId,
  type MemoryId,
  type GoalId,
  type ActionId,
  type FeedbackId,
  type MemoryActionRecord,
  type MemoryFeedbackVector,
  type MemoryGoalUtility,
  type MemoryOutcomeRecord,
  type MemoryPredictionRecord,
  type OutcomeId,
  type ParticipantId,
  type MemoryInfluenceSurface,
  type MemoryLink,
  type RinMemory,
} from './model.ts'

export const MEMORY_CONSOLIDATION_SCHEMA_VERSION = 1 as const
export const DEFAULT_LABILE_WINDOW_MS = 24 * 60 * 60 * 1_000
const MAX_LABILE_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000

export type MemoryUseSurface = Exclude<MemoryInfluenceSurface, 'recall'>
export type MemoryUsePurpose =
  | 'answer'
  | 'prediction'
  | 'action'
  | 'planning'
  | 'relationship-expression'

export type MemoryUseTrace = Readonly<{
  id: string
  cycleId: string
  memoryId: MemoryId
  memoryVersion: string
  surface: MemoryUseSurface
  purpose: MemoryUsePurpose
  usedAt: string
}>

export type MemoryLabileWindow = Readonly<{
  memoryId: MemoryId
  memoryVersion: string
  useTraceId: string
  openedAt: string
  expiresAt: string
}>

export type MemoryConsolidationOperation =
  | 'reinforce'
  | 'revise'
  | 'split'
  | 'contest'
  | 'supersede'
  | 'reject'

export type MemoryConsolidationInput = Readonly<{
  memory: RinMemory
  labile: MemoryLabileWindow
  operation: MemoryConsolidationOperation
  basis: EpistemicBasis
  evidenceIds: readonly EvidenceId[]
  independentEvidenceIds?: readonly EvidenceId[]
  at: string
  explanation: string
  replacement?: RinMemory
  parts?: readonly RinMemory[]
}>

export type MemoryConsolidationResult = Readonly<{
  schemaVersion: typeof MEMORY_CONSOLIDATION_SCHEMA_VERSION
  operation: MemoryConsolidationOperation
  memoryId: MemoryId
  previousVersion: string
  labile: MemoryLabileWindow
  evidenceIds: readonly EvidenceId[]
  independentEvidenceIds: readonly EvidenceId[]
  resultingMemories: readonly RinMemory[]
  confidenceChanged: boolean
  explanation: string
}>

/**
 * A controller decision bound to one item from a consolidation schedule.
 *
 * The schedule identifies the exact source version and persisted use trace;
 * this decision supplies the operation and evidence that the controller has
 * accepted. The store binds both before it creates a consolidation result.
 */
export type MemoryConsolidationDecision = Readonly<{
  memoryId: MemoryId
  memoryVersion: string
  useTraceId: string
  operation: MemoryConsolidationOperation
  basis: EpistemicBasis
  evidenceIds: readonly EvidenceId[]
  independentEvidenceIds?: readonly EvidenceId[]
  at: string
  explanation: string
  replacement?: RinMemory
  parts?: readonly RinMemory[]
}>
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Validates a serialized consolidation result at the cognition protocol edge.
 *
 * Semantic checks that depend on the currently materialized source version
 * remain in the materializer; this validator only checks the result envelope
 * and the shape of every resulting representation.
 */
export function assertMemoryConsolidationResult(value: unknown): asserts value is MemoryConsolidationResult {
  if (!isRecord(value) || value.schemaVersion !== MEMORY_CONSOLIDATION_SCHEMA_VERSION) {
    throw new Error('rin memory consolidation: unsupported result schema')
  }
  assertOperation(value.operation as MemoryConsolidationOperation)
  assertText(value.memoryId, 'result.memoryId')
  assertText(value.previousVersion, 'result.previousVersion')
  assertText(value.explanation, 'result.explanation')
  if (!isRecord(value.labile)) throw new Error('rin memory consolidation: result.labile must be an object')
  assertText(value.labile.memoryId, 'result.labile.memoryId')
  assertText(value.labile.memoryVersion, 'result.labile.memoryVersion')
  assertText(value.labile.useTraceId, 'result.labile.useTraceId')
  assertTimestamp(value.labile.openedAt, 'result.labile.openedAt')
  assertTimestamp(value.labile.expiresAt, 'result.labile.expiresAt')
  if (Date.parse(value.labile.expiresAt) < Date.parse(value.labile.openedAt)) {
    throw new Error('rin memory consolidation: result.labile expires before it opens')
  }
  if (!Array.isArray(value.evidenceIds)) {
    throw new Error('rin memory consolidation: result.evidenceIds must be an array')
  }
  assertEvidenceIds(value.evidenceIds as readonly EvidenceId[], 'result.evidenceIds')
  if (!Array.isArray(value.independentEvidenceIds)) {
    throw new Error('rin memory consolidation: result.independentEvidenceIds must be an array')
  }
  assertEvidenceIds(value.independentEvidenceIds as readonly EvidenceId[], 'result.independentEvidenceIds', true)
  assertIndependentEvidence(
    value.evidenceIds as readonly EvidenceId[],
    value.independentEvidenceIds as readonly EvidenceId[],
  )
  if (!Array.isArray(value.resultingMemories) || value.resultingMemories.length === 0) {
    throw new Error('rin memory consolidation: result must contain resulting memories')
  }
  const resultingMemories = value.resultingMemories.map((entry, index) => {
    if (!isRecord(entry)) throw new Error('rin memory consolidation: result memory ' + index + ' must be an object')
    return createMemory(entry as RinMemory)
  })
  if (resultingMemories[0]?.id !== value.memoryId) {
    throw new Error('rin memory consolidation: first resulting memory must preserve source identity')
  }
  if (typeof value.confidenceChanged !== 'boolean') {
    throw new Error('rin memory consolidation: result.confidenceChanged must be boolean')
  }
}


function assertText(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('rin memory consolidation: ' + label + ' must be non-empty')
  }
}

function assertTimestamp(value: unknown, label: string): asserts value is string {
  assertText(value, label)
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error('rin memory consolidation: ' + label + ' must be a valid timestamp')
  }
}

function assertEvidenceIds(value: readonly EvidenceId[], label: string, allowEmpty = false): void {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new Error('rin memory consolidation: ' + label + ' must not be empty')
  }
  const ids = value.map(String)
  if (ids.some(id => id.trim() === '') || new Set(ids).size !== ids.length) {
    throw new Error('rin memory consolidation: ' + label + ' must contain unique ids')
  }
}

function assertBasis(value: EpistemicBasis): void {
  if (![
    'direct-observation',
    'user-report',
    'new-evidence',
    'model-inference',
    'model-proposal',
    'user-correction',
  ].includes(value)) {
    throw new Error('rin memory consolidation: invalid epistemic basis')
  }
}

function assertOperation(value: MemoryConsolidationOperation): void {
  if (![
    'reinforce',
    'revise',
    'split',
    'contest',
    'supersede',
    'reject',
  ].includes(value)) {
    throw new Error('rin memory consolidation: invalid operation')
  }
}

function assertUseSurface(value: MemoryUseSurface): void {
  if (![
    'model-input',
    'action-selection',
    'relationship-expression',
    'planning',
  ].includes(value)) {
    throw new Error('rin memory consolidation: invalid use surface')
  }
}

function assertUsePurpose(value: MemoryUsePurpose): void {
  if (![
    'answer',
    'prediction',
    'action',
    'planning',
    'relationship-expression',
  ].includes(value)) {
    throw new Error('rin memory consolidation: invalid use purpose')
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return value
}
export type MemoryFormationCandidateInput = Readonly<{
  memory: RinMemory
  sourceSceneIds: readonly MemoryId[]
  independentEvidenceIds?: readonly string[]
}>

export type MemoryRepresentationFormationInput = Readonly<{
  scenes: readonly RinMemory[]
  links: readonly MemoryLink[]
  actions?: readonly MemoryActionRecord[]
  outcomes?: readonly MemoryOutcomeRecord[]
  feedback?: readonly MemoryFeedbackVector[]
  predictions?: readonly MemoryPredictionRecord[]
  candidates: readonly MemoryFormationCandidateInput[]
  at: string
}>

/** The canonical state slice from which the controller can derive formation pressure. */

export type MemoryRepresentationDerivationInput = Omit<MemoryRepresentationFormationInput, 'candidates'>
export type MemoryRepresentationFormationCandidate = Readonly<{
  memory: RinMemory
  sourceSceneIds: readonly MemoryId[]
  independentEvidenceIds: readonly string[]
  stable: boolean
  readiness: 'candidate' | 'ready-for-consolidation'
  reasons: readonly string[]
}>

export const MEMORY_REPRESENTATION_FORMATION_SCHEMA_VERSION = 1 as const

export type MemoryRepresentationFormationResult = Readonly<{
  schemaVersion: typeof MEMORY_REPRESENTATION_FORMATION_SCHEMA_VERSION
  memoryId: MemoryId
  previousVersion: string
  sourceSceneIds: readonly MemoryId[]
  evidenceIds: readonly EvidenceId[]
  independentEvidenceIds: readonly EvidenceId[]
  memory: RinMemory
  explanation: string
}>

export type MemoryRepresentationFormationCommitInput = Readonly<{
  memory: RinMemory
  sourceSceneIds: readonly MemoryId[]
  evidenceIds: readonly EvidenceId[]
  independentEvidenceIds: readonly EvidenceId[]
  at: string
  explanation: string
}>

function normalizedFormationText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim()
}

function derivedRepresentationId(goalId: GoalId, action: string): MemoryId {
  const digest = createHash('sha256')
    .update(String(goalId) + '\u0000' + normalizedFormationText(action))
    .digest('hex')
    .slice(0, 24)
  return createMemoryId('derived-disposition-' + digest)
}

type FormationScene = Extract<RinMemory, { form: 'scene' }>

type FormationActionGroup = {
  key: string
  actor: MemoryActionRecord['actor']
  actions: MemoryActionRecord[]
  sceneIds: Set<MemoryId>
}

type FormationRelationshipGroup = {
  key: string
  participants: readonly [ParticipantId, ParticipantId]
  sceneIds: Set<MemoryId>
}

function derivedCandidateId(form: string, identity: string): MemoryId {
  const digest = createHash('sha256')
    .update(form + '\u0000' + normalizedFormationText(identity))
    .digest('hex')
    .slice(0, 24)
  return createMemoryId('derived-' + form.replace(/[^a-z0-9]+/gi, '-') + '-' + digest)
}

function activeFormationScenes(
  ids: readonly MemoryId[],
  sceneById: ReadonlyMap<string, FormationScene>,
): FormationScene[] {
  const seen = new Set<string>()
  return ids
    .map(id => {
      const key = String(id)
      if (seen.has(key)) return undefined
      seen.add(key)
      return sceneById.get(key)
    })
    .filter((scene): scene is FormationScene =>
      scene !== undefined
      && scene.state.persistence !== 'archived'
      && scene.state.persistence !== 'erased',
    )
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
}

function formationSceneEvidenceIds(scenes: readonly FormationScene[]): readonly string[] {
  const evidence = new Set<string>()
  for (const scene of scenes) {
    const refs = scene.data.runtimeEventRefs ?? []
    if (refs.length === 0) {
      evidence.add('scene:' + String(scene.id))
      continue
    }
    for (const ref of refs) evidence.add('runtime:' + ref.sessionId + ':' + ref.eventSeq)
  }
  return [...evidence].sort()
}

function collectFormationActionGroups(
  actions: readonly MemoryActionRecord[],
  sceneById: ReadonlyMap<string, FormationScene>,
  keyForAction: (action: MemoryActionRecord) => string,
): readonly FormationActionGroup[] {
  const groups = new Map<string, FormationActionGroup>()
  for (const action of actions) {
    const key = keyForAction(action)
    if (key === '') continue
    const sourceScenes = activeFormationScenes(action.sourceMemoryIds, sceneById)
    if (sourceScenes.length === 0) continue
    const group = groups.get(key) ?? {
      key,
      actor: action.actor,
      actions: [],
      sceneIds: new Set<MemoryId>(),
    }
    group.actions.push(action)
    for (const scene of sourceScenes) group.sceneIds.add(scene.id)
    groups.set(key, group)
  }
  return [...groups.values()].sort((left, right) => left.key.localeCompare(right.key))
}

function latestFormationAt(values: readonly string[], fallback: string): string {
  return [...values].sort((left, right) =>
    Date.parse(right) - Date.parse(left) || right.localeCompare(left),
  )[0] ?? fallback
}

function isRinFormationActor(actor: ParticipantId): boolean {
  const value = String(actor)
  return value === 'rin' || value.endsWith('-rin')
}

function isRuntimeScopedFormationParticipant(participant: string): boolean {
  return participant.startsWith('session-') || participant.startsWith('scene-')
}

function createDerivedCandidateMemory(input: Readonly<{
  id: MemoryId
  form: RinMemory['form']
  data: unknown
  createdAt: string
  updatedAt: string
  epistemic: 'inferred' | 'hypothesized'
  confidence: number
  affect?: FormationScene['data']['affect']
}>): RinMemory {
  return createMemory({
    id: input.id,
    form: input.form,
    data: input.data,
    state: {
      persistence: 'transient',
      activation: 'active',
      integration: 'raw',
      epistemic: input.epistemic,
      influence: 'blocked',
    },
    dynamics: {
      activation: 0.35,
      accessibility: 0.2,
      salience: 0.35,
      stability: 0.1,
      confidence: input.confidence,
      integrationStrength: 0,
      novelty: 0.55,
      surprise: 0.2,
      affect: input.affect ?? { valence: 0, arousal: 0, control: 0.5 },
      validity: { startsAt: input.createdAt },
      utilityByGoal: [],
      inhibition: 0,
      influenceSurfaces: [],
    },
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  } as RinMemory)
}

function independentFormationEvidence(
  actions: readonly MemoryActionRecord[],
  outcomes: readonly MemoryOutcomeRecord[],
  feedback: readonly MemoryFeedbackVector[],
): readonly string[] {
  const evidence = new Set<string>()
  for (const action of actions) evidence.add(action.sessionId === undefined ? 'action:' + String(action.id) : 'session:' + action.sessionId)
  for (const outcome of outcomes) evidence.add(outcome.sessionId === undefined ? 'outcome:' + String(outcome.id) : 'session:' + outcome.sessionId)
  for (const vector of feedback) evidence.add(vector.sessionId === undefined ? 'feedback:' + String(vector.id) : 'session:' + vector.sessionId)
  return [...evidence].sort()
}

function isNegativeDispositionFeedback(vector: MemoryFeedbackVector): boolean {
  return vector.kind === 'correct'
    || vector.kind === 'reject'
    || vector.userResponse === 'corrected'
    || vector.userResponse === 'rejected'
    || vector.boundaryRespect === 'crossed'
    || vector.taskOutcome < -0.25
    || (vector.predictionAccuracy !== undefined && vector.predictionAccuracy < -0.25)
    || (vector.relationshipConsequence !== undefined && vector.relationshipConsequence < -0.25)
    || (vector.autonomyEffect !== undefined && vector.autonomyEffect < -0.25)
    || (vector.safetyEffect !== undefined && vector.safetyEffect < -0.25)
    || (vector.factualCorrection !== undefined && vector.factualCorrection.trim() !== '')
}

function feedbackFailureDescriptions(feedback: readonly MemoryFeedbackVector[]): readonly string[] {
  return [...new Set(feedback
    .filter(isNegativeDispositionFeedback)
    .map(vector => vector.factualCorrection?.trim() || vector.explanation)
    .filter(value => value.trim() !== ''))]
}

/**
 * Derives behavior candidates from the canonical action/result chain.
 *
 * This is deliberately conservative: every derived representation is a
 * transient, raw, blocked candidate. Repeated self/person behavior only
 * becomes a candidate when it has an observable result or feedback trace;
 * relationships require stable participant ids and repeated shared scenes;
 * prospects require an explicit canonical prediction. The event stream never
 * invents identity, intimacy, or an unobserved future.
 */
export function deriveMemoryRepresentationCandidates(
  input: MemoryRepresentationDerivationInput,
): readonly MemoryFormationCandidateInput[] {
  const atMs = parseTime(input.at, 'formation at')
  const scenes = input.scenes.map(scene => createMemory(scene)).filter(scene => scene.form === 'scene')
  const sceneById = new Map(scenes.map(scene => [String(scene.id), scene]))
  const actions = (input.actions ?? []).filter(action => Date.parse(action.occurredAt) <= atMs)
  const outcomes = (input.outcomes ?? []).filter(outcome => Date.parse(outcome.occurredAt) <= atMs)
  const feedback = (input.feedback ?? []).filter(vector => Date.parse(vector.occurredAt) <= atMs)
  const predictions = (input.predictions ?? []).filter(prediction => Date.parse(prediction.createdAt) <= atMs)
  const groups = new Map<string, {
    goalId: GoalId
    actionKey: string
    actions: MemoryActionRecord[]
    sceneIds: Set<MemoryId>
  }>()

  for (const action of actions) {
    const actionKey = normalizedFormationText(action.description)
    if (actionKey === '') continue
    const sourceScenes = action.sourceMemoryIds
      .map(id => sceneById.get(String(id)))
      .filter((scene): scene is Extract<RinMemory, { form: 'scene' }> => scene !== undefined)
      .filter(scene => scene.state.persistence !== 'archived' && scene.state.persistence !== 'erased')
    if (sourceScenes.length === 0) continue
    const goalIds = [...new Set([
      ...action.goalIds.map(String),
      ...sourceScenes.flatMap(scene => scene.data.goals.map(String)),
    ])]
    for (const goalIdValue of goalIds) {
      const goalId = (action.goalIds.find(id => String(id) === goalIdValue)
        ?? sourceScenes.flatMap(scene => scene.data.goals).find(id => String(id) === goalIdValue)) as GoalId | undefined
      if (goalId === undefined) continue
      const key = String(goalId) + '\u0000' + actionKey
      const group = groups.get(key) ?? {
        goalId,
        actionKey,
        actions: [],
        sceneIds: new Set<MemoryId>(),
      }
      group.actions.push(action)
      for (const scene of sourceScenes) group.sceneIds.add(scene.id)
      groups.set(key, group)
    }
  }

  const derived = [...groups.values()]
    .sort((left, right) => left.goalId.localeCompare(right.goalId) || left.actionKey.localeCompare(right.actionKey))
    .flatMap(group => {
      const groupActionIds = new Set(group.actions.map(action => String(action.id)))
      const sourceSceneIds = [...group.sceneIds].sort()
      const groupOutcomes = outcomes.filter(outcome => groupActionIds.has(String(outcome.actionId)))
      const outcomeIds = new Set(groupOutcomes.map(outcome => String(outcome.id)))
      const groupFeedback = feedback.filter(vector =>
        (vector.actionId !== undefined && groupActionIds.has(String(vector.actionId)))
        || (vector.outcomeId !== undefined && outcomeIds.has(String(vector.outcomeId))),
      )
      if (groupOutcomes.length === 0 && groupFeedback.length === 0) return []
      const sourceScenes = sourceSceneIds
        .map(id => sceneById.get(String(id)))
        .filter((scene): scene is Extract<RinMemory, { form: 'scene' }> => scene !== undefined)
      const contexts = [...new Set(sourceScenes.flatMap(scene => [
        scene.data.environment,
        ...scene.data.observations,
        ...scene.data.interpretations,
      ]).filter(value => value.trim() !== ''))]
      const actionPattern = [...new Set(group.actions.map(action => action.description))]
      const expectedOutcomes = [...new Set(group.actions.flatMap(action =>
        predictions
          .filter(prediction => action.predictionIds.some(id => String(id) === String(prediction.id)))
          .map(prediction => prediction.expectedOutcome),
      ))]
      const observedOutcomes = [...new Set(groupOutcomes
        .filter(outcome => outcome.status === 'observed' || outcome.status === 'partial')
        .map(outcome => outcome.description))]
      const failureModes = [...new Set([
        ...groupOutcomes
          .filter(outcome => outcome.status === 'failed' || outcome.status === 'partial')
          .map(outcome => outcome.description),
        ...feedbackFailureDescriptions(groupFeedback),
      ])]
      const utility = groupFeedback.length === 0
        ? []
        : [{
            goalId: group.goalId,
            value: groupFeedback.reduce((sum, vector) => sum + utilitySampleFromFeedback(vector), 0) / groupFeedback.length,
          }]
      const firstAction = [...group.actions].sort((left, right) =>
        Date.parse(left.occurredAt) - Date.parse(right.occurredAt) || String(left.id).localeCompare(String(right.id)),
      )[0]
      if (firstAction === undefined) throw new Error('rin memory formation: derived action group is empty')
      const firstScene = sourceScenes[0]
      const negativeFeedback = feedbackPolarity(groupFeedback, groupOutcomes).negative
      const evidenceIds = independentFormationEvidence(group.actions, groupOutcomes, groupFeedback)
      return {
        memory: createMemory({
          id: derivedRepresentationId(group.goalId, group.actionKey),
          form: 'disposition',
          data: {
            triggeringContexts: contexts,
            intendedGoal: group.goalId,
            actionPattern,
            supportingActionIds: group.actions.map(action => action.id),
            supportingOutcomeIds: groupOutcomes.map(outcome => outcome.id),
            supportingFeedbackIds: groupFeedback.map(vector => vector.id),
            sampleCount: groupOutcomes.length,
            expectedOutcomes,
            observedOutcomes,
            applicabilityConditions: contexts,
            failureModes,
            utilityByGoal: utility,
          },
          state: {
            persistence: 'transient',
            activation: 'active',
            integration: 'raw',
            epistemic: 'inferred',
            influence: 'blocked',
          },
          dynamics: {
            activation: 0.35,
            accessibility: 0.2,
            salience: Math.min(1, 0.3 + Math.min(group.actions.length, 4) * 0.08),
            stability: 0.1,
            confidence: Math.min(1, 0.25 + Math.min(evidenceIds.length, 4) * 0.12),
            integrationStrength: 0,
            novelty: group.actions.length > 1 ? 0.35 : 0.6,
            surprise: negativeFeedback || failureModes.length > 0 ? 0.35 : 0.1,
            affect: firstScene?.data.affect ?? { valence: 0, arousal: 0, control: 0.5 },
            validity: { startsAt: firstAction.occurredAt },
            utilityByGoal: utility,
            inhibition: negativeFeedback ? 0.15 : 0,
            influenceSurfaces: [],
          },
          createdAt: firstAction.occurredAt,
          updatedAt: input.at,
        }),
        sourceSceneIds,
        ...(evidenceIds.length === 0 ? {} : { independentEvidenceIds: evidenceIds }),
      }
    })
  const selfCandidates = collectFormationActionGroups(
    actions.filter(action => isRinFormationActor(action.actor)),
    sceneById,
    action => normalizedFormationText(action.description),
  ).flatMap(group => {
    const groupActionIds = new Set(group.actions.map(action => String(action.id)))
    const groupOutcomes = outcomes.filter(outcome => groupActionIds.has(String(outcome.actionId)))
    const outcomeIds = new Set(groupOutcomes.map(outcome => String(outcome.id)))
    const groupFeedback = feedback.filter(vector =>
      (vector.actionId !== undefined && groupActionIds.has(String(vector.actionId)))
      || (vector.outcomeId !== undefined && outcomeIds.has(String(vector.outcomeId))),
    )
    if (groupOutcomes.length === 0 && groupFeedback.length === 0) return []
    const sourceSceneIds = [...group.sceneIds].sort()
    const sourceScenes = activeFormationScenes(sourceSceneIds, sceneById)
    const firstAction = [...group.actions].sort((left, right) =>
      Date.parse(left.occurredAt) - Date.parse(right.occurredAt) || String(left.id).localeCompare(String(right.id)),
    )[0]
    if (firstAction === undefined || sourceScenes.length === 0) return []
    const evidenceIds = independentFormationEvidence(group.actions, groupOutcomes, groupFeedback)
    const actionPattern = [...new Set(group.actions.map(action => action.description))]
    const historicalChanges = [...new Set(groupOutcomes
      .filter(outcome => outcome.status === 'failed' || outcome.status === 'partial')
      .map(outcome => outcome.description))]
    return [{
      memory: createDerivedCandidateMemory({
        id: derivedCandidateId('self-model', group.key),
        form: 'self-model',
        data: {
          values: [],
          abilities: [],
          tendencies: actionPattern,
          historicalChanges,
        },
        createdAt: firstAction.occurredAt,
        updatedAt: input.at,
        epistemic: 'inferred',
        confidence: Math.min(0.7, 0.2 + Math.min(evidenceIds.length, 5) * 0.1),
        ...(sourceScenes[0] === undefined ? {} : { affect: sourceScenes[0].data.affect }),
      }),
      sourceSceneIds,
      independentEvidenceIds: evidenceIds,
    }]
  })

  const personCandidates = collectFormationActionGroups(
    actions.filter(action => !isRinFormationActor(action.actor)),
    sceneById,
    action => String(action.actor),
  ).flatMap(group => {
    const groupActionIds = new Set(group.actions.map(action => String(action.id)))
    const groupOutcomes = outcomes.filter(outcome => groupActionIds.has(String(outcome.actionId)))
    const outcomeIds = new Set(groupOutcomes.map(outcome => String(outcome.id)))
    const groupFeedback = feedback.filter(vector =>
      (vector.actionId !== undefined && groupActionIds.has(String(vector.actionId)))
      || (vector.outcomeId !== undefined && outcomeIds.has(String(vector.outcomeId))),
    )
    if (groupOutcomes.length === 0 && groupFeedback.length === 0) return []
    const sourceSceneIds = [...group.sceneIds].sort()
    const sourceScenes = activeFormationScenes(sourceSceneIds, sceneById)
    const firstAction = [...group.actions].sort((left, right) =>
      Date.parse(left.occurredAt) - Date.parse(right.occurredAt) || String(left.id).localeCompare(String(right.id)),
    )[0]
    if (firstAction === undefined || sourceScenes.length === 0) return []
    const evidenceIds = independentFormationEvidence(group.actions, groupOutcomes, groupFeedback)
    const patterns = [...new Set(group.actions.map(action => action.description))]
    const contexts = [...new Set(sourceScenes.map(scene => scene.data.environment))]
    const observedAt = latestFormationAt([
      ...group.actions.map(action => action.occurredAt),
      ...groupOutcomes.map(outcome => outcome.occurredAt),
    ], firstAction.occurredAt)
    return [{
      memory: createDerivedCandidateMemory({
        id: derivedCandidateId('person-model', String(group.actor)),
        form: 'person-model',
        data: {
          subject: group.actor,
          claims: [],
          observedPatterns: patterns,
          currentState: [],
          lastObservedAt: observedAt,
          ...(contexts.length === 0 ? {} : { contextConditions: contexts }),
        },
        createdAt: firstAction.occurredAt,
        updatedAt: input.at,
        epistemic: 'inferred',
        confidence: Math.min(0.65, 0.2 + Math.min(evidenceIds.length, 5) * 0.09),
        ...(sourceScenes[0] === undefined ? {} : { affect: sourceScenes[0].data.affect }),
      }),
      sourceSceneIds,
      independentEvidenceIds: evidenceIds,
    }]
  })

  const relationshipGroups = new Map<string, FormationRelationshipGroup>()
  for (const scene of scenes) {
    if (
      scene.state.persistence === 'archived'
      || scene.state.persistence === 'erased'
      || scene.data.actions.length === 0 && scene.data.outcomes.length === 0
    ) continue
    const participantIds = [...new Set(scene.data.participants.map(String))]
      .filter(id => id !== '' && !isRuntimeScopedFormationParticipant(id))
      .sort()
    for (let leftIndex = 0; leftIndex < participantIds.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < participantIds.length; rightIndex += 1) {
        const pair = [participantIds[leftIndex], participantIds[rightIndex]]
        const first = scene.data.participants.find(id => String(id) === pair[0])
        const second = scene.data.participants.find(id => String(id) === pair[1])
        if (first === undefined || second === undefined) continue
        const key = pair.join('\u0000')
        const group = relationshipGroups.get(key) ?? {
          key,
          participants: [first, second] as [ParticipantId, ParticipantId],
          sceneIds: new Set<MemoryId>(),
        }
        group.sceneIds.add(scene.id)
        relationshipGroups.set(key, group)
      }
    }
  }
  const relationshipCandidates = [...relationshipGroups.values()]
    .sort((left, right) => left.key.localeCompare(right.key))
    .flatMap(group => {
      const sourceSceneIds = [...group.sceneIds].sort()
      const sourceScenes = activeFormationScenes(sourceSceneIds, sceneById)
      if (sourceScenes.length === 0) return []
      const sourceSceneIdSet = new Set(sourceSceneIds.map(String))
      const sharedActions = actions.filter(action =>
        action.sourceMemoryIds.some(id => sourceSceneIdSet.has(String(id))))
      const sharedActionIds = new Set(sharedActions.map(action => String(action.id)))
      const sharedOutcomes = outcomes.filter(outcome => sharedActionIds.has(String(outcome.actionId)))
      const sharedOutcomeIds = new Set(sharedOutcomes.map(outcome => String(outcome.id)))
      const groupFeedback = feedback.filter(vector =>
        (vector.sceneId !== undefined && sourceSceneIdSet.has(String(vector.sceneId)))
        || (vector.actionId !== undefined && sharedActionIds.has(String(vector.actionId)))
        || (vector.outcomeId !== undefined && sharedOutcomeIds.has(String(vector.outcomeId))))
      const relationshipBoundaries = [...new Set(groupFeedback
        .filter(vector => vector.boundaryRespect !== undefined && vector.boundaryRespect !== 'unclear')
        .map(vector => 'boundary ' + vector.boundaryRespect + ': ' + vector.explanation))]
      const relationshipConflicts = [...new Set(groupFeedback
        .filter(vector =>
          vector.boundaryRespect === 'crossed'
          || (vector.relationshipConsequence !== undefined && vector.relationshipConsequence < -0.25),
        )
        .map(vector => 'relationship conflict: ' + (vector.factualCorrection?.trim() || vector.explanation)))]
      const evidenceIds = [...new Set([
        ...formationSceneEvidenceIds(sourceScenes),
        ...independentFormationEvidence(sharedActions, sharedOutcomes, groupFeedback),
      ])].sort()
      const firstScene = sourceScenes[0]
      if (firstScene === undefined) return []
      return [{
        memory: createDerivedCandidateMemory({
          id: derivedCandidateId('relationship-model', group.key),
          form: 'relationship-model',
          data: {
            participants: group.participants,
            sharedMemoryIds: sourceSceneIds,
            commitments: [],
            boundaries: relationshipBoundaries,
            conflicts: relationshipConflicts,
            expectations: [],
            distance: 0.5,
          },
          createdAt: firstScene.createdAt,
          updatedAt: input.at,
          epistemic: 'inferred',
          confidence: Math.min(0.6, 0.2 + Math.min(evidenceIds.length, 4) * 0.08),
          affect: firstScene.data.affect,
        }),
        sourceSceneIds,
        independentEvidenceIds: evidenceIds,
      }]
    })

  const prospectCandidates = [...predictions]
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
    .flatMap(prediction => {
      const sourceScenes = activeFormationScenes(prediction.sourceMemoryIds, sceneById)
      if (sourceScenes.length === 0) return []
      const sourceSceneIds = sourceScenes.map(scene => scene.id)
      const evidenceIds = [
        'prediction:' + String(prediction.id),
        ...formationSceneEvidenceIds(sourceScenes),
      ].sort()
      const firstScene = sourceScenes[0]
      if (firstScene === undefined) return []
      return [{
        memory: createDerivedCandidateMemory({
          id: derivedCandidateId('prospect', String(prediction.id)),
          form: 'prospect',
          data: {
            kind: 'prediction',
            premise: prediction.statement,
            possibleOutcomes: [prediction.expectedOutcome],
            relatedMemoryIds: sourceSceneIds,
            ...(prediction.targetTime === undefined ? {} : { targetTime: prediction.targetTime }),
          },
          createdAt: prediction.createdAt,
          updatedAt: input.at,
          epistemic: 'hypothesized',
          confidence: 0.25,
          affect: firstScene.data.affect,
        }),
        sourceSceneIds,
        independentEvidenceIds: evidenceIds,
      }]
    })

  return Object.freeze([
    ...derived,
    ...selfCandidates,
    ...personCandidates,
    ...relationshipCandidates,
    ...prospectCandidates,
  ])
}

/**
 * Checks a proposed long-term representation against the actual scene and
 * behavior records currently available to the cognition controller.
 *
 * This is a formation planner, not a second store and not an implicit promotion
 * path. Every output remains a candidate until the existing owner/controller
 * transition and atomic consolidation transaction accepts it.
 */
export function formMemoryRepresentations(
  input: MemoryRepresentationFormationInput,
): readonly MemoryRepresentationFormationCandidate[] {
  const atMs = parseTime(input.at, 'formation at')
  const scenes = input.scenes.map(scene => {
    const value = createMemory(scene)
    if (value.form !== 'scene') throw new Error('rin memory formation: scenes input may only contain scene memories')
    return value
  })
  const sceneIds = new Set(scenes.map(scene => String(scene.id)))
  const sceneById = new Map(scenes.map(scene => [String(scene.id), scene]))
  const links = input.links.map(link => createMemoryLink(link))
  const availableIds = new Set<string>([
    ...sceneIds,
    ...links.flatMap(link => [String(link.from), String(link.to)]),
  ])
  const actionIds = new Set((input.actions ?? []).map(action => String(action.id)))
  const outcomeIds = new Set((input.outcomes ?? []).map(outcome => String(outcome.id)))
  const feedbackIds = new Set((input.feedback ?? []).map(vector => String(vector.id)))
  const actionById = new Map((input.actions ?? []).map(action => [String(action.id), action]))
  const outcomeById = new Map((input.outcomes ?? []).map(outcome => [String(outcome.id), outcome]))
  const feedbackById = new Map((input.feedback ?? []).map(vector => [String(vector.id), vector]))
  const candidates = input.candidates.map(candidateInput => {
    const memory = createMemory(candidateInput.memory)
    if (memory.state.persistence !== 'transient' || memory.state.integration !== 'raw') {
      throw new Error('rin memory formation: candidate must remain transient and raw')
    }
    if (memory.state.influence !== 'blocked' || memory.dynamics.influenceSurfaces.length !== 0) {
      throw new Error('rin memory formation: candidate must remain blocked from influence')
    }
    if (memory.state.epistemic === 'observed'
      || memory.state.epistemic === 'superseded'
      || memory.state.epistemic === 'rejected') {
      throw new Error('rin memory formation: candidate cannot be observed or terminal')
    }
    if (Date.parse(memory.createdAt) > atMs) {
      throw new Error('rin memory formation: candidate cannot begin after formation time')
    }
    const sourceSceneIds = [...candidateInput.sourceSceneIds]
    if (new Set(sourceSceneIds.map(String)).size !== sourceSceneIds.length || sourceSceneIds.length === 0) {
      throw new Error('rin memory formation: source scenes must be unique and non-empty')
    }
    for (const sceneId of sourceSceneIds) {
      const scene = sceneById.get(String(sceneId))
      if (scene === undefined) throw new Error('rin memory formation: source scene is not materialized')
      if (scene.state.persistence === 'archived' || scene.state.persistence === 'erased') {
        throw new Error('rin memory formation: archived or erased scene cannot support a candidate')
      }
    }
    const independentEvidenceIds = [...(candidateInput.independentEvidenceIds ?? sourceSceneIds)]
    if (independentEvidenceIds.length === 0 || new Set(independentEvidenceIds).size !== independentEvidenceIds.length) {
      throw new Error('rin memory formation: independent evidence must be unique and non-empty')
    }
    const reasons: string[] = []
    let stable = memory.form !== 'prospect'
      && sourceSceneIds.length >= 2
      && independentEvidenceIds.length >= 2
    if (!stable) reasons.push('requires at least two independent scene/evidence observations before long-term influence')
    const supportingScenes = sourceSceneIds
      .map(sceneId => sceneById.get(String(sceneId)))
      .filter((scene): scene is Extract<RinMemory, { form: 'scene' }> => scene !== undefined)
    const sourceSceneIdSet = new Set(sourceSceneIds.map(String))
    const sceneHasEvidence = (scene: Extract<RinMemory, { form: 'scene' }>): boolean =>
      scene.data.observations.length > 0
      || scene.data.actions.length > 0
      || scene.data.outcomes.length > 0
      || scene.data.predictionErrors.length > 0
    switch (memory.form) {
      case 'self-model': {
        if (!supportingScenes.some(sceneHasEvidence)) {
          stable = false
          reasons.push('self model needs an observable scene or action/result trace')
        }
        break
      }
      case 'person-model': {
        const subjectScenes = supportingScenes.filter(scene => scene.data.participants.includes(memory.data.subject))
        if (subjectScenes.length === 0) {
          throw new Error('rin memory formation: person model subject is absent from supporting scenes')
        }
        if (subjectScenes.length < 2) {
          stable = false
          reasons.push('person model needs repeated observations of the same subject before long-term influence')
        }
        const hasContextualState = (memory.data.contextConditions?.length ?? 0) > 0
          || (memory.data.stateByContext?.length ?? 0) > 0
        if (memory.data.currentState.length > 0 && !hasContextualState) {
          stable = false
          reasons.push('current person state is kept contextual until a context condition is recorded')
        }
        break
      }
      case 'relationship-model': {
        const participants = new Set(memory.data.participants.map(String))
        const cooccurringScenes = supportingScenes.filter(scene =>
          [...participants].every(participant => scene.data.participants.some(id => String(id) === participant)),
        )
        if (cooccurringScenes.length === 0) {
          throw new Error('rin memory formation: relationship participants never co-occur in supporting scenes')
        }
        if (cooccurringScenes.length < 2) {
          stable = false
          reasons.push('relationship model needs repeated co-occurrence of both participants before long-term influence')
        }
        if (memory.data.sharedMemoryIds.some(id => !sceneIds.has(String(id)))) {
          throw new Error('rin memory formation: relationship shared memory must be a supporting scene')
        }
        const relationalSignal = memory.data.commitments.length > 0
          || memory.data.boundaries.length > 0
          || memory.data.conflicts.length > 0
          || memory.data.expectations.length > 0
          || memory.data.sharedMemoryIds.length > 0
        if (!relationalSignal) {
          stable = false
          reasons.push('relationship model needs an explicit commitment, boundary, conflict, expectation, or shared scene')
        }
        reasons.push('relationship influence is expressed through commitments and boundaries, not a hidden intimacy score')
        break
      }
      case 'disposition': {
        const supportingActions = memory.data.supportingActionIds ?? []
        const supportingOutcomes = memory.data.supportingOutcomeIds ?? []
        const supportingFeedback = memory.data.supportingFeedbackIds ?? []
        const supportingActionIdSet = new Set(supportingActions.map(String))
        const supportingOutcomeIdSet = new Set(supportingOutcomes.map(String))
        if (supportingActions.some(id => !actionIds.has(String(id)))) {
          throw new Error('rin memory formation: disposition references an unknown action record')
        }
        if (supportingOutcomes.some(id => !outcomeIds.has(String(id)))) {
          throw new Error('rin memory formation: disposition references an unknown outcome record')
        }
        if (supportingFeedback.some(id => !feedbackIds.has(String(id)))) {
          throw new Error('rin memory formation: disposition references an unknown feedback record')
        }
        const supportingActionRecords = supportingActions
          .map(id => actionById.get(String(id)))
          .filter((action): action is MemoryActionRecord => action !== undefined)
        if (supportingActionRecords.some(action => !action.sourceMemoryIds.some(id => sourceSceneIdSet.has(String(id))))) {
          throw new Error('rin memory formation: disposition action record does not support a declared source scene')
        }
        const supportingOutcomeRecords = supportingOutcomes
          .map(id => outcomeById.get(String(id)))
          .filter((outcome): outcome is MemoryOutcomeRecord => outcome !== undefined)
        if (supportingOutcomeRecords.some(outcome => !supportingActionIdSet.has(String(outcome.actionId)))) {
          throw new Error('rin memory formation: disposition outcome record does not belong to a supporting action')
        }
        const supportingFeedbackRecords = supportingFeedback
          .map(id => feedbackById.get(String(id)))
          .filter((vector): vector is MemoryFeedbackVector => vector !== undefined)
        if (supportingFeedbackRecords.some(vector => {
          const actionBound = vector.actionId !== undefined && supportingActionIdSet.has(String(vector.actionId))
          const outcomeBound = vector.outcomeId !== undefined && supportingOutcomeIdSet.has(String(vector.outcomeId))
          return (vector.actionId !== undefined && !actionBound)
            || (vector.outcomeId !== undefined && !outcomeBound)
            || (!actionBound && !outcomeBound)
        })) {
          throw new Error('rin memory formation: disposition feedback record does not belong to a supporting action or outcome')
        }
        if (memory.data.sampleCount !== undefined && memory.data.sampleCount < supportingOutcomes.length) {
          throw new Error('rin memory formation: disposition sample count is below its outcome evidence')
        }
        if (supportingOutcomes.length < 2) stable = false
        break
      }
      case 'prospect':
        stable = false
        reasons.push('prospect remains a simulation and never enters observed history')
        if (memory.data.relatedMemoryIds.some(id => !availableIds.has(String(id)))) {
          throw new Error('rin memory formation: prospect references an unavailable memory')
        }
        break
      default:
        break
    }
    if (stable) reasons.push('independent evidence threshold met; controller may evaluate consolidation')
    return Object.freeze({
      memory,
      sourceSceneIds: Object.freeze(sourceSceneIds),
      independentEvidenceIds: Object.freeze(independentEvidenceIds),
      stable,
      readiness: stable ? 'ready-for-consolidation' : 'candidate',
      reasons: Object.freeze(reasons),
    })
  })
  return Object.freeze(candidates)
}

/**
 * Accept one stable representation candidate into the durable memory axis.
 *
 * Formation is explicit controller work, not an automatic consequence of
 * derivation. The candidate keeps its epistemic state and remains blocked from
 * all influence surfaces; owner permission is a separate transaction.
 */
export function formMemoryRepresentation(
  input: MemoryRepresentationFormationCommitInput,
): MemoryRepresentationFormationResult {
  const current = createMemory(input.memory)
  assertText(input.explanation, 'formation explanation')
  const atMs = parseTime(input.at, 'formation commit at')
  if (atMs <= Date.parse(current.updatedAt)) {
    throw new Error('rin memory formation: commit time must advance the candidate version')
  }
  if (
    current.state.persistence !== 'transient'
    || current.state.integration !== 'raw'
    || current.state.influence !== 'blocked'
  ) {
    throw new Error('rin memory formation: candidate must be transient, raw, and blocked')
  }
  if (
    current.state.epistemic === 'observed'
    || current.state.epistemic === 'superseded'
    || current.state.epistemic === 'rejected'
  ) {
    throw new Error('rin memory formation: candidate epistemic state cannot be accepted')
  }
  const sourceSceneIds = [...input.sourceSceneIds]
  if (sourceSceneIds.length === 0 || new Set(sourceSceneIds.map(String)).size !== sourceSceneIds.length) {
    throw new Error('rin memory formation: source scenes must be unique and non-empty')
  }
  if (sourceSceneIds.some(id => String(id) === String(current.id))) {
    throw new Error('rin memory formation: candidate cannot support itself')
  }
  assertEvidenceIds(input.evidenceIds, 'formation evidenceIds')
  const independentEvidenceIds = [...input.independentEvidenceIds]
  assertIndependentEvidence(input.evidenceIds, independentEvidenceIds)
  if (independentEvidenceIds.length === 0) {
    throw new Error('rin memory formation: stable formation requires independent evidence')
  }

  let formed = current
  for (const type of ['encode', 'durable', 'link', 'consolidate', 'integrate'] as const) {
    formed = transitionMemory(formed, { type, at: input.at })
  }
  if (
    formed.state.persistence !== 'durable'
    || formed.state.integration !== 'integrated'
    || formed.state.influence !== 'blocked'
    || formed.dynamics.influenceSurfaces.length !== 0
  ) {
    throw new Error('rin memory formation: formed representation crossed the influence boundary')
  }
  return deepFreeze({
    schemaVersion: MEMORY_REPRESENTATION_FORMATION_SCHEMA_VERSION,
    memoryId: current.id,
    previousVersion: current.updatedAt,
    sourceSceneIds,
    evidenceIds: [...input.evidenceIds],
    independentEvidenceIds,
    memory: formed,
    explanation: input.explanation,
  })
}

export function assertMemoryRepresentationFormationResult(
  value: unknown,
): asserts value is MemoryRepresentationFormationResult {
  if (!isRecord(value) || value.schemaVersion !== MEMORY_REPRESENTATION_FORMATION_SCHEMA_VERSION) {
    throw new Error('rin memory formation: unsupported result schema')
  }
  assertText(value.memoryId, 'result.memoryId')
  assertText(value.previousVersion, 'result.previousVersion')
  if (!Array.isArray(value.sourceSceneIds) || value.sourceSceneIds.length === 0) {
    throw new Error('rin memory formation: result sourceSceneIds must not be empty')
  }
  if (value.sourceSceneIds.some(id => typeof id !== 'string' || id.trim() === '')) {
    throw new Error('rin memory formation: result.sourceSceneIds must contain non-empty ids')
  }
  if (new Set(value.sourceSceneIds.map(String)).size !== value.sourceSceneIds.length) {
    throw new Error('rin memory formation: result sourceSceneIds must be unique')
  }
  if (!Array.isArray(value.evidenceIds)) {
    throw new Error('rin memory formation: result evidenceIds must be an array')
  }
  assertEvidenceIds(value.evidenceIds as readonly EvidenceId[], 'result.evidenceIds')
  if (!Array.isArray(value.independentEvidenceIds)) {
    throw new Error('rin memory formation: result independentEvidenceIds must be an array')
  }
  assertEvidenceIds(value.independentEvidenceIds as readonly EvidenceId[], 'result.independentEvidenceIds')
  assertIndependentEvidence(
    value.evidenceIds as readonly EvidenceId[],
    value.independentEvidenceIds as readonly EvidenceId[],
  )
  if (!isRecord(value.memory)) {
    throw new Error('rin memory formation: result memory is required')
  }
  const memory = createMemory(value.memory as RinMemory)
  if (memory.id !== value.memoryId || memory.updatedAt === value.previousVersion) {
    throw new Error('rin memory formation: result identity or version is invalid')
  }
  if (
    memory.state.persistence !== 'durable'
    || memory.state.integration !== 'integrated'
    || memory.state.influence !== 'blocked'
    || memory.dynamics.influenceSurfaces.length !== 0
  ) {
    throw new Error('rin memory formation: result must be durable, integrated, and blocked')
  }
  assertText(value.explanation, 'result.explanation')
}

export type MemoryDispositionLearningInput = Readonly<{
  disposition: Extract<RinMemory, { form: 'disposition' }>
  action: MemoryActionRecord
  outcomes: readonly MemoryOutcomeRecord[]
  feedback: readonly MemoryFeedbackVector[]
  predictions?: readonly MemoryPredictionRecord[]
  at: string
  explanation: string
}>

export type MemoryDispositionLearningResult = Readonly<{
  dispositionId: MemoryId
  actionId: ActionId
  previousVersion: string
  memory: Extract<RinMemory, { form: 'disposition' }>
  sampleCount: number
  independentOutcomeIds: readonly OutcomeId[]
  feedbackIds: readonly FeedbackId[]
  stable: boolean
  semanticFieldsChanged: boolean
  explanation: string
}>

function appendUnique(values: readonly string[], additions: readonly string[]): string[] {
  return [...new Set([...values, ...additions])]
}

function feedbackPolarity(
  feedback: readonly MemoryFeedbackVector[],
  outcomes: readonly MemoryOutcomeRecord[],
): { positive: boolean; negative: boolean; boundaryPressure: number; costPressure: number } {
  let positive = outcomes.some(outcome => outcome.status === 'observed')
  let negative = outcomes.some(outcome => outcome.status === 'failed')
  let boundaryPressure = 0
  let costPressure = 0
  for (const vector of feedback) {
    if (vector.kind === 'accept' || vector.userResponse === 'accepted' || vector.taskOutcome > 0.25) positive = true
    if (vector.kind === 'correct' || vector.kind === 'reject' || vector.kind === 'ignore' || vector.userResponse === 'rejected' || vector.userResponse === 'corrected' || vector.factualCorrection !== undefined || vector.taskOutcome < -0.25) negative = true
    if (vector.predictionAccuracy !== undefined) {
      if (vector.predictionAccuracy > 0.25) positive = true
      if (vector.predictionAccuracy < -0.25) negative = true
    }
    if (vector.relationshipConsequence !== undefined && vector.relationshipConsequence < -0.25) negative = true
    if (vector.autonomyEffect !== undefined && vector.autonomyEffect < -0.25) negative = true
    if (vector.safetyEffect !== undefined && vector.safetyEffect < -0.25) negative = true
    if (vector.kind === 'boundary' || vector.boundaryRespect !== undefined) {
      if (vector.boundaryRespect === 'crossed') {
        negative = true
        boundaryPressure = Math.max(boundaryPressure, 0.25)
      } else if (vector.boundaryRespect === 'respected') {
        positive = true
      }
    }
    costPressure = Math.max(costPressure, vector.actionCost)
  }
  return { positive, negative, boundaryPressure, costPressure }
}

function signedClamp(value: number): number {
  return Math.min(1, Math.max(-1, value))
}

function utilitySampleFromFeedback(vector: MemoryFeedbackVector): number {
  return signedClamp(vector.taskOutcome - (0.35 * vector.actionCost))
}

function utilitySampleFromOutcome(outcome: MemoryOutcomeRecord): number {
  if (outcome.status === 'observed') return 0.5
  if (outcome.status === 'failed') return -0.5
  return 0
}

function updateGoalUtility(
  values: readonly MemoryGoalUtility[],
  goalId: GoalId,
  samples: readonly number[],
  priorSampleCount: number,
): MemoryGoalUtility[] {
  if (samples.length === 0) return [...values]
  const sampleMean = signedClamp(samples.reduce((sum, value) => sum + value, 0) / samples.length)
  const previous = values.find(item => item.goalId === goalId)
  if (previous === undefined) return [...values, { goalId, value: sampleMean }]
  const priorWeight = Math.max(1, priorSampleCount)
  const newWeight = Math.max(1, samples.length)
  const value = signedClamp(((previous.value * priorWeight) + (sampleMean * newWeight)) / (priorWeight + newWeight))
  return values.map(item => item.goalId === goalId ? { ...item, value } : item)
}

/**
 * Converts a complete action/outcome/feedback chain into a disposition
 * revision candidate. One sample can alter accessibility and inhibition, but
 * semantic action tendencies only change after independent outcomes are seen.
 */
export function learnDispositionFromFeedback(
  input: MemoryDispositionLearningInput,
): MemoryDispositionLearningResult {
  const disposition = createMemory(input.disposition) as Extract<RinMemory, { form: 'disposition' }>
  const atMs = parseTime(input.at, 'disposition learning at')
  if (atMs <= Date.parse(disposition.updatedAt)) {
    throw new Error('rin memory learning: learning time must be newer than disposition version')
  }
  assertText(input.explanation, 'disposition learning explanation')
  const outcomes = input.outcomes
    .filter(outcome => outcome.actionId === input.action.id)
    .map(outcome => ({ ...outcome }))
  const outcomeIds = new Set(outcomes.map(outcome => String(outcome.id)))
  const feedback = input.feedback.filter(vector => {
    const actionBound = vector.actionId !== undefined && vector.actionId === input.action.id
    const outcomeBound = vector.outcomeId !== undefined && outcomeIds.has(String(vector.outcomeId))
    const directDisposition = vector.dispositionId === disposition.id
      && vector.actionId === undefined
      && vector.outcomeId === undefined
    return actionBound || outcomeBound || directDisposition
  })
  if (outcomes.length === 0 && feedback.length === 0) {
    throw new Error('rin memory learning: action chain has no outcome or feedback')
  }
  const existingActionIds = input.disposition.data.supportingActionIds ?? []
  const existingOutcomeIds = input.disposition.data.supportingOutcomeIds ?? []
  const existingFeedbackIds = input.disposition.data.supportingFeedbackIds ?? []
  const newOutcomes = outcomes.filter(outcome => !existingOutcomeIds.some(id => String(id) === String(outcome.id)))
  const newFeedback = feedback.filter(vector => !existingFeedbackIds.some(id => String(id) === String(vector.id)))
  if (newOutcomes.length === 0 && newFeedback.length === 0) {
    throw new Error('rin memory learning: action chain has no new outcome or feedback')
  }
  const supportingActionIds = appendUnique(existingActionIds.map(String), [String(input.action.id)])
  const supportingOutcomeIds = appendUnique(existingOutcomeIds.map(String), newOutcomes.map(outcome => String(outcome.id)))
  const supportingFeedbackIds = appendUnique(existingFeedbackIds.map(String), feedback.map(vector => String(vector.id)))
  const independentOrigins = new Set<string>()
  const independentOutcomeIds = outcomes.filter(outcome => {
    const origin = outcome.sessionId ?? String(outcome.id)
    if (independentOrigins.has(origin)) return false
    independentOrigins.add(origin)
    return true
  }).map(outcome => outcome.id)
  const stable = independentOutcomeIds.length >= 2
  const polarity = feedbackPolarity(newFeedback, newOutcomes)
  const positiveDescriptions = polarity.positive && stable ? [input.action.description] : []
  const expectedDescriptions = stable
    ? (input.predictions ?? [])
      .filter(prediction => input.action.predictionIds.includes(prediction.id))
      .map(prediction => prediction.expectedOutcome)
    : []
  const observedDescriptions = stable
    ? outcomes.filter(outcome => outcome.status === 'observed' || outcome.status === 'partial').map(outcome => outcome.description)
    : []
  const failureDescriptions = polarity.negative && stable
    ? [...new Set([
      ...outcomes
        .filter(outcome => outcome.status === 'failed' || outcome.status === 'partial')
        .map(outcome => outcome.description),
      ...feedbackFailureDescriptions(newFeedback),
    ])]
    : []
  const semanticFieldsChanged = positiveDescriptions.length > 0
    || expectedDescriptions.length > 0
    || observedDescriptions.length > 0
    || failureDescriptions.length > 0
  const utilitySamples = newFeedback.length > 0
    ? newFeedback.map(utilitySampleFromFeedback)
    : newOutcomes.map(utilitySampleFromOutcome)
  const priorSampleCount = Math.max(
    existingOutcomeIds.length,
    input.disposition.data.sampleCount ?? 0,
  )
  const dataUtilityByGoal = updateGoalUtility(
    disposition.data.utilityByGoal,
    disposition.data.intendedGoal,
    utilitySamples,
    priorSampleCount,
  )
  const dynamicsUtilityByGoal = updateGoalUtility(
    disposition.dynamics.utilityByGoal,
    disposition.data.intendedGoal,
    utilitySamples,
    priorSampleCount,
  )
  const data = {
    ...disposition.data,
    supportingActionIds: supportingActionIds as ActionId[],
    supportingOutcomeIds: supportingOutcomeIds as OutcomeId[],
    supportingFeedbackIds: supportingFeedbackIds as FeedbackId[],
    sampleCount: Math.max(input.disposition.data.sampleCount ?? 0, supportingOutcomeIds.length),
    utilityByGoal: dataUtilityByGoal,
    ...(semanticFieldsChanged ? {
      actionPattern: appendUnique(disposition.data.actionPattern, positiveDescriptions),
      expectedOutcomes: appendUnique(disposition.data.expectedOutcomes, expectedDescriptions),
      observedOutcomes: appendUnique(disposition.data.observedOutcomes, observedDescriptions),
      failureModes: appendUnique(disposition.data.failureModes, failureDescriptions),
    } : {}),
  }
  const accessibilityDelta = polarity.positive ? 0.06 : -0.03 - (0.02 * polarity.costPressure)
  const inhibitionDelta = (polarity.negative ? 0.08 + polarity.boundaryPressure : -0.03) + (0.04 * polarity.costPressure)
  const memory = createMemory({
    ...disposition,
    data,
    updatedAt: new Date(atMs).toISOString(),
    dynamics: {
      ...disposition.dynamics,
      accessibility: clamp(disposition.dynamics.accessibility + accessibilityDelta),
      inhibition: clamp(disposition.dynamics.inhibition + inhibitionDelta),
      utilityByGoal: dynamicsUtilityByGoal,
    },
  }) as Extract<RinMemory, { form: 'disposition' }>
  const feedbackIds = newFeedback.map(vector => vector.id)
  return Object.freeze({
    dispositionId: disposition.id,
    actionId: input.action.id,
    previousVersion: disposition.updatedAt,
    memory,
    sampleCount: data.sampleCount,
    independentOutcomeIds: Object.freeze(independentOutcomeIds),
    feedbackIds: Object.freeze(feedbackIds),
    stable,
    semanticFieldsChanged,
    explanation: input.explanation,
  })
}


function clamp(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function parseTime(value: string, label: string): number {
  assertTimestamp(value, label)
  return Date.parse(value)
}

function normalizeOutput(memory: RinMemory, at: string, label: string): RinMemory {
  const atMs = parseTime(at, 'consolidation time')
  if (atMs < Date.parse(memory.createdAt)) {
    throw new Error('rin memory consolidation: ' + label + ' cannot precede createdAt')
  }
  return createMemory({ ...memory, updatedAt: at })
}

function assertModelCannotCreateObserved(memory: RinMemory, basis: EpistemicBasis, label: string): void {
  if (
    memory.state.epistemic === 'observed'
    && (basis === 'model-inference' || basis === 'model-proposal')
  ) {
    throw new Error('rin memory consolidation: ' + label + ' model output cannot create observed memory')
  }
}

function assertActiveSource(memory: RinMemory): void {
  if (memory.state.persistence === 'archived' || memory.state.persistence === 'erased') {
    throw new Error('rin memory consolidation: archived or erased memory cannot enter a labile window')
  }
  if (memory.state.epistemic === 'superseded' || memory.state.epistemic === 'rejected') {
    throw new Error('rin memory consolidation: terminal epistemic memory cannot re-consolidate')
  }
}

function assertRevisable(memory: RinMemory, operation: MemoryConsolidationOperation): void {
  assertActiveSource(memory)
  if (memory.state.epistemic === 'contested' && operation !== 'reinforce') {
    throw new Error('rin memory consolidation: contested memory needs a new resolution before ' + operation)
  }
}

function assertLabileMatches(memory: RinMemory, labile: MemoryLabileWindow): void {
  if (
    labile.memoryId !== memory.id
    || labile.memoryVersion !== memory.updatedAt
  ) {
    throw new Error('rin memory consolidation: labile window targets a stale memory version')
  }
  assertTimestamp(labile.openedAt, 'labile.openedAt')
  assertTimestamp(labile.expiresAt, 'labile.expiresAt')
  if (Date.parse(labile.expiresAt) < Date.parse(labile.openedAt)) {
    throw new Error('rin memory consolidation: labile window expires before it opens')
  }
  assertText(labile.useTraceId, 'labile.useTraceId')
}

function assertIndependentEvidence(
  evidenceIds: readonly EvidenceId[],
  independentEvidenceIds: readonly EvidenceId[],
): void {
  const evidence = new Set(evidenceIds.map(String))
  if (independentEvidenceIds.some(id => !evidence.has(String(id)))) {
    throw new Error('rin memory consolidation: independent evidence must be a subset of evidence')
  }
  if (new Set(independentEvidenceIds.map(String)).size !== independentEvidenceIds.length) {
    throw new Error('rin memory consolidation: independent evidence must be unique')
  }
}

/**
 * Open a short reconsolidation window only from an actual use trace.
 *
 * A recall result or a workspace membership is not enough: the trace must
 * identify the exact representation version that participated in a model-facing
 * or action-facing operation.
 */
export function openLabileWindow(
  memory: RinMemory,
  use: MemoryUseTrace,
  openedAt = use.usedAt,
  durationMs = DEFAULT_LABILE_WINDOW_MS,
): MemoryLabileWindow {
  assertActiveSource(memory)
  assertText(use.id, 'use.id')
  assertText(use.cycleId, 'use.cycleId')
  assertText(use.memoryVersion, 'use.memoryVersion')
  assertUseSurface(use.surface)
  assertUsePurpose(use.purpose)
  const useAt = parseTime(use.usedAt, 'use.usedAt')
  const openAt = parseTime(openedAt, 'labile.openedAt')
  if (use.memoryId !== memory.id || use.memoryVersion !== memory.updatedAt) {
    throw new Error('rin memory consolidation: use trace targets a stale memory version')
  }
  if (openAt < useAt) {
    throw new Error('rin memory consolidation: labile window cannot open before actual use')
  }
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0 || durationMs > MAX_LABILE_WINDOW_MS) {
    throw new Error('rin memory consolidation: labile duration is outside the allowed range')
  }
  const window: MemoryLabileWindow = {
    memoryId: memory.id,
    memoryVersion: memory.updatedAt,
    useTraceId: use.id,
    openedAt: new Date(openAt).toISOString(),
    expiresAt: new Date(openAt + durationMs).toISOString(),
  }
  return deepFreeze(window)
}

/**
 * Produce one deterministic reconsolidation result.
 *
 * The original value remains immutable. The returned representations are
 * versioned outputs that a controller can commit atomically with their links.
 */
export function consolidateMemory(input: MemoryConsolidationInput): MemoryConsolidationResult {
  const memory = createMemory(input.memory)
  assertOperation(input.operation)
  assertBasis(input.basis)
  assertText(input.explanation, 'explanation')
  const at = parseTime(input.at, 'consolidation at')
  assertLabileMatches(memory, input.labile)
  if (at < Date.parse(input.labile.openedAt) || at > Date.parse(input.labile.expiresAt)) {
    throw new Error('rin memory consolidation: consolidation is outside the labile window')
  }
  assertEvidenceIds(input.evidenceIds, 'evidenceIds')
  const independentEvidenceIds = [...(input.independentEvidenceIds ?? [])]
  assertIndependentEvidence(input.evidenceIds, independentEvidenceIds)
  assertRevisable(memory, input.operation)

  const previousVersion = memory.updatedAt
  const changedConfidence = independentEvidenceIds.length > 0

  switch (input.operation) {
    case 'reinforce': {
      const confidence = changedConfidence
        ? clamp(memory.dynamics.confidence + Math.min(0.12, independentEvidenceIds.length * 0.04))
        : memory.dynamics.confidence
      const reinforced = createMemory({
        ...memory,
        updatedAt: input.at,
        dynamics: {
          ...memory.dynamics,
          accessibility: clamp(memory.dynamics.accessibility + 0.12),
          stability: clamp(memory.dynamics.stability + 0.08),
          integrationStrength: clamp(memory.dynamics.integrationStrength + 0.04),
          novelty: clamp(memory.dynamics.novelty - 0.05),
          surprise: clamp(memory.dynamics.surprise - 0.05),
          confidence,
        },
      })
      return deepFreeze({
        schemaVersion: MEMORY_CONSOLIDATION_SCHEMA_VERSION,
        operation: input.operation,
        memoryId: memory.id,
        previousVersion,
        labile: input.labile,
        evidenceIds: [...input.evidenceIds],
        independentEvidenceIds,
        resultingMemories: [reinforced],
        confidenceChanged: reinforced.dynamics.confidence !== memory.dynamics.confidence,
        explanation: input.explanation,
      })
    }
    case 'revise': {
      if (input.replacement === undefined) {
        throw new Error('rin memory consolidation: revise requires a replacement')
      }
      if (input.replacement.id !== memory.id) {
        throw new Error('rin memory consolidation: revise must preserve memory identity')
      }
      assertModelCannotCreateObserved(input.replacement, input.basis, 'revise')
      const revised = normalizeOutput(input.replacement, input.at, 'replacement')
      return deepFreeze({
        schemaVersion: MEMORY_CONSOLIDATION_SCHEMA_VERSION,
        operation: input.operation,
        memoryId: memory.id,
        previousVersion,
        labile: input.labile,
        evidenceIds: [...input.evidenceIds],
        independentEvidenceIds,
        resultingMemories: [revised],
        confidenceChanged: revised.dynamics.confidence !== memory.dynamics.confidence,
        explanation: input.explanation,
      })
    }
    case 'contest': {
      if (memory.state.epistemic === 'contested') {
        throw new Error('rin memory consolidation: memory is already contested')
      }
      const contested = createMemory({
        ...memory,
        updatedAt: input.at,
        state: { ...memory.state, epistemic: 'contested' },
        dynamics: {
          ...memory.dynamics,
          accessibility: clamp(memory.dynamics.accessibility - 0.05),
          inhibition: clamp(memory.dynamics.inhibition + 0.15),
          confidence: Math.min(memory.dynamics.confidence, 0.55),
        },
      })
      return deepFreeze({
        schemaVersion: MEMORY_CONSOLIDATION_SCHEMA_VERSION,
        operation: input.operation,
        memoryId: memory.id,
        previousVersion,
        labile: input.labile,
        evidenceIds: [...input.evidenceIds],
        independentEvidenceIds,
        resultingMemories: [contested],
        confidenceChanged: contested.dynamics.confidence !== memory.dynamics.confidence,
        explanation: input.explanation,
      })
    }
    case 'supersede': {
      if (input.replacement === undefined) {
        throw new Error('rin memory consolidation: supersede requires a replacement')
      }
      if (input.replacement.id === memory.id) {
        throw new Error('rin memory consolidation: supersede replacement needs a new identity')
      }
      assertModelCannotCreateObserved(input.replacement, input.basis, 'supersede')
      const superseded = createMemory({
        ...memory,
        updatedAt: input.at,
        state: { ...memory.state, epistemic: 'superseded', influence: 'blocked' },
        dynamics: { ...memory.dynamics, influenceSurfaces: [] },
      })
      const replacement = normalizeOutput(input.replacement, input.at, 'replacement')
      return deepFreeze({
        schemaVersion: MEMORY_CONSOLIDATION_SCHEMA_VERSION,
        operation: input.operation,
        memoryId: memory.id,
        previousVersion,
        labile: input.labile,
        evidenceIds: [...input.evidenceIds],
        independentEvidenceIds,
        resultingMemories: [superseded, replacement],
        confidenceChanged: replacement.dynamics.confidence !== memory.dynamics.confidence,
        explanation: input.explanation,
      })
    }
    case 'split': {
      if (input.parts === undefined || input.parts.length < 2) {
        throw new Error('rin memory consolidation: split requires at least two parts')
      }
      const partIds = input.parts.map(part => String(part.id))
      if (
        partIds.some(id => id === String(memory.id))
        || new Set(partIds).size !== partIds.length
      ) {
        throw new Error('rin memory consolidation: split parts need distinct new identities')
      }
      for (const part of input.parts) assertModelCannotCreateObserved(part, input.basis, 'split')
      const superseded = createMemory({
        ...memory,
        updatedAt: input.at,
        state: { ...memory.state, epistemic: 'superseded', influence: 'blocked' },
        dynamics: { ...memory.dynamics, influenceSurfaces: [] },
      })
      const parts = input.parts.map((part, index) => normalizeOutput(part, input.at, 'split part ' + index))
      return deepFreeze({
        schemaVersion: MEMORY_CONSOLIDATION_SCHEMA_VERSION,
        operation: input.operation,
        memoryId: memory.id,
        previousVersion,
        labile: input.labile,
        evidenceIds: [...input.evidenceIds],
        independentEvidenceIds,
        resultingMemories: [superseded, ...parts],
        confidenceChanged: parts.some(part => part.dynamics.confidence !== memory.dynamics.confidence),
        explanation: input.explanation,
      })
    }
    case 'reject': {
      const rejected = createMemory({
        ...memory,
        updatedAt: input.at,
        state: { ...memory.state, epistemic: 'rejected', influence: 'blocked' },
        dynamics: { ...memory.dynamics, influenceSurfaces: [] },
      })
      return deepFreeze({
        schemaVersion: MEMORY_CONSOLIDATION_SCHEMA_VERSION,
        operation: input.operation,
        memoryId: memory.id,
        previousVersion,
        labile: input.labile,
        evidenceIds: [...input.evidenceIds],
        independentEvidenceIds,
        resultingMemories: [rejected],
        confidenceChanged: rejected.dynamics.confidence !== memory.dynamics.confidence,
        explanation: input.explanation,
      })
    }
  }
}

export type MemoryConsolidationPriority =
  | 'prediction-error'
  | 'open-loop'
  | 'conflict'
  | 'cross-scene'
  | 'unintegrated'
  | 'impact'

export type MemoryConsolidationScheduleInput = Readonly<{
  memories: readonly RinMemory[]
  links: readonly MemoryLink[]
  useTraces: readonly MemoryUseTrace[]
  at: string
  maxItems?: number
}>

export type MemoryConsolidationWorkItem = Readonly<{
  memoryId: MemoryId
  memoryVersion: string
  useTraceId: string
  labile: MemoryLabileWindow
  score: number
  repetitionCount: number
  priorities: readonly MemoryConsolidationPriority[]
  reasons: readonly string[]
  confidenceNeedsIndependentEvidence: true
  groupId: string
}>

export type MemoryConsolidationGroup = Readonly<{
  id: string
  memoryIds: readonly MemoryId[]
  crossScene: boolean
  reasons: readonly string[]
}>

export type MemoryConsolidationSchedule = Readonly<{
  at: string
  items: readonly MemoryConsolidationWorkItem[]
  groups: readonly MemoryConsolidationGroup[]
}>

const CONSOLIDATION_SCHEDULE_MAX_ITEMS = 64
const CROSS_SCENE_RELATIONS = new Set([
  'temporal-before',
  'temporal-overlap',
  'continues',
  'supports',
  'derives',
  'contradicts',
  'similar-to',
  'context-of',
  'caused-by',
  'predicts',
  'action-led-to',
  'feedback-for',
])

function activeVersionLink(
  link: MemoryLink,
  memories: ReadonlyMap<string, RinMemory>,
): boolean {
  if (link.state !== 'active') return false
  const from = memories.get(String(link.from))
  const to = memories.get(String(link.to))
  return from !== undefined
    && to !== undefined
    && link.fromVersion === from.updatedAt
    && link.toVersion === to.updatedAt
}

function unionFind(ids: readonly string[]): {
  find: (id: string) => string
  join: (left: string, right: string) => void
} {
  const parent = new Map(ids.map(id => [id, id]))
  const find = (id: string): string => {
    const current = parent.get(id)
    if (current === undefined) return id
    if (current === id) return id
    const root = find(current)
    parent.set(id, root)
    return root
  }
  const join = (left: string, right: string): void => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot)
  }
  return { find, join }
}

function connectsSceneMemories(
  memory: RinMemory,
  link: MemoryLink,
  memories: ReadonlyMap<string, RinMemory>,
): boolean {
  if (memory.form !== 'scene') return false
  const otherId = String(link.from) === String(memory.id) ? String(link.to) : String(link.from)
  return memories.get(otherId)?.form === 'scene'
}

function schedulePressure(
  memory: RinMemory,
  links: readonly MemoryLink[],
  repetitionCount: number,
  memories: ReadonlyMap<string, RinMemory>,
): {
  score: number
  priorities: MemoryConsolidationPriority[]
  reasons: string[]
} {
  const priorities: MemoryConsolidationPriority[] = []
  const reasons: string[] = []
  let score = 0
  if (memory.form === 'scene') {
    const error = memory.data.predictionErrors.reduce((sum, entry) => sum + entry.magnitude, 0)
    if (error > 0) {
      score += Math.min(3, error * 3)
      priorities.push('prediction-error')
      reasons.push('prediction error magnitude=' + error.toFixed(3))
    }
  }
  if (memory.form === 'open-loop' && memory.data.status === 'open') {
    score += 2
    priorities.push('open-loop')
    reasons.push('unresolved open loop')
  }
  if (memory.state.epistemic === 'contested' || links.some(link => link.relation === 'contradicts' || link.state === 'contested')) {
    score += 2
    priorities.push('conflict')
    reasons.push('unresolved epistemic conflict')
  }
  if (memory.state.integration !== 'integrated') {
    score += 1
    priorities.push('unintegrated')
    reasons.push('representation is not integrated')
  }
  const crossSceneLinks = links.filter(link => CROSS_SCENE_RELATIONS.has(link.relation) && connectsSceneMemories(memory, link, memories)).length
  if (crossSceneLinks > 0) {
    score += Math.min(2, crossSceneLinks * 0.4)
    priorities.push('cross-scene')
    reasons.push('connected to ' + crossSceneLinks + ' active cross-scene relation(s)')
  }
  const impact = memory.dynamics.salience + memory.dynamics.surprise + memory.dynamics.affect.arousal
  if (impact > 1.2) {
    score += Math.min(2, impact)
    priorities.push('impact')
    reasons.push('high salience/surprise/affect impact')
  }
  if (repetitionCount > 1) {
    score += Math.min(0.75, (repetitionCount - 1) * 0.15)
    reasons.push('repeated actual use=' + repetitionCount + '; repetition cannot upgrade epistemic state')
  }
  return { score, priorities: [...new Set(priorities)], reasons }
}

/**
 * Selects labile representations for one offline consolidation pass.
 *
 * This is a planning snapshot, not a write operation. It only considers actual
 * use traces for the current memory version, groups linked scene memories, and
 * never changes epistemic state merely because a representation was repeated.
 */
export function planConsolidationSchedule(
  input: MemoryConsolidationScheduleInput,
): MemoryConsolidationSchedule {
  const atMs = parseTime(input.at, 'schedule at')
  const maxItems = Math.min(
    CONSOLIDATION_SCHEDULE_MAX_ITEMS,
    Math.max(1, Math.trunc(input.maxItems ?? 16)),
  )
  const memories = new Map(input.memories.map(memory => [String(memory.id), createMemory(memory)]))
  const tracesByMemory = new Map<string, MemoryUseTrace[]>()
  for (const trace of input.useTraces) {
    const traces = tracesByMemory.get(String(trace.memoryId)) ?? []
    traces.push(trace)
    tracesByMemory.set(String(trace.memoryId), traces)
  }
  const candidates = [...memories.values()].flatMap(memory => {
    if (memory.state.persistence === 'archived' || memory.state.persistence === 'erased'
      || memory.state.epistemic === 'superseded' || memory.state.epistemic === 'rejected') return []
    const traces = (tracesByMemory.get(String(memory.id)) ?? [])
      .filter(trace => trace.memoryVersion === memory.updatedAt && Date.parse(trace.usedAt) <= atMs)
      .sort((left, right) => Date.parse(right.usedAt) - Date.parse(left.usedAt) || right.id.localeCompare(left.id))
    const latest = traces[0]
    if (latest === undefined) return []
    const labile = openLabileWindow(memory, latest)
    if (atMs > Date.parse(labile.expiresAt)) return []
    const relatedLinks = input.links.filter(link =>
      (String(link.from) === String(memory.id) || String(link.to) === String(memory.id))
      && activeVersionLink(link, memories),
    )
    const pressure = schedulePressure(memory, relatedLinks, traces.length, memories)
    return [{
      memoryId: memory.id,
      memoryVersion: memory.updatedAt,
      useTraceId: latest.id,
      labile,
      score: pressure.score,
      repetitionCount: traces.length,
      priorities: pressure.priorities,
      reasons: pressure.reasons,
      confidenceNeedsIndependentEvidence: true as const,
      groupId: '',
    } satisfies MemoryConsolidationWorkItem]
  }).sort((left, right) => right.score - left.score || String(left.memoryId).localeCompare(String(right.memoryId)))
    .slice(0, maxItems)
  const candidateIds = new Set(candidates.map(item => String(item.memoryId)))
  const findGroups = unionFind([...candidateIds])
  for (const link of input.links) {
    const left = String(link.from)
    const right = String(link.to)
    if (!candidateIds.has(left) || !candidateIds.has(right) || !activeVersionLink(link, memories)) continue
    const leftMemory = memories.get(left)
    const rightMemory = memories.get(right)
    if (leftMemory?.form !== 'scene' || rightMemory?.form !== 'scene' || !CROSS_SCENE_RELATIONS.has(link.relation)) continue
    findGroups.join(left, right)
  }
  const groupMembers = new Map<string, string[]>()
  for (const id of candidateIds) {
    const root = findGroups.find(id)
    const members = groupMembers.get(root) ?? []
    members.push(id)
    groupMembers.set(root, members)
  }
  const groupIds = new Map<string, string>()
  const groups: MemoryConsolidationGroup[] = []
  for (const members of [...groupMembers.values()].sort((left, right) => left.join('').localeCompare(right.join('')))) {
    members.sort((left, right) => left.localeCompare(right))
    const id = 'consolidation-group:' + members.join(',')
    const crossScene = members.length > 1
    groupIds.set(members[0] as string, id)
    for (const member of members) groupIds.set(member, id)
    groups.push({
      id,
      memoryIds: members as MemoryId[],
      crossScene,
      reasons: crossScene ? ['linked scene memories scheduled together'] : ['single-memory labile work item'],
    })
  }
  const items = candidates.map(item => ({
    ...item,
    groupId: groupIds.get(String(item.memoryId)) ?? 'consolidation-group:' + String(item.memoryId),
  }))
  return deepFreeze({
    at: new Date(atMs).toISOString(),
    items,
    groups: groups.sort((left, right) => left.id.localeCompare(right.id)),
  })
}


export const MEMORY_DECAY_SCHEMA_VERSION = 1 as const
export const MEMORY_DECAY_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1_000
const MAX_DECAY_ELAPSED_MS = 365 * 24 * 60 * 60 * 1_000

export type MemoryDecayInput = Readonly<{
  memory: RinMemory
  links: readonly MemoryLink[]
  elapsedMs: number
  at: string
  explanation: string
}>

export type MemoryDecayResult = Readonly<{
  schemaVersion: typeof MEMORY_DECAY_SCHEMA_VERSION
  memoryId: MemoryId
  previousVersion: string
  elapsedMs: number
  memory: RinMemory
  links: readonly MemoryLink[]
  explanation: string
}>

export function assertMemoryDecayResult(value: unknown): asserts value is MemoryDecayResult {
  if (!isRecord(value) || value.schemaVersion !== MEMORY_DECAY_SCHEMA_VERSION) {
    throw new Error('rin memory decay: unsupported result schema')
  }
  assertText(value.memoryId, 'decay.memoryId')
  assertTimestamp(value.previousVersion, 'decay.previousVersion')
  const elapsedMs = value.elapsedMs
  if (typeof elapsedMs !== 'number' || !Number.isSafeInteger(elapsedMs) || elapsedMs <= 0 || elapsedMs > MAX_DECAY_ELAPSED_MS) {
    throw new Error('rin memory decay: elapsedMs is outside the allowed range')
  }
  assertText(value.explanation, 'decay.explanation')
  if (!isRecord(value.memory)) throw new Error('rin memory decay: result.memory must be an object')
  const memory = createMemory(value.memory as RinMemory)
  if (memory.id !== value.memoryId) {
    throw new Error('rin memory decay: result memory id does not match memoryId')
  }
  if (Date.parse(memory.updatedAt) <= Date.parse(value.previousVersion)) {
    throw new Error('rin memory decay: result memory must be newer than previousVersion')
  }
  if (!Array.isArray(value.links)) throw new Error('rin memory decay: result.links must be an array')
  const linkIds = new Set<string>()
  for (const [index, entry] of value.links.entries()) {
    if (!isRecord(entry)) throw new Error('rin memory decay: result link ' + index + ' must be an object')
    const link = createMemoryLink(entry as MemoryLink)
    if (linkIds.has(String(link.id))) throw new Error('rin memory decay: result.links must have unique ids')
    linkIds.add(String(link.id))
  }
}

function assertDecaySource(memory: RinMemory): void {
  if (memory.state.persistence !== 'durable') {
    throw new Error('rin memory decay: only durable memory can decay')
  }
  if (memory.state.epistemic === 'superseded' || memory.state.epistemic === 'rejected') {
    throw new Error('rin memory decay: terminal epistemic memory cannot decay')
  }
}

function assertDecayLinkSet(memory: RinMemory, links: readonly MemoryLink[], atMs: number): void {
  const linkIds = new Set<string>()
  for (const link of links) {
    if (linkIds.has(String(link.id))) throw new Error('rin memory decay: links must have unique ids')
    linkIds.add(String(link.id))
    createMemoryLink(link)
    if (link.state !== 'active' || (link.from !== memory.id && link.to !== memory.id)) continue
    if (Date.parse(link.createdAt) > atMs) {
      throw new Error('rin memory decay: active link cannot begin after decay time')
    }
    const sourceVersion = link.from === memory.id ? link.fromVersion : link.toVersion
    if (sourceVersion !== memory.updatedAt) {
      throw new Error('rin memory decay: active link targets a stale source version')
    }
  }
}

/**
 * Applies time-dependent accessibility decay to one durable representation and
 * its active incident links.
 *
 * Decay is a dynamic update only: content, state, epistemic status, confidence,
 * validity, and influence surfaces remain unchanged. The result is an immutable
 * materialization candidate for a background cognition transaction.
 */
export function decayMemory(input: MemoryDecayInput): MemoryDecayResult {
  const memory = createMemory(input.memory)
  const previousVersion = memory.updatedAt
  const previousMs = parseTime(previousVersion, 'decay.previousVersion')
  const atMs = parseTime(input.at, 'decay.at')
  assertDecaySource(memory)
  assertText(input.explanation, 'decay.explanation')
  if (atMs <= previousMs) throw new Error('rin memory decay: decay time must be newer than memory version')
  if (!Number.isSafeInteger(input.elapsedMs) || input.elapsedMs <= 0 || input.elapsedMs > MAX_DECAY_ELAPSED_MS) {
    throw new Error('rin memory decay: elapsedMs is outside the allowed range')
  }
  if (input.elapsedMs !== atMs - previousMs) {
    throw new Error('rin memory decay: elapsedMs must equal the memory version time delta')
  }
  assertDecayLinkSet(memory, input.links, atMs)
  const factor = Math.exp(
    -Math.LN2 * input.elapsedMs
    / (MEMORY_DECAY_HALF_LIFE_MS * (0.5 + memory.dynamics.stability)),
  )
  const at = new Date(atMs).toISOString()
  const decayed = createMemory({
    ...memory,
    updatedAt: at,
    dynamics: {
      ...memory.dynamics,
      accessibility: clamp(memory.dynamics.accessibility * factor),
    },
  })
  const links = input.links
    .filter(link => link.state === 'active' && (link.from === memory.id || link.to === memory.id))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
    .map(link => createMemoryLink({
      ...link,
      fromVersion: link.from === memory.id ? at : link.fromVersion,
      toVersion: link.to === memory.id ? at : link.toVersion,
      strength: clamp(link.strength * factor),
      updatedAt: at,
    }))
  return deepFreeze({
    schemaVersion: MEMORY_DECAY_SCHEMA_VERSION,
    memoryId: memory.id,
    previousVersion,
    elapsedMs: input.elapsedMs,
    memory: decayed,
    links,
    explanation: input.explanation,
  })
}





export type DispositionSkillProjection = Readonly<{
  sourceMemoryId: MemoryId
  sourceVersion: string
  name: string
  description: string
  markdown: string
}>

/**
 * Rebuilds one executable skill artifact from the canonical disposition.
 *
 * The artifact is a projection: it carries no independent truth and is never
 * used as a write source for the cognition model. Re-running this function
 * with the same disposition version produces the same bytes.
 */
export function projectDispositionToSkill(
  memory: RinMemory,
): DispositionSkillProjection {
  const disposition = createMemory(memory)
  if (disposition.form !== 'disposition') {
    throw new Error('rin memory projection: skill source must be a disposition')
  }
  if (disposition.state.persistence !== 'durable'
    || disposition.state.integration !== 'integrated'
    || disposition.state.influence !== 'permitted'
    || (disposition.state.epistemic !== 'observed' && disposition.state.epistemic !== 'inferred')) {
    throw new Error('rin memory projection: skill source must be durable, integrated, permitted, and non-contested')
  }
  const sourceMemoryId = String(disposition.id)
  const slug = sourceMemoryId
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'disposition'
  const name = 'rin-' + slug
  const description = 'Executable behavior pattern for ' + disposition.data.intendedGoal
  const list = (label: string, values: readonly string[]): string[] => [
    '## ' + label,
    ...(values.length === 0 ? ['- none recorded'] : values.map(value => '- ' + value)),
    '',
  ]
  const markdown = [
    '---',
    'name: ' + name,
    'description: "' + description.replace(/"/g, '\\\"') + '"',
    'generated_from: disposition',
    'source_memory_id: ' + sourceMemoryId,
    'source_memory_version: ' + disposition.updatedAt,
    '---',
    '',
    '# ' + name,
    '',
    'Use this projection only when the triggering context and applicability conditions match.',
    '',
    ...list('Triggering contexts', disposition.data.triggeringContexts),
    ...list('Action pattern', disposition.data.actionPattern),
    ...list('Expected outcomes', disposition.data.expectedOutcomes),
    ...list('Applicability conditions', disposition.data.applicabilityConditions),
    ...list('Failure modes', disposition.data.failureModes),
  ].join('\n')
  return Object.freeze({
    sourceMemoryId: disposition.id,
    sourceVersion: disposition.updatedAt,
    name,
    description,
    markdown,
  })
}
