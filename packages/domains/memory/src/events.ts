/**
 * Rin's command, event, and transaction protocol for cognitive memory.
 *
 * Commands are intentions, events are accepted facts, and transactions bind
 * the facts produced by one intention. Model output can propose a candidate,
 * but only an owner can issue data-rights commands.
 *
 * @module @rin/memory
 */

import { isDeepStrictEqual } from 'node:util'
import type {
  MemoryActorKind,
  MemoryCommandType,
  MemoryEventType,
} from '@rin/contracts'
import { MEMORY_COGNITION_PROTOCOL_VERSION } from '@rin/contracts'
import {
  createMemory,
  createMemoryLink,
  EPISTEMIC_STATES,
  INFLUENCE_STATES,
  MEMORY_INFLUENCE_SURFACES,
  type EvidenceId,
  type EpistemicBasis,
  type InfluenceState,
  type MemoryLink,
  type MemoryForm,
  type MemoryId,
  type MemoryActionRecord,
  type MemoryFeedbackVector,
  type MemoryOutcomeRecord,
  type MemoryPredictionRecord,
  type MemoryInfluenceSurface,
  type MemoryTransition,
  type RinMemory,
} from './model.ts'
import { assertMemoryConsolidationResult, assertMemoryDecayResult, assertMemoryRepresentationFormationResult, type MemoryConsolidationResult, type MemoryDecayResult, type MemoryDispositionLearningResult, type MemoryRepresentationFormationResult, type MemoryUseTrace } from './consolidation.ts'

type Branded<Name extends string> = string & {
  readonly __rinMemoryProtocolBrand: Name
}

export type MemoryCommandId = Branded<'MemoryCommandId'>
export type MemoryEventId = Branded<'MemoryEventId'>
export type MemoryTransactionId = Branded<'MemoryTransactionId'>
export type MemoryCorrelationId = Branded<'MemoryCorrelationId'>
export type MemoryAuthorizationId = Branded<'MemoryAuthorizationId'>

export class MemoryProtocolError extends Error {
  constructor(message: string) {
    super('rin memory protocol: ' + message)
    this.name = 'MemoryProtocolError'
  }
}

function createProtocolId<Name extends string>(value: string, label: string): Branded<Name> {
  if (typeof value !== 'string' || value.trim() === '' || /\s/.test(value)) {
    throw new MemoryProtocolError(label + ' must be a non-empty token without whitespace')
  }
  return value as Branded<Name>
}

/**
 * Creates an opaque command identifier.
 *
 * @param value - Stable identifier supplied by the command producer.
 * @returns A branded command identifier.
 */
export function createMemoryCommandId(value: string): MemoryCommandId {
  return createProtocolId(value, 'command id')
}

/**
 * Creates an opaque event identifier.
 *
 * @param value - Stable identifier supplied by the event writer.
 * @returns A branded event identifier.
 */
export function createMemoryEventId(value: string): MemoryEventId {
  return createProtocolId(value, 'event id')
}

/**
 * Creates an opaque transaction identifier.
 *
 * @param value - Stable identifier supplied by the transaction writer.
 * @returns A branded transaction identifier.
 */
export function createMemoryTransactionId(value: string): MemoryTransactionId {
  return createProtocolId(value, 'transaction id')
}

/**
 * Creates an opaque correlation identifier.
 *
 * @param value - Stable identifier shared by related commands.
 * @returns A branded correlation identifier.
 */
export function createMemoryCorrelationId(value: string): MemoryCorrelationId {
  return createProtocolId(value, 'correlation id')
}

/**
 * Creates an opaque owner-erase authorization identifier.
 *
 * @param value - Stable identifier supplied by the owner.
 * @returns A branded authorization identifier.
 */
export function createMemoryAuthorizationId(value: string): MemoryAuthorizationId {
  return createProtocolId(value, 'authorization id')
}

export type MemoryActor = Readonly<{
  kind: MemoryActorKind
  id: string
}>
export type OwnerActor = MemoryActor & Readonly<{ kind: 'owner' }>
export type RuntimeActor = MemoryActor & Readonly<{ kind: 'runtime' }>
export type ModelActor = MemoryActor & Readonly<{ kind: 'model' }>
export type PluginActor = MemoryActor & Readonly<{ kind: 'plugin' }>
export type BackgroundActor = MemoryActor & Readonly<{ kind: 'background' }>

/**
 * Creates an actor used by the memory protocol.
 *
 * @param kind - The authority class of the producer.
 * @param id - Stable producer identifier.
 * @returns An immutable protocol actor.
 */
export function createMemoryActor<K extends MemoryActorKind>(kind: K, id: string): MemoryActor & Readonly<{ kind: K }> {
  assertActor({ kind, id }, 'actor')
  return deepFreeze({ kind, id })
}

/**
 * Creates an owner actor for data-rights commands.
 *
 * @param id - Stable owner identifier.
 * @returns An immutable owner actor.
 */
export function createOwnerActor(id: string): OwnerActor {
  return createMemoryActor('owner', id) as OwnerActor
}

/**
 * Creates a runtime actor for accepted observations and transitions.
 *
 * @param id - Stable runtime identifier.
 * @returns An immutable runtime actor.
 */
export function createRuntimeActor(id: string): RuntimeActor {
  return createMemoryActor('runtime', id) as RuntimeActor
}

/**
 * Creates a model actor that can only submit proposals.
 *
 * @param id - Stable model identifier.
 * @returns An immutable model actor.
 */
export function createModelActor(id: string): ModelActor {
  return createMemoryActor('model', id) as ModelActor
}

/**
 * Creates a plugin actor for source observations.
 *
 * @param id - Stable plugin identifier.
 * @returns An immutable plugin actor.
 */
export function createPluginActor(id: string): PluginActor {
  return createMemoryActor('plugin', id) as PluginActor
}

/**
 * Creates a background actor for non-owner maintenance transitions.
 *
 * @param id - Stable background process identifier.
 * @returns An immutable background actor.
 */
export function createBackgroundActor(id: string): BackgroundActor {
  return createMemoryActor('background', id) as BackgroundActor
}

export type MemoryCandidate = Readonly<{
  kind: 'model-candidate'
  memory: RinMemory
  basis: Extract<EpistemicBasis, 'model-inference' | 'model-proposal'>
  evidenceIds: readonly EvidenceId[]
  sourceMemoryIds?: readonly MemoryId[]
  rationale: string
}>

/**
 * Creates a model candidate without granting it behavioral influence.
 *
 * @param actor - The model actor submitting the candidate.
 * @param input - Candidate memory and the model's explicit rationale.
 * @returns An immutable, non-observed candidate.
 */
export function createModelCandidate(
  actor: ModelActor,
  input: Omit<MemoryCandidate, 'kind'>,
): MemoryCandidate {
  assertActor(actor, 'model actor')
  if (actor.kind !== 'model') {
    throw new MemoryProtocolError('only a model actor can create a model candidate')
  }
  const memory = createMemory(input.memory)
  if (memory.state.epistemic === 'observed' || memory.state.epistemic === 'superseded' || memory.state.epistemic === 'rejected') {
    throw new MemoryProtocolError('model candidate cannot be observed, superseded, or rejected')
  }
  if (memory.state.influence !== 'blocked' || memory.dynamics.influenceSurfaces.length > 0) {
    throw new MemoryProtocolError('model candidate must be blocked from every influence surface')
  }
  if (memory.state.persistence !== 'transient' || memory.state.integration !== 'raw') {
    throw new MemoryProtocolError('model candidate must remain transient and raw until a controller accepts it')
  }
  if (memory.state.epistemic !== 'inferred' && memory.state.epistemic !== 'hypothesized') {
    throw new MemoryProtocolError('model candidate epistemic state must be inferred or hypothesized')
  }
  if (input.basis !== 'model-inference' && input.basis !== 'model-proposal') {
    throw new MemoryProtocolError('model candidate basis must describe model output')
  }
  assertStringArray(input.evidenceIds, 'model candidate evidence ids')
  if (input.sourceMemoryIds !== undefined) {
    assertStringArray(input.sourceMemoryIds, 'model candidate source memory ids')
    if (input.sourceMemoryIds.some(id => String(id) === String(memory.id))) {
      throw new MemoryProtocolError('model candidate cannot support itself')
    }
  }
  assertText(input.rationale, 'model candidate rationale')
  return deepFreeze({
    kind: 'model-candidate',
    memory,
    basis: input.basis,
    evidenceIds: [...input.evidenceIds],
    ...(input.sourceMemoryIds === undefined ? {} : { sourceMemoryIds: [...input.sourceMemoryIds] }),
    rationale: input.rationale,
  })
}
export type ModelProposalTransactionInput = Readonly<{
  actor: ModelActor
  candidate: Omit<MemoryCandidate, 'kind'>
  commandId: MemoryCommandId
  eventId: MemoryEventId
  transactionId: MemoryTransactionId
  correlationId: MemoryCorrelationId
  issuedAt: string
}>

/**
 * Forms one online model interpretation as a canonical, replayable proposal.
 *
 * The proposal is deliberately not an observed fact and cannot carry behavioral
 * influence. A controller may later accept, contest, revise, or reject it.
 */
export function createModelProposalTransaction(
  input: ModelProposalTransactionInput,
): MemoryTransaction {
  const candidate = createModelCandidate(input.actor, input.candidate)
  const command: MemoryCommand = {
    kind: 'memory-command',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'propose',
    commandId: input.commandId,
    correlationId: input.correlationId,
    actor: input.actor,
    issuedAt: input.issuedAt,
    payload: { candidate },
  }
  const event: MemoryEvent = {
    kind: 'memory-event',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'memory-proposed',
    eventId: input.eventId,
    transactionId: input.transactionId,
    commandId: input.commandId,
    position: 0,
    actor: input.actor,
    occurredAt: input.issuedAt,
    payload: { candidate },
  }
  return createMemoryTransaction({
    transactionId: input.transactionId,
    commandId: input.commandId,
    correlationId: input.correlationId,
    actor: input.actor,
    openedAt: input.issuedAt,
    committedAt: input.issuedAt,
    command,
    events: [event],
  })
}

type CommandBase<T extends MemoryCommandType, A extends MemoryActor, P> = Readonly<{
  kind: 'memory-command'
  protocolVersion: typeof MEMORY_COGNITION_PROTOCOL_VERSION
  type: T
  commandId: MemoryCommandId
  correlationId: MemoryCorrelationId
  actor: A
  issuedAt: string
  payload: P
}>

type ObservationCommand = CommandBase<'observe', RuntimeActor | PluginActor, Readonly<{
  memory: RinMemory
}>>
export type SceneChange =
  | Readonly<{
      operation: 'open'
      memory: RinMemory
    }>
  | Readonly<{
      operation: 'extend' | 'close'
      memoryId: MemoryId
      previousVersion: string
      memory: RinMemory
    }>
export type OpenLoopChange =
  | Readonly<{
      operation: 'open'
      sceneId: MemoryId
      memory: RinMemory
    }>
  | Readonly<{
      operation: 'resolve'
      sceneId: MemoryId
      memoryId: MemoryId
      previousVersion: string
      memory: RinMemory
    }>

type SceneCommand = CommandBase<'scene', RuntimeActor, Readonly<{
  changes: readonly SceneChange[]
  loopChanges?: readonly OpenLoopChange[]
}>>
type ProposalCommand = CommandBase<'propose', ModelActor, Readonly<{
  candidate: MemoryCandidate
}>>
type FormRepresentationCommand = CommandBase<'form', BackgroundActor, Readonly<{
  result: MemoryRepresentationFormationResult
}>>
type TransitionCommand = CommandBase<'transition', RuntimeActor | BackgroundActor, Readonly<{
  memoryId: MemoryId
  transition: MemoryTransition
}>>
type ConsolidateCommand = CommandBase<'consolidate', RuntimeActor | BackgroundActor, Readonly<{
  result: MemoryConsolidationResult
}>>
type DecayCommand = CommandBase<'decay', BackgroundActor, Readonly<{
  result: MemoryDecayResult
}>>
type PredictionCommand = CommandBase<'record-prediction', RuntimeActor | BackgroundActor, Readonly<{
  prediction: MemoryPredictionRecord
}>>
type ActionCommand = CommandBase<'record-action', RuntimeActor, Readonly<{
  action: MemoryActionRecord
}>>
type OutcomeCommand = CommandBase<'record-outcome', RuntimeActor | BackgroundActor, Readonly<{
  outcome: MemoryOutcomeRecord
}>>
type FeedbackCommand = CommandBase<'record-feedback', RuntimeActor | BackgroundActor, Readonly<{
  feedback: MemoryFeedbackVector
}>>
export type MemoryBehaviorBatch = Readonly<{
  prediction?: MemoryPredictionRecord
  action?: MemoryActionRecord
  outcome?: MemoryOutcomeRecord
  feedback?: MemoryFeedbackVector
}>
type BehaviorBatchCommand = CommandBase<'record-behavior', RuntimeActor, MemoryBehaviorBatch>
type DispositionLearningCommand = CommandBase<'learn-disposition', BackgroundActor, Readonly<{
  result: MemoryDispositionLearningResult
}>>
type RecordUseCommand = CommandBase<'record-use', RuntimeActor | BackgroundActor, Readonly<{
  use: MemoryUseTrace
}>>
type LinkCommand = CommandBase<
  'link',
  RuntimeActor | BackgroundActor,
  Readonly<{ links: readonly MemoryLink[] }>
>

type CorrectionCommand = CommandBase<'correct', OwnerActor, Readonly<{
  memoryId: MemoryId
  replacement: Readonly<{ form: MemoryForm['form']; data: Record<string, unknown> }>
  evidenceIds: readonly EvidenceId[]
  explanation: string
}>>
type RestrictInfluenceCommand = CommandBase<'restrict-influence', OwnerActor, Readonly<{
  memoryId: MemoryId
  surfaces: readonly MemoryInfluenceSurface[]
  reason: string
}>>
type RevokeInfluenceCommand = CommandBase<'revoke-influence', OwnerActor, Readonly<{
  memoryId: MemoryId
  reason: string
}>>
type PermitInfluenceCommand = CommandBase<'permit-influence', OwnerActor, Readonly<{
  memoryId: MemoryId
  previousVersion: string
  surfaces: readonly MemoryInfluenceSurface[]
  reason: string
}>>
type ErasePreviewCommand = CommandBase<'erase-preview', OwnerActor, Readonly<{
  memoryIds: readonly MemoryId[]
}>>
type AuthorizeEraseCommand = CommandBase<'authorize-erase', OwnerActor, Readonly<{
  authorizationId: MemoryAuthorizationId
  memoryIds: readonly MemoryId[]
  expiresAt: string
  scopeHash: string
}>>
type CommitEraseCommand = CommandBase<'commit-erase', OwnerActor, Readonly<{
  authorizationId: MemoryAuthorizationId
}>>

export type MemoryCommand =
  | ObservationCommand
  | SceneCommand
  | ProposalCommand
  | FormRepresentationCommand
  | TransitionCommand
  | ConsolidateCommand
  | PredictionCommand
  | ActionCommand
  | OutcomeCommand
  | FeedbackCommand
  | BehaviorBatchCommand
  | DispositionLearningCommand
  | DecayCommand
  | RecordUseCommand
  | LinkCommand
  | CorrectionCommand
  | RestrictInfluenceCommand
  | RevokeInfluenceCommand
  | PermitInfluenceCommand
  | ErasePreviewCommand
  | AuthorizeEraseCommand
  | CommitEraseCommand

export type MemoryEventBase<T extends MemoryEventType, A extends MemoryActor, P> = Readonly<{
  kind: 'memory-event'
  protocolVersion: typeof MEMORY_COGNITION_PROTOCOL_VERSION
  type: T
  eventId: MemoryEventId
  transactionId: MemoryTransactionId
  commandId: MemoryCommandId
  position: number
  actor: A
  occurredAt: string
  payload: P
}>

type ObservedEvent = MemoryEventBase<'memory-observed', RuntimeActor | PluginActor, Readonly<{
  memory: RinMemory
}>>
type SceneOpenedEvent = MemoryEventBase<'scene-opened', RuntimeActor, Readonly<{
  memory: RinMemory
}>>
type SceneRevisionPayload = Readonly<{
  memoryId: MemoryId
  previousVersion: string
  memory: RinMemory
}>
type SceneExtendedEvent = MemoryEventBase<'scene-extended', RuntimeActor, SceneRevisionPayload>
type SceneClosedEvent = MemoryEventBase<'scene-closed', RuntimeActor, SceneRevisionPayload>
type OpenLoopOpenedEvent = MemoryEventBase<'open-loop-opened', RuntimeActor, Readonly<{
  sceneId: MemoryId
  memory: RinMemory
}>>
type OpenLoopResolvedEvent = MemoryEventBase<'open-loop-resolved', RuntimeActor, Readonly<{
  sceneId: MemoryId
  memoryId: MemoryId
  previousVersion: string
  memory: RinMemory
}>>
type ProposedEvent = MemoryEventBase<'memory-proposed', ModelActor, Readonly<{
  candidate: MemoryCandidate
}>>
type RepresentationFormedEvent = MemoryEventBase<'memory-formed', BackgroundActor, Readonly<{
  result: MemoryRepresentationFormationResult
}>>
type PredictionRecordedEvent = MemoryEventBase<'prediction-recorded', RuntimeActor | BackgroundActor, Readonly<{
  prediction: MemoryPredictionRecord
}>>
type ActionRecordedEvent = MemoryEventBase<'action-recorded', RuntimeActor, Readonly<{
  action: MemoryActionRecord
}>>
type OutcomeRecordedEvent = MemoryEventBase<'outcome-recorded', RuntimeActor | BackgroundActor, Readonly<{
  outcome: MemoryOutcomeRecord
}>>
type FeedbackRecordedEvent = MemoryEventBase<'feedback-recorded', RuntimeActor | BackgroundActor, Readonly<{
  feedback: MemoryFeedbackVector
}>>
type DispositionLearnedEvent = MemoryEventBase<'disposition-learned', BackgroundActor, Readonly<{
  result: MemoryDispositionLearningResult
}>>
type TransitionedEvent = MemoryEventBase<'memory-transitioned', RuntimeActor | BackgroundActor, Readonly<{
  memoryId: MemoryId
  memory: RinMemory
  transition: MemoryTransition
}>>
type MemoryConsolidatedEvent = MemoryEventBase<'memory-consolidated', RuntimeActor | BackgroundActor, Readonly<{
  result: MemoryConsolidationResult
}>>
type MemoryUsedEvent = MemoryEventBase<'memory-used', RuntimeActor | BackgroundActor, Readonly<{
  use: MemoryUseTrace
}>>
type MemoryDecayedEvent = MemoryEventBase<'memory-decayed', BackgroundActor, Readonly<{
  result: MemoryDecayResult
}>>
type LinkedEvent = MemoryEventBase<
  'memory-linked',
  RuntimeActor | BackgroundActor,
  Readonly<{ links: readonly MemoryLink[] }>
>

type CorrectedEvent = MemoryEventBase<'memory-corrected', OwnerActor, Readonly<{
  memoryId: MemoryId
  memory: RinMemory
  evidenceIds: readonly EvidenceId[]
  explanation: string
}>>
type InfluencePermittedEvent = MemoryEventBase<'influence-permitted', OwnerActor, Readonly<{
  memoryId: MemoryId
  previousVersion: string
  state: Extract<InfluenceState, 'permitted'>
  memory: RinMemory
  surfaces: readonly MemoryInfluenceSurface[]
  reason: string
}>>
type InfluenceRestrictedEvent = MemoryEventBase<'influence-restricted', OwnerActor, Readonly<{
  memoryId: MemoryId
  state: Extract<InfluenceState, 'restricted'>
  surfaces: readonly MemoryInfluenceSurface[]
  reason: string
}>>
type InfluenceRevokedEvent = MemoryEventBase<'influence-revoked', OwnerActor, Readonly<{
  memoryId: MemoryId
  state: Extract<InfluenceState, 'revoked'>
  reason: string
}>>
type EraseAuthorizedEvent = MemoryEventBase<'erase-authorized', OwnerActor, Readonly<{
  authorizationId: MemoryAuthorizationId
  memoryIds: readonly MemoryId[]
  expiresAt: string
  scopeHash: string
}>>
type EraseCommittedEvent = MemoryEventBase<'erase-committed', OwnerActor, Readonly<{
  authorizationId: MemoryAuthorizationId
  memoryIds: readonly MemoryId[]
}>>

export type MemoryEvent =
  | ObservedEvent
  | SceneOpenedEvent
  | SceneExtendedEvent
  | SceneClosedEvent
  | OpenLoopOpenedEvent
  | OpenLoopResolvedEvent
  | ProposedEvent
  | RepresentationFormedEvent
  | TransitionedEvent
  | MemoryConsolidatedEvent
  | MemoryDecayedEvent
  | InfluencePermittedEvent
  | MemoryUsedEvent
  | LinkedEvent
  | PredictionRecordedEvent
  | ActionRecordedEvent
  | OutcomeRecordedEvent
  | FeedbackRecordedEvent
  | DispositionLearnedEvent
  | CorrectedEvent
  | InfluenceRestrictedEvent
  | InfluenceRevokedEvent
  | EraseAuthorizedEvent
  | EraseCommittedEvent

export type MemoryTransaction = Readonly<{
  kind: 'memory-transaction'
  protocolVersion: typeof MEMORY_COGNITION_PROTOCOL_VERSION
  transactionId: MemoryTransactionId
  commandId: MemoryCommandId
  correlationId: MemoryCorrelationId
  actor: MemoryActor
  openedAt: string
  committedAt: string
  command: MemoryCommand
  events: readonly MemoryEvent[]
}>

const COMMAND_TYPES: readonly MemoryCommandType[] = [
  'observe',
  'scene',
  'propose',
  'form',
  'transition',
  'decay',
  'consolidate',
  'record-prediction',
  'record-action',
  'record-outcome',
  'record-behavior',
  'record-feedback',
  'learn-disposition',
  'record-use',
  'link',
  'correct',
  'restrict-influence',
  'revoke-influence',
  'permit-influence',
  'erase-preview',
  'authorize-erase',
  'commit-erase',
]
const EVENT_TYPES: readonly MemoryEventType[] = [
  'memory-observed',
  'scene-opened',
  'scene-extended',
  'prediction-recorded',
  'action-recorded',
  'outcome-recorded',
  'feedback-recorded',
  'disposition-learned',
  'scene-closed',
  'open-loop-opened',
  'open-loop-resolved',
  'memory-proposed',
  'memory-formed',
  'memory-decayed',
  'memory-transitioned',
  'memory-consolidated',
  'memory-used',
  'memory-linked',
  'memory-corrected',
  'influence-permitted',
  'influence-restricted',
  'influence-revoked',
  'erase-authorized',
  'erase-committed',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function assertText(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new MemoryProtocolError(label + ' must be non-empty text')
  }
}

function assertStringArray(value: unknown, label: string): asserts value is readonly string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.trim() === '')) {
    throw new MemoryProtocolError(label + ' must be an array of non-empty strings')
  }
  if (new Set(value).size !== value.length) {
    throw new MemoryProtocolError(label + ' must not contain duplicates')
  }
}

function assertTimestamp(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '' || !Number.isFinite(Date.parse(value))) {
    throw new MemoryProtocolError(label + ' must be a valid timestamp')
  }
}

function assertActor(value: unknown, label: string): asserts value is MemoryActor {
  if (!isRecord(value) || typeof value.kind !== 'string' || typeof value.id !== 'string') {
    throw new MemoryProtocolError(label + ' must contain kind and id')
  }
  if (!(['owner', 'runtime', 'model', 'plugin', 'background'] as readonly string[]).includes(value.kind)) {
    throw new MemoryProtocolError(label + ' has an unknown authority kind')
  }
  if (value.id.trim() === '' || /\s/.test(value.id)) {
    throw new MemoryProtocolError(label + ' id must be a non-empty token without whitespace')
  }
}

function assertProtocolId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '' || /\s/.test(value)) {
    throw new MemoryProtocolError(label + ' must be a non-empty token without whitespace')
  }
}

function assertPosition(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new MemoryProtocolError(label + ' must be a non-negative integer')
  }
}

function assertProtocolVersion(value: unknown): void {
  if (value !== MEMORY_COGNITION_PROTOCOL_VERSION) {
    throw new MemoryProtocolError('unsupported cognition protocol version')
  }
}

function assertSurfaceArray(value: unknown, label: string): asserts value is readonly MemoryInfluenceSurface[] {
  if (!Array.isArray(value)) {
    throw new MemoryProtocolError(label + ' must be an array')
  }
  const valid = new Set<string>(MEMORY_INFLUENCE_SURFACES)
  if (value.some(surface => typeof surface !== 'string' || !valid.has(surface))) {
    throw new MemoryProtocolError(label + ' contains an unknown influence surface')
  }
  if (new Set(value).size !== value.length) {
    throw new MemoryProtocolError(label + ' must not contain duplicates')
  }
}
function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
function assertMemoryUseTrace(value: unknown, label: string): asserts value is MemoryUseTrace {
  if (!isRecord(value)) {
    throw new MemoryProtocolError(label + ' must be an object')
  }
  assertProtocolId(value.id, label + '.id')
  assertProtocolId(value.cycleId, label + '.cycleId')
  assertProtocolId(value.memoryId, label + '.memoryId')
  assertProtocolId(value.memoryVersion, label + '.memoryVersion')
  assertTimestamp(value.usedAt, label + '.usedAt')
  if (!['model-input', 'action-selection', 'relationship-expression', 'planning'].includes(String(value.surface))) {
    throw new MemoryProtocolError(label + '.surface must describe an actual use surface')
  }
  if (!['answer', 'prediction', 'action', 'planning', 'relationship-expression'].includes(String(value.purpose))) {
    throw new MemoryProtocolError(label + '.purpose is invalid')
  }
}
function assertMemoryPredictionRecord(value: unknown, label: string): asserts value is MemoryPredictionRecord {
  if (!isRecord(value)) throw new MemoryProtocolError(label + ' must be an object')
  assertProtocolId(value.id, label + '.id')
  assertProtocolId(value.cycleId, label + '.cycleId')
  assertText(value.statement, label + '.statement')
  assertStringArray(value.sourceMemoryIds, label + '.sourceMemoryIds')
  assertText(value.expectedOutcome, label + '.expectedOutcome')
  if (value.epistemic !== 'hypothesized') throw new MemoryProtocolError(label + '.epistemic must remain hypothesized')
  assertTimestamp(value.createdAt, label + '.createdAt')
  if (value.targetTime !== undefined) assertTimestamp(value.targetTime, label + '.targetTime')
}

function assertMemoryActionRecord(value: unknown, label: string): asserts value is MemoryActionRecord {
  if (!isRecord(value)) throw new MemoryProtocolError(label + ' must be an object')
  assertProtocolId(value.id, label + '.id')
  assertProtocolId(value.cycleId, label + '.cycleId')
  if (value.sessionId !== undefined) assertText(value.sessionId, label + '.sessionId')
  if (value.correlationKey !== undefined) assertText(value.correlationKey, label + '.correlationKey')
  assertText(value.workspaceHash, label + '.workspaceHash')
  assertProtocolId(value.actor, label + '.actor')
  assertText(value.description, label + '.description')
  assertStringArray(value.goalIds, label + '.goalIds')
  assertStringArray(value.sourceMemoryIds, label + '.sourceMemoryIds')
  assertStringArray(value.predictionIds, label + '.predictionIds')
  assertTimestamp(value.occurredAt, label + '.occurredAt')
}

function assertMemoryOutcomeRecord(value: unknown, label: string): asserts value is MemoryOutcomeRecord {
  if (!isRecord(value)) throw new MemoryProtocolError(label + ' must be an object')
  assertProtocolId(value.id, label + '.id')
  assertProtocolId(value.cycleId, label + '.cycleId')
  if (value.sessionId !== undefined) assertText(value.sessionId, label + '.sessionId')
  if (value.correlationKey !== undefined) assertText(value.correlationKey, label + '.correlationKey')
  assertProtocolId(value.actionId, label + '.actionId')
  if (value.predictionId !== undefined) assertProtocolId(value.predictionId, label + '.predictionId')
  if (!['observed', 'failed', 'partial', 'unknown'].includes(String(value.status))) {
    throw new MemoryProtocolError(label + '.status is invalid')
  }
  assertText(value.description, label + '.description')
  assertTimestamp(value.occurredAt, label + '.occurredAt')
  if (typeof value.delayed !== 'boolean') throw new MemoryProtocolError(label + '.delayed must be boolean')
}

function assertMemoryFeedbackVector(value: unknown, label: string): asserts value is MemoryFeedbackVector {
  if (!isRecord(value)) throw new MemoryProtocolError(label + ' must be an object')
  assertProtocolId(value.id, label + '.id')
  assertProtocolId(value.cycleId, label + '.cycleId')
  if (value.sessionId !== undefined) assertText(value.sessionId, label + '.sessionId')
  if (!['accept', 'correct', 'reject', 'ignore', 'boundary'].includes(String(value.kind))) {
    throw new MemoryProtocolError(label + '.kind is invalid')
  }
  const targetIds = ['actionId', 'predictionId', 'outcomeId', 'sceneId', 'dispositionId']
    .filter(key => value[key] !== undefined)
  if (targetIds.length === 0) throw new MemoryProtocolError(label + ' must target an action, prediction, outcome, scene, or disposition')
  for (const key of targetIds) assertProtocolId(value[key], label + '.' + key)
  assertRecordRange(value.taskOutcome, -1, 1, label + '.taskOutcome')
  assertRecordRange(value.actionCost, 0, 1, label + '.actionCost')
  for (const [key, min, max] of [
    ['predictionAccuracy', -1, 1],
    ['relationshipConsequence', -1, 1],
    ['autonomyEffect', -1, 1],
    ['safetyEffect', -1, 1],
  ] as const) {
    if (value[key] !== undefined) assertRecordRange(value[key], min, max, label + '.' + key)
  }
  if (value.factualCorrection !== undefined) assertText(value.factualCorrection, label + '.factualCorrection')
  if (value.userResponse !== undefined && !['accepted', 'corrected', 'rejected', 'ignored', 'unclear'].includes(String(value.userResponse))) {
    throw new MemoryProtocolError(label + '.userResponse is invalid')
  }
  if (value.boundaryRespect !== undefined && !['respected', 'crossed', 'changed', 'unclear'].includes(String(value.boundaryRespect))) {
    throw new MemoryProtocolError(label + '.boundaryRespect is invalid')
  }
  if (value.delayedConsequence !== undefined) assertText(value.delayedConsequence, label + '.delayedConsequence')
  assertText(value.explanation, label + '.explanation')
  assertTimestamp(value.occurredAt, label + '.occurredAt')
  if (typeof value.delayed !== 'boolean') throw new MemoryProtocolError(label + '.delayed must be boolean')
}
function assertMemoryDispositionLearningResult(value: unknown, label: string): asserts value is MemoryDispositionLearningResult {
  if (!isRecord(value)) throw new MemoryProtocolError(label + ' must be an object')
  assertProtocolId(value.dispositionId, label + '.dispositionId')
  assertProtocolId(value.actionId, label + '.actionId')
  assertTimestamp(value.previousVersion, label + '.previousVersion')
  if (!isRecord(value.memory)) throw new MemoryProtocolError(label + '.memory must be an object')
  const memory = createMemory(value.memory as RinMemory)
  if (memory.form !== 'disposition' || memory.id !== value.dispositionId) {
    throw new MemoryProtocolError(label + '.memory must be the learned disposition')
  }
  if (Date.parse(memory.updatedAt) <= Date.parse(value.previousVersion as string)) {
    throw new MemoryProtocolError(label + '.memory must advance the disposition version')
  }
  assertRecordRange(value.sampleCount, 0, Number.MAX_SAFE_INTEGER, label + '.sampleCount')
  assertStringArray(value.independentOutcomeIds, label + '.independentOutcomeIds')
  assertStringArray(value.feedbackIds, label + '.feedbackIds')
  if (typeof value.stable !== 'boolean' || typeof value.semanticFieldsChanged !== 'boolean') {
    throw new MemoryProtocolError(label + '.stable and semanticFieldsChanged must be boolean')
  }
  assertText(value.explanation, label + '.explanation')
}

function assertRecordRange(value: unknown, min: number, max: number, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new MemoryProtocolError(label + ' must be between ' + min + ' and ' + max)
  }
}

function assertMemoryLinks(value: unknown, label: string): asserts value is readonly MemoryLink[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new MemoryProtocolError(label + ' must contain at least one link')
  }
  const ids = new Set<string>()
  for (const entry of value) {
    const link = createMemoryLink(entry as MemoryLink)
    if (ids.has(link.id)) throw new MemoryProtocolError(label + ' must not repeat a link id')
    ids.add(link.id)
  }
}

function assertObservedMemory(value: unknown, label: string): void {
  if (!isRecord(value)) throw new MemoryProtocolError(label + ' must be an object')
  const memory = createMemory(value as RinMemory)
  if (memory.form === 'prospect') {
    throw new MemoryProtocolError(label + ' prospect cannot enter observed history')
  }
}

function assertMemoryCandidate(value: unknown): asserts value is MemoryCandidate {
  if (!isRecord(value) || value.kind !== 'model-candidate' || !isRecord(value.memory)) {
    throw new MemoryProtocolError('invalid model candidate')
  }
  assertText(value.rationale, 'model candidate rationale')
  if (value.basis !== 'model-inference' && value.basis !== 'model-proposal') {
    throw new MemoryProtocolError('invalid model candidate basis')
  }
  assertStringArray(value.evidenceIds, 'model candidate evidence ids')
  if (value.sourceMemoryIds !== undefined) {
    assertStringArray(value.sourceMemoryIds, 'model candidate source memory ids')
  }
  const memory = createMemory(value.memory as RinMemory)
  if (value.sourceMemoryIds?.some(id => id === memory.id)) {
    throw new MemoryProtocolError('model candidate cannot support itself')
  }
  if (memory.state.epistemic === 'observed' || memory.state.epistemic === 'superseded' || memory.state.epistemic === 'rejected') {
    throw new MemoryProtocolError('model candidate cannot be observed, superseded, or rejected')
  }
  if (memory.state.influence !== 'blocked' || memory.dynamics.influenceSurfaces.length > 0) {
    throw new MemoryProtocolError('model candidate must be blocked from every influence surface')
  }
  if (memory.state.persistence !== 'transient' || memory.state.integration !== 'raw') {
    throw new MemoryProtocolError('model candidate must remain transient and raw until a controller accepts it')
  }
  if (memory.state.epistemic !== 'inferred' && memory.state.epistemic !== 'hypothesized') {
    throw new MemoryProtocolError('model candidate epistemic state must be inferred or hypothesized')
  }
}

function sceneMemory(value: unknown, label: string): RinMemory {
  if (!isRecord(value)) throw new MemoryProtocolError(label + ' must be an object')
  const memory = createMemory(value as RinMemory)
  if (memory.form !== 'scene') throw new MemoryProtocolError(label + ' must be a scene memory')
  return memory
}

function assertSceneChange(value: unknown, label: string): void {
  if (!isRecord(value)) throw new MemoryProtocolError(label + ' must be an object')
  if (value.operation === 'open') {
    sceneMemory(value.memory, label + '.memory')
    return
  }
  if (value.operation !== 'extend' && value.operation !== 'close') {
    throw new MemoryProtocolError(label + '.operation is invalid')
  }
  assertProtocolId(value.memoryId, label + '.memoryId')
  assertTimestamp(value.previousVersion, label + '.previousVersion')
  const memory = sceneMemory(value.memory, label + '.memory')
  if (memory.id !== value.memoryId) {
    throw new MemoryProtocolError(label + '.memory id does not match memoryId')
  }
}
function openLoopMemory(value: unknown, label: string, status: 'open' | 'resolved'): Extract<RinMemory, { form: 'open-loop' }> {
  if (!isRecord(value)) throw new MemoryProtocolError(label + ' must be an object')
  const memory = createMemory(value as RinMemory)
  if (memory.form !== 'open-loop') throw new MemoryProtocolError(label + ' must be an open-loop memory')
  if (memory.data.status !== status) {
    throw new MemoryProtocolError(label + ' must have status ' + status)
  }
  return memory
}

function assertOpenLoopChange(value: unknown, label: string): void {
  if (!isRecord(value)) throw new MemoryProtocolError(label + ' must be an object')
  assertProtocolId(value.sceneId, label + '.sceneId')
  const sceneId = value.sceneId as MemoryId
  if (value.operation === 'open') {
    const memory = openLoopMemory(value.memory, label + '.memory', 'open')
    if (!memory.data.relatedMemoryIds.includes(sceneId)) {
      throw new MemoryProtocolError(label + '.memory must relate to its scene')
    }
    return
  }
  if (value.operation !== 'resolve') {
    throw new MemoryProtocolError(label + '.operation is invalid')
  }
  assertProtocolId(value.memoryId, label + '.memoryId')
  assertTimestamp(value.previousVersion, label + '.previousVersion')
  const memory = openLoopMemory(value.memory, label + '.memory', 'resolved')
  if (memory.id !== value.memoryId) {
    throw new MemoryProtocolError(label + '.memory id does not match memoryId')
  }
  if (!memory.data.relatedMemoryIds.includes(sceneId)) {
    throw new MemoryProtocolError(label + '.memory must relate to its scene')
  }
}
function assertSceneRevision(value: unknown, label: string): asserts value is SceneRevisionPayload {
  if (!isRecord(value)) throw new MemoryProtocolError(label + ' must be an object')
  assertProtocolId(value.memoryId, label + '.memoryId')
  assertTimestamp(value.previousVersion, label + '.previousVersion')
  const memory = sceneMemory(value.memory, label + '.memory')
  if (memory.id !== value.memoryId) {
    throw new MemoryProtocolError(label + '.memory id does not match memoryId')
  }
}

function assertMemoryTransition(value: unknown): asserts value is MemoryTransition {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new MemoryProtocolError('invalid memory transition')
  }
  assertTimestamp(value.at, 'transition timestamp')
  if (!['encode', 'durable', 'archive', 'prime', 'activate', 'workspace', 'cool', 'deactivate', 'link', 'consolidate', 'integrate', 'epistemic', 'influence'].includes(value.type)) {
    throw new MemoryProtocolError('unknown memory transition')
  }
  if (value.type === 'epistemic') {
    assertText(value.to, 'epistemic transition state')
    if (!EPISTEMIC_STATES.includes(value.to as (typeof EPISTEMIC_STATES)[number])) {
      throw new MemoryProtocolError('unknown epistemic transition state')
    }
    assertText(value.basis, 'epistemic transition basis')
    if (!['direct-observation', 'user-report', 'new-evidence', 'model-inference', 'model-proposal', 'user-correction'].includes(value.basis)) {
      throw new MemoryProtocolError('unknown epistemic transition basis')
    }
    assertStringArray(value.evidenceIds, 'epistemic transition evidence ids')
  }
  if (value.type === 'influence') {
    assertText(value.to, 'influence transition state')
    if (!INFLUENCE_STATES.includes(value.to as (typeof INFLUENCE_STATES)[number])) {
      throw new MemoryProtocolError('unknown influence transition state')
    }
    assertSurfaceArray(value.surfaces, 'influence transition surfaces')
  }
}

function assertCommandAuthority(type: MemoryCommandType, actor: MemoryActor): void {
  const allowed: Record<MemoryCommandType, readonly MemoryActorKind[]> = {
    observe: ['runtime', 'plugin'],
    scene: ['runtime'],
    decay: ['background'],
    propose: ['model'],
    form: ['background'],
    transition: ['runtime', 'background'],
    consolidate: ['runtime', 'background'],
    'record-use': ['runtime', 'background'],
    link: ['runtime', 'background'],
    correct: ['owner'],
    'restrict-influence': ['owner'],
    'revoke-influence': ['owner'],
    'permit-influence': ['owner'],
    'erase-preview': ['owner'],
    'authorize-erase': ['owner'],
    'commit-erase': ['owner'],
    'record-prediction': ['runtime', 'background'],
    'record-action': ['runtime'],
    'record-outcome': ['runtime', 'background'],
    'record-behavior': ['runtime'],
    'record-feedback': ['runtime', 'background'],
    'learn-disposition': ['background'],
  }
  if (!allowed[type].includes(actor.kind)) {
    throw new MemoryProtocolError('actor kind ' + actor.kind + ' cannot issue ' + type + ' command')
  }
}

function readCommandEnvelope(value: unknown): {
  type: MemoryCommandType
  actor: MemoryActor
  payload: Record<string, unknown>
} {
  if (!isRecord(value)) {
    throw new MemoryProtocolError('memory command must be an object')
  }
  if (value.kind !== 'memory-command') {
    throw new MemoryProtocolError('invalid memory command envelope kind')
  }
  assertProtocolVersion(value.protocolVersion)
  assertProtocolId(value.commandId, 'command id')
  assertProtocolId(value.correlationId, 'correlation id')
  assertTimestamp(value.issuedAt, 'command timestamp')
  assertActor(value.actor, 'command actor')
  if (typeof value.type !== 'string' || !COMMAND_TYPES.includes(value.type as MemoryCommandType)) {
    throw new MemoryProtocolError('unknown memory command')
  }
  const type = value.type as MemoryCommandType
  assertCommandAuthority(type, value.actor)
  if (!isRecord(value.payload)) {
    throw new MemoryProtocolError('memory command payload is required')
  }
  return { type, actor: value.actor, payload: value.payload }
}

/**
 * Validates a memory command at a parser or queue boundary.
 *
 * @param value - Unknown command data received from a model, plugin, file, or wire.
 * @returns Nothing; throws when the command is malformed or unauthorized.
 */
export function assertMemoryCommand(value: unknown): asserts value is MemoryCommand {
  const { type, actor, payload } = readCommandEnvelope(value)
  switch (type) {
    case 'observe':
      if (actor.kind !== 'runtime' && actor.kind !== 'plugin') {
        throw new MemoryProtocolError('observation actor is not permitted')
      }
      if (!isRecord(payload.memory)) {
        throw new MemoryProtocolError('observe command requires memory')
      }
      assertObservedMemory(payload.memory, 'observe command memory')
      return
    case 'scene':
      if (actor.kind !== 'runtime') {
        throw new MemoryProtocolError('scene command actor must be runtime')
      }
      const loopChanges = payload.loopChanges
      if (!Array.isArray(payload.changes)) {
        throw new MemoryProtocolError('scene command changes must be an array')
      }
      if (loopChanges !== undefined && !Array.isArray(loopChanges)) {
        throw new MemoryProtocolError('scene command loopChanges must be an array')
      }
      if (payload.changes.length === 0 && (!Array.isArray(loopChanges) || loopChanges.length === 0)) {
        throw new MemoryProtocolError('scene command requires at least one change')
      }
      payload.changes.forEach((change, index) => assertSceneChange(change, 'scene changes[' + index + ']'))
      if (Array.isArray(loopChanges)) {
        loopChanges.forEach((change, index) => assertOpenLoopChange(change, 'scene loopChanges[' + index + ']'))
      }
      return
    case 'propose':
      if (actor.kind !== 'model') {
        throw new MemoryProtocolError('proposal actor must be a model')
      }
      assertMemoryCandidate(payload.candidate)
      return
    case 'form':
      if (actor.kind !== 'background') {
        throw new MemoryProtocolError('representation formation actor must be background')
      }
      assertMemoryRepresentationFormationResult(payload.result)
      return
    case 'decay':
      if (actor.kind !== 'background') {
        throw new MemoryProtocolError('decay actor must be background')
      }
      assertMemoryDecayResult(payload.result)
      return
    case 'transition':
      if (actor.kind !== 'runtime' && actor.kind !== 'background') {
        throw new MemoryProtocolError('transition actor is not permitted')
      }
      assertProtocolId(payload.memoryId, 'transition memory id')
      const transition = payload.transition
      assertMemoryTransition(transition)
      if (transition.type === 'influence') {
        throw new MemoryProtocolError('influence transitions require the owner permit-influence command')
      }
      return
    case 'consolidate':
      if (actor.kind !== 'runtime' && actor.kind !== 'background') {
        throw new MemoryProtocolError('consolidation actor is not permitted')
      }
      assertMemoryConsolidationResult(payload.result)
      return
    case 'learn-disposition':
      if (actor.kind !== 'background') throw new MemoryProtocolError('disposition learning actor must be background')
      assertMemoryDispositionLearningResult(payload.result, 'disposition learning')
      return
    case 'record-use':
      if (actor.kind !== 'runtime' && actor.kind !== 'background') {
        throw new MemoryProtocolError('use trace actor is not permitted')
      }
      assertMemoryUseTrace(payload.use, 'record-use command use')
      return
    case 'record-prediction':
      if (actor.kind !== 'runtime' && actor.kind !== 'background') throw new MemoryProtocolError('prediction actor is not permitted')
      assertMemoryPredictionRecord(payload.prediction, 'prediction')
      return
    case 'record-action':
      if (actor.kind !== 'runtime') throw new MemoryProtocolError('action actor must be runtime')
      assertMemoryActionRecord(payload.action, 'action')
      return
    case 'record-outcome':
      if (actor.kind !== 'runtime' && actor.kind !== 'background') throw new MemoryProtocolError('outcome actor is not permitted')
      assertMemoryOutcomeRecord(payload.outcome, 'outcome')
      return
    case 'record-feedback':
      if (actor.kind !== 'runtime' && actor.kind !== 'background') throw new MemoryProtocolError('feedback actor is not permitted')
      assertMemoryFeedbackVector(payload.feedback, 'feedback')
      return
    case 'record-behavior':
      if (actor.kind !== 'runtime') throw new MemoryProtocolError('behavior batch actor must be runtime')
      assertMemoryBehaviorBatchPayload(payload, 'behavior batch')
      return
    case 'link':
      if (actor.kind !== 'runtime' && actor.kind !== 'background') {
        throw new MemoryProtocolError('link actor is not permitted')
      }
      assertMemoryLinks(payload.links, 'link command links')
      return
    case 'correct':
      if (actor.kind !== 'owner') {
        throw new MemoryProtocolError('correction is owner-only')
      }
      assertProtocolId(payload.memoryId, 'correction memory id')
      assertText(payload.explanation, 'correction explanation')
      assertStringArray(payload.evidenceIds, 'correction evidence ids')
      if (!isRecord(payload.replacement) || typeof payload.replacement.form !== 'string' || !isRecord(payload.replacement.data)) {
        throw new MemoryProtocolError('correction replacement must be a memory form')
      }
      return
    case 'permit-influence':
      if (actor.kind !== 'owner') {
        throw new MemoryProtocolError('influence permission is owner-only')
      }
      assertProtocolId(payload.memoryId, 'permission memory id')
      assertTimestamp(payload.previousVersion, 'permission previous version')
      assertSurfaceArray(payload.surfaces, 'permission surfaces')
      if (payload.surfaces.length === 0) {
        throw new MemoryProtocolError('permission surfaces must name at least one influence surface')
      }
      assertText(payload.reason, 'permission reason')
      return
    case 'restrict-influence':
      if (actor.kind !== 'owner') {
        throw new MemoryProtocolError('influence restriction is owner-only')
      }
      assertProtocolId(payload.memoryId, 'restriction memory id')
      assertSurfaceArray(payload.surfaces, 'restriction surfaces')
      assertText(payload.reason, 'restriction reason')
      return
    case 'revoke-influence':
      if (actor.kind !== 'owner') {
        throw new MemoryProtocolError('influence revocation is owner-only')
      }
      assertProtocolId(payload.memoryId, 'revocation memory id')
      assertText(payload.reason, 'revocation reason')
      return
    case 'erase-preview':
      if (actor.kind !== 'owner') {
        throw new MemoryProtocolError('erase preview is owner-only')
      }
      assertStringArray(payload.memoryIds, 'erase preview memory ids')
      return
    case 'authorize-erase':
      if (actor.kind !== 'owner') {
        throw new MemoryProtocolError('erase authorization is owner-only')
      }
      assertProtocolId(payload.authorizationId, 'authorization id')
      assertStringArray(payload.memoryIds, 'erase authorization memory ids')
      assertTimestamp(payload.expiresAt, 'erase authorization expiry')
      assertText(payload.scopeHash, 'erase authorization scope hash')
      return
    case 'commit-erase':
      if (actor.kind !== 'owner') {
        throw new MemoryProtocolError('erase commit is owner-only')
      }
      assertProtocolId(payload.authorizationId, 'authorization id')
      return
  }
}

/**
 * Freezes a typed command after applying the authority checks.
 *
 * @param value - Typed command produced by a domain caller.
 * @returns An immutable validated command.
 */
export function createMemoryCommand(value: MemoryCommand): MemoryCommand {
  assertMemoryCommand(value)
  return deepFreeze(cloneValue(value))
}

function assertEventAuthority(type: MemoryEventType, actor: MemoryActor): void {
  const allowed: Record<MemoryEventType, readonly MemoryActorKind[]> = {
    'memory-observed': ['runtime', 'plugin'],
    'scene-opened': ['runtime'],
    'scene-extended': ['runtime'],
    'scene-closed': ['runtime'],
    'open-loop-opened': ['runtime'],
    'open-loop-resolved': ['runtime'],
    'memory-proposed': ['model'],
    'memory-formed': ['background'],
    'memory-transitioned': ['runtime', 'background'],
    'memory-consolidated': ['runtime', 'background'],
    'memory-decayed': ['background'],
    'memory-used': ['runtime', 'background'],
    'memory-linked': ['runtime', 'background'],
    'memory-corrected': ['owner'],
    'influence-permitted': ['owner'],
    'influence-restricted': ['owner'],
    'influence-revoked': ['owner'],
    'erase-authorized': ['owner'],
    'erase-committed': ['owner'],
    'prediction-recorded': ['runtime', 'background'],
    'action-recorded': ['runtime'],
    'outcome-recorded': ['runtime', 'background'],
    'feedback-recorded': ['runtime', 'background'],
    'disposition-learned': ['background'],
  }
  if (!allowed[type].includes(actor.kind)) {
    throw new MemoryProtocolError('actor kind ' + actor.kind + ' cannot emit ' + type)
  }
}

function readEventEnvelope(value: unknown): {
  type: MemoryEventType
  actor: MemoryActor
  payload: Record<string, unknown>
  occurredAt: string
} {
  if (!isRecord(value)) {
    throw new MemoryProtocolError('memory event must be an object')
  }
  if (value.kind !== 'memory-event') {
    throw new MemoryProtocolError('invalid memory event envelope kind')
  }
  assertProtocolVersion(value.protocolVersion)
  assertProtocolId(value.eventId, 'event id')
  assertProtocolId(value.transactionId, 'transaction id')
  assertProtocolId(value.commandId, 'command id')
  assertPosition(value.position, 'event position')
  assertTimestamp(value.occurredAt, 'event timestamp')
  assertActor(value.actor, 'event actor')
  if (typeof value.type !== 'string' || !EVENT_TYPES.includes(value.type as MemoryEventType)) {
    throw new MemoryProtocolError('unknown memory event')
  }
  const type = value.type as MemoryEventType
  assertEventAuthority(type, value.actor)
  if (!isRecord(value.payload)) {
    throw new MemoryProtocolError('memory event payload is required')
  }
  return { type, actor: value.actor, payload: value.payload, occurredAt: value.occurredAt }
}

/**
 * Validates a memory event at a durable or queue boundary.
 *
 * @param value - Unknown event data received from a transaction writer or store.
 * @returns Nothing; throws when the event is malformed or unauthorized.
 */
export function assertMemoryEvent(value: unknown): asserts value is MemoryEvent {
  const { type, actor, payload, occurredAt } = readEventEnvelope(value)
  switch (type) {
    case 'memory-observed':
      if (actor.kind !== 'runtime' && actor.kind !== 'plugin') {
        throw new MemoryProtocolError('observation event actor is not permitted')
      }
      if (!isRecord(payload.memory)) {
        throw new MemoryProtocolError('observation event requires memory')
      }
      assertObservedMemory(payload.memory, 'observation event memory')
      return
    case 'scene-opened':
      if (actor.kind !== 'runtime') {
        throw new MemoryProtocolError('scene opened event actor must be runtime')
      }
      if (!isRecord(payload.memory)) {
        throw new MemoryProtocolError('scene opened event requires memory')
      }
      sceneMemory(payload.memory, 'scene opened event memory')
      return
    case 'scene-extended':
    case 'scene-closed':
      if (actor.kind !== 'runtime') {
        throw new MemoryProtocolError('scene revision event actor must be runtime')
      }
      assertSceneRevision(payload, type + ' event payload')
      return
    case 'memory-proposed':
      if (actor.kind !== 'model') {
        throw new MemoryProtocolError('proposal event actor must be a model')
      }
      assertMemoryCandidate(payload.candidate)
      return
    case 'memory-formed':
      if (actor.kind !== 'background') {
        throw new MemoryProtocolError('representation formation event actor must be background')
      }
      assertMemoryRepresentationFormationResult(payload.result)
      return
    case 'open-loop-opened':
      if (actor.kind !== 'runtime') {
        throw new MemoryProtocolError('open-loop event actor must be runtime')
      }
      assertOpenLoopChange({ operation: 'open', sceneId: payload.sceneId, memory: payload.memory }, 'open-loop-opened event')
      return
    case 'open-loop-resolved':
      if (actor.kind !== 'runtime') {
        throw new MemoryProtocolError('open-loop event actor must be runtime')
      }
      assertOpenLoopChange(
        {
          operation: 'resolve',
          sceneId: payload.sceneId,
          memoryId: payload.memoryId,
          previousVersion: payload.previousVersion,
          memory: payload.memory,
        },
        'open-loop-resolved event',
      )
      return
    case 'memory-transitioned': {
      if (actor.kind !== 'runtime' && actor.kind !== 'background') {
        throw new MemoryProtocolError('transition event actor is not permitted')
      }
      assertProtocolId(payload.memoryId, 'transition event memory id')
      if (!isRecord(payload.memory)) {
        throw new MemoryProtocolError('transition event requires resulting memory')
      }
      const memory = createMemory(payload.memory as RinMemory)
      assertMemoryTransition(payload.transition)
      if (memory.id !== payload.memoryId) {
        throw new MemoryProtocolError('transition event memory id does not match resulting memory')
      }
      return
    }
    case 'memory-consolidated':
      if (actor.kind !== 'runtime' && actor.kind !== 'background') {
        throw new MemoryProtocolError('consolidation event actor is not permitted')
      }
      assertMemoryConsolidationResult(payload.result)
      return
    case 'memory-decayed':
      if (actor.kind !== 'background') {
        throw new MemoryProtocolError('decay event actor must be background')
      }
      assertMemoryDecayResult(payload.result)
      return
    case 'memory-used':
      if (actor.kind !== 'runtime' && actor.kind !== 'background') {
        throw new MemoryProtocolError('use trace event actor is not permitted')
      }
      assertMemoryUseTrace(payload.use, 'memory-used event use')
      return
    case 'disposition-learned':
      if (actor.kind !== 'background') throw new MemoryProtocolError('disposition learning event actor must be background')
      assertMemoryDispositionLearningResult(payload.result, 'disposition learned event')
      return
    case 'prediction-recorded':
      if (actor.kind !== 'runtime' && actor.kind !== 'background') throw new MemoryProtocolError('prediction event actor is not permitted')
      assertMemoryPredictionRecord(payload.prediction, 'prediction event')
      return
    case 'action-recorded':
      if (actor.kind !== 'runtime') throw new MemoryProtocolError('action event actor must be runtime')
      assertMemoryActionRecord(payload.action, 'action event')
      return
    case 'outcome-recorded':
      if (actor.kind !== 'runtime' && actor.kind !== 'background') throw new MemoryProtocolError('outcome event actor is not permitted')
      assertMemoryOutcomeRecord(payload.outcome, 'outcome event')
      return
    case 'feedback-recorded':
      if (actor.kind !== 'runtime' && actor.kind !== 'background') throw new MemoryProtocolError('feedback event actor is not permitted')
      assertMemoryFeedbackVector(payload.feedback, 'feedback event')
      return
    case 'memory-linked':
      if (actor.kind !== 'runtime' && actor.kind !== 'background') {
        throw new MemoryProtocolError('link event actor is not permitted')
      }
      assertMemoryLinks(payload.links, 'link event links')
      return
    case 'memory-corrected': {
      if (actor.kind !== 'owner') {
        throw new MemoryProtocolError('correction event is owner-only')
      }
      assertProtocolId(payload.memoryId, 'correction event memory id')
      if (!isRecord(payload.memory)) {
        throw new MemoryProtocolError('correction event requires resulting memory')
      }
      const memory = createMemory(payload.memory as RinMemory)
      assertStringArray(payload.evidenceIds, 'correction event evidence ids')
      assertText(payload.explanation, 'correction event explanation')
      if (memory.id !== payload.memoryId) {
        throw new MemoryProtocolError('correction event memory id does not match resulting memory')
      }
      return
    }
    case 'influence-permitted': {
      if (actor.kind !== 'owner') {
        throw new MemoryProtocolError('influence permission event is owner-only')
      }
      assertProtocolId(payload.memoryId, 'permission event memory id')
      assertTimestamp(payload.previousVersion, 'permission event previous version')
      if (payload.state !== 'permitted') {
        throw new MemoryProtocolError('permission event must set permitted state')
      }
      assertSurfaceArray(payload.surfaces, 'permission event surfaces')
      if (payload.surfaces.length === 0) {
        throw new MemoryProtocolError('permission event surfaces must name at least one influence surface')
      }
      assertText(payload.reason, 'permission event reason')
      if (!isRecord(payload.memory)) {
        throw new MemoryProtocolError('permission event requires resulting memory')
      }
      const memory = createMemory(payload.memory as RinMemory)
      if (memory.id !== payload.memoryId) {
        throw new MemoryProtocolError('permission event memory id does not match resulting memory')
      }
      if (memory.state.influence !== 'permitted' || !sameStringArray(memory.dynamics.influenceSurfaces, payload.surfaces)) {
        throw new MemoryProtocolError('permission event resulting memory does not match permitted surfaces')
      }
      if (memory.updatedAt !== occurredAt) {
        throw new MemoryProtocolError('permission event resulting memory version must equal occurredAt')
      }
      return
    }
    case 'influence-restricted':
      if (actor.kind !== 'owner') {
        throw new MemoryProtocolError('influence restriction event is owner-only')
      }
      assertProtocolId(payload.memoryId, 'restriction event memory id')
      if (payload.state !== 'restricted') {
        throw new MemoryProtocolError('restriction event must set restricted state')
      }
      assertSurfaceArray(payload.surfaces, 'restriction event surfaces')
      assertText(payload.reason, 'restriction event reason')
      return
    case 'influence-revoked':
      if (actor.kind !== 'owner') {
        throw new MemoryProtocolError('influence revocation event is owner-only')
      }
      assertProtocolId(payload.memoryId, 'revocation event memory id')
      if (payload.state !== 'revoked') {
        throw new MemoryProtocolError('revocation event must set revoked state')
      }
      assertText(payload.reason, 'revocation event reason')
      return
    case 'erase-authorized':
      if (actor.kind !== 'owner') {
        throw new MemoryProtocolError('erase authorization event is owner-only')
      }
      assertProtocolId(payload.authorizationId, 'authorization event id')
      assertStringArray(payload.memoryIds, 'authorization event memory ids')
      assertTimestamp(payload.expiresAt, 'authorization event expiry')
      assertText(payload.scopeHash, 'authorization event scope hash')
      return
    case 'erase-committed':
      if (actor.kind !== 'owner') {
        throw new MemoryProtocolError('erase commit event is owner-only')
      }
      assertProtocolId(payload.authorizationId, 'commit event authorization id')
      assertStringArray(payload.memoryIds, 'commit event memory ids')
      return
  }
}

/**
 * Freezes a typed event after validating its actor and resulting memory.
 *
 * @param value - Typed event produced inside a transaction.
 * @returns An immutable validated event.
 */
export function createMemoryEvent(value: MemoryEvent): MemoryEvent {
  assertMemoryEvent(value)
  return deepFreeze(cloneValue(value))
}

function eventTypeMatchesCommand(command: MemoryCommandType, event: MemoryEventType): boolean {
  const expected: Record<MemoryCommandType, readonly MemoryEventType[]> = {
    observe: ['memory-observed'],
    scene: ['scene-opened', 'scene-extended', 'scene-closed', 'open-loop-opened', 'open-loop-resolved'],
    propose: ['memory-proposed'],
    form: ['memory-formed'],
    'record-use': ['memory-used'],
    transition: ['memory-transitioned'],
    consolidate: ['memory-consolidated'],
    'learn-disposition': ['disposition-learned'],
    'record-prediction': ['prediction-recorded'],
    'record-action': ['action-recorded'],
    'record-outcome': ['outcome-recorded'],
    'record-behavior': ['prediction-recorded', 'action-recorded', 'outcome-recorded', 'feedback-recorded'],
    'record-feedback': ['feedback-recorded'],
    decay: ['memory-decayed'],
    link: ['memory-linked'],
    correct: ['memory-corrected'],
    'restrict-influence': ['influence-restricted'],
    'revoke-influence': ['influence-revoked'],
    'permit-influence': ['influence-permitted'],
    'erase-preview': [],
    'authorize-erase': ['erase-authorized'],
    'commit-erase': ['erase-committed'],
  }
  return expected[command].includes(event)
}
function assertSceneTransactionBinding(command: SceneCommand, events: readonly MemoryEvent[]): void {
  const loopChanges = command.payload.loopChanges ?? []
  if (command.payload.changes.length + loopChanges.length !== events.length) {
    throw new MemoryProtocolError('scene transaction event count does not match scene and loop changes')
  }
  for (const [index, change] of command.payload.changes.entries()) {
    const event = events[index]
    if (event === undefined) {
      throw new MemoryProtocolError('scene transaction is missing an event')
    }
    if (change.operation === 'open') {
      if (event.type !== 'scene-opened') {
        throw new MemoryProtocolError('scene opened event does not match its change')
      }
      if (event.payload.memory.id !== change.memory.id) {
        throw new MemoryProtocolError('scene opened event memory does not match its change')
      }
      continue
    }
    if (change.operation === 'extend') {
      if (event.type !== 'scene-extended') {
        throw new MemoryProtocolError('scene revision event does not match its change')
      }
      if (
        event.payload.memoryId !== change.memoryId
        || event.payload.previousVersion !== change.previousVersion
        || event.payload.memory.id !== change.memory.id
      ) {
        throw new MemoryProtocolError('scene revision event payload does not match its change')
      }
      continue
    }
    if (event.type !== 'scene-closed') {
      throw new MemoryProtocolError('scene revision event does not match its change')
    }
    if (
      event.payload.memoryId !== change.memoryId
      || event.payload.previousVersion !== change.previousVersion
      || event.payload.memory.id !== change.memory.id
    ) {
      throw new MemoryProtocolError('scene revision event payload does not match its change')
    }
  }
  for (const [index, change] of loopChanges.entries()) {
    const event = events[command.payload.changes.length + index]
    if (event === undefined) {
      throw new MemoryProtocolError('scene transaction is missing an open-loop event')
    }
    if (change.operation === 'open') {
      if (event.type !== 'open-loop-opened' || event.payload.sceneId !== change.sceneId || event.payload.memory.id !== change.memory.id) {
        throw new MemoryProtocolError('open-loop opened event does not match its change')
      }
      continue
    }
    if (event.type !== 'open-loop-resolved' || event.payload.sceneId !== change.sceneId || event.payload.memoryId !== change.memoryId || event.payload.previousVersion !== change.previousVersion || event.payload.memory.id !== change.memory.id) {
      throw new MemoryProtocolError('open-loop resolved event does not match its change')
    }
  }
}

function assertInfluencePermissionTransactionBinding(
  command: PermitInfluenceCommand,
  events: readonly MemoryEvent[],
): void {
  if (events.length !== 1 || events[0]?.type !== 'influence-permitted') {
    throw new MemoryProtocolError('influence permission transaction must contain one permission event')
  }
  const event = events[0]
  if (event === undefined || event.type !== 'influence-permitted') {
    throw new MemoryProtocolError('influence permission transaction is missing its permission event')
  }
  const commandPayload = command.payload
  const eventPayload = event.payload
  if (
    eventPayload.memoryId !== commandPayload.memoryId
    || eventPayload.previousVersion !== commandPayload.previousVersion
    || eventPayload.reason !== commandPayload.reason
    || !sameStringArray(eventPayload.surfaces, commandPayload.surfaces)
  ) {
    throw new MemoryProtocolError('influence permission event does not match its command')
  }
}

/**
 * Binds one command and its accepted events into an atomic transaction.
 *
 * @param value - Transaction envelope with a single command and its events.
 * @returns An immutable validated transaction.
 */
export function createMemoryTransaction(value: Omit<MemoryTransaction, 'kind' | 'protocolVersion'>): MemoryTransaction {
  const command = createMemoryCommand(value.command)
  assertProtocolId(value.transactionId, 'transaction id')
  assertProtocolId(value.commandId, 'transaction command id')
  assertProtocolId(value.correlationId, 'transaction correlation id')
  assertTimestamp(value.openedAt, 'transaction opened timestamp')
  assertTimestamp(value.committedAt, 'transaction committed timestamp')
  if (Date.parse(value.committedAt) < Date.parse(value.openedAt)) {
    throw new MemoryProtocolError('transaction committedAt cannot precede openedAt')
  }
  if (value.commandId !== command.commandId || value.correlationId !== command.correlationId) {
    throw new MemoryProtocolError('transaction identity does not match its command')
  }
  assertActor(value.actor, 'transaction actor')
  if (value.actor.kind !== command.actor.kind || value.actor.id !== command.actor.id) {
    throw new MemoryProtocolError('transaction actor does not match its command')
  }
  if (!Array.isArray(value.events)) {
    throw new MemoryProtocolError('transaction events must be an array')
  }
  const events = value.events.map(createMemoryEvent)
  const positions = events.map(event => event.position)
  if (new Set(positions).size !== positions.length || positions.some((position, index) => position !== index)) {
    throw new MemoryProtocolError('transaction event positions must be contiguous from zero')
  }
  for (const event of events) {
    if (
      event.transactionId !== value.transactionId ||
      event.commandId !== value.commandId ||
      event.actor.kind !== value.actor.kind ||
      event.actor.id !== value.actor.id ||
      !eventTypeMatchesCommand(command.type, event.type)
    ) {
      throw new MemoryProtocolError('transaction event does not belong to its command')
    }
  }
  if (command.type === 'scene') {
    assertSceneTransactionBinding(command, events)
  }
  if (command.type === 'permit-influence') {
    assertInfluencePermissionTransactionBinding(command, events)
  }
  if (command.type === 'record-behavior') {
    assertBehaviorBatchTransactionBinding(command, events)
  }
  if (events.length === 0 && command.type !== 'erase-preview') {
    throw new MemoryProtocolError('mutating command transaction must contain an event')
  }
  return deepFreeze({
    kind: 'memory-transaction',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    transactionId: value.transactionId,
    commandId: value.commandId,
    correlationId: value.correlationId,
    actor: cloneValue(value.actor),
    openedAt: value.openedAt,
    committedAt: value.committedAt,
    command,
    events,
  })
}

/**
 * Validates a complete transaction envelope at a durable or queue boundary.
 *
 * @param value - Unknown transaction data received from a writer or store.
 * @returns Nothing; throws when the envelope or its command/event binding is invalid.
 */
export function assertMemoryTransaction(value: unknown): asserts value is MemoryTransaction {
  if (!isRecord(value)) {
    throw new MemoryProtocolError('memory transaction must be an object')
  }
  if (value.kind !== 'memory-transaction') {
    throw new MemoryProtocolError('invalid memory transaction envelope kind')
  }
  assertProtocolVersion(value.protocolVersion)
  assertProtocolId(value.transactionId, 'transaction id')
  assertProtocolId(value.commandId, 'transaction command id')
  assertProtocolId(value.correlationId, 'transaction correlation id')
  assertTimestamp(value.openedAt, 'transaction opened timestamp')
  assertTimestamp(value.committedAt, 'transaction committed timestamp')
  assertActor(value.actor, 'transaction actor')
  if (!isRecord(value.command)) {
    throw new MemoryProtocolError('transaction command is required')
  }
  assertMemoryCommand(value.command)
  if (!Array.isArray(value.events)) {
    throw new MemoryProtocolError('transaction events must be an array')
  }
  for (const event of value.events) assertMemoryEvent(event)
  createMemoryTransaction({
    transactionId: value.transactionId as MemoryTransactionId,
    commandId: value.commandId as MemoryCommandId,
    correlationId: value.correlationId as MemoryCorrelationId,
    actor: value.actor,
    openedAt: value.openedAt,
    committedAt: value.committedAt,
    command: value.command,
    events: value.events,
  })
}
export type MemoryInfluencePermissionTransactionInput = Readonly<{
  actor: OwnerActor
  memoryId: MemoryId
  previousVersion: string
  memory: RinMemory
  surfaces: readonly MemoryInfluenceSurface[]
  reason: string
  commandId: MemoryCommandId
  eventId: MemoryEventId
  transactionId: MemoryTransactionId
  correlationId: MemoryCorrelationId
  issuedAt: string
  committedAt: string
}>

/** Forms an owner-only, version-bound permission for behavioral influence. */
export function createMemoryInfluencePermissionTransaction(
  input: MemoryInfluencePermissionTransactionInput,
): MemoryTransaction {
  const memory = createMemory(input.memory)
  if (memory.id !== input.memoryId) {
    throw new MemoryProtocolError('permission memory id does not match resulting memory')
  }
  if (memory.state.influence !== 'permitted') {
    throw new MemoryProtocolError('permission transaction must produce permitted memory')
  }
  if (memory.updatedAt !== input.committedAt) {
    throw new MemoryProtocolError('permission resulting memory version must equal committedAt')
  }
  if (input.surfaces.length === 0 || !sameStringArray(memory.dynamics.influenceSurfaces, input.surfaces)) {
    throw new MemoryProtocolError('permission resulting memory surfaces do not match the command')
  }
  const command: MemoryCommand = {
    kind: 'memory-command',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'permit-influence',
    commandId: input.commandId,
    correlationId: input.correlationId,
    actor: input.actor,
    issuedAt: input.issuedAt,
    payload: {
      memoryId: input.memoryId,
      previousVersion: input.previousVersion,
      surfaces: [...input.surfaces],
      reason: input.reason,
    },
  }
  const event: MemoryEvent = {
    kind: 'memory-event',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'influence-permitted',
    eventId: input.eventId,
    transactionId: input.transactionId,
    commandId: input.commandId,
    position: 0,
    actor: input.actor,
    occurredAt: input.committedAt,
    payload: {
      memoryId: input.memoryId,
      previousVersion: input.previousVersion,
      state: 'permitted',
      memory,
      surfaces: [...input.surfaces],
      reason: input.reason,
    },
  }
  return createMemoryTransaction({
    transactionId: input.transactionId,
    commandId: input.commandId,
    correlationId: input.correlationId,
    actor: input.actor,
    openedAt: input.issuedAt,
    committedAt: input.committedAt,
    command,
    events: [event],
  })
}

export type MemoryTransitionTransactionInput = Readonly<{
  actor: RuntimeActor | BackgroundActor
  memoryId: MemoryId
  memory: RinMemory
  transition: MemoryTransition
  commandId: MemoryCommandId
  eventId: MemoryEventId
  transactionId: MemoryTransactionId
  correlationId: MemoryCorrelationId
  issuedAt: string
  committedAt: string
}>

export type MemoryCorrectionTransactionInput = Readonly<{
  actor: OwnerActor
  memoryId: MemoryId
  memory: RinMemory
  evidenceIds: readonly EvidenceId[]
  explanation: string
  commandId: MemoryCommandId
  eventId: MemoryEventId
  transactionId: MemoryTransactionId
  correlationId: MemoryCorrelationId
  issuedAt: string
  committedAt: string
}>

/**
 * Forms the owner-only correction that revises one representation's content in
 * place. The prior version stays recoverable from the journal; the corrected
 * memory carries the resulting version.
 */
export function createMemoryCorrectionTransaction(
  input: MemoryCorrectionTransactionInput,
): MemoryTransaction {
  const memory = createMemory(input.memory)
  if (memory.id !== input.memoryId) {
    throw new MemoryProtocolError('correction memory id does not match resulting memory')
  }
  if (memory.updatedAt !== input.committedAt) {
    throw new MemoryProtocolError('correction resulting memory version must equal committedAt')
  }
  if (memory.state.persistence === 'erased') {
    throw new MemoryProtocolError('correction cannot target an erased memory')
  }
  const command: MemoryCommand = {
    kind: 'memory-command',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'correct',
    commandId: input.commandId,
    correlationId: input.correlationId,
    actor: input.actor,
    issuedAt: input.issuedAt,
    payload: {
      memoryId: input.memoryId,
      replacement: { form: memory.form, data: memory.data },
      evidenceIds: [...input.evidenceIds],
      explanation: input.explanation,
    },
  }
  const event: MemoryEvent = {
    kind: 'memory-event',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'memory-corrected',
    eventId: input.eventId,
    transactionId: input.transactionId,
    commandId: input.commandId,
    position: 0,
    actor: input.actor,
    occurredAt: input.committedAt,
    payload: {
      memoryId: input.memoryId,
      memory,
      evidenceIds: [...input.evidenceIds],
      explanation: input.explanation,
    },
  }
  return createMemoryTransaction({
    transactionId: input.transactionId,
    commandId: input.commandId,
    correlationId: input.correlationId,
    actor: input.actor,
    openedAt: input.issuedAt,
    committedAt: input.committedAt,
    command,
    events: [event],
  })
}

export type MemoryInfluenceRestrictionTransactionInput = Readonly<{
  actor: OwnerActor
  memoryId: MemoryId
  memory: RinMemory
  surfaces: readonly MemoryInfluenceSurface[]
  reason: string
  commandId: MemoryCommandId
  eventId: MemoryEventId
  transactionId: MemoryTransactionId
  correlationId: MemoryCorrelationId
  issuedAt: string
  committedAt: string
}>

/** Forms the owner-only restriction that limits one representation's influence surfaces. */
export function createMemoryInfluenceRestrictionTransaction(
  input: MemoryInfluenceRestrictionTransactionInput,
): MemoryTransaction {
  const memory = createMemory(input.memory)
  if (memory.id !== input.memoryId) {
    throw new MemoryProtocolError('restriction memory id does not match resulting memory')
  }
  if (memory.state.influence !== 'restricted') {
    throw new MemoryProtocolError('restriction transaction must produce restricted memory')
  }
  if (memory.updatedAt !== input.committedAt) {
    throw new MemoryProtocolError('restriction resulting memory version must equal committedAt')
  }
  if (input.surfaces.length === 0 || !sameStringArray(memory.dynamics.influenceSurfaces, input.surfaces)) {
    throw new MemoryProtocolError('restriction resulting memory surfaces do not match the command')
  }
  const command: MemoryCommand = {
    kind: 'memory-command',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'restrict-influence',
    commandId: input.commandId,
    correlationId: input.correlationId,
    actor: input.actor,
    issuedAt: input.issuedAt,
    payload: {
      memoryId: input.memoryId,
      surfaces: [...input.surfaces],
      reason: input.reason,
    },
  }
  const event: MemoryEvent = {
    kind: 'memory-event',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'influence-restricted',
    eventId: input.eventId,
    transactionId: input.transactionId,
    commandId: input.commandId,
    position: 0,
    actor: input.actor,
    occurredAt: input.committedAt,
    payload: {
      memoryId: input.memoryId,
      state: 'restricted',
      surfaces: [...input.surfaces],
      reason: input.reason,
    },
  }
  return createMemoryTransaction({
    transactionId: input.transactionId,
    commandId: input.commandId,
    correlationId: input.correlationId,
    actor: input.actor,
    openedAt: input.issuedAt,
    committedAt: input.committedAt,
    command,
    events: [event],
  })
}

export type MemoryInfluenceRevocationTransactionInput = Readonly<{
  actor: OwnerActor
  memoryId: MemoryId
  memory: RinMemory
  reason: string
  commandId: MemoryCommandId
  eventId: MemoryEventId
  transactionId: MemoryTransactionId
  correlationId: MemoryCorrelationId
  issuedAt: string
  committedAt: string
}>

/** Forms the owner-only revocation that permanently blocks one representation's influence. */
export function createMemoryInfluenceRevocationTransaction(
  input: MemoryInfluenceRevocationTransactionInput,
): MemoryTransaction {
  const memory = createMemory(input.memory)
  if (memory.id !== input.memoryId) {
    throw new MemoryProtocolError('revocation memory id does not match resulting memory')
  }
  if (memory.state.influence !== 'revoked') {
    throw new MemoryProtocolError('revocation transaction must produce revoked memory')
  }
  if (memory.updatedAt !== input.committedAt) {
    throw new MemoryProtocolError('revocation resulting memory version must equal committedAt')
  }
  const command: MemoryCommand = {
    kind: 'memory-command',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'revoke-influence',
    commandId: input.commandId,
    correlationId: input.correlationId,
    actor: input.actor,
    issuedAt: input.issuedAt,
    payload: {
      memoryId: input.memoryId,
      reason: input.reason,
    },
  }
  const event: MemoryEvent = {
    kind: 'memory-event',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'influence-revoked',
    eventId: input.eventId,
    transactionId: input.transactionId,
    commandId: input.commandId,
    position: 0,
    actor: input.actor,
    occurredAt: input.committedAt,
    payload: {
      memoryId: input.memoryId,
      state: 'revoked',
      reason: input.reason,
    },
  }
  return createMemoryTransaction({
    transactionId: input.transactionId,
    commandId: input.commandId,
    correlationId: input.correlationId,
    actor: input.actor,
    openedAt: input.issuedAt,
    committedAt: input.committedAt,
    command,
    events: [event],
  })
}

export type MemoryEraseAuthorizationTransactionInput = Readonly<{
  actor: OwnerActor
  authorizationId: MemoryAuthorizationId
  memoryIds: readonly MemoryId[]
  expiresAt: string
  scopeHash: string
  commandId: MemoryCommandId
  eventId: MemoryEventId
  transactionId: MemoryTransactionId
  correlationId: MemoryCorrelationId
  issuedAt: string
  committedAt: string
}>

/** Forms the owner-only authorization that binds one erase scope and expiry. */
export function createMemoryEraseAuthorizationTransaction(
  input: MemoryEraseAuthorizationTransactionInput,
): MemoryTransaction {
  if (input.memoryIds.length === 0) {
    throw new MemoryProtocolError('erase authorization must cover at least one memory')
  }
  const command: MemoryCommand = {
    kind: 'memory-command',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'authorize-erase',
    commandId: input.commandId,
    correlationId: input.correlationId,
    actor: input.actor,
    issuedAt: input.issuedAt,
    payload: {
      authorizationId: input.authorizationId,
      memoryIds: [...input.memoryIds],
      expiresAt: input.expiresAt,
      scopeHash: input.scopeHash,
    },
  }
  const event: MemoryEvent = {
    kind: 'memory-event',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'erase-authorized',
    eventId: input.eventId,
    transactionId: input.transactionId,
    commandId: input.commandId,
    position: 0,
    actor: input.actor,
    occurredAt: input.committedAt,
    payload: {
      authorizationId: input.authorizationId,
      memoryIds: [...input.memoryIds],
      expiresAt: input.expiresAt,
      scopeHash: input.scopeHash,
    },
  }
  return createMemoryTransaction({
    transactionId: input.transactionId,
    commandId: input.commandId,
    correlationId: input.correlationId,
    actor: input.actor,
    openedAt: input.issuedAt,
    committedAt: input.committedAt,
    command,
    events: [event],
  })
}

export type MemoryEraseCommitTransactionInput = Readonly<{
  actor: OwnerActor
  authorizationId: MemoryAuthorizationId
  memoryIds: readonly MemoryId[]
  commandId: MemoryCommandId
  eventId: MemoryEventId
  transactionId: MemoryTransactionId
  correlationId: MemoryCorrelationId
  issuedAt: string
  committedAt: string
}>

/** Forms the owner-only atomic commit that consumes one erase authorization. */
export function createMemoryEraseCommitTransaction(
  input: MemoryEraseCommitTransactionInput,
): MemoryTransaction {
  if (input.memoryIds.length === 0) {
    throw new MemoryProtocolError('erase commit must cover at least one memory')
  }
  const command: MemoryCommand = {
    kind: 'memory-command',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'commit-erase',
    commandId: input.commandId,
    correlationId: input.correlationId,
    actor: input.actor,
    issuedAt: input.issuedAt,
    payload: {
      authorizationId: input.authorizationId,
    },
  }
  const event: MemoryEvent = {
    kind: 'memory-event',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'erase-committed',
    eventId: input.eventId,
    transactionId: input.transactionId,
    commandId: input.commandId,
    position: 0,
    actor: input.actor,
    occurredAt: input.committedAt,
    payload: {
      authorizationId: input.authorizationId,
      memoryIds: [...input.memoryIds],
    },
  }
  return createMemoryTransaction({
    transactionId: input.transactionId,
    commandId: input.commandId,
    correlationId: input.correlationId,
    actor: input.actor,
    openedAt: input.issuedAt,
    committedAt: input.committedAt,
    command,
    events: [event],
  })
}

/**
 * Forms one versioned state transition in the canonical cognition journal.
 *
 * Influence transitions are intentionally excluded: behavioral permission has
 * its owner-only permit-influence transaction and cannot use this command.
 */
export type MemoryRepresentationFormationTransactionInput = Readonly<{
  actor: BackgroundActor
  result: MemoryRepresentationFormationResult
  commandId: MemoryCommandId
  eventId: MemoryEventId
  transactionId: MemoryTransactionId
  correlationId: MemoryCorrelationId
  issuedAt: string
}>

/**
 * Creates the controller transaction that moves one accepted representation
 * from transient/raw to durable/integrated while keeping influence blocked.
 */
export function createMemoryRepresentationFormationTransaction(
  input: MemoryRepresentationFormationTransactionInput,
): MemoryTransaction {
  assertMemoryRepresentationFormationResult(input.result)
  const command: MemoryCommand = {
    kind: 'memory-command',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'form',
    commandId: input.commandId,
    correlationId: input.correlationId,
    actor: input.actor,
    issuedAt: input.issuedAt,
    payload: { result: input.result },
  }
  const event: MemoryEvent = {
    kind: 'memory-event',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'memory-formed',
    eventId: input.eventId,
    transactionId: input.transactionId,
    commandId: input.commandId,
    position: 0,
    actor: input.actor,
    occurredAt: input.result.memory.updatedAt,
    payload: { result: input.result },
  }
  return createMemoryTransaction({
    transactionId: input.transactionId,
    commandId: input.commandId,
    correlationId: input.correlationId,
    actor: input.actor,
    openedAt: input.issuedAt,
    committedAt: input.result.memory.updatedAt,
    command,
    events: [event],
  })
}

export function createMemoryTransitionTransaction(
  input: MemoryTransitionTransactionInput,
): MemoryTransaction {
  const memory = createMemory(input.memory)
  assertMemoryTransition(input.transition)
  if (memory.id !== input.memoryId) {
    throw new MemoryProtocolError('transition memory id does not match resulting memory')
  }
  if (memory.updatedAt !== input.transition.at) {
    throw new MemoryProtocolError('transition resulting memory version must equal transition.at')
  }
  if (input.transition.type === 'influence') {
    throw new MemoryProtocolError('influence transitions require the owner permit-influence command')
  }
  const command: MemoryCommand = {
    kind: 'memory-command',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'transition',
    commandId: input.commandId,
    correlationId: input.correlationId,
    actor: input.actor,
    issuedAt: input.issuedAt,
    payload: {
      memoryId: input.memoryId,
      transition: input.transition,
    },
  }
  const event: MemoryEvent = {
    kind: 'memory-event',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'memory-transitioned',
    eventId: input.eventId,
    transactionId: input.transactionId,
    commandId: input.commandId,
    position: 0,
    actor: input.actor,
    occurredAt: input.committedAt,
    payload: {
      memoryId: input.memoryId,
      memory,
      transition: input.transition,
    },
  }
  return createMemoryTransaction({
    transactionId: input.transactionId,
    commandId: input.commandId,
    correlationId: input.correlationId,
    actor: input.actor,
    openedAt: input.issuedAt,
    committedAt: input.committedAt,
    command,
    events: [event],
  })
}
function cloneValue<T>(value: T): T {
  return structuredClone(value)
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return value
}

export type MemoryUseTransactionInput = Readonly<{
  actor: RuntimeActor | BackgroundActor
  use: MemoryUseTrace
  commandId: MemoryCommandId
  eventId: MemoryEventId
  transactionId: MemoryTransactionId
  correlationId: MemoryCorrelationId
  issuedAt: string
}>

/**
 * Forms one actual representation use as a canonical cognition transaction.
 *
 * The event is intentionally materialization-neutral: it advances the journal
 * and can be queried for labile-window derivation, but it does not mutate the
 * representation merely because it was used.
 */
export function createMemoryUseTransaction(input: MemoryUseTransactionInput): MemoryTransaction {
  assertMemoryUseTrace(input.use, 'memory use')
  const command: MemoryCommand = {
    kind: 'memory-command',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'record-use',
    commandId: input.commandId,
    correlationId: input.correlationId,
    actor: input.actor,
    issuedAt: input.issuedAt,
    payload: { use: input.use },
  }
  const event: MemoryEvent = {
    kind: 'memory-event',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'memory-used',
    eventId: input.eventId,
    transactionId: input.transactionId,
    commandId: input.commandId,
    position: 0,
    actor: input.actor,
    occurredAt: input.use.usedAt,
    payload: { use: input.use },
  }
  return createMemoryTransaction({
    transactionId: input.transactionId,
    commandId: input.commandId,
    correlationId: input.correlationId,
    actor: input.actor,
    openedAt: input.issuedAt,
    committedAt: input.use.usedAt,
    command,
    events: [event],
  })
}
export type MemoryConsolidationTransactionInput = Readonly<{
  actor: RuntimeActor | BackgroundActor
  result: MemoryConsolidationResult
  commandId: MemoryCommandId
  eventId: MemoryEventId
  transactionId: MemoryTransactionId
  correlationId: MemoryCorrelationId
  issuedAt: string
  committedAt: string
}>

/**
 * Forms one validated reconsolidation result as an atomic cognition transaction.
 */
export function createMemoryConsolidationTransaction(
  input: MemoryConsolidationTransactionInput,
): MemoryTransaction {
  assertMemoryConsolidationResult(input.result)
  const command: MemoryCommand = {
    kind: 'memory-command',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'consolidate',
    commandId: input.commandId,
    correlationId: input.correlationId,
    actor: input.actor,
    issuedAt: input.issuedAt,
    payload: { result: input.result },
  }
  const event: MemoryEvent = {
    kind: 'memory-event',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'memory-consolidated',
    eventId: input.eventId,
    transactionId: input.transactionId,
    commandId: input.commandId,
    position: 0,
    actor: input.actor,
    occurredAt: input.committedAt,
    payload: { result: input.result },
  }
  return createMemoryTransaction({
    transactionId: input.transactionId,
    commandId: input.commandId,
    correlationId: input.correlationId,
    actor: input.actor,
    openedAt: input.issuedAt,
    committedAt: input.committedAt,
    command,
    events: [event],
  })
}

export type MemoryDecayTransactionInput = Readonly<{
  actor: BackgroundActor
  result: MemoryDecayResult
  commandId: MemoryCommandId
  eventId: MemoryEventId
  transactionId: MemoryTransactionId
  correlationId: MemoryCorrelationId
  issuedAt: string
  committedAt: string
}>

/** Forms one validated background decay result as an atomic cognition transaction. */
export function createMemoryDecayTransaction(input: MemoryDecayTransactionInput): MemoryTransaction {
  assertMemoryDecayResult(input.result)
  const command: MemoryCommand = {
    kind: 'memory-command',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'decay',
    commandId: input.commandId,
    correlationId: input.correlationId,
    actor: input.actor,
    issuedAt: input.issuedAt,
    payload: { result: input.result },
  }
  const event: MemoryEvent = {
    kind: 'memory-event',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'memory-decayed',
    eventId: input.eventId,
    transactionId: input.transactionId,
    commandId: input.commandId,
    position: 0,
    actor: input.actor,
    occurredAt: input.committedAt,
    payload: { result: input.result },
  }
  return createMemoryTransaction({
    transactionId: input.transactionId,
    commandId: input.commandId,
    correlationId: input.correlationId,
    actor: input.actor,
    openedAt: input.issuedAt,
    committedAt: input.committedAt,
    command,
    events: [event],
  })
}
type BehaviorTransactionIdentity = Readonly<{
  commandId: MemoryCommandId
  eventId: MemoryEventId
  transactionId: MemoryTransactionId
  correlationId: MemoryCorrelationId
  issuedAt: string
  committedAt: string
}>

function createBehaviorTransaction(input: BehaviorTransactionIdentity & Readonly<{
  actor: RuntimeActor | BackgroundActor
  commandType: Extract<MemoryCommandType, 'record-prediction' | 'record-action' | 'record-outcome' | 'record-feedback' | 'learn-disposition'>
  eventType: Extract<MemoryEventType, 'prediction-recorded' | 'action-recorded' | 'outcome-recorded' | 'feedback-recorded' | 'disposition-learned'>
  payload: Readonly<Record<string, unknown>>
  occurredAt: string
}>): MemoryTransaction {
  const command: MemoryCommand = {
    kind: 'memory-command',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: input.commandType,
    commandId: input.commandId,
    correlationId: input.correlationId,
    actor: input.actor,
    issuedAt: input.issuedAt,
    payload: input.payload,
  } as MemoryCommand
  const event: MemoryEvent = {
    kind: 'memory-event',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: input.eventType,
    eventId: input.eventId,
    transactionId: input.transactionId,
    commandId: input.commandId,
    position: 0,
    actor: input.actor,
    occurredAt: input.occurredAt,
    payload: input.payload,
  } as MemoryEvent
  return createMemoryTransaction({
    transactionId: input.transactionId,
    commandId: input.commandId,
    correlationId: input.correlationId,
    actor: input.actor,
    openedAt: input.issuedAt,
    committedAt: input.committedAt,
    command,
    events: [event],
  })
}

export type MemoryPredictionTransactionInput = BehaviorTransactionIdentity & Readonly<{
  actor: RuntimeActor | BackgroundActor
  prediction: MemoryPredictionRecord
}>

export function createMemoryPredictionTransaction(input: MemoryPredictionTransactionInput): MemoryTransaction {
  assertMemoryPredictionRecord(input.prediction, 'memory prediction')
  return createBehaviorTransaction({
    ...input,
    commandType: 'record-prediction',
    eventType: 'prediction-recorded',
    payload: { prediction: input.prediction },
    occurredAt: input.prediction.createdAt,
  })
}

export type MemoryActionTransactionInput = BehaviorTransactionIdentity & Readonly<{
  actor: RuntimeActor
  action: MemoryActionRecord
}>

export function createMemoryActionTransaction(input: MemoryActionTransactionInput): MemoryTransaction {
  assertMemoryActionRecord(input.action, 'memory action')
  return createBehaviorTransaction({
    ...input,
    commandType: 'record-action',
    eventType: 'action-recorded',
    payload: { action: input.action },
    occurredAt: input.action.occurredAt,
  })
}

export type MemoryOutcomeTransactionInput = BehaviorTransactionIdentity & Readonly<{
  actor: RuntimeActor | BackgroundActor
  outcome: MemoryOutcomeRecord
}>

export function createMemoryOutcomeTransaction(input: MemoryOutcomeTransactionInput): MemoryTransaction {
  assertMemoryOutcomeRecord(input.outcome, 'memory outcome')
  return createBehaviorTransaction({
    ...input,
    commandType: 'record-outcome',
    eventType: 'outcome-recorded',
    payload: { outcome: input.outcome },
    occurredAt: input.outcome.occurredAt,
  })
}

export type MemoryFeedbackTransactionInput = BehaviorTransactionIdentity & Readonly<{
  actor: RuntimeActor | BackgroundActor
  feedback: MemoryFeedbackVector
}>

export function createMemoryFeedbackTransaction(input: MemoryFeedbackTransactionInput): MemoryTransaction {
  assertMemoryFeedbackVector(input.feedback, 'memory feedback')
  return createBehaviorTransaction({
    ...input,
    commandType: 'record-feedback',
    eventType: 'feedback-recorded',
    payload: { feedback: input.feedback },
    occurredAt: input.feedback.occurredAt,
  })
}
export type MemoryBehaviorTransactionInput = BehaviorTransactionIdentity & Readonly<{
  actor: RuntimeActor
  prediction?: MemoryPredictionRecord
  action?: MemoryActionRecord
  outcome?: MemoryOutcomeRecord
  feedback?: MemoryFeedbackVector
}>

/** Forms one atomic runtime behavior batch in the cognition journal. */
export function createMemoryBehaviorTransaction(input: MemoryBehaviorTransactionInput): MemoryTransaction {
  const payload: MemoryBehaviorBatch = {
    ...(input.prediction === undefined ? {} : { prediction: input.prediction }),
    ...(input.action === undefined ? {} : { action: input.action }),
    ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
    ...(input.feedback === undefined ? {} : { feedback: input.feedback }),
  }
  assertMemoryBehaviorBatchPayload(payload as unknown as Record<string, unknown>, 'behavior batch')
  const events: MemoryEvent[] = []
  const add = (type: MemoryEventType, suffix: string, occurredAt: string, eventPayload: Record<string, unknown>): void => {
    events.push({
      kind: 'memory-event',
      protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
      type,
      eventId: createMemoryEventId(String(input.eventId) + '-' + suffix),
      transactionId: input.transactionId,
      commandId: input.commandId,
      position: events.length,
      actor: input.actor,
      occurredAt,
      payload: eventPayload,
    } as MemoryEvent)
  }
  if (input.prediction !== undefined) add('prediction-recorded', 'prediction', input.prediction.createdAt, { prediction: input.prediction })
  if (input.action !== undefined) add('action-recorded', 'action', input.action.occurredAt, { action: input.action })
  if (input.outcome !== undefined) add('outcome-recorded', 'outcome', input.outcome.occurredAt, { outcome: input.outcome })
  if (input.feedback !== undefined) add('feedback-recorded', 'feedback', input.feedback.occurredAt, { feedback: input.feedback })
  const command: MemoryCommand = {
    kind: 'memory-command',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'record-behavior',
    commandId: input.commandId,
    correlationId: input.correlationId,
    actor: input.actor,
    issuedAt: input.issuedAt,
    payload,
  }
  return createMemoryTransaction({
    transactionId: input.transactionId,
    commandId: input.commandId,
    correlationId: input.correlationId,
    actor: input.actor,
    openedAt: input.issuedAt,
    committedAt: input.committedAt,
    command,
    events,
  })
}


export type MemoryDispositionLearningTransactionInput = BehaviorTransactionIdentity & Readonly<{
  actor: BackgroundActor
  result: MemoryDispositionLearningResult
}>

export function createMemoryDispositionLearningTransaction(input: MemoryDispositionLearningTransactionInput): MemoryTransaction {
  assertMemoryDispositionLearningResult(input.result, 'memory disposition learning')
  return createBehaviorTransaction({
    ...input,
    commandType: 'learn-disposition',
    eventType: 'disposition-learned',
    payload: { result: input.result },
    occurredAt: input.result.memory.updatedAt,
  })
}
function assertMemoryBehaviorBatchPayload(
  payload: Record<string, unknown>,
  label: string,
): asserts payload is MemoryBehaviorBatch {
  const prediction = payload.prediction
  const action = payload.action
  const outcome = payload.outcome
  const feedback = payload.feedback
  if (prediction === undefined && action === undefined && outcome === undefined && feedback === undefined) {
    throw new MemoryProtocolError(label + ' must contain at least one behavior record')
  }
  if (prediction !== undefined) assertMemoryPredictionRecord(prediction, label + '.prediction')
  if (action !== undefined) assertMemoryActionRecord(action, label + '.action')
  if (outcome !== undefined) assertMemoryOutcomeRecord(outcome, label + '.outcome')
  if (feedback !== undefined) assertMemoryFeedbackVector(feedback, label + '.feedback')
  if (prediction !== undefined && action !== undefined && !action.predictionIds.some(id => String(id) === String(prediction.id))) {
    throw new MemoryProtocolError(label + ' action does not include its batched prediction')
  }
  if (action !== undefined && outcome !== undefined && outcome.actionId !== action.id) {
    throw new MemoryProtocolError(label + ' outcome does not belong to its batched action')
  }
  if (prediction !== undefined && outcome?.predictionId !== undefined && outcome.predictionId !== prediction.id) {
    throw new MemoryProtocolError(label + ' outcome does not reference its batched prediction')
  }
  if (action !== undefined && feedback?.actionId !== undefined && feedback.actionId !== action.id) {
    throw new MemoryProtocolError(label + ' feedback does not reference its batched action')
  }
  if (prediction !== undefined && feedback?.predictionId !== undefined && feedback.predictionId !== prediction.id) {
    throw new MemoryProtocolError(label + ' feedback does not reference its batched prediction')
  }
  if (outcome !== undefined && feedback?.outcomeId !== undefined && feedback.outcomeId !== outcome.id) {
    throw new MemoryProtocolError(label + ' feedback does not reference its batched outcome')
  }
}

function assertBehaviorBatchTransactionBinding(
  command: BehaviorBatchCommand,
  events: readonly MemoryEvent[],
): void {
  assertMemoryBehaviorBatchPayload(command.payload as unknown as Record<string, unknown>, 'behavior batch')
  const expected: Array<{ type: MemoryEventType; key: keyof MemoryBehaviorBatch; value: unknown }> = []
  if (command.payload.prediction !== undefined) expected.push({ type: 'prediction-recorded', key: 'prediction', value: command.payload.prediction })
  if (command.payload.action !== undefined) expected.push({ type: 'action-recorded', key: 'action', value: command.payload.action })
  if (command.payload.outcome !== undefined) expected.push({ type: 'outcome-recorded', key: 'outcome', value: command.payload.outcome })
  if (command.payload.feedback !== undefined) expected.push({ type: 'feedback-recorded', key: 'feedback', value: command.payload.feedback })
  if (events.length !== expected.length) throw new MemoryProtocolError('behavior batch event count does not match its payload')
  for (const [index, item] of expected.entries()) {
    const event = events[index]
    if (event === undefined || event.type !== item.type) throw new MemoryProtocolError('behavior batch event order does not match its payload')
    const eventValue = item.key === 'prediction'
      ? event.type === 'prediction-recorded' ? event.payload.prediction : undefined
      : item.key === 'action'
        ? event.type === 'action-recorded' ? event.payload.action : undefined
        : item.key === 'outcome'
          ? event.type === 'outcome-recorded' ? event.payload.outcome : undefined
          : event.type === 'feedback-recorded' ? event.payload.feedback : undefined
    if (!isDeepStrictEqual(eventValue, item.value)) throw new MemoryProtocolError('behavior batch event payload does not match its command')
  }
}
