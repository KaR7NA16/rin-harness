/**
 * Rin's runtime event mapper.
 *
 * Dsh session events are the occurrence timeline. This module gives each
 * meaningful occurrence a Rin-native cognitive meaning and emits one observed
 * scene representation. Unsupported session mechanics remain mechanics.
 *
 * @module @rin/memory
 */

import { MEMORY_COGNITION_PROTOCOL_VERSION } from '@rin/contracts'
import {
  createMemoryCommandId,
  createMemoryCorrelationId,
  createMemoryEventId,
  createMemoryTransactionId,
  createMemoryTransaction,
  createRuntimeActor,
  type MemoryCommand,
  type MemoryEvent,
  type MemoryTransaction,
  type OpenLoopChange,
  type SceneChange,
} from './events.ts'
import {
  createGoalId,
  createPredictionId,
  createMemory,
  createMemoryId,
  createActionId,
  createOutcomeId,
  createFeedbackId,
  createWorkspaceCycleId,
  createParticipantId,
  memoryVersion,
  type MemoryId,
  type GoalId,
  type ParticipantId,
  type MemoryActionRecord,
  type CurrentFieldActionSource,
  type MemoryPredictionRecord,
  type MemoryOutcomeRecord,
  type MemoryBoundaryRespect,
  type MemoryFeedbackKind,
  type MemoryFeedbackVector,
  type MemoryUserResponse,
  type RuntimeEventKind,
  type SceneLifecycle,
  type RuntimeEventRef,
  type RinMemory,
} from './model.ts'

/** Structural dsh session event consumed by the memory domain. */
export type RuntimeSessionEvent = Readonly<{
  type: string
  seq: number
  time: number
  data: unknown
}>

export type RuntimePredictionHint = Readonly<{
  statement: string
  expectedOutcome: string
  targetTime?: string
}>

export type RuntimeFeedbackHint = Readonly<{
  kind: MemoryFeedbackKind
  actionId?: string
  predictionId?: string
  outcomeId?: string
  dispositionId?: string
  correlationKey?: string
  taskOutcome?: number
  actionCost?: number
  factualCorrection?: string
  predictionAccuracy?: number
  userResponse?: MemoryUserResponse
  relationshipConsequence?: number
  boundaryRespect?: MemoryBoundaryRespect
  autonomyEffect?: number
  safetyEffect?: number
  delayedConsequence?: string
  explanation?: string
}>

/**
 * Exact output-to-workspace binding for a relationship-aware expression.
 *
 * The producer must carry the recall cycle and workspace hash that actually
 * shaped the output. Memory ids alone are insufficient because one session
 * can contain several workspaces with different versions.
 */
export type RuntimeRelationshipExpression = Readonly<{
  cycleId: string
  workspaceHash: string
  memoryIds: readonly MemoryId[]
}>

/** A meaningful occurrence formed from one session event. */
export type RuntimeMemoryFact = Readonly<{
  sessionId: string
  eventSeq: number
  eventType: string
  occurredAt: string
  kind: RuntimeEventKind
  /** Explicit output annotation for memories that shaped relationship expression. */
  relationshipExpression?: RuntimeRelationshipExpression
  feedback?: RuntimeFeedbackHint
  content: string
  outcomeStatus?: 'observed' | 'failed'
  predictionId?: string
  prediction?: RuntimePredictionHint
  correlationKey?: string
}>

export type RuntimeSceneBoundary = 'continue' | 'open' | 'close'

/**
 * Stable identities may be supplied by an embedding application. Runtime
 * session/scene identities remain the default so the memory domain never
 * invents cross-session identity.
 */
export type RuntimeParticipantHint = Readonly<{
  user: ParticipantId
  rin: ParticipantId
}>

export type RuntimeSceneHint = Readonly<{
  continuityKey?: string
  boundary?: RuntimeSceneBoundary
  participants?: RuntimeParticipantHint
  goals?: readonly GoalId[]
}>

type RuntimeSceneContext = Readonly<Pick<RuntimeSceneHint, 'participants' | 'goals'>>

/** Context from the latest persisted workspace used to bind runtime behavior. */
export type RuntimeBehaviorContext = Readonly<{
  cycleId: string
  workspaceHash: string
  sceneId?: MemoryId
  workspaceMemoryIds?: readonly MemoryId[]
  candidateActionSources?: readonly CurrentFieldActionSource[]
  goals?: readonly GoalId[]
  actions: readonly MemoryActionRecord[]
  outcomes?: readonly MemoryOutcomeRecord[]
  predictions?: readonly MemoryPredictionRecord[]
}>

export type RuntimeBehaviorMutation = Readonly<{
  prediction?: MemoryPredictionRecord
  action?: MemoryActionRecord
  outcome?: MemoryOutcomeRecord
  feedback?: MemoryFeedbackVector
}>

function runtimeBehaviorParticipant(sessionId: string): ReturnType<typeof createParticipantId> {
  return createParticipantId('session-' + runtimeToken(sessionId) + '-rin')
}
function normalizedRuntimeActionText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim()
}

export function selectCandidateActionSources(
  content: string,
  sources: readonly CurrentFieldActionSource[] | undefined,
): readonly CurrentFieldActionSource[] {
  if (sources === undefined || sources.length === 0) return []
  const normalizedContent = normalizedRuntimeActionText(content)
  const matches = sources.filter(source => {
    const action = normalizedRuntimeActionText(source.action)
    return action !== '' && normalizedContent.includes(action)
  })
  if (matches.length === 0) return []
  const selected = matches
    .slice()
    .sort((left, right) =>
      right.selectionValue - left.selectionValue
      || normalizedRuntimeActionText(right.action).length - normalizedRuntimeActionText(left.action).length
      || left.action.localeCompare(right.action),
    )[0]
  if (selected === undefined) return []
  return matches.filter(source => source.action === selected.action)
}

/**
 * Converts accepted assistant/tool occurrences into the same action/outcome
 * records that explicit model integrations use. Missing workspace or action
 * linkage returns an empty mutation instead of inventing a behavior record.
 */
export function mapRuntimeBehaviorFact(
  fact: RuntimeMemoryFact,
  context: RuntimeBehaviorContext,
): RuntimeBehaviorMutation {
  requiredText(context.cycleId, 'runtime behavior cycle id')
  requiredText(context.workspaceHash, 'runtime behavior workspace hash')
  const workspaceSourceMemoryIds = [...new Set([
    ...(context.sceneId === undefined ? [] : [context.sceneId]),
    ...(context.workspaceMemoryIds ?? []),
  ])]
  const candidateActionSources = fact.kind === 'action'
    ? selectCandidateActionSources(fact.content, context.candidateActionSources)
    : []
  const sourceMemoryIds = candidateActionSources.length === 0
    ? workspaceSourceMemoryIds
    : [...new Set([
        ...(context.sceneId === undefined ? [] : [context.sceneId]),
        ...candidateActionSources.flatMap(source => source.sourceMemoryIds),
      ])]
  const outcomes = context.outcomes ?? []
  if (fact.feedback !== undefined) {
    const feedback = fact.feedback
    const correlationKey = feedback.correlationKey ?? fact.correlationKey
    const matchingActions = feedback.actionId !== undefined
      ? context.actions.filter(action => String(action.id) === feedback.actionId)
      : correlationKey !== undefined
        ? context.actions.filter(action => action.correlationKey === correlationKey)
        : feedback.outcomeId !== undefined
          ? (() => {
              const outcome = outcomes.find(item => String(item.id) === feedback.outcomeId)
              return outcome === undefined
                ? []
                : context.actions.filter(action => String(action.id) === String(outcome.actionId))
            })()
          : feedback.dispositionId === undefined
            ? []
            : context.actions.filter(action => action.sourceMemoryIds.some(id =>
              String(id) === String(feedback.dispositionId),
            ))
    const matchingAction = matchingActions.length === 1 ? matchingActions[0] : undefined
    if (matchingAction === undefined) return {}
    const matchingOutcomes = outcomes.filter(outcome => outcome.actionId === matchingAction.id)
    const matchingOutcome = feedback.outcomeId === undefined
      ? (matchingOutcomes.length === 1 ? matchingOutcomes[0] : undefined)
      : matchingOutcomes.find(outcome =>
        String(outcome.id) === feedback.outcomeId && outcome.actionId === matchingAction.id,
      )
    if (feedback.outcomeId !== undefined && matchingOutcome === undefined) return {}
    const expectedPredictionId = feedback.predictionId
      ?? matchingOutcome?.predictionId
      ?? (matchingAction.predictionIds.length === 1 ? matchingAction.predictionIds[0] : undefined)
    const matchingPrediction = expectedPredictionId === undefined
      ? undefined
      : context.predictions?.find(prediction => String(prediction.id) === String(expectedPredictionId))
    if (feedback.predictionId !== undefined && matchingPrediction === undefined) return {}
    if (
      matchingOutcome?.predictionId !== undefined
      && matchingPrediction !== undefined
      && String(matchingPrediction.id) !== String(matchingOutcome.predictionId)
    ) return {}
    return {
      feedback: {
        id: createFeedbackId('runtime-feedback-' + runtimeToken(fact.sessionId) + '-' + fact.eventSeq),
        cycleId: matchingAction.cycleId,
        sessionId: fact.sessionId,
        kind: feedback.kind,
        actionId: matchingAction.id,
        ...(matchingPrediction === undefined ? {} : { predictionId: matchingPrediction.id }),
        ...(matchingOutcome === undefined ? {} : { outcomeId: matchingOutcome.id }),
        ...(context.sceneId === undefined ? {} : { sceneId: context.sceneId }),
        ...(feedback.dispositionId === undefined ? {} : { dispositionId: createMemoryId(feedback.dispositionId) }),
        taskOutcome: feedback.taskOutcome ?? 0,
        actionCost: feedback.actionCost ?? 0,
        ...(feedback.factualCorrection === undefined ? {} : { factualCorrection: feedback.factualCorrection }),
        ...(feedback.predictionAccuracy === undefined ? {} : { predictionAccuracy: feedback.predictionAccuracy }),
        ...(feedback.userResponse === undefined ? {} : { userResponse: feedback.userResponse }),
        ...(feedback.relationshipConsequence === undefined ? {} : { relationshipConsequence: feedback.relationshipConsequence }),
        ...(feedback.boundaryRespect === undefined ? {} : { boundaryRespect: feedback.boundaryRespect }),
        ...(feedback.autonomyEffect === undefined ? {} : { autonomyEffect: feedback.autonomyEffect }),
        ...(feedback.safetyEffect === undefined ? {} : { safetyEffect: feedback.safetyEffect }),
        ...(feedback.delayedConsequence === undefined ? {} : { delayedConsequence: feedback.delayedConsequence }),
        explanation: feedback.explanation ?? fact.content,
        occurredAt: fact.occurredAt,
        delayed: matchingAction.sessionId !== fact.sessionId || matchingAction.cycleId !== context.cycleId,
      },
    }
  }
  if (fact.kind === 'action') {
    if (fact.eventType !== 'assistant/message' && fact.eventType !== 'tool/call') return {}
    const prediction = fact.prediction === undefined ? undefined : {
      id: createPredictionId('runtime-prediction-' + runtimeToken(fact.sessionId) + '-' + fact.eventSeq),
      cycleId: createWorkspaceCycleId(context.cycleId),
      statement: fact.prediction.statement,
      sourceMemoryIds,
      expectedOutcome: fact.prediction.expectedOutcome,
      epistemic: 'hypothesized' as const,
      ...(fact.prediction.targetTime === undefined ? {} : { targetTime: fact.prediction.targetTime }),
      createdAt: fact.occurredAt,
    }
    return {
      ...(prediction === undefined ? {} : { prediction }),
      action: {
        id: createActionId('runtime-action-' + runtimeToken(fact.sessionId) + '-' + fact.eventSeq),
        cycleId: createWorkspaceCycleId(context.cycleId),
        sessionId: fact.sessionId,
        ...(fact.correlationKey === undefined ? {} : { correlationKey: fact.correlationKey }),
        workspaceHash: context.workspaceHash,
        actor: runtimeBehaviorParticipant(fact.sessionId),
        description: fact.content,
        goalIds: context.goals === undefined ? [] : [...context.goals],
        sourceMemoryIds,
        predictionIds: prediction === undefined ? [] : [prediction.id],
        occurredAt: fact.occurredAt,
      },
    }
  }
  if (fact.kind !== 'outcome' || (fact.eventType !== 'tool/result' && fact.eventType !== 'turn/end')) return {}
  const matchingActions = context.actions.filter(action => fact.correlationKey === undefined
    ? action.cycleId === context.cycleId
    : action.correlationKey === fact.correlationKey)
  const matching = matchingActions.length === 1 ? matchingActions[0] : undefined
  if (matching === undefined) return {}
  const predictionId = fact.predictionId === undefined
    ? (matching.predictionIds.length === 1 ? matching.predictionIds[0] : undefined)
    : matching.predictionIds.find(id => String(id) === fact.predictionId)
  if (fact.predictionId !== undefined && predictionId === undefined) return {}
  return {
    outcome: {
      id: createOutcomeId('runtime-outcome-' + runtimeToken(fact.sessionId) + '-' + fact.eventSeq),
      cycleId: matching.cycleId,
      sessionId: fact.sessionId,
      ...(fact.correlationKey === undefined ? {} : { correlationKey: fact.correlationKey }),
      actionId: matching.id,
      ...(predictionId === undefined ? {} : { predictionId }),
      status: fact.outcomeStatus === 'failed' ? 'failed' : 'observed',
      description: fact.content,
      occurredAt: fact.occurredAt,
      delayed: matching.sessionId !== fact.sessionId || matching.cycleId !== context.cycleId,
    },
  }
}


/** A malformed runtime event cannot be silently turned into cognition. */
export class RuntimeCognitionError extends Error {
  constructor(message: string) {
    super('rin memory runtime: ' + message)
    this.name = 'RuntimeCognitionError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RuntimeCognitionError(label + ' must be non-empty text')
  }
  return value.trim()
}

function optionalCorrelationKey(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined
  return requiredText(value, label)
}

/**
 * DSH stores the tool-call correlation on result message content blocks.
 * Multiple distinct blocks are deliberately left unbound because choosing one
 * would turn an ambiguous result into a false outcome relation.
 */
function toolResultCorrelationKey(value: unknown): string | undefined {
  if (!isRecord(value) || !Array.isArray(value.content)) return undefined
  const ids = value.content.flatMap((item, index) => {
    if (!isRecord(item) || item.toolCallId === undefined) return []
    return [requiredText(item.toolCallId, 'tool/result message.content[' + index + '].toolCallId')]
  })
  const unique = [...new Set(ids)]
  return unique.length === 1 ? unique[0] : undefined
}

function optionalPredictionId(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined
  return requiredText(value, label)
}

function optionalMemoryIdList(value: unknown, label: string): readonly MemoryId[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new RuntimeCognitionError(label + ' must be an array')
  const ids = value.map((item, index) => createMemoryId(requiredText(item, label + '[' + index + ']')))
  if (new Set(ids.map(String)).size !== ids.length) {
    throw new RuntimeCognitionError(label + ' must not contain duplicates')
  }
  return ids
}

function optionalRelationshipExpression(value: unknown, label: string): RuntimeRelationshipExpression | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new RuntimeCognitionError(label + ' must be an object')
  const cycleId = requiredText(value.cycleId, label + '.cycleId')
  const workspaceHash = requiredText(value.workspaceHash, label + '.workspaceHash')
  const memoryIds = optionalMemoryIdList(value.memoryIds, label + '.memoryIds')
  if (memoryIds === undefined || memoryIds.length === 0) {
    throw new RuntimeCognitionError(label + '.memoryIds must contain at least one memory id')
  }
  return { cycleId, workspaceHash, memoryIds }
}

function optionalPredictionHint(value: unknown, label: string): RuntimePredictionHint | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new RuntimeCognitionError(label + ' must be an object')
  const statement = requiredText(value.statement, label + '.statement')
  const expectedOutcome = requiredText(value.expectedOutcome, label + '.expectedOutcome')
  if (value.targetTime !== undefined) {
    if (typeof value.targetTime !== 'string' || !Number.isFinite(Date.parse(value.targetTime))) {
      throw new RuntimeCognitionError(label + '.targetTime must be a valid timestamp')
    }
  }
  return {
    statement,
    expectedOutcome,
    ...(value.targetTime === undefined ? {} : { targetTime: value.targetTime }),
  }
}

function optionalFeedbackHint(value: unknown, label: string): RuntimeFeedbackHint | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new RuntimeCognitionError(label + ' must be an object')
  const kind = value.kind
  if (!['accept', 'correct', 'reject', 'ignore', 'boundary'].includes(String(kind))) {
    throw new RuntimeCognitionError(label + '.kind is invalid')
  }
  const taskOutcome = value.taskOutcome === undefined ? 0 : value.taskOutcome
  const actionCost = value.actionCost === undefined ? 0 : value.actionCost
  if (typeof taskOutcome !== 'number' || !Number.isFinite(taskOutcome) || taskOutcome < -1 || taskOutcome > 1) {
    throw new RuntimeCognitionError(label + '.taskOutcome must be between -1 and 1')
  }
  if (typeof actionCost !== 'number' || !Number.isFinite(actionCost) || actionCost < 0 || actionCost > 1) {
    throw new RuntimeCognitionError(label + '.actionCost must be between 0 and 1')
  }
  const optionalRange = (entry: unknown, entryLabel: string, min: number, max: number): number | undefined => {
    if (entry === undefined) return undefined
    if (typeof entry !== 'number' || !Number.isFinite(entry) || entry < min || entry > max) {
      throw new RuntimeCognitionError(entryLabel + ' must be between ' + min + ' and ' + max)
    }
    return entry
  }
  const predictionAccuracy = optionalRange(value.predictionAccuracy, label + '.predictionAccuracy', -1, 1)
  const relationshipConsequence = optionalRange(value.relationshipConsequence, label + '.relationshipConsequence', -1, 1)
  const autonomyEffect = optionalRange(value.autonomyEffect, label + '.autonomyEffect', -1, 1)
  const safetyEffect = optionalRange(value.safetyEffect, label + '.safetyEffect', -1, 1)
  if (value.userResponse !== undefined && !['accepted', 'corrected', 'rejected', 'ignored', 'unclear'].includes(String(value.userResponse))) {
    throw new RuntimeCognitionError(label + '.userResponse is invalid')
  }
  if (value.boundaryRespect !== undefined && !['respected', 'crossed', 'changed', 'unclear'].includes(String(value.boundaryRespect))) {
    throw new RuntimeCognitionError(label + '.boundaryRespect is invalid')
  }
  const optionalText = (entry: unknown, entryLabel: string): string | undefined =>
    entry === undefined ? undefined : requiredText(entry, entryLabel)
  const factualCorrection = optionalText(value.factualCorrection, label + '.factualCorrection')
  const delayedConsequence = optionalText(value.delayedConsequence, label + '.delayedConsequence')
  const explanation = optionalText(value.explanation, label + '.explanation')
  return {
    kind: kind as MemoryFeedbackKind,
    ...(value.actionId === undefined ? {} : { actionId: requiredText(value.actionId, label + '.actionId') }),
    ...(value.predictionId === undefined ? {} : { predictionId: requiredText(value.predictionId, label + '.predictionId') }),
    ...(value.outcomeId === undefined ? {} : { outcomeId: requiredText(value.outcomeId, label + '.outcomeId') }),
    ...(value.dispositionId === undefined ? {} : { dispositionId: requiredText(value.dispositionId, label + '.dispositionId') }),
    ...(value.correlationKey === undefined ? {} : { correlationKey: requiredText(value.correlationKey, label + '.correlationKey') }),
    taskOutcome,
    actionCost,
    ...(factualCorrection === undefined ? {} : { factualCorrection }),
    ...(predictionAccuracy === undefined ? {} : { predictionAccuracy }),
    ...(value.userResponse === undefined ? {} : { userResponse: value.userResponse as MemoryUserResponse }),
    ...(relationshipConsequence === undefined ? {} : { relationshipConsequence }),
    ...(value.boundaryRespect === undefined ? {} : { boundaryRespect: value.boundaryRespect as MemoryBoundaryRespect }),
    ...(autonomyEffect === undefined ? {} : { autonomyEffect }),
    ...(safetyEffect === undefined ? {} : { safetyEffect }),
    ...(delayedConsequence === undefined ? {} : { delayedConsequence }),
    ...(explanation === undefined ? {} : { explanation }),
  }
}

function assertSessionEventShape(sessionId: string, event: RuntimeSessionEvent): void {
  requiredText(sessionId, 'session id')
  requiredText(event.type, 'session event type')
  if (!Number.isSafeInteger(event.seq) || event.seq < 0) {
    throw new RuntimeCognitionError('session event sequence must be a non-negative safe integer')
  }
  if (!Number.isSafeInteger(event.time) || event.time < 0 || Number.isNaN(new Date(event.time).getTime())) {
    throw new RuntimeCognitionError('session event time must be a non-negative epoch millisecond')
  }
}

function contentBlockText(value: unknown): string[] {
  if (!isRecord(value)) return []
  if (typeof value.content === 'string') return [value.content]
  if (Array.isArray(value.content)) return value.content.flatMap(contentBlockText)
  switch (value.type) {
    case 'text':
      return typeof value.text === 'string' ? [value.text] : []
    case 'tool-call':
      return [value.name, value.arguments].filter(
        (part): part is string => typeof part === 'string',
      )
    case 'tool-result':
      return Array.isArray(value.content) ? value.content.flatMap(contentBlockText) : []
    default:
      return []
  }
}

function contentText(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value
    .flatMap(contentBlockText)
    .map(part => part.trim())
    .filter(Boolean)
    .join('\n')
}

function messageText(value: unknown, label: string): string {
  if (!isRecord(value)) throw new RuntimeCognitionError(label + ' must be an object')
  const content = contentText(value.content)
  if (content === '') throw new RuntimeCognitionError(label + ' has no textual content')
  return content
}

function turnEndFactContent(data: unknown): { content: string; status: 'observed' | 'failed' } {
  if (!isRecord(data) || !isRecord(data.reason)) {
    throw new RuntimeCognitionError('turn/end requires a reason')
  }
  const kind = requiredText(data.reason.kind, 'turn end reason kind')
  const error = isRecord(data.reason.error) ? data.reason.error : undefined
  const reason = isRecord(data.reason.reason) ? data.reason.reason : undefined
  const detail = typeof error?.message === 'string'
    ? ': ' + error.message.trim()
    : typeof reason?.kind === 'string' ? ': ' + reason.kind : ''
  return {
    content: 'turn ended ' + kind + detail,
    status: kind === 'completed' ? 'observed' : 'failed',
  }
}

/**
 * Maps one dsh event to an occurrence fact.
 *
 * Lifecycle, chunk, header, and todo events remain session mechanics. They do
 * not independently alter Rin's cognitive state and are intentionally ignored.
 */
export function mapRuntimeSessionEvent(
  sessionId: string,
  event: RuntimeSessionEvent,
): RuntimeMemoryFact | null {
  assertSessionEventShape(sessionId, event)
  const occurredAt = new Date(event.time).toISOString()
  switch (event.type) {
    case 'user/message': {
      if (!isRecord(event.data) || !isRecord(event.data.source) || event.data.source.kind !== 'user') {
        return null
      }
      const feedback = optionalFeedbackHint(event.data.feedback, 'user/message feedback')
      return {
        sessionId,
        eventSeq: event.seq,
        eventType: event.type,
        occurredAt,
        kind: 'observation',
        content: messageText(event.data, 'user/message'),
        ...(feedback === undefined ? {} : { feedback }),
      }
    }
    case 'assistant/message': {
      const message = isRecord(event.data) ? event.data.message : undefined
      const prediction = isRecord(event.data)
        ? optionalPredictionHint(event.data.prediction, 'assistant/message prediction')
        : undefined
      const relationshipExpression = isRecord(event.data)
        ? optionalRelationshipExpression(
          event.data.relationshipExpression,
          'assistant/message relationshipExpression',
        )
        : undefined
      return {
        sessionId,
        ...(prediction === undefined ? {} : { prediction }),
        ...(relationshipExpression === undefined ? {} : { relationshipExpression }),
        eventSeq: event.seq,
        eventType: event.type,
        occurredAt,
        kind: 'action',
        content: messageText(message, 'assistant/message'),
      }
    }
    case 'tool/call': {
      if (!isRecord(event.data)) throw new RuntimeCognitionError('tool/call requires an object payload')
      const name = requiredText(event.data.name, 'tool/call name')
      const args = typeof event.data.arguments === 'string' ? event.data.arguments.trim() : ''
      const correlationKey = optionalCorrelationKey(event.data.callId, 'tool/call callId')
      const prediction = optionalPredictionHint(event.data.prediction, 'tool/call prediction')
      return {
        sessionId,
        eventSeq: event.seq,
        eventType: event.type,
        ...(prediction === undefined ? {} : { prediction }),
        occurredAt,
        kind: 'action',
        content: args === '' ? 'tool call: ' + name : 'tool call: ' + name + '\n' + args,
        ...(correlationKey === undefined ? {} : { correlationKey }),
      }
    }
    case 'tool/result': {
      if (!isRecord(event.data)) throw new RuntimeCognitionError('tool/result requires an object payload')
      const message = messageText(event.data.message, 'tool/result message')
      const explicitCorrelationKey = optionalCorrelationKey(event.data.callId, 'tool/result callId')
      const correlationKey = explicitCorrelationKey ?? toolResultCorrelationKey(event.data.message)
      const predictionId = optionalPredictionId(event.data.predictionId, 'tool/result predictionId')
      return {
        sessionId,
        eventSeq: event.seq,
        eventType: event.type,
        occurredAt,
        kind: 'outcome',
        content: message,
        outcomeStatus: event.data.error === undefined ? 'observed' : 'failed',
        ...(correlationKey === undefined ? {} : { correlationKey }),
        ...(predictionId === undefined ? {} : { predictionId }),
      }
    }
    case 'turn/end': {
      const result = turnEndFactContent(event.data)
      const predictionId = isRecord(event.data)
        ? optionalPredictionId(event.data.predictionId, 'turn/end predictionId')
        : undefined
      return {
        sessionId,
        eventSeq: event.seq,
        eventType: event.type,
        occurredAt,
        kind: 'outcome',
        content: result.content,
        outcomeStatus: result.status,
        ...(predictionId === undefined ? {} : { predictionId }),
      }
    }
    default:
      return null
  }
}

function runtimeToken(value: string): string {
  return encodeURIComponent(requiredText(value, 'runtime identity'))
}

function buildRuntimeMemory(fact: RuntimeMemoryFact): RinMemory {
  const sessionKey = runtimeToken(fact.sessionId)
  const user = createParticipantId('session-' + sessionKey + '-user')
  const rin = createParticipantId('session-' + sessionKey + '-rin')
  const eventRef = runtimeEventRef(fact)
  const actions = fact.kind === 'action'
    ? [{ actor: rin, description: fact.content }]
    : []
  const outcomes = fact.kind === 'outcome'
    ? [{ description: fact.content, status: fact.outcomeStatus ?? 'observed' }]
    : []
  return createMemory({
    id: createMemoryId('runtime-' + sessionKey + '-' + fact.eventSeq),
    form: 'scene',
    data: {
      participants: [user, rin],
      environment: 'dsh-session-' + sessionKey,
      goals: [],
      observations: fact.kind === 'observation' ? [fact.content] : [],
      interpretations: [],
      actions,
      outcomes,
      predictionErrors: [],
      affect: { valence: 0, arousal: 0, control: 0.5 },
      runtimeEventRefs: [eventRef],
    },
    state: {
      persistence: 'transient',
      activation: 'active',
      integration: 'raw',
      epistemic: 'observed',
      influence: 'blocked',
    },
    dynamics: {
      activation: 0.4,
      accessibility: 0.2,
      salience: fact.kind === 'observation' ? 0.6 : 0.4,
      stability: 0.1,
      confidence: 1,
      integrationStrength: 0,
      novelty: 0.5,
      surprise: 0,
      affect: { valence: 0, arousal: 0, control: 0.5 },
      validity: { startsAt: fact.occurredAt },
      utilityByGoal: [],
      inhibition: 0,
      influenceSurfaces: [],
    },
    createdAt: fact.occurredAt,
    updatedAt: fact.occurredAt,
  })
}

function runtimeEventRef(fact: RuntimeMemoryFact): RuntimeEventRef {
  return {
    source: 'dsh-session',
    sessionId: fact.sessionId,
    eventSeq: fact.eventSeq,
    eventType: fact.eventType,
    kind: fact.kind,
    ...(fact.correlationKey === undefined ? {} : { correlationKey: fact.correlationKey }),
  }
}

function buildRuntimeSceneMemory(
  fact: RuntimeMemoryFact,
  continuityKey: string,
  status: 'open' | 'closed' = 'open',
  context: RuntimeSceneContext = {},
): RinMemory {
  const sceneKey = runtimeToken(continuityKey)
  const user = context.participants?.user ?? createParticipantId('scene-' + sceneKey + '-user')
  const rin = context.participants?.rin ?? createParticipantId('scene-' + sceneKey + '-rin')
  const lifecycle: SceneLifecycle = status === 'closed'
    ? {
        continuityKey,
        status,
        startedAt: fact.occurredAt,
        endedAt: fact.occurredAt,
      }
    : {
        continuityKey,
        status,
        startedAt: fact.occurredAt,
      }
  return createMemory({
    id: createMemoryId('runtime-scene-' + sceneKey),
    form: 'scene',
    data: {
      participants: [user, rin],
      environment: 'rin-scene-' + sceneKey,
      goals: [...(context.goals ?? [])],
      observations: fact.kind === 'observation' ? [fact.content] : [],
      interpretations: [],
      actions: fact.kind === 'action' ? [{ actor: rin, description: fact.content }] : [],
      outcomes: fact.kind === 'outcome'
        ? [{ description: fact.content, status: fact.outcomeStatus ?? 'observed' }]
        : [],
      predictionErrors: [],
      affect: { valence: 0, arousal: 0, control: 0.5 },
      lifecycle,
      runtimeEventRefs: [runtimeEventRef(fact)],
    },
    state: {
      persistence: 'transient',
      activation: 'active',
      integration: 'raw',
      epistemic: 'observed',
      influence: 'blocked',
    },
    dynamics: {
      activation: 0.4,
      accessibility: 0.2,
      salience: fact.kind === 'observation' ? 0.6 : 0.4,
      stability: 0.1,
      confidence: 1,
      integrationStrength: 0,
      novelty: 0.5,
      surprise: 0,
      affect: { valence: 0, arousal: 0, control: 0.5 },
      validity: { startsAt: fact.occurredAt },
      utilityByGoal: [],
      inhibition: 0,
      influenceSurfaces: [],
    },
    createdAt: fact.occurredAt,
    updatedAt: fact.occurredAt,
  })
}

function buildRuntimeOpenLoop(fact: RuntimeMemoryFact, sceneId: MemoryId): RinMemory {
  if (fact.correlationKey === undefined) {
    throw new RuntimeCognitionError('runtime open-loop requires a correlation key')
  }
  const sessionKey = runtimeToken(fact.sessionId)
  const correlationKey = runtimeToken(fact.correlationKey)
  return createMemory({
    id: createMemoryId('runtime-open-loop-' + sessionKey + '-' + correlationKey),
    form: 'open-loop',
    data: {
      goal: createGoalId('runtime-goal-' + sessionKey + '-' + correlationKey),
      description: 'pending tool call: ' + fact.content,
      relatedMemoryIds: [sceneId],
      status: 'open',
      origin: runtimeEventRef(fact),
    },
    state: {
      persistence: 'transient',
      activation: 'active',
      integration: 'raw',
      epistemic: 'observed',
      influence: 'blocked',
    },
    dynamics: {
      activation: 0.4,
      accessibility: 0.2,
      salience: 0.4,
      stability: 0.1,
      confidence: 1,
      integrationStrength: 0,
      novelty: 0.5,
      surprise: 0,
      affect: { valence: 0, arousal: 0, control: 0.5 },
      validity: { startsAt: fact.occurredAt },
      utilityByGoal: [],
      inhibition: 0,
      influenceSurfaces: [],
    },
    createdAt: fact.occurredAt,
    updatedAt: fact.occurredAt,
  })
}

function resolveRuntimeOpenLoop(previous: RinMemory, fact: RuntimeMemoryFact): RinMemory {
  if (previous.form !== 'open-loop' || previous.data.status !== 'open') {
    throw new RuntimeCognitionError('runtime result target must be an open loop')
  }
  if (Date.parse(fact.occurredAt) < Date.parse(previous.updatedAt)) {
    throw new RuntimeCognitionError('runtime result must not precede its tool call')
  }
  return createMemory({
    ...previous,
    data: {
      ...previous.data,
      status: 'resolved',
      resolution: {
        description: fact.content,
        status: fact.outcomeStatus ?? 'observed',
        occurredAt: fact.occurredAt,
        eventRef: runtimeEventRef(fact),
      },
    },
    updatedAt: fact.occurredAt,
  })
}

function findRuntimeOpenLoop(
  memories: readonly RinMemory[],
  fact: RuntimeMemoryFact,
): RinMemory | undefined {
  if (fact.correlationKey === undefined) return undefined
  const matches = memories.filter(memory =>
    memory.form === 'open-loop'
    && memory.data.status === 'open'
    && memory.data.origin?.correlationKey === fact.correlationKey,
  )
  if (matches.length > 1) {
    throw new RuntimeCognitionError('correlation key resolves to multiple open loops')
  }
  return matches[0]
}

function planRuntimeLoopChanges(
  fact: RuntimeMemoryFact,
  memories: readonly RinMemory[],
  sceneChanges: readonly SceneChange[],
): readonly OpenLoopChange[] {
  if (fact.eventType === 'tool/call') {
    if (fact.correlationKey === undefined) return []
    if (findRuntimeOpenLoop(memories, fact) !== undefined) {
      throw new RuntimeCognitionError('tool call correlation key already has an open loop')
    }
    const sceneChange = sceneChanges[sceneChanges.length - 1]
    const activeScene = findActiveRuntimeSceneForSession(memories, fact.sessionId)
    const sceneId = sceneChange?.memory.id ?? activeScene?.id
    if (sceneId === undefined) {
      throw new RuntimeCognitionError('runtime tool call requires a scene to attach its open loop')
    }
    return [{
      operation: 'open',
      sceneId,
      memory: buildRuntimeOpenLoop(fact, sceneId),
    }]
  }
  if (fact.eventType !== 'tool/result') return []
  const previous = findRuntimeOpenLoop(memories, fact)
  if (previous === undefined) return []
  if (previous.form !== 'open-loop') {
    throw new RuntimeCognitionError('runtime result target is not an open loop')
  }
  const sceneId = previous.data.relatedMemoryIds[0]
  if (sceneId === undefined) {
    throw new RuntimeCognitionError('runtime open loop has no related scene')
  }
  return [{
    operation: 'resolve',
    sceneId,
    memoryId: previous.id,
    previousVersion: memoryVersion(previous),
    memory: resolveRuntimeOpenLoop(previous, fact),
  }]
}

function appendRuntimeSceneFact(
  previous: RinMemory,
  fact: RuntimeMemoryFact,
  status: 'open' | 'closed',
  context: RuntimeSceneContext = {},
): RinMemory {
  if (previous.form !== 'scene' || previous.data.lifecycle === undefined) {
    throw new RuntimeCognitionError('runtime scene revision requires a lifecycle-bearing scene')
  }
  if (previous.data.lifecycle.status !== 'open') {
    throw new RuntimeCognitionError('a closed runtime scene cannot receive another fact')
  }
  assertRuntimeSceneContextCompatibility(previous, context)
  if (Date.parse(fact.occurredAt) < Date.parse(previous.updatedAt)) {
    throw new RuntimeCognitionError('runtime scene facts must be ordered by occurrence time')
  }
  const lifecycle: SceneLifecycle = status === 'closed'
    ? { ...previous.data.lifecycle, status, endedAt: fact.occurredAt }
    : { ...previous.data.lifecycle, status }
  const rin = previous.data.participants[1]
  if (rin === undefined) {
    throw new RuntimeCognitionError('runtime scene must retain a Rin participant')
  }
  return createMemory({
    ...previous,
    data: {
      ...previous.data,
      observations: fact.kind === 'observation'
        ? [...previous.data.observations, fact.content]
        : previous.data.observations,
      actions: fact.kind === 'action'
        ? [...previous.data.actions, { actor: rin, description: fact.content }]
        : previous.data.actions,
      outcomes: fact.kind === 'outcome'
        ? [...previous.data.outcomes, {
            description: fact.content,
            status: fact.outcomeStatus ?? 'observed',
          }]
        : previous.data.outcomes,
      lifecycle,
      runtimeEventRefs: [...(previous.data.runtimeEventRefs ?? []), runtimeEventRef(fact)],
    },
    updatedAt: fact.occurredAt,
  })
}

function closeRuntimeScene(previous: RinMemory, occurredAt: string): RinMemory {
  if (previous.form !== 'scene' || previous.data.lifecycle === undefined) {
    throw new RuntimeCognitionError('runtime scene close requires a lifecycle-bearing scene')
  }
  if (previous.data.lifecycle.status !== 'open') {
    throw new RuntimeCognitionError('a closed runtime scene cannot be closed again')
  }
  if (Date.parse(occurredAt) < Date.parse(previous.updatedAt)) {
    throw new RuntimeCognitionError('runtime scene boundary must not move backwards in time')
  }
  return createMemory({
    ...previous,
    data: {
      ...previous.data,
      lifecycle: {
        ...previous.data.lifecycle,
        status: 'closed',
        endedAt: occurredAt,
      },
    },
    updatedAt: occurredAt,
  })
}

function findRuntimeSceneByContinuity(
  memories: readonly RinMemory[],
  continuityKey: string,
): RinMemory | undefined {
  const matches = memories.filter(memory =>
    memory.form === 'scene'
    && memory.data.lifecycle?.continuityKey === continuityKey,
  )
  if (matches.length > 1) {
    throw new RuntimeCognitionError('continuity key resolves to multiple runtime scenes')
  }
  return matches[0]
}

function findActiveRuntimeSceneForSession(
  memories: readonly RinMemory[],
  sessionId: string,
): RinMemory | undefined {
  const matches = memories.filter(memory =>
    memory.form === 'scene'
    && memory.data.lifecycle?.status === 'open'
    && memory.data.runtimeEventRefs?.some(ref => ref.sessionId === sessionId),
  )
  if (matches.length > 1) {
    throw new RuntimeCognitionError('session has multiple active runtime scenes')
  }
  return matches[0]
}

function containsRuntimeFact(memories: readonly RinMemory[], fact: RuntimeMemoryFact): boolean {
  return memories.some(memory =>
    memory.form === 'scene'
    && memory.data.runtimeEventRefs?.some(ref =>
      ref.sessionId === fact.sessionId && ref.eventSeq === fact.eventSeq,
    ),
  )
}

type NormalizedRuntimeSceneHint = RuntimeSceneContext & Readonly<{
  continuityKey?: string
  boundary: RuntimeSceneBoundary
}>

function normalizeRuntimeParticipants(value: unknown): RuntimeParticipantHint | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) {
    throw new RuntimeCognitionError('runtime scene participants must be an object')
  }
  const user = createParticipantId(requiredText(value.user, 'runtime scene participants.user'))
  const rin = createParticipantId(requiredText(value.rin, 'runtime scene participants.rin'))
  if (String(user) === String(rin)) {
    throw new RuntimeCognitionError('runtime scene participants.user and rin must differ')
  }
  return Object.freeze({ user, rin })
}

function normalizeRuntimeGoals(value: unknown): readonly GoalId[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    throw new RuntimeCognitionError('runtime scene goals must be an array')
  }
  const goals = value.map((entry, index) =>
    createGoalId(requiredText(entry, 'runtime scene goals[' + index + ']')),
  )
  if (new Set(goals.map(String)).size !== goals.length) {
    throw new RuntimeCognitionError('runtime scene goals must be unique')
  }
  return Object.freeze(goals)
}

function normalizeRuntimeSceneHint(
  sessionId: string,
  hint: RuntimeSceneHint | undefined,
): NormalizedRuntimeSceneHint {
  if (hint !== undefined && !isRecord(hint)) {
    throw new RuntimeCognitionError('runtime scene hint must be an object')
  }
  const boundary = hint?.boundary ?? 'continue'
  if (boundary !== 'continue' && boundary !== 'open' && boundary !== 'close') {
    throw new RuntimeCognitionError('runtime scene boundary is invalid')
  }
  const continuityKey = hint?.continuityKey === undefined
    ? undefined
    : requiredText(hint.continuityKey, 'runtime scene continuity key')
  const participants = normalizeRuntimeParticipants(hint?.participants)
  const goals = normalizeRuntimeGoals(hint?.goals)
  requiredText(sessionId, 'session id')
  return {
    boundary,
    ...(continuityKey === undefined ? {} : { continuityKey }),
    ...(participants === undefined ? {} : { participants }),
    ...(goals === undefined ? {} : { goals }),
  }
}

function assertRuntimeSceneContextCompatibility(
  previous: RinMemory,
  context: RuntimeSceneContext,
): void {
  if (previous.form !== 'scene') {
    throw new RuntimeCognitionError('runtime scene context requires a scene')
  }
  if (context.participants !== undefined) {
    const expected = [String(context.participants.user), String(context.participants.rin)]
    const actual = previous.data.participants.map(String)
    if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) {
      throw new RuntimeCognitionError('runtime scene participants cannot change during a scene')
    }
  }
  if (context.goals !== undefined) {
    const expected = context.goals.map(String)
    const actual = previous.data.goals.map(String)
    if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) {
      throw new RuntimeCognitionError('runtime scene goals cannot change during a scene')
    }
  }
}

function planRuntimeSceneChanges(
  sessionId: string,
  fact: RuntimeMemoryFact,
  memories: readonly RinMemory[],
  hint: RuntimeSceneHint | undefined,
): readonly SceneChange[] {
  const normalized = normalizeRuntimeSceneHint(sessionId, hint)
  const active = findActiveRuntimeSceneForSession(memories, sessionId)
  const continuityKey = normalized.continuityKey
    ?? (active?.form === 'scene' ? active.data.lifecycle?.continuityKey : undefined)
    ?? 'session:' + sessionId
  const matching = findRuntimeSceneByContinuity(memories, continuityKey)

  if (normalized.boundary === 'open') {
    if (matching !== undefined) {
      throw new RuntimeCognitionError('opening a scene requires a new continuity key')
    }
    const changes: SceneChange[] = []
    if (active !== undefined) {
      if (active.form !== 'scene' || active.data.lifecycle === undefined) {
        throw new RuntimeCognitionError('active runtime scene has no lifecycle')
      }
      changes.push({
        operation: 'close',
        memoryId: active.id,
        previousVersion: memoryVersion(active),
        memory: closeRuntimeScene(active, fact.occurredAt),
      })
    }
    changes.push({
      operation: 'open',
      memory: buildRuntimeSceneMemory(fact, continuityKey, 'open', normalized),
    })
    return changes
  }

  if (normalized.boundary === 'close') {
    const target = matching ?? active
    if (target === undefined) {
      throw new RuntimeCognitionError('closing a scene requires an active runtime scene')
    }
    if (target.form !== 'scene' || target.data.lifecycle === undefined) {
      throw new RuntimeCognitionError('runtime scene close target has no lifecycle')
    }
    if (active !== undefined && target.id !== active.id) {
      throw new RuntimeCognitionError('a session can only close its active runtime scene')
    }
    if (target.data.lifecycle.status !== 'open') {
      throw new RuntimeCognitionError('a closed runtime scene cannot be continued')
    }
    return [{
      operation: 'close',
      memoryId: target.id,
      previousVersion: memoryVersion(target),
      memory: appendRuntimeSceneFact(target, fact, 'closed', normalized),
    }]
  }

  if (active !== undefined && active.form === 'scene' && active.data.lifecycle?.continuityKey !== continuityKey) {
    throw new RuntimeCognitionError('continuity changed without an explicit open boundary')
  }
  if (matching?.form === 'scene' && matching.data.lifecycle?.status === 'closed') {
    throw new RuntimeCognitionError('a closed runtime scene cannot be continued')
  }
  const target = matching ?? active
  if (target !== undefined) {
    if (target.form !== 'scene' || target.data.lifecycle === undefined) {
      throw new RuntimeCognitionError('runtime scene continuation target has no lifecycle')
    }
    return [{
      operation: 'extend',
      memoryId: target.id,
      previousVersion: memoryVersion(target),
      memory: appendRuntimeSceneFact(target, fact, 'open', normalized),
    }]
  }
  return [{
    operation: 'open',
    memory: buildRuntimeSceneMemory(fact, continuityKey, 'open', normalized),
  }]
}

function createRuntimeSceneTransaction(
  fact: RuntimeMemoryFact,
  changes: readonly SceneChange[],
  actorId: string,
  loopChanges: readonly OpenLoopChange[] = [],
): MemoryTransaction {
  const sessionKey = runtimeToken(fact.sessionId)
  const eventKey = 'scene-' + sessionKey + '-' + fact.eventSeq
  const actor = createRuntimeActor(actorId)
  const commandId = createMemoryCommandId('scene-command-' + eventKey)
  const transactionId = createMemoryTransactionId('scene-transaction-' + eventKey)
  const correlationId = createMemoryCorrelationId('session-' + sessionKey)
  const command: MemoryCommand = {
    kind: 'memory-command',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'scene',
    commandId,
    correlationId,
    actor,
    issuedAt: fact.occurredAt,
    payload: loopChanges.length === 0 ? { changes } : { changes, loopChanges },
  }
  const events: MemoryEvent[] = changes.map((change, position) => {
    if (change.operation === 'open') {
      return {
        kind: 'memory-event',
        protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
        type: 'scene-opened',
        eventId: createMemoryEventId('scene-event-' + eventKey + '-' + position),
        transactionId,
        commandId,
        position,
        actor,
        occurredAt: change.memory.updatedAt,
        payload: { memory: change.memory },
      }
    }
    return {
      kind: 'memory-event',
      protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
      type: change.operation === 'extend' ? 'scene-extended' : 'scene-closed',
      eventId: createMemoryEventId('scene-event-' + eventKey + '-' + position),
      transactionId,
      commandId,
      position,
      actor,
      occurredAt: change.memory.updatedAt,
      payload: {
        memoryId: change.memoryId,
        previousVersion: change.previousVersion,
        memory: change.memory,
      },
    }
  })
  loopChanges.forEach((change, index) => {
    const position = changes.length + index
    if (change.operation === 'open') {
      events.push({
        kind: 'memory-event',
        protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
        type: 'open-loop-opened',
        eventId: createMemoryEventId('scene-event-' + eventKey + '-' + position),
        transactionId,
        commandId,
        position,
        actor,
        occurredAt: change.memory.updatedAt,
        payload: {
          sceneId: change.sceneId,
          memory: change.memory,
        },
      })
      return
    }
    events.push({
      kind: 'memory-event',
      protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
      type: 'open-loop-resolved',
      eventId: createMemoryEventId('scene-event-' + eventKey + '-' + position),
      transactionId,
      commandId,
      position,
      actor,
      occurredAt: change.memory.updatedAt,
      payload: {
        sceneId: change.sceneId,
        memoryId: change.memoryId,
        previousVersion: change.previousVersion,
        memory: change.memory,
      },
    })
  })
  return createMemoryTransaction({
    transactionId,
    commandId,
    correlationId,
    actor,
    openedAt: fact.occurredAt,
    committedAt: fact.occurredAt,
    command,
    events,
  })
}

/** Create the deterministic observation transaction for one runtime fact. */
export function createRuntimeMemoryTransaction(
  fact: RuntimeMemoryFact,
  actorId = 'rin-runtime',
): MemoryTransaction {
  const sessionKey = runtimeToken(fact.sessionId)
  const eventKey = 'runtime-' + sessionKey + '-' + fact.eventSeq
  const actor = createRuntimeActor(actorId)
  const memory = buildRuntimeMemory(fact)
  const commandId = createMemoryCommandId('observe-' + eventKey)
  const transactionId = createMemoryTransactionId('transaction-' + eventKey)
  const correlationId = createMemoryCorrelationId('session-' + sessionKey)
  const command: MemoryCommand = {
    kind: 'memory-command',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'observe',
    commandId,
    correlationId,
    actor,
    issuedAt: fact.occurredAt,
    payload: { memory },
  }
  const event: MemoryEvent = {
    kind: 'memory-event',
    protocolVersion: MEMORY_COGNITION_PROTOCOL_VERSION,
    type: 'memory-observed',
    eventId: createMemoryEventId('event-' + eventKey),
    transactionId,
    commandId,
    position: 0,
    actor,
    occurredAt: fact.occurredAt,
    payload: { memory },
  }
  return createMemoryTransaction({
    transactionId,
    commandId,
    correlationId,
    actor,
    openedAt: fact.occurredAt,
    committedAt: fact.occurredAt,
    command,
    events: [event],
  })
}

/** True when a value has the structural shape of a dsh session event. */
export function isRuntimeSessionEvent(value: unknown): value is RuntimeSessionEvent {
  return isRecord(value)
    && typeof value.type === 'string'
    && typeof value.seq === 'number'
    && typeof value.time === 'number'
    && 'data' in value
}

/** Runtime read model required to plan a scene state transition. */
export type RuntimeCognitionState = Readonly<{
  memories: readonly RinMemory[]
}>

/** Minimal sink used by the runtime bridge; the domain owns the write and read. */
export interface RuntimeCognitionSink {
  appendTransaction(transaction: MemoryTransaction): MemoryTransaction
  getTransaction(transactionId: string): MemoryTransaction | undefined
  readMaterializedState(): RuntimeCognitionState
}

/** Turns meaningful session occurrences into canonical cognition transactions. */
export class RuntimeCognitionIngestor {
  constructor(
    private readonly sink: RuntimeCognitionSink,
    private readonly actorId = 'rin-runtime',
  ) {}

  ingest(
    sessionId: string,
    event: RuntimeSessionEvent,
    hint?: RuntimeSceneHint,
  ): MemoryTransaction | null {
    const fact = mapRuntimeSessionEvent(sessionId, event)
    if (fact === null) return null
    const sceneTransactionId = createMemoryTransactionId(
      'scene-transaction-scene-' + runtimeToken(fact.sessionId) + '-' + fact.eventSeq,
    )
    const existing = this.sink.getTransaction(sceneTransactionId)
    if (existing !== undefined) return existing
    const state = this.sink.readMaterializedState()
    if (containsRuntimeFact(state.memories, fact)) return null
    const loop = findRuntimeOpenLoop(state.memories, fact)
    const changes = loop !== undefined && fact.eventType === 'tool/result'
      ? []
      : planRuntimeSceneChanges(sessionId, fact, state.memories, hint)
    const loopChanges = planRuntimeLoopChanges(fact, state.memories, changes)
    return this.sink.appendTransaction(createRuntimeSceneTransaction(fact, changes, this.actorId, loopChanges))
  }
}
