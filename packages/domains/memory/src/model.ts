/**
 * Rin's unified in-memory cognition model.
 *
 * Eight representation forms share one identity, five orthogonal state axes,
 * and one set of dynamic quantities. This module validates construction and
 * returns immutable values from every transition; storage, events, and
 * authorization are added by later Wave 1 tasks.
 *
 * @module @rin/memory
 */

type Branded<Name extends string> = string & {
  readonly __rinMemoryBrand: Name
}

export type MemoryId = Branded<'MemoryId'>
export type LinkId = Branded<'LinkId'>
export type ParticipantId = Branded<'ParticipantId'>
export type GoalId = Branded<'GoalId'>
export type EvidenceId = Branded<'EvidenceId'>

export type ActionId = Branded<'ActionId'>
export type PredictionId = Branded<'PredictionId'>
export type OutcomeId = Branded<'OutcomeId'>
export type FeedbackId = Branded<'FeedbackId'>
export type WorkspaceCycleId = Branded<'WorkspaceCycleId'>
export class MemoryModelError extends Error {
  constructor(message: string) {
    super('rin memory model: ' + message)
    this.name = 'MemoryModelError'
  }
}

function createId<Name extends string>(value: string, label: string): Branded<Name> {
  if (value.trim() === '' || /\s/.test(value)) {
    throw new MemoryModelError(label + ' must be a non-empty token without whitespace')
  }
  return value as Branded<Name>
}

/** Create an opaque ID for one logical memory representation. */
export function createMemoryId(value: string): MemoryId {
  return createId(value, 'memory id')
}

/** Create an opaque ID for one typed relation between memory representations. */
export function createLinkId(value: string): LinkId {
  return createId(value, 'link id')
}

/** Create an opaque ID for a participant in a scene or relationship. */
export function createParticipantId(value: string): ParticipantId {
  return createId(value, 'participant id')
}

/** Create an opaque ID for a goal referenced by a scene, disposition, or open loop. */
export function createGoalId(value: string): GoalId {
  return createId(value, 'goal id')
}

/** Create an opaque ID for evidence used by an epistemic transition. */
export function createEvidenceId(value: string): EvidenceId {
  return createId(value, 'evidence id')
}

/** Create an opaque ID for an action selected from a model-visible workspace. */
export function createActionId(value: string): ActionId {
  return createId(value, 'action id')
}

/** Create an opaque ID for a prediction made from a model-visible workspace. */
export function createPredictionId(value: string): PredictionId {
  return createId(value, 'prediction id')
}

/** Create an opaque ID for an observed or delayed action outcome. */
export function createOutcomeId(value: string): OutcomeId {
  return createId(value, 'outcome id')
}

/** Create an opaque ID for user or environment feedback. */
export function createFeedbackId(value: string): FeedbackId {
  return createId(value, 'feedback id')
}

/** Create an opaque ID for one model-visible workspace cycle. */
export function createWorkspaceCycleId(value: string): WorkspaceCycleId {
  return createId(value, 'workspace cycle id')
}

export const PERSISTENCE_STATES = [
  'transient',
  'encoded',
  'durable',
  'archived',
  'erased',
] as const
export type PersistenceState = typeof PERSISTENCE_STATES[number]

export const ACTIVATION_STATES = [
  'dormant',
  'primed',
  'active',
  'workspace',
] as const
export type ActivationState = typeof ACTIVATION_STATES[number]

export const INTEGRATION_STATES = [
  'raw',
  'linked',
  'consolidating',
  'integrated',
] as const
export type IntegrationState = typeof INTEGRATION_STATES[number]

export const EPISTEMIC_STATES = [
  'observed',
  'inferred',
  'hypothesized',
  'contested',
  'superseded',
  'rejected',
] as const
export type EpistemicState = typeof EPISTEMIC_STATES[number]

export const INFLUENCE_STATES = [
  'permitted',
  'restricted',
  'blocked',
  'revoked',
] as const
export type InfluenceState = typeof INFLUENCE_STATES[number]

/** The five orthogonal axes defined by the memory blueprint. */
export type MemoryState = Readonly<{
  persistence: PersistenceState
  activation: ActivationState
  integration: IntegrationState
  epistemic: EpistemicState
  influence: InfluenceState
}>

export const MEMORY_INFLUENCE_SURFACES = [
  'recall',
  'model-input',
  'action-selection',
  'relationship-expression',
  'planning',
] as const
export type MemoryInfluenceSurface = typeof MEMORY_INFLUENCE_SURFACES[number]

export type MemoryAffect = Readonly<{
  valence: number
  arousal: number
  control: number
}>

export type RuntimeEventKind = 'observation' | 'action' | 'outcome'

/** Exact occurrence locator retained inside a scene representation. */
export type RuntimeEventRef = Readonly<{
  source: 'dsh-session'
  sessionId: string
  eventSeq: number
  eventType: string
  kind: RuntimeEventKind
  correlationKey?: string
}>

export type MemoryValidity = Readonly<{
  startsAt: string
  endsAt?: string
}>

export function isMemoryValidityActiveAt(validity: MemoryValidity, at: string): boolean {
  const timestamp = Date.parse(at)
  const startsAt = Date.parse(validity.startsAt)
  const endsAt = validity.endsAt === undefined ? undefined : Date.parse(validity.endsAt)
  return Number.isFinite(timestamp)
    && Number.isFinite(startsAt)
    && (endsAt === undefined || Number.isFinite(endsAt))
    && startsAt <= timestamp
    && (endsAt === undefined || timestamp <= endsAt)
}

export const MEMORY_LINK_RELATIONS = [
  'temporal-before',
  'temporal-overlap',
  'part-of',
  'continues',
  'supports',
  'derives',
  'contradicts',
  'supersedes',
  'similar-to',
  'context-of',
  'caused-by',
  'predicts',
  'actor-of',
  'about-person',
  'shared-with',
  'relationship-context',
  'action-led-to',
  'feedback-for',
  'simulates',
] as const
export type MemoryLinkRelation = typeof MEMORY_LINK_RELATIONS[number]

export const MEMORY_LINK_STATES = [
  'active',
  'contested',
  'superseded',
  'retracted',
] as const
export type MemoryLinkState = typeof MEMORY_LINK_STATES[number]

/** A typed edge between two immutable representation versions. */
export type MemoryLink = Readonly<{
  id: LinkId
  from: MemoryId
  relation: MemoryLinkRelation
  to: MemoryId
  fromVersion: string
  toVersion: string
  strength: number
  validity: MemoryValidity
  state: MemoryLinkState
  createdAt: string
  updatedAt: string
}>
export type MemoryGoalUtility = Readonly<{
  goalId: GoalId
  value: number
}>

/**
 * Dynamic quantities are intentionally not collapsed into one importance score.
 */
export type MemoryDynamics = Readonly<{
  activation: number
  accessibility: number
  salience: number
  stability: number
  confidence: number
  integrationStrength: number
  novelty: number
  surprise: number
  affect: MemoryAffect
  validity: MemoryValidity
  utilityByGoal: readonly MemoryGoalUtility[]
  inhibition: number
  influenceSurfaces: readonly MemoryInfluenceSurface[]
}>

export type MemoryAction = Readonly<{
  actor: ParticipantId
  description: string
  result?: string
}>

export type MemoryOutcome = Readonly<{
  description: string
  status: 'expected' | 'observed' | 'failed'
}>

export type MemoryPredictionError = Readonly<{
  expected: string
  actual: string
  magnitude: number
}>


/** A prediction made from one concrete model-visible workspace. */
export type MemoryPredictionRecord = Readonly<{
  id: PredictionId
  cycleId: WorkspaceCycleId
  statement: string
  sourceMemoryIds: readonly MemoryId[]
  expectedOutcome: string
  targetTime?: string
  epistemic: 'hypothesized'
  createdAt: string
}>

/** A selected action with the exact workspace and predictions that informed it. */
export type MemoryActionRecord = Readonly<{
  id: ActionId
  cycleId: WorkspaceCycleId
  sessionId?: string
  correlationKey?: string
  workspaceHash: string
  actor: ParticipantId
  description: string
  goalIds: readonly GoalId[]
  sourceMemoryIds: readonly MemoryId[]
  predictionIds: readonly PredictionId[]
  occurredAt: string
}>

export type MemoryOutcomeStatus = 'observed' | 'failed' | 'partial' | 'unknown'

/** An immediate or delayed result linked back to the action that produced it. */
export type MemoryOutcomeRecord = Readonly<{
  id: OutcomeId
  cycleId: WorkspaceCycleId
  sessionId?: string
  correlationKey?: string
  actionId: ActionId
  predictionId?: PredictionId
  status: MemoryOutcomeStatus
  description: string
  occurredAt: string
  delayed: boolean
}>

export type MemoryFeedbackKind = 'accept' | 'correct' | 'reject' | 'ignore' | 'boundary'
export type MemoryUserResponse = 'accepted' | 'corrected' | 'rejected' | 'ignored' | 'unclear'
export type MemoryBoundaryRespect = 'respected' | 'crossed' | 'changed' | 'unclear'

/** A multidimensional feedback vector; it is never collapsed into one reward. */
export type MemoryFeedbackVector = Readonly<{
  id: FeedbackId
  cycleId: WorkspaceCycleId
  sessionId?: string
  kind: MemoryFeedbackKind
  actionId?: ActionId
  predictionId?: PredictionId
  outcomeId?: OutcomeId
  sceneId?: MemoryId
  dispositionId?: MemoryId
  taskOutcome: number
  actionCost: number
  factualCorrection?: string
  predictionAccuracy?: number
  userResponse?: MemoryUserResponse
  relationshipConsequence?: number
  boundaryRespect?: MemoryBoundaryRespect
  autonomyEffect?: number
  safetyEffect?: number
  delayedConsequence?: string
  explanation: string
  occurredAt: string
  delayed: boolean
}>
export type SceneLifecycle = Readonly<{
  continuityKey: string
  status: 'open' | 'closed'
  startedAt: string
  endedAt?: string
}>

export type SceneData = Readonly<{
  participants: readonly ParticipantId[]
  environment: string
  goals: readonly GoalId[]
  observations: readonly string[]
  interpretations: readonly string[]
  actions: readonly MemoryAction[]
  outcomes: readonly MemoryOutcome[]
  predictionErrors: readonly MemoryPredictionError[]
  affect: MemoryAffect
  lifecycle?: SceneLifecycle
  runtimeEventRefs?: readonly RuntimeEventRef[]
}>

/**
 * The one materialized field through which Rin represents what is currently
 * happening. It is a derived cognition state, not a ninth memory form.
 */
export type CurrentFieldActionSource = Readonly<{
  action: string
  sourceMemoryIds: readonly MemoryId[]
  utility: number
  inhibition: number
  selectionValue: number
  reasons: readonly string[]
}>

export type CurrentField = Readonly<{
  ownerId: string
  version: number
  updatedAt: string
  sceneId?: MemoryId
  sceneVersion?: string
  sceneStatus?: SceneLifecycle['status']
  participants: readonly ParticipantId[]
  goals: readonly GoalId[]
  affect: MemoryAffect
  predictions: readonly MemoryId[]
  predictionErrors: readonly MemoryPredictionError[]
  activeOpenLoops: readonly MemoryId[]
  candidateActions: readonly string[]
  candidateActionSources?: readonly CurrentFieldActionSource[]
  activeMemoryCoalition: readonly MemoryId[]
  uncertainty: readonly string[]
}>
export type MemoryRelation = Readonly<{
  from: string
  relation: string
  to: string
}>

export type StructureData = Readonly<{
  entities: readonly string[]
  relations: readonly MemoryRelation[]
  concepts: readonly string[]
  causalPatterns: readonly string[]
  validity: MemoryValidity
}>

export type SelfModelData = Readonly<{
  values: readonly string[]
  abilities: readonly string[]
  tendencies: readonly string[]
  historicalChanges: readonly string[]
}>

export type PersonModelData = Readonly<{
  subject: ParticipantId
  claims: readonly string[]
  observedPatterns: readonly string[]
  currentState: readonly string[]
  lastObservedAt: string
  contextConditions?: readonly string[]
  stateByContext?: readonly Readonly<{
    context: string
    state: readonly string[]
    observedAt: string
  }>[]
}>

export type RelationshipData = Readonly<{
  participants: readonly [ParticipantId, ParticipantId]
  sharedMemoryIds: readonly MemoryId[]
  commitments: readonly string[]
  boundaries: readonly string[]
  conflicts: readonly string[]
  expectations: readonly string[]
  distance: number
}>

export type DispositionData = Readonly<{
  triggeringContexts: readonly string[]
  intendedGoal: GoalId
  actionPattern: readonly string[]
  supportingActionIds?: readonly ActionId[]
  supportingOutcomeIds?: readonly OutcomeId[]
  supportingFeedbackIds?: readonly FeedbackId[]
  sampleCount?: number
  expectedOutcomes: readonly string[]
  observedOutcomes: readonly string[]
  applicabilityConditions: readonly string[]
  failureModes: readonly string[]
  utilityByGoal: readonly MemoryGoalUtility[]
}>
export type OpenLoopResolution = Readonly<{
  description: string
  status: 'observed' | 'failed'
  occurredAt: string
  eventRef?: RuntimeEventRef
}>
export type OpenLoopData = Readonly<{
  goal: GoalId
  description: string
  relatedMemoryIds: readonly MemoryId[]
  status: 'open' | 'resolved' | 'abandoned'
  origin?: RuntimeEventRef
  resolution?: OpenLoopResolution
}>

export type ProspectData = Readonly<{
  kind: 'prediction' | 'plan' | 'counterfactual' | 'dream'
  premise: string
  possibleOutcomes: readonly string[]
  relatedMemoryIds: readonly MemoryId[]
  targetTime?: string
}>

export type MemoryForm =
  | Readonly<{ form: 'scene'; data: SceneData }>
  | Readonly<{ form: 'structure'; data: StructureData }>
  | Readonly<{ form: 'self-model'; data: SelfModelData }>
  | Readonly<{ form: 'person-model'; data: PersonModelData }>
  | Readonly<{ form: 'relationship-model'; data: RelationshipData }>
  | Readonly<{ form: 'disposition'; data: DispositionData }>
  | Readonly<{ form: 'open-loop'; data: OpenLoopData }>
  | Readonly<{ form: 'prospect'; data: ProspectData }>

type MemoryEnvelope = Readonly<{
  id: MemoryId
  state: MemoryState
  dynamics: MemoryDynamics
  createdAt: string
  updatedAt: string
}> & MemoryForm

/** One logical Rin memory value, regardless of its current representation form. */
export type RinMemory = MemoryEnvelope

function matchesContextCondition(condition: string, sceneContext: readonly string[]): boolean {
  const normalizedCondition = condition.normalize('NFKC').toLocaleLowerCase().trim()
  if (normalizedCondition === '') return false
  return sceneContext.some(value => {
    const normalizedValue = value.normalize('NFKC').toLocaleLowerCase().trim()
    return normalizedValue !== ''
      && (normalizedValue.includes(normalizedCondition) || normalizedCondition.includes(normalizedValue))
  })
}

/** Return the contexts in which a contextual person model is allowed to apply. */
export function memoryContextConditions(memory: RinMemory): readonly string[] {
  if (memory.form !== 'person-model') return []
  if (memory.data.contextConditions !== undefined && memory.data.contextConditions.length > 0) {
    return memory.data.contextConditions
  }
  return memory.data.stateByContext?.map(entry => entry.context) ?? []
}

/** Contextual person state is active only when the current scene matches its learned context. */
export function isMemoryContextActiveForScene(
  memory: RinMemory,
  scene: Extract<RinMemory, { form: 'scene' }>,
): boolean {
  const conditions = memoryContextConditions(memory)
  if (conditions.length === 0) return true
  const sceneContext = [scene.data.environment, ...scene.data.observations, ...scene.data.interpretations]
  return conditions.some(condition => matchesContextCondition(condition, sceneContext))
}

export function assertMemoryLinkSemantics(link: MemoryLink, from: RinMemory, to: RinMemory): void {
  if (link.relation !== 'simulates') return
  if (from.form !== 'prospect') {
    throw new MemoryModelError('simulates link source must be a prospect memory')
  }
  if (!from.data.relatedMemoryIds.some(id => String(id) === String(to.id))) {
    throw new MemoryModelError('simulates link target must be declared by the prospect')
  }
}

/** The canonical version cursor used when a link targets a representation. */
export function memoryVersion(memory: RinMemory): string {
  return memory.updatedAt
}

/** Construction input; all defaults are explicit instead of hidden in run-time code. */
export type MemoryDraft = MemoryEnvelope

export type EpistemicBasis =
  | 'direct-observation'
  | 'user-report'
  | 'new-evidence'
  | 'model-inference'
  | 'model-proposal'
  | 'user-correction'

export type MemoryTransition =
  | Readonly<{ type: 'encode'; at: string }>
  | Readonly<{ type: 'durable'; at: string }>
  | Readonly<{ type: 'archive'; at: string }>
  | Readonly<{ type: 'prime'; at: string }>
  | Readonly<{ type: 'activate'; at: string }>
  | Readonly<{ type: 'workspace'; at: string }>
  | Readonly<{ type: 'cool'; at: string }>
  | Readonly<{ type: 'deactivate'; at: string }>
  | Readonly<{ type: 'link'; at: string }>
  | Readonly<{ type: 'consolidate'; at: string }>
  | Readonly<{ type: 'integrate'; at: string }>
  | Readonly<{
      type: 'epistemic'
      to: EpistemicState
      basis: EpistemicBasis
      evidenceIds: readonly EvidenceId[]
      at: string
    }>
  | Readonly<{
      type: 'influence'
      to: InfluenceState
      surfaces: readonly MemoryInfluenceSurface[]
      at: string
    }>

function assertTimestamp(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '' || !Number.isFinite(Date.parse(value))) {
    throw new MemoryModelError(label + ' must be a valid timestamp')
  }
}

function assertRange(value: unknown, min: number, max: number, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new MemoryModelError(label + ' must be between ' + min + ' and ' + max)
  }
}

function assertText(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new MemoryModelError(label + ' must be a non-empty string')
  }
}

function assertStringArray(value: unknown, label: string): asserts value is readonly string[] {
  if (!Array.isArray(value)) throw new MemoryModelError(label + ' must be an array')
  for (const entry of value) assertText(entry, label + ' entry')
}

function assertUniqueStrings(value: readonly string[], label: string): void {
  if (new Set(value).size !== value.length) {
    throw new MemoryModelError(label + ' must not contain duplicates')
  }
}

function assertIdArray(value: unknown, label: string): asserts value is readonly string[] {
  assertStringArray(value, label)
  assertUniqueStrings(value, label)
}

function assertChoice(value: unknown, choices: readonly string[], label: string): void {
  if (typeof value !== 'string' || !choices.includes(value)) {
    throw new MemoryModelError(label + ' is invalid')
  }
}

function validateValidity(value: MemoryValidity, label: string): void {
  assertTimestamp(value.startsAt, label + '.startsAt')
  if (value.endsAt !== undefined) {
    assertTimestamp(value.endsAt, label + '.endsAt')
    if (Date.parse(value.endsAt) < Date.parse(value.startsAt)) {
      throw new MemoryModelError(label + '.endsAt must not precede startsAt')
    }
  }
}

function validateLink(link: MemoryLink, label = 'memory link'): void {
  if (typeof link.id !== 'string') throw new MemoryModelError(label + '.id is invalid')
  if (typeof link.from !== 'string') throw new MemoryModelError(label + '.from is invalid')
  if (typeof link.to !== 'string') throw new MemoryModelError(label + '.to is invalid')
  if (link.from === link.to) throw new MemoryModelError(label + ' cannot connect a memory to itself')
  assertChoice(link.relation, MEMORY_LINK_RELATIONS, label + '.relation')
  assertText(link.fromVersion, label + '.fromVersion')
  assertText(link.toVersion, label + '.toVersion')
  assertRange(link.strength, 0, 1, label + '.strength')
  validateValidity(link.validity, label + '.validity')
  assertChoice(link.state, MEMORY_LINK_STATES, label + '.state')
  assertTimestamp(link.createdAt, label + '.createdAt')
  assertTimestamp(link.updatedAt, label + '.updatedAt')
  if (Date.parse(link.updatedAt) < Date.parse(link.createdAt)) {
    throw new MemoryModelError(label + '.updatedAt must not precede createdAt')
  }
}

function validateAffect(value: MemoryAffect, label: string): void {
  assertRange(value.valence, -1, 1, label + '.valence')
  assertRange(value.arousal, 0, 1, label + '.arousal')
  assertRange(value.control, 0, 1, label + '.control')
}

function validateCurrentField(field: CurrentField): void {
  assertText(field.ownerId, 'current field.ownerId')
  if (!Number.isSafeInteger(field.version) || field.version < 0) {
    throw new MemoryModelError('current field.version must be a non-negative safe integer')
  }
  assertTimestamp(field.updatedAt, 'current field.updatedAt')
  if (field.sceneId === undefined) {
    if (field.sceneVersion !== undefined || field.sceneStatus !== undefined) {
      throw new MemoryModelError('current field scene metadata requires sceneId')
    }
  } else {
    assertText(field.sceneId, 'current field.sceneId')
    assertTimestamp(field.sceneVersion, 'current field.sceneVersion')
    assertChoice(field.sceneStatus, ['open', 'closed'], 'current field.sceneStatus')
  }
  assertIdArray(field.participants, 'current field.participants')
  assertIdArray(field.goals, 'current field.goals')
  validateAffect(field.affect, 'current field.affect')
  assertIdArray(field.predictions, 'current field.predictions')
  for (const predictionError of field.predictionErrors) {
    assertText(predictionError.expected, 'current field prediction error expected')
    assertText(predictionError.actual, 'current field prediction error actual')
    assertRange(predictionError.magnitude, 0, 1, 'current field prediction error magnitude')
  }
  assertIdArray(field.activeOpenLoops, 'current field.activeOpenLoops')
  assertStringArray(field.candidateActions, 'current field.candidateActions')
  if (field.candidateActionSources !== undefined) {
    for (const source of field.candidateActionSources) {
      assertText(source.action, 'current field candidate action source action')
      assertIdArray(source.sourceMemoryIds, 'current field candidate action source memory ids')
      if (source.sourceMemoryIds.length === 0) {
        throw new MemoryModelError('current field candidate action source requires at least one source memory id')
      }
      assertRange(source.utility, -1, 1, 'current field candidate action source utility')
      assertRange(source.inhibition, 0, 1, 'current field candidate action source inhibition')
      assertRange(source.selectionValue, -1, 1, 'current field candidate action source selection value')
      assertStringArray(source.reasons, 'current field candidate action source reasons')
      if (!field.candidateActions.includes(source.action)) {
        throw new MemoryModelError('current field candidate action source must reference a candidate action')
      }
    }
  }
  assertIdArray(field.activeMemoryCoalition, 'current field.activeMemoryCoalition')
  assertStringArray(field.uncertainty, 'current field.uncertainty')
}

function validateRuntimeEventRef(value: RuntimeEventRef, label: string): void {
  if (value.source !== 'dsh-session') throw new MemoryModelError(label + '.source is invalid')
  assertText(value.sessionId, label + '.sessionId')
  if (!Number.isSafeInteger(value.eventSeq) || value.eventSeq < 0) {
    throw new MemoryModelError(label + '.eventSeq must be a non-negative safe integer')
  }
  assertText(value.eventType, label + '.eventType')
  assertChoice(value.kind, ['observation', 'action', 'outcome'], label + '.kind')
  if (value.correlationKey !== undefined) assertText(value.correlationKey, label + '.correlationKey')

}
function validateSceneLifecycle(value: SceneLifecycle, label: string): void {
  assertText(value.continuityKey, label + '.continuityKey')
  assertChoice(value.status, ['open', 'closed'], label + '.status')
  assertTimestamp(value.startedAt, label + '.startedAt')
  if (value.status === 'closed') {
    if (value.endedAt === undefined) throw new MemoryModelError(label + '.endedAt is required when closed')
    assertTimestamp(value.endedAt, label + '.endedAt')
    if (Date.parse(value.endedAt) < Date.parse(value.startedAt)) {
      throw new MemoryModelError(label + '.endedAt must not precede startedAt')
    }
  } else if (value.endedAt !== undefined) {
    throw new MemoryModelError(label + '.endedAt is not allowed while open')
  }
}
function validateDynamics(value: MemoryDynamics, state: MemoryState): void {
  assertRange(value.activation, 0, 1, 'dynamics.activation')
  assertRange(value.accessibility, 0, 1, 'dynamics.accessibility')
  assertRange(value.salience, 0, 1, 'dynamics.salience')
  assertRange(value.stability, 0, 1, 'dynamics.stability')
  assertRange(value.confidence, 0, 1, 'dynamics.confidence')
  assertRange(value.integrationStrength, 0, 1, 'dynamics.integrationStrength')
  assertRange(value.novelty, 0, 1, 'dynamics.novelty')
  assertRange(value.surprise, 0, 1, 'dynamics.surprise')
  validateAffect(value.affect, 'dynamics.affect')
  validateValidity(value.validity, 'dynamics.validity')
  if (!Array.isArray(value.utilityByGoal)) {
    throw new MemoryModelError('dynamics.utilityByGoal must be an array')
  }
  const goalIds: string[] = []
  for (const utility of value.utilityByGoal) {
    if (typeof utility.goalId !== 'string') throw new MemoryModelError('dynamics.utilityByGoal has an invalid goal id')
    assertRange(utility.value, -1, 1, 'dynamics.utilityByGoal.value')
    goalIds.push(utility.goalId)
  }
  assertUniqueStrings(goalIds, 'dynamics.utilityByGoal')
  assertRange(value.inhibition, 0, 1, 'dynamics.inhibition')
  assertStringArray(value.influenceSurfaces, 'dynamics.influenceSurfaces')
  assertUniqueStrings(value.influenceSurfaces, 'dynamics.influenceSurfaces')
  for (const surface of value.influenceSurfaces) {
    assertChoice(surface, MEMORY_INFLUENCE_SURFACES, 'dynamics.influenceSurfaces entry')
  }
  if (state.influence === 'permitted' && value.influenceSurfaces.length === 0) {
    throw new MemoryModelError('permitted memory must name at least one influence surface')
  }
  if ((state.influence === 'blocked' || state.influence === 'revoked') && value.influenceSurfaces.length > 0) {
    throw new MemoryModelError('blocked or revoked memory cannot retain influence surfaces')
  }
}

function validateState(state: MemoryState, form: MemoryForm): void {
  assertChoice(state.persistence, PERSISTENCE_STATES, 'state.persistence')
  assertChoice(state.activation, ACTIVATION_STATES, 'state.activation')
  assertChoice(state.integration, INTEGRATION_STATES, 'state.integration')
  assertChoice(state.epistemic, EPISTEMIC_STATES, 'state.epistemic')
  assertChoice(state.influence, INFLUENCE_STATES, 'state.influence')

  if (state.persistence === 'erased') {
    throw new MemoryModelError('erased content can only be produced by an authorized erase transaction')
  }
  if (state.persistence === 'transient' && state.integration !== 'raw') {
    throw new MemoryModelError('transient memory must remain raw')
  }
  if (state.persistence === 'transient' && state.influence !== 'blocked') {
    throw new MemoryModelError('transient memory cannot influence behavior')
  }
  if (state.persistence === 'archived') {
    if (state.activation !== 'dormant') throw new MemoryModelError('archived memory must be dormant')
    if (state.influence !== 'blocked' && state.influence !== 'revoked') {
      throw new MemoryModelError('archived memory cannot influence behavior')
    }
  }
  if (state.activation === 'workspace' && state.persistence === 'archived') {
    throw new MemoryModelError('archived memory cannot enter workspace')
  }
  if (state.integration === 'integrated' && state.persistence === 'transient') {
    throw new MemoryModelError('transient memory cannot be integrated')
  }
  if (state.influence === 'permitted') {
    if (state.persistence !== 'durable') throw new MemoryModelError('permitted memory must be durable')
    if (state.integration === 'raw') throw new MemoryModelError('permitted memory must be linked before influence')
    if (state.epistemic === 'hypothesized' || state.epistemic === 'rejected' || state.epistemic === 'superseded') {
      throw new MemoryModelError('hypothesized, rejected, or superseded memory cannot be permitted')
    }
  }
  if (form.form === 'prospect' && state.epistemic !== 'hypothesized') {
    throw new MemoryModelError('prospect memory must remain hypothesized')
  }
}

function validateForm(form: MemoryForm): void {
  switch (form.form) {
    case 'scene': {
      assertIdArray(form.data.participants, 'scene.participants')
      if (form.data.participants.length === 0) throw new MemoryModelError('scene needs at least one participant')
      assertText(form.data.environment, 'scene.environment')
      assertIdArray(form.data.goals, 'scene.goals')
      for (const action of form.data.actions) {
        if (!form.data.participants.includes(action.actor)) {
          throw new MemoryModelError('scene action actor must be a scene participant')
        }
        assertText(action.description, 'scene action description')
        if (action.result !== undefined) assertText(action.result, 'scene action result')
      }
      for (const outcome of form.data.outcomes) {
        assertChoice(outcome.status, ['expected', 'observed', 'failed'], 'scene outcome status')
        assertText(outcome.description, 'scene outcome description')
      }
      for (const predictionError of form.data.predictionErrors) {
        assertText(predictionError.expected, 'scene prediction error expected')
        assertText(predictionError.actual, 'scene prediction error actual')
        assertRange(predictionError.magnitude, 0, 1, 'scene prediction error magnitude')
      }
      validateAffect(form.data.affect, 'scene.affect')
      if (form.data.lifecycle !== undefined) {
        validateSceneLifecycle(form.data.lifecycle, 'scene.lifecycle')
      }
      if (form.data.runtimeEventRefs !== undefined) {
        if (!Array.isArray(form.data.runtimeEventRefs)) {
          throw new MemoryModelError('scene.runtimeEventRefs must be an array')
        }
        const keys = form.data.runtimeEventRefs.map(ref => ref.sessionId + ':' + ref.eventSeq)
        assertUniqueStrings(keys, 'scene.runtimeEventRefs')
        for (const [index, ref] of form.data.runtimeEventRefs.entries()) {
          validateRuntimeEventRef(ref, 'scene.runtimeEventRefs[' + index + ']')
        }
      }
      return
    }
    case 'structure':
      assertStringArray(form.data.entities, 'structure.entities')
      for (const relation of form.data.relations) {
        assertText(relation.from, 'structure relation from')
        assertText(relation.relation, 'structure relation')
        assertText(relation.to, 'structure relation to')
      }
      assertStringArray(form.data.concepts, 'structure.concepts')
      assertStringArray(form.data.causalPatterns, 'structure.causalPatterns')
      validateValidity(form.data.validity, 'structure.validity')
      return
    case 'self-model':
      assertStringArray(form.data.values, 'self-model.values')
      assertStringArray(form.data.abilities, 'self-model.abilities')
      assertStringArray(form.data.tendencies, 'self-model.tendencies')
      assertStringArray(form.data.historicalChanges, 'self-model.historicalChanges')
      return
    case 'person-model':
      if (typeof form.data.subject !== 'string') throw new MemoryModelError('person-model.subject is invalid')
      assertStringArray(form.data.claims, 'person-model.claims')
      assertStringArray(form.data.observedPatterns, 'person-model.observedPatterns')
      assertStringArray(form.data.currentState, 'person-model.currentState')
      assertTimestamp(form.data.lastObservedAt, 'person-model.lastObservedAt')
      if (form.data.contextConditions !== undefined) {
        assertStringArray(form.data.contextConditions, 'person-model.contextConditions')
        assertUniqueStrings(form.data.contextConditions, 'person-model.contextConditions')
      }
      if (form.data.stateByContext !== undefined) {
        if (!Array.isArray(form.data.stateByContext)) throw new MemoryModelError('person-model.stateByContext must be an array')
        const contexts: string[] = []
        for (const [index, entry] of form.data.stateByContext.entries()) {
          assertText(entry.context, 'person-model.stateByContext[' + index + '].context')
          assertStringArray(entry.state, 'person-model.stateByContext[' + index + '].state')
          assertTimestamp(entry.observedAt, 'person-model.stateByContext[' + index + '].observedAt')
          contexts.push(entry.context)
        }
        assertUniqueStrings(contexts, 'person-model.stateByContext')
      }
      return
    case 'relationship-model':
      if (form.data.participants.length !== 2 || form.data.participants[0] === form.data.participants[1]) {
        throw new MemoryModelError('relationship-model needs two distinct participants')
      }
      assertIdArray(form.data.sharedMemoryIds, 'relationship-model.sharedMemoryIds')
      assertStringArray(form.data.commitments, 'relationship-model.commitments')
      assertStringArray(form.data.boundaries, 'relationship-model.boundaries')
      assertStringArray(form.data.conflicts, 'relationship-model.conflicts')
      assertStringArray(form.data.expectations, 'relationship-model.expectations')
      assertRange(form.data.distance, 0, 1, 'relationship-model.distance')
      return
    case 'disposition':
      assertStringArray(form.data.triggeringContexts, 'disposition.triggeringContexts')
      if (typeof form.data.intendedGoal !== 'string') throw new MemoryModelError('disposition.intendedGoal is invalid')
      assertStringArray(form.data.actionPattern, 'disposition.actionPattern')
      assertStringArray(form.data.expectedOutcomes, 'disposition.expectedOutcomes')
      assertStringArray(form.data.observedOutcomes, 'disposition.observedOutcomes')
      assertStringArray(form.data.applicabilityConditions, 'disposition.applicabilityConditions')
      assertStringArray(form.data.failureModes, 'disposition.failureModes')
      if (form.data.supportingActionIds !== undefined) assertIdArray(form.data.supportingActionIds, 'disposition.supportingActionIds')
      if (form.data.supportingOutcomeIds !== undefined) assertIdArray(form.data.supportingOutcomeIds, 'disposition.supportingOutcomeIds')
      if (form.data.supportingFeedbackIds !== undefined) assertIdArray(form.data.supportingFeedbackIds, 'disposition.supportingFeedbackIds')
      if (form.data.sampleCount !== undefined) {
        if (!Number.isSafeInteger(form.data.sampleCount) || form.data.sampleCount < 0) {
          throw new MemoryModelError('disposition.sampleCount must be a non-negative safe integer')
        }
        if (
          form.data.supportingOutcomeIds !== undefined
          && form.data.sampleCount < form.data.supportingOutcomeIds.length
        ) throw new MemoryModelError('disposition.sampleCount cannot be smaller than supporting outcomes')
      }
      return
    case 'open-loop':
      if (typeof form.data.goal !== 'string') throw new MemoryModelError('open-loop.goal is invalid')
      assertText(form.data.description, 'open-loop.description')
      assertIdArray(form.data.relatedMemoryIds, 'open-loop.relatedMemoryIds')
      assertChoice(form.data.status, ['open', 'resolved', 'abandoned'], 'open-loop.status')
      if (form.data.origin !== undefined) validateRuntimeEventRef(form.data.origin, 'open-loop.origin')
      if (form.data.resolution !== undefined) {
        assertText(form.data.resolution.description, 'open-loop.resolution.description')
        assertChoice(form.data.resolution.status, ['observed', 'failed'], 'open-loop.resolution.status')
        assertTimestamp(form.data.resolution.occurredAt, 'open-loop.resolution.occurredAt')
        if (form.data.resolution.eventRef !== undefined) {
          validateRuntimeEventRef(form.data.resolution.eventRef, 'open-loop.resolution.eventRef')
        }
      }
      if (form.data.status === 'open' && form.data.resolution !== undefined) {
        throw new MemoryModelError('open-loop cannot have a resolution while open')
      }
      return
    case 'prospect':
      assertChoice(form.data.kind, ['prediction', 'plan', 'counterfactual', 'dream'], 'prospect.kind')
      assertText(form.data.premise, 'prospect.premise')
      assertStringArray(form.data.possibleOutcomes, 'prospect.possibleOutcomes')
      assertIdArray(form.data.relatedMemoryIds, 'prospect.relatedMemoryIds')
      if (form.data.targetTime !== undefined) assertTimestamp(form.data.targetTime, 'prospect.targetTime')
      return
    default:
      throw new MemoryModelError('unknown memory form')
  }
}

function validateMemory(memory: MemoryDraft | RinMemory): void {
  if (typeof memory.id !== 'string') throw new MemoryModelError('memory id is invalid')
  assertTimestamp(memory.createdAt, 'createdAt')
  assertTimestamp(memory.updatedAt, 'updatedAt')
  if (Date.parse(memory.updatedAt) < Date.parse(memory.createdAt)) {
    throw new MemoryModelError('updatedAt must not precede createdAt')
  }
  validateForm(memory)
  validateState(memory.state, memory)
  validateDynamics(memory.dynamics, memory.state)
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map(entry => cloneValue(entry)) as T
  if (typeof value === 'object' && value !== null) {
    const clone: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      clone[key] = cloneValue(entry)
    }
    return clone as T
  }
  return value
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const entry of Object.values(value as Record<string, unknown>)) deepFreeze(entry)
  return value
}

/** Construct one validated, immutable memory representation. */
export function createMemory(input: MemoryDraft): RinMemory {
  validateMemory(input)
  return deepFreeze(cloneValue(input)) as RinMemory
}

/** Construct one validated, immutable current cognition field. */
export function createCurrentField(input: CurrentField): CurrentField {
  validateCurrentField(input)
  return deepFreeze(cloneValue(input)) as CurrentField
}

/** Construct the empty field used before the first committed cognition transaction. */
export function createEmptyCurrentField(ownerId = 'rin'): CurrentField {
  return createCurrentField({
    ownerId,
    version: 0,
    updatedAt: '1970-01-01T00:00:00.000Z',
    participants: [],
    goals: [],
    affect: { valence: 0, arousal: 0, control: 0.5 },
    predictions: [],

    predictionErrors: [],
    activeOpenLoops: [],
    candidateActions: [],
    candidateActionSources: [],
    activeMemoryCoalition: [],
    uncertainty: [],
  })
}

/** Construct one validated, immutable typed relation. */
export function createMemoryLink(input: MemoryLink): MemoryLink {
  validateLink(input)
  return deepFreeze(cloneValue(input)) as MemoryLink

}
function commitTransition(
  memory: RinMemory,
  state: MemoryState,
  dynamics: MemoryDynamics,
  at: string,
): RinMemory {
  const candidate = { ...memory, state, dynamics, updatedAt: at }
  validateMemory(candidate)
  return deepFreeze(cloneValue(candidate)) as RinMemory
}

function requireState(actual: string, expected: string, transition: string): void {
  if (actual !== expected) {
    throw new MemoryModelError(transition + ' requires ' + expected + ', received ' + actual)
  }
}

/** Apply one legal, deterministic state transition. */
export function transitionMemory(memory: RinMemory, transition: MemoryTransition): RinMemory {
  assertTimestamp(transition.at, 'transition.at')
  if (Date.parse(transition.at) < Date.parse(memory.updatedAt)) {
    throw new MemoryModelError('transition.at must not precede updatedAt')
  }
  if (memory.state.persistence === 'erased') {
    throw new MemoryModelError('erased memory is terminal')
  }

  const state = { ...memory.state }
  let dynamics = memory.dynamics
  switch (transition.type) {
    case 'encode':
      requireState(state.persistence, 'transient', 'encode')
      state.persistence = 'encoded'
      break
    case 'durable':
      requireState(state.persistence, 'encoded', 'durable')
      state.persistence = 'durable'
      break
    case 'archive':
      requireState(state.persistence, 'durable', 'archive')
      state.persistence = 'archived'
      state.activation = 'dormant'
      state.influence = 'blocked'
      dynamics = { ...dynamics, influenceSurfaces: [] }
      break
    case 'prime':
      requireState(state.activation, 'dormant', 'prime')
      if (state.persistence === 'archived') throw new MemoryModelError('archived memory needs an explicit history query')
      state.activation = 'primed'
      break
    case 'activate':
      requireState(state.activation, 'primed', 'activate')
      state.activation = 'active'
      break
    case 'workspace':
      requireState(state.activation, 'active', 'workspace')
      if (state.persistence === 'archived') throw new MemoryModelError('archived memory cannot enter workspace')
      state.activation = 'workspace'
      break
    case 'cool':
      requireState(state.activation, 'workspace', 'cool')
      state.activation = 'active'
      break
    case 'deactivate':
      if (state.activation !== 'active' && state.activation !== 'workspace') {
        throw new MemoryModelError('deactivate requires active or workspace')
      }
      state.activation = 'dormant'
      break
    case 'link':
      requireState(state.integration, 'raw', 'link')
      state.integration = 'linked'
      break
    case 'consolidate':
      requireState(state.integration, 'linked', 'consolidate')
      state.integration = 'consolidating'
      break
    case 'integrate':
      requireState(state.integration, 'consolidating', 'integrate')
      state.integration = 'integrated'
      break
    case 'epistemic': {
      if (state.epistemic === transition.to) throw new MemoryModelError('epistemic state is already ' + transition.to)
      if (state.epistemic === 'superseded' || state.epistemic === 'rejected') {
        throw new MemoryModelError(state.epistemic + ' memory is terminal for this representation')
      }
      assertChoice(transition.basis, [
        'direct-observation',
        'user-report',
        'new-evidence',
        'model-inference',
        'model-proposal',
        'user-correction',
      ], 'epistemic basis')
      assertIdArray(transition.evidenceIds, 'epistemic evidenceIds')
      if (transition.to === 'hypothesized') {
        if (transition.basis !== 'model-proposal' || transition.evidenceIds.length > 0) {
          throw new MemoryModelError('hypothesized transition requires a model proposal without evidence')
        }
        if (state.epistemic === 'observed') {
          throw new MemoryModelError('observed memory cannot regress to hypothesized')
        }
      } else {
        if (transition.evidenceIds.length === 0) {
          throw new MemoryModelError('epistemic transition needs evidence')
        }
        if (transition.to === 'observed' && (transition.basis === 'model-proposal' || transition.basis === 'model-inference')) {
          throw new MemoryModelError('model output cannot create an observed fact')
        }
      }
      if (memory.form === 'prospect' && transition.to === 'observed') {
        throw new MemoryModelError('prospect memory cannot become observed')
      }
      state.epistemic = transition.to
      break
    }
    case 'influence':
      if (state.influence === 'revoked') throw new MemoryModelError('revoked influence cannot be reopened')
      assertChoice(transition.to, INFLUENCE_STATES, 'influence state')
      assertStringArray(transition.surfaces, 'influence surfaces')
      assertUniqueStrings(transition.surfaces, 'influence surfaces')
      for (const surface of transition.surfaces) {
        assertChoice(surface, MEMORY_INFLUENCE_SURFACES, 'influence surface')
      }
      state.influence = transition.to
      dynamics = { ...dynamics, influenceSurfaces: [...transition.surfaces] }
      break
    default:
      throw new MemoryModelError('unknown memory transition')
  }

  return commitTransition(memory, state, dynamics, transition.at)
}


/**
 * A link may remain journaled and active after an endpoint has advanced. Such
 * an edge is historical, not a live relation in Rin's present cognition.
 */
export function isCurrentVersionLink(
  link: MemoryLink,
  memories: readonly RinMemory[],
): boolean {
  if (link.state === 'retracted') return false
  const from = memories.find(memory => String(memory.id) === String(link.from))
  const to = memories.find(memory => String(memory.id) === String(link.to))
  return from !== undefined
    && to !== undefined
    && link.fromVersion === memoryVersion(from)
    && link.toVersion === memoryVersion(to)
}
