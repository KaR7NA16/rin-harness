/**
 * Rin memory recall dynamics.
 *
 * This is the only runtime surface that turns the canonical cognition field
 * into model-facing memory. Search, links, dynamics, and external evidence
 * are inputs to one coalition process; none is a parallel injection path.
 */

import { createHash } from 'node:crypto'
import { MEMORY_WORKSPACE_CONTRACT_VERSION } from '@rin/contracts'
import type { MemoryCurrentField, MemoryWorkspaceDto } from '@rin/contracts'
import type { MemoryMaterializedState } from './store.ts'
import type { MemoryUseTrace } from './consolidation.ts'
import {
  isMemoryContextActiveForScene,
  isMemoryValidityActiveAt,
  isCurrentVersionLink,
  type CurrentField,
  type MemoryActionRecord,
  type MemoryFeedbackVector,
  type MemoryLink,
  type MemoryLinkRelation,
  type MemoryLinkState,
  type MemoryOutcomeRecord,
  type RinMemory,
} from './model.ts'

export const MEMORY_RECALL_SCHEMA_VERSION = 2 as const

export type MemoryRecallSourceKind =
  | 'current-field'
  | 'lexical'
  | 'typed-link'
  | 'contextual'
  | 'dynamics'
  | 'behavior'
  | 'session-search'
  | 'embedding'
  | 'external'

export type MemoryRecallMode = 'current' | 'history'

export interface MemoryRecallQuery {
  mode?: MemoryRecallMode
  text?: string
  memoryIds?: readonly string[]
  participantIds?: readonly string[]
  goalIds?: readonly string[]
  sessionId?: string
}

export interface MemoryRecallBudget {
  maxItems?: number
  maxTokens?: number
  linkDepth?: number
}

export interface MemoryRecallInput {
  cycleId?: string
  query?: MemoryRecallQuery | string
  budget?: MemoryRecallBudget
}

export interface MemoryRecallExternalCandidate {
  id: string
  source: MemoryRecallSourceKind
  content: string
  title?: string
  reference?: Record<string, unknown>
  confidence?: number
  scoreHint?: number
}

export interface MemoryRecallSourceContext {
  query: MemoryRecallQuery
  state: MemoryMaterializedState
}

export interface MemoryRecallSource {
  id: string
  kind: Exclude<MemoryRecallSourceKind, 'current-field' | 'lexical' | 'typed-link' | 'dynamics' | 'contextual' | 'behavior'>
  query(
    context: MemoryRecallSourceContext,
  ): Promise<readonly MemoryRecallExternalCandidate[]> | readonly MemoryRecallExternalCandidate[]
}

export interface MemoryRecallScore {
  cueFit: number
  contextualFit: number
  accessibility: number
  salience: number
  utility: number
  openLoopPressure: number
  relationRelevance: number
  predictionRelevance: number
  inhibition: number
  contradictionCost: number
  uncertaintyPenalty: number
  invalidityPenalty: number
  total: number
}

export interface MemoryRecallCandidate {
  id: string
  kind: 'memory' | 'indexed-evidence'
  memory?: RinMemory
  external?: MemoryRecallExternalCandidate
  score: MemoryRecallScore
  sources: MemoryRecallSourceKind[]
  linkIds: string[]
  relatedMemoryIds: string[]
  duplicateKey: string
  reasons: string[]
}

export type MemoryWorkspaceRole =
  | 'scene'
  | 'critical'
  | 'support'
  | 'conflict'
  | 'open-loop'
  | 'prospect'
  | 'context'
  | 'evidence'

export interface MemoryWorkspaceItem {
  id: string
  kind: 'memory' | 'indexed-evidence'
  role: MemoryWorkspaceRole
  memory?: RinMemory
  external?: MemoryRecallExternalCandidate
  epistemic: string
  influence: string
  uncertainty: string[]
  confidence: number
  score: number
  scoreBreakdown: MemoryRecallScore
  selectionReasons: string[]
}

export interface MemoryWorkspaceLink {
  id: string
  from: string
  to: string
  relation: MemoryLinkRelation | 'evidence-for'
  strength: number
  state: MemoryLinkState | 'active'
  role: 'support' | 'conflict' | 'context' | 'derivation' | 'evidence'
}

export interface MemoryWorkspace {
  schemaVersion: typeof MEMORY_RECALL_SCHEMA_VERSION
  cycleId: string
  materializedVersion: number
  query: MemoryRecallQuery
  budget: {
    maxItems: number
    maxTokens: number
    usedItems: number
    usedTokens: number
  }
  currentField: CurrentField
  items: MemoryWorkspaceItem[]
  links: MemoryWorkspaceLink[]
  uncertainty: string[]
  hash: string
}

export interface MemoryRecallTrace {
  schemaVersion: typeof MEMORY_RECALL_SCHEMA_VERSION
  cycleId: string
  materializedVersion: number
  query: MemoryRecallQuery
  budget: MemoryWorkspace['budget']
  sources: Array<{
    id: string
    kind: MemoryRecallSourceKind
    candidateIds: string[]
    error?: string
  }>
  candidates: MemoryRecallCandidate[]
  suppressed: Array<{ id: string; reason: string; keptId?: string }>
  selectedIds: string[]
  selection: MemoryRecallSelectionDecision[]
}

export interface MemoryRecallSelectionDecision {
  id: string
  rank: number
  baseScore: number
  priorityBoost: number
  relationBoost: number
  anchorBoost: number
  finalValue: number
  reasons: string[]
}

export interface MemoryRecallResult {
  workspace: MemoryWorkspace
  trace: MemoryRecallTrace
}

export type MemoryActionChoice = Readonly<{
  id: string
  description: string
  sourceMemoryIds: readonly string[]
}>

export type MemoryRecallBehaviorEvaluation = Readonly<{
  beforeChoiceId: string
  afterChoiceId: string
  beforeChoiceAvailable: boolean
  afterChoiceAvailable: boolean
  beforeChoiceScores: Readonly<Record<string, number>>
  afterChoiceScores: Readonly<Record<string, number>>
  behaviorAffectedMemoryIds: readonly string[]
  recallChanged: boolean
  choiceChanged: boolean
  passed: boolean
  reasons: readonly string[]
}>

export interface MemoryRecallRecord {
  cycleId: string
  createdAt: string
  workspace: MemoryWorkspace
  trace: MemoryRecallTrace
}

export interface MemoryModelInputRecord {
  id: string
  cycleId: string
  sequence: number
  sessionId?: string
  createdAt: string
  workspaceHash?: string
  inputHash: string
  input: Record<string, unknown>
}

export interface MemoryModelInputRecordInput {
  cycleId?: string
  sessionId?: string
  input: Readonly<Record<string, unknown>>
}

export type MemoryPersistedRecallBehaviorInput = Readonly<{
  beforeCycleId: string
  afterCycleId: string
  choices: readonly MemoryActionChoice[]
  actionId?: string
  actionPhase?: 'before' | 'after'
}>

export type MemoryRecordedRecallBehaviorEvaluation = Readonly<{
  beforeCycleId: string
  afterCycleId: string
  actionId: string
  actionPhase: 'before' | 'after'
  executedChoiceId?: string
  actionSourceBound: boolean
  modelInputBound: boolean
  materializationAdvanced: boolean
  actionSelectionUseIds: readonly string[]
  outcomeIds: readonly string[]
  feedbackIds: readonly string[]
  chainComplete: boolean
  recall: MemoryRecallBehaviorEvaluation
  passed: boolean
  reasons: readonly string[]
}>

type CandidateMap = Map<string, MemoryRecallCandidate>
type LinkMap = Map<string, MemoryLink>

const DEFAULT_MAX_ITEMS = 12
const DEFAULT_MAX_TOKENS = 2400
const DEFAULT_LINK_DEPTH = 2

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : 0))
}

function boundedInt(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.trunc(value ?? fallback)))
}

function normalizeText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim()
}

function terms(value: string): string[] {
  return [...new Set(normalizeText(value).match(/[\p{L}\p{N}_-]{2,}/gu) ?? [])]
}

function overlap(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) return 0
  const rightSet = new Set(right)
  return clamp(left.filter(item => rightSet.has(item)).length / Math.max(left.length, right.length))
}

function memoryNarrative(memory: RinMemory): string {
  const data = memory.data as Record<string, unknown>
  const fragments: string[] = [memory.form]
  const visit = (value: unknown, key = ''): void => {
    if (typeof value === 'string' && value.trim() !== '') {
      fragments.push(value.trim())
      return
    }
    if (typeof value !== 'object' || value === null) return
    if (Array.isArray(value)) {
      for (const item of value) visit(item, key)
      return
    }
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      if (childKey === 'runtimeEventRefs' || childKey === 'relatedMemoryIds') continue
      visit(childValue, childKey)
    }
  }
  visit(data)
  return fragments.join(' | ')
}

function memoryContextIds(memory: RinMemory): { participantIds: readonly string[]; goalIds: readonly string[] } {
  switch (memory.form) {
    case 'scene':
      return { participantIds: memory.data.participants, goalIds: memory.data.goals }
    case 'person-model':
      return { participantIds: [memory.data.subject], goalIds: [] }
    case 'relationship-model':
      return { participantIds: memory.data.participants, goalIds: [] }
    case 'disposition':
      return { participantIds: [], goalIds: [memory.data.intendedGoal] }
    case 'open-loop':
      return { participantIds: [], goalIds: [memory.data.goal] }
    default:
      return { participantIds: [], goalIds: [] }
  }
}

function memoryDuplicateKey(memory: RinMemory): string {
  const narrative = memoryNarrative(memory).split(' | ').slice(1).join(' | ')
  return normalizeText(narrative).slice(0, 1200)
}

function isRecallable(
  memory: RinMemory,
  mode: MemoryRecallMode = 'current',
  at?: string,
  currentScene?: Extract<RinMemory, { form: 'scene' }>,
): boolean {
  const historicalArchive = memory.state.persistence === 'archived' && mode === 'history'
  if (memory.state.persistence === 'archived' && !historicalArchive) return false
  if (memory.state.persistence === 'erased') return false
  if (!historicalArchive && (memory.state.influence === 'blocked' || memory.state.influence === 'revoked')) return false
  if (mode !== 'history' && at !== undefined && !isMemoryValidityActiveAt(memory.dynamics.validity, at)) return false
  if (mode !== 'history' && currentScene !== undefined && !isMemoryContextActiveForScene(memory, currentScene)) return false
  return memory.state.epistemic !== 'superseded'
    && memory.state.epistemic !== 'rejected'
}

function currentAnchors(
  field: CurrentField,
  query: MemoryRecallQuery,
  memories: readonly RinMemory[],
  at?: string,
  currentScene?: Extract<RinMemory, { form: 'scene' }>,
): Set<string> {
  const recallableIds = new Set(memories
    .filter(memory => isRecallable(memory, query.mode, at, currentScene))
    .map(memory => String(memory.id)))
  return new Set([
    ...(field.sceneId === undefined ? [] : [field.sceneId]),
    ...field.predictions,
    ...field.activeOpenLoops,
    ...field.activeMemoryCoalition,
    ...(query.memoryIds ?? []),
  ].filter(id => recallableIds.has(String(id))))
}

function recallUtilityGoalIds(
  memory: RinMemory,
  field: CurrentField,
  activeGoalIds: ReadonlySet<string>,
): ReadonlySet<string> {
  if (activeGoalIds.size > 0 || memory.form !== 'disposition') return activeGoalIds
  const isCurrentActionCandidate = (field.candidateActionSources ?? []).some(source =>
    source.sourceMemoryIds.some(id => String(id) === String(memory.id)),
  )
  return isCurrentActionCandidate
    ? new Set([String(memory.data.intendedGoal)])
    : activeGoalIds
}

function linkNeighborhood(
  state: MemoryMaterializedState,
  seeds: ReadonlySet<string>,
  maxDepth: number,
  at: string | undefined,
  mode: MemoryRecallMode | undefined,
): { ids: Set<string>; links: LinkMap } {
  const ids = new Set(seeds)
  const links = new Map<string, MemoryLink>()
  let frontier = new Set(seeds)
  for (let depth = 0; depth < maxDepth && frontier.size > 0; depth += 1) {
    const next = new Set<string>()
    for (const link of state.links) {
      if (
        !isCurrentVersionLink(link, state.memories)
        || (mode !== 'history' && at !== undefined && !isMemoryValidityActiveAt(link.validity, at))
      ) continue
      if (!frontier.has(link.from) && !frontier.has(link.to)) continue
      links.set(String(link.id), link)
      const other = frontier.has(link.from) ? link.to : link.from
      if (!ids.has(other)) {
        ids.add(other)
        next.add(other)
      }
    }
    frontier = next
  }
  return { ids, links }
}

function linkRole(relation: MemoryLinkRelation): MemoryWorkspaceLink['role'] {
  if (relation === 'contradicts' || relation === 'supersedes') return 'conflict'
  if (relation === 'supports' || relation === 'derives' || relation === 'feedback-for') return 'support'
  if (relation === 'caused-by' || relation === 'action-led-to') return 'derivation'
  return 'context'
}

function memoryConfidence(memory: RinMemory): number {
  return clamp(memory.dynamics.confidence)
}

function candidateText(candidate: MemoryRecallCandidate): string {
  return candidate.memory === undefined
    ? candidate.external?.content ?? ''
    : memoryNarrative(candidate.memory)
}

function candidatePriorityBoost(candidate: MemoryRecallCandidate): number {
  const memory = candidate.memory
  if (memory === undefined) return 0.02
  const formBoost = memory.form === 'scene' ? 0.12
    : memory.form === 'structure' ? 0.06
    : memory.form === 'relationship-model' ? 0.05
    : 0
  const observedBoost = memory.state.epistemic === 'observed' ? 0.04 : 0
  return formBoost + observedBoost
}

function candidatePriority(candidate: MemoryRecallCandidate): number {
  return candidate.score.total + candidatePriorityBoost(candidate)
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4))
}

function safeExternal(
  value: MemoryRecallExternalCandidate,
  fallbackSource: MemoryRecallSourceKind,
): MemoryRecallExternalCandidate | undefined {
  if (value.id.trim() === '' || value.content.trim() === '') return undefined
  const source = value.source === 'session-search' || value.source === 'embedding' || value.source === 'external'
    ? value.source
    : fallbackSource
  return {
    ...value,
    source,
    content: value.content.trim(),
    ...(value.confidence === undefined ? {} : { confidence: clamp(value.confidence) }),
    ...(value.scoreHint === undefined ? {} : { scoreHint: clamp(value.scoreHint, -1, 1) }),
  }
}

function normalizeQuery(input: MemoryRecallInput): MemoryRecallQuery {
  if (typeof input.query === 'string') return { text: input.query }
  const mode = input.query?.mode
  if (mode !== undefined && mode !== 'current' && mode !== 'history') {
    throw new Error('memory recall mode must be current or history')
  }
  return {
    ...(mode === undefined ? {} : { mode }),
    ...(input.query?.text === undefined ? {} : { text: input.query.text }),
    ...(input.query?.memoryIds === undefined ? {} : { memoryIds: [...input.query.memoryIds] }),
    ...(input.query?.participantIds === undefined ? {} : { participantIds: [...input.query.participantIds] }),
    ...(input.query?.goalIds === undefined ? {} : { goalIds: [...input.query.goalIds] }),
    ...(input.query?.sessionId === undefined ? {} : { sessionId: input.query.sessionId }),
  }
}

function normalizeBudget(input: MemoryRecallBudget | undefined): MemoryWorkspace['budget'] {
  return {
    maxItems: boundedInt(input?.maxItems, DEFAULT_MAX_ITEMS, 1, 64),
    maxTokens: boundedInt(input?.maxTokens, DEFAULT_MAX_TOKENS, 128, 16_000),
    usedItems: 0,
    usedTokens: 0,
  }
}

function addMemoryCandidate(
  candidates: CandidateMap,
  memory: RinMemory,
  score: MemoryRecallScore,
  sources: readonly MemoryRecallSourceKind[],
  links: readonly MemoryLink[],
  reasons: readonly string[],
): void {
  const id = String(memory.id)
  const existing = candidates.get(id)
  if (existing === undefined) {
    candidates.set(id, {
      id,
      kind: 'memory',
      memory,
      score,
      sources: [...new Set(sources)],
      linkIds: links.map(link => String(link.id)),
      relatedMemoryIds: [...new Set(links.flatMap(link => [String(link.from), String(link.to)]))].filter(item => item !== id),
      duplicateKey: memoryDuplicateKey(memory),
      reasons: [...reasons],
    })
    return
  }
  existing.sources = [...new Set([...existing.sources, ...sources])]
  existing.linkIds = [...new Set([...existing.linkIds, ...links.map(link => String(link.id))])]
  existing.relatedMemoryIds = [...new Set([
    ...existing.relatedMemoryIds,
    ...links.flatMap(link => [String(link.from), String(link.to)]),
  ])].filter(item => item !== id)
  existing.reasons = [...new Set([...existing.reasons, ...reasons])]
  if (score.total > existing.score.total) existing.score = score
}

type MemoryBehaviorSignal = Readonly<{
  relevance: number
  inhibition: number
  correctionPressure: number
  reasons: readonly string[]
}>

function behaviorSignal(state: MemoryMaterializedState, memoryId: string): MemoryBehaviorSignal {
  const predictions = (state.predictions ?? []).filter(prediction => prediction.sourceMemoryIds.some(id => String(id) === memoryId))
  const predictionIds = new Set(predictions.map(prediction => String(prediction.id)))
  const actions = (state.actions ?? []).filter(action =>
    action.sourceMemoryIds.some(id => String(id) === memoryId) || action.predictionIds.some(id => predictionIds.has(String(id))))
  const actionIds = new Set(actions.map(action => String(action.id)))
  const outcomes = (state.outcomes ?? []).filter(outcome =>
    actionIds.has(String(outcome.actionId))
    || (outcome.predictionId !== undefined && predictionIds.has(String(outcome.predictionId))))
  const outcomeIds = new Set(outcomes.map(outcome => String(outcome.id)))
  const feedback = (state.feedback ?? []).filter(vector =>
    vector.sceneId === memoryId
    || vector.dispositionId === memoryId
    || (vector.actionId !== undefined && actionIds.has(String(vector.actionId)))
    || (vector.predictionId !== undefined && predictionIds.has(String(vector.predictionId)))
    || (vector.outcomeId !== undefined && outcomeIds.has(String(vector.outcomeId))))
  const negativeFeedback = feedback.filter(vector =>
    vector.kind === 'reject'
    || vector.kind === 'boundary'
    || vector.userResponse === 'rejected'
    || vector.userResponse === 'ignored'
    || vector.taskOutcome < -0.25,
  )
  const corrections = feedback.filter(vector =>
    vector.kind === 'correct'
    || vector.userResponse === 'corrected'
    || (vector.factualCorrection !== undefined && vector.factualCorrection.trim() !== ''),
  )
  const predictionMismatchMagnitude = feedback.reduce((sum, vector) =>
    sum + Math.max(0, -(vector.predictionAccuracy ?? 0)),
  0)
  const relationshipBoundaryPressure = feedback.reduce((sum, vector) =>
    sum
      + Math.max(0, -(vector.relationshipConsequence ?? 0))
      + (vector.boundaryRespect === 'crossed' ? 1 : 0),
    0,
  )
  const autonomySafetyPressure = feedback.reduce((sum, vector) =>
    sum
      + Math.max(0, -(vector.autonomyEffect ?? 0))
      + Math.max(0, -(vector.safetyEffect ?? 0)),
    0,
  )
  const delayedFeedback = feedback.filter(vector =>
    vector.delayed || (vector.delayedConsequence !== undefined && vector.delayedConsequence.trim() !== ''),
  )
  const delayedOutcomes = outcomes.filter(outcome => outcome.delayed)
  const relevance = clamp(
    0.24 * Math.min(predictions.length, 3)
      + 0.18 * Math.min(actions.length, 3)
      + 0.2 * Math.min(outcomes.length, 3)
      + 0.16 * Math.min(feedback.length, 3)
      + 0.08 * Math.min(delayedFeedback.length, 3)
      + 0.06 * Math.min(predictionMismatchMagnitude, 2),
  )
  const inhibition = clamp(
    0.22 * Math.min(negativeFeedback.length, 3)
      + 0.08 * Math.min(delayedOutcomes.length, 3)
      + 0.12 * Math.min(relationshipBoundaryPressure, 3)
      + 0.12 * Math.min(autonomySafetyPressure, 3),
  )
  const correctionPressure = clamp(
    0.2 * Math.min(corrections.length, 3)
      + 0.1 * Math.min(predictionMismatchMagnitude, 2),
  )
  const reasons = [
    ...(predictions.length === 0 ? [] : ['linked prediction']),
    ...(actions.length === 0 ? [] : ['linked action']),
    ...(outcomes.length === 0 ? [] : [delayedOutcomes.length > 0 ? 'delayed outcome' : 'linked outcome']),
    ...(feedback.length === 0 ? [] : ['behavior feedback']),
    ...(negativeFeedback.length === 0 ? [] : ['boundary/rejection inhibition']),
    ...(corrections.length === 0 ? [] : ['correction pressure']),
    ...(predictionMismatchMagnitude === 0 ? [] : ['prediction mismatch pressure']),
    ...(relationshipBoundaryPressure === 0 ? [] : ['relationship/boundary pressure']),
    ...(autonomySafetyPressure === 0 ? [] : ['autonomy/safety pressure']),
    ...(delayedFeedback.length === 0 ? [] : ['delayed feedback']),
  ]
  return { relevance, inhibition, correctionPressure, reasons }
}

type MemoryOpenLoopSignal = Readonly<{
  pressure: number
  reasons: readonly string[]
}>

function openLoopPressureSignal(
  state: MemoryMaterializedState,
  memoryId: string,
  at: string | undefined,
  mode: MemoryRecallMode | undefined,
): MemoryOpenLoopSignal {
  const loops = state.memories.filter(memory =>
    memory.form === 'open-loop'
    && memory.data.status === 'open'
    && memory.state.persistence !== 'archived'
    && memory.state.persistence !== 'erased'
    && memory.state.epistemic !== 'superseded'
    && memory.state.epistemic !== 'rejected'
    && memory.state.influence !== 'revoked'
    && (mode === 'history' || at === undefined || isMemoryValidityActiveAt(memory.dynamics.validity, at))
    && (String(memory.id) === memoryId || memory.data.relatedMemoryIds.some(id => String(id) === memoryId)),
  )
  if (loops.length === 0) return { pressure: 0, reasons: [] }
  const direct = loops.some(memory => String(memory.id) === memoryId)
  const pressure = direct
    ? 1
    : clamp(Math.max(...loops.map(memory =>
      0.45
        + 0.25 * clamp(memory.dynamics.salience)
        + 0.15 * clamp(memory.dynamics.surprise)
        + 0.15 * clamp(memory.dynamics.affect.arousal),
    )))
  return {
    pressure,
    reasons: [direct ? 'unresolved open loop' : 'unresolved open-loop consequence pressure=' + pressure.toFixed(2)],
  }
}

function scoreMemory(
  memory: RinMemory,
  query: MemoryRecallQuery,
  links: readonly MemoryLink[],
  anchorIds: ReadonlySet<string>,
  signal: MemoryBehaviorSignal,
  unresolvedLoopPressure: number,
  activeGoalIds: ReadonlySet<string>,
  at: string | undefined,
  currentScene?: Extract<RinMemory, { form: 'scene' }>,
): MemoryRecallScore {
  const narrativeTerms = terms(memoryNarrative(memory))
  const queryTerms = terms(query.text ?? '')
  const contextIds = memoryContextIds(memory)
  const participantFit = overlap(contextIds.participantIds, query.participantIds ?? [])
  const goalFit = overlap(contextIds.goalIds, query.goalIds ?? [])
  const anchorFit = anchorIds.has(String(memory.id)) ? 1 : 0
  const linkRelevance = links.length === 0 ? 0 : clamp(
    links.reduce((sum, link) => sum + link.strength, 0) / links.length,
  )
  const openLoop = Math.max(memory.form === 'open-loop' && memory.data.status === 'open' ? 1 : 0, clamp(unresolvedLoopPressure))
  const prediction = clamp(Math.max(memory.form === 'prospect' || links.some(link => link.relation === 'predicts') ? 1 : 0, signal.relevance))
  const contradiction = clamp((memory.state.epistemic === 'contested'
    || links.some(link => link.relation === 'contradicts' || link.state === 'contested') ? 0.12 : 0) + signal.correctionPressure * 0.08)
  const uncertainty = (1 - memoryConfidence(memory)) * 0.45
    + (memory.state.epistemic === 'hypothesized' ? 0.15 : 0)
    + signal.correctionPressure * 0.1
  const cueFit = Math.max(overlap(queryTerms, narrativeTerms), anchorFit)
  const contextualFit = clamp(Math.max(participantFit, goalFit, anchorFit * 0.8))
  const applicableUtilities = memory.dynamics.utilityByGoal.filter(item => activeGoalIds.has(String(item.goalId)))
  const utility = applicableUtilities.length === 0
    ? 0
    : clamp(Math.max(...applicableUtilities.map(item => item.value)))
  const total = clamp(
    0.22 * cueFit
      + 0.14 * contextualFit
      + 0.12 * memory.dynamics.accessibility
      + 0.12 * memory.dynamics.salience
      + 0.08 * utility
      + 0.1 * Math.max(openLoop, memory.dynamics.surprise)
      + 0.08 * linkRelevance
      + 0.06 * prediction
      - 0.07 * Math.max(memory.dynamics.inhibition, signal.inhibition)
      - 0.04 * contradiction
      - 0.04 * uncertainty,
    -1,
    1,
  )
  return {
    cueFit,
    contextualFit,
    accessibility: clamp(memory.dynamics.accessibility),
    salience: clamp(memory.dynamics.salience),
    utility,
    openLoopPressure: clamp(Math.max(openLoop, memory.dynamics.surprise)),
    relationRelevance: linkRelevance,
    predictionRelevance: prediction,
    inhibition: clamp(Math.max(memory.dynamics.inhibition, signal.inhibition)),
    contradictionCost: contradiction,
    uncertaintyPenalty: clamp(uncertainty),
    invalidityPenalty: isRecallable(memory, query.mode, at, currentScene) ? 0 : 1,
    total,
  }
}

function scoreExternal(
  external: MemoryRecallExternalCandidate,
  query: MemoryRecallQuery,
): MemoryRecallScore {
  const fit = overlap(terms(query.text ?? ''), terms(external.content))
  const confidence = clamp(external.confidence ?? 0.5)
  const hint = clamp(external.scoreHint ?? fit, -1, 1)
  const total = clamp(0.34 * fit + 0.28 * confidence + 0.2 * Math.max(0, hint))
  return {
    cueFit: fit,
    contextualFit: 0,
    accessibility: 0.5,
    salience: confidence,
    utility: 0,
    openLoopPressure: 0,
    relationRelevance: 0,
    predictionRelevance: 0,
    inhibition: 0,
    contradictionCost: 0,
    uncertaintyPenalty: 1 - confidence,
    invalidityPenalty: 0,
    total,
  }
}

function addExternalCandidate(
  candidates: CandidateMap,
  external: MemoryRecallExternalCandidate,
  query: MemoryRecallQuery,
  sourceKind: MemoryRecallSourceKind,
): void {
  const value = safeExternal(external, sourceKind)
  if (value === undefined) return
  const id = value.id
  const score = scoreExternal(value, query)
  const existing = candidates.get(id)
  if (existing === undefined) {
    candidates.set(id, {
      id,
      kind: 'indexed-evidence',
      external: value,
      score,
      sources: [value.source],
      linkIds: [],
      relatedMemoryIds: [],
      duplicateKey: normalizeText(value.content).slice(0, 1200),
      reasons: ['external candidate'],
    })
    return
  }
  existing.sources = [...new Set([...existing.sources, value.source])]
  if (score.total > existing.score.total) existing.score = score
}


function linksForMemory(links: readonly MemoryLink[], memoryId: string): MemoryLink[] {
  return links.filter(link => String(link.from) === memoryId || String(link.to) === memoryId)
}


function workspaceRole(
  candidate: MemoryRecallCandidate,
  field: CurrentField,
  links: readonly MemoryLink[],
): MemoryWorkspaceRole {
  if (candidate.kind === 'indexed-evidence') return 'evidence'
  const memory = candidate.memory
  if (memory === undefined) return 'context'
  if (field.sceneId === memory.id) return 'scene'
  if (memory.form === 'open-loop') return 'open-loop'
  if (memory.form === 'prospect') return 'prospect'
  if (links.some(link => link.relation === 'contradicts' || link.state === 'contested')) return 'conflict'
  if (links.some(link => link.relation === 'supports' || link.relation === 'derives' || link.relation === 'feedback-for')) {
    return 'support'
  }
  if (candidate.score.contextualFit >= 0.65 || candidate.sources.includes('current-field')) return 'critical'
  return 'context'
}

function workspaceUncertainty(memory: RinMemory | undefined): string[] {
  if (memory === undefined) return []
  const uncertainty: string[] = []
  if (memory.dynamics.confidence < 0.75) {
    uncertainty.push('confidence=' + memory.dynamics.confidence.toFixed(2))
  }
  if (memory.state.persistence === 'archived') uncertainty.push('historical archive; not behaviorally active')
  if (memory.state.epistemic === 'contested') uncertainty.push('epistemic=contested')
  if (memory.form === 'prospect') uncertainty.push('prospect remains hypothetical')
  return uncertainty
}

function materializeWorkspaceItem(
  candidate: MemoryRecallCandidate,
  field: CurrentField,
  links: readonly MemoryLink[],
  decision?: MemoryRecallSelectionDecision,
): MemoryWorkspaceItem {
  const memory = candidate.memory
  const external = candidate.external
  const confidence = memory === undefined
    ? clamp(external?.confidence ?? 0.5)
    : memoryConfidence(memory)
  return {
    id: candidate.id,
    kind: candidate.kind,
    role: workspaceRole(candidate, field, links),
    ...(memory === undefined ? {} : { memory }),
    ...(external === undefined ? {} : { external }),
    epistemic: memory?.state.epistemic ?? 'indexed-evidence',
    influence: memory?.state.influence ?? 'permitted',
    uncertainty: workspaceUncertainty(memory),
    confidence,
    score: candidate.score.total,
    scoreBreakdown: candidate.score,
    selectionReasons: [...new Set([
      ...candidate.reasons,
      ...(decision?.reasons ?? []),
    ])],
  }
}

function workspaceLink(
  link: MemoryLink,
): MemoryWorkspaceLink {
  return {
    id: String(link.id),
    from: String(link.from),
    to: String(link.to),
    relation: link.relation,
    strength: clamp(link.strength),
    state: link.state,
    role: linkRole(link.relation),
  }
}
function duplicateRepresentative(group: readonly MemoryRecallCandidate[]): MemoryRecallCandidate {
  const sorted = [...group].sort((left, right) => {
    const leftMemory = left.memory
    const rightMemory = right.memory
    const leftValue = leftMemory === undefined ? 0 : (
      (leftMemory.form === 'scene' ? 4 : leftMemory.form === 'structure' ? 3 : 2)
      + (leftMemory.state.epistemic === 'observed' ? 1 : 0)
      + (leftMemory.state.integration === 'integrated' ? 0.5 : 0)
    )
    const rightValue = rightMemory === undefined ? 0 : (
      (rightMemory.form === 'scene' ? 4 : rightMemory.form === 'structure' ? 3 : 2)
      + (rightMemory.state.epistemic === 'observed' ? 1 : 0)
      + (rightMemory.state.integration === 'integrated' ? 0.5 : 0)
    )
    return rightValue - leftValue || candidatePriority(right) - candidatePriority(left) || left.id.localeCompare(right.id)
  })
  if (sorted[0] === undefined) throw new Error('duplicate group must not be empty')
  return sorted[0]
}

function candidatesConflict(
  left: MemoryRecallCandidate,
  right: MemoryRecallCandidate,
  links: readonly MemoryLink[],
): boolean {
  return links.some(link => {
    const endpoints = new Set([String(link.from), String(link.to)])
    return endpoints.has(left.id)
      && endpoints.has(right.id)
      && (link.relation === 'contradicts' || link.relation === 'supersedes' || link.state === 'contested')
  })
}

function mergeDuplicateCandidate(keeper: MemoryRecallCandidate, candidate: MemoryRecallCandidate): void {
  keeper.sources = [...new Set([...keeper.sources, ...candidate.sources])]
  keeper.linkIds = [...new Set([...keeper.linkIds, ...candidate.linkIds])]
  keeper.relatedMemoryIds = [...new Set([...keeper.relatedMemoryIds, ...candidate.relatedMemoryIds])]
    .filter(id => id !== keeper.id)
  keeper.reasons = [...new Set([...keeper.reasons, ...candidate.reasons, 'duplicate evidence merged'])]
  if (candidate.score.total > keeper.score.total) keeper.score = candidate.score
}

function collapseDuplicates(
  candidates: readonly MemoryRecallCandidate[],
  links: readonly MemoryLink[],
): { unique: MemoryRecallCandidate[]; suppressed: Array<{ id: string; reason: string; keptId?: string }> } {
  const groups = new Map<string, MemoryRecallCandidate[]>()
  for (const candidate of candidates) {
    const group = groups.get(candidate.duplicateKey) ?? []
    group.push(candidate)
    groups.set(candidate.duplicateKey, group)
  }
  const unique: MemoryRecallCandidate[] = []
  const suppressed: Array<{ id: string; reason: string; keptId?: string }> = []
  for (const group of groups.values()) {
    const keeper = duplicateRepresentative(group)
    if (group.some((candidate, index) =>
      group.slice(index + 1).some(other => candidatesConflict(candidate, other, links)))) {
      for (const candidate of group) {
        candidate.reasons = [...new Set([
          ...candidate.reasons,
          'duplicate retained because a typed conflict is present',
        ])]
        unique.push(candidate)
      }
      continue
    }
    unique.push(keeper)
    for (const candidate of group) {
      if (candidate.id === keeper.id) continue
      mergeDuplicateCandidate(keeper, candidate)
      suppressed.push({
        id: candidate.id,
        reason: 'duplicate content was subsumed by the more grounded representative',
        keptId: keeper.id,
      })
    }
  }
  return { unique, suppressed }
}

function relationBoost(
  candidate: MemoryRecallCandidate,
  selected: ReadonlySet<string>,
  links: readonly MemoryLink[],
): number {
  let boost = 0
  for (const link of links) {
    const touches = String(link.from) === candidate.id || String(link.to) === candidate.id
    if (!touches) continue
    const other = String(link.from) === candidate.id ? String(link.to) : String(link.from)
    if (!selected.has(other)) continue
    if (link.relation === 'contradicts' || link.relation === 'supersedes') boost = Math.max(boost, 0.24)
    else if (link.relation === 'supports' || link.relation === 'derives' || link.relation === 'feedback-for') {
      boost = Math.max(boost, 0.14)
    } else {
      boost = Math.max(boost, 0.08)
    }
  }
  return boost
}

function evaluateSelection(
  candidate: MemoryRecallCandidate,
  selected: ReadonlySet<string>,
  links: readonly MemoryLink[],
  field: CurrentField,
): MemoryRecallSelectionDecision {
  const priorityBoost = candidatePriorityBoost(candidate)
  const relation = relationBoost(candidate, selected, links)
  const anchor = field.activeMemoryCoalition.some(id => String(id) === candidate.id) ? 0.2
    : field.sceneId === candidate.id ? 0.18
    : 0
  const reasons: string[] = []
  if (priorityBoost > 0) reasons.push('grounding/form priority boost=' + priorityBoost.toFixed(2))
  if (relation > 0) reasons.push('coalition relation boost=' + relation.toFixed(2))
  if (anchor > 0) reasons.push('current field anchor boost=' + anchor.toFixed(2))
  return {
    id: candidate.id,
    rank: 0,
    baseScore: candidate.score.total,
    priorityBoost,
    relationBoost: relation,
    anchorBoost: anchor,
    finalValue: candidate.score.total + priorityBoost + relation + anchor,
    reasons,
  }
}

function selectCoalition(
  candidates: readonly MemoryRecallCandidate[],
  links: readonly MemoryLink[],
  field: CurrentField,
  budget: MemoryWorkspace['budget'],
): {
  selected: MemoryRecallCandidate[]
  usedTokens: number
  decisions: MemoryRecallSelectionDecision[]
  suppressed: Array<{ id: string; reason: string }>
} {
  const remaining = new Map(candidates.map(candidate => [candidate.id, candidate]))
  const selected: MemoryRecallCandidate[] = []
  const selectedIds = new Set<string>()
  const decisions: MemoryRecallSelectionDecision[] = []
  const suppressed: Array<{ id: string; reason: string }> = []
  const suppressedIds = new Set<string>()
  let usedTokens = 0
  while (remaining.size > 0 && selected.length < budget.maxItems) {
    let best: MemoryRecallCandidate | undefined
    let bestDecision: MemoryRecallSelectionDecision | undefined
    for (const candidate of remaining.values()) {
      const text = candidateText(candidate)
      const tokens = estimateTokens(text)
      if (usedTokens + tokens > budget.maxTokens) {
        if (!suppressedIds.has(candidate.id)) {
          suppressedIds.add(candidate.id)
          suppressed.push({ id: candidate.id, reason: 'candidate exceeds the hard token budget' })
        }
        continue
      }
      const decision = evaluateSelection(candidate, selectedIds, links, field)
      if (
        bestDecision === undefined
        || decision.finalValue > bestDecision.finalValue
        || (decision.finalValue === bestDecision.finalValue && candidate.id.localeCompare(best?.id ?? '') < 0)
      ) {
        best = candidate
        bestDecision = decision
      }
    }
    if (best === undefined || bestDecision === undefined) break
    remaining.delete(best.id)
    selected.push(best)
    selectedIds.add(best.id)
    usedTokens += estimateTokens(candidateText(best))
    decisions.push({ ...bestDecision, rank: decisions.length + 1 })
  }
  return { selected, usedTokens, decisions, suppressed }
}

function safeWorkspace(
  cycleId: string,
  state: MemoryMaterializedState,
  query: MemoryRecallQuery,
  budget: MemoryWorkspace['budget'],
  selected: readonly MemoryRecallCandidate[],
  allLinks: readonly MemoryLink[],
  field: CurrentField,
  decisions: readonly MemoryRecallSelectionDecision[],
): MemoryWorkspace {
  const decisionsById = new Map(decisions.map(decision => [decision.id, decision]))
  const items = selected.map(candidate => materializeWorkspaceItem(
    candidate,
    field,
    allLinks.filter(link => candidate.linkIds.includes(String(link.id))),
    decisionsById.get(candidate.id),
  ))
  const itemIds = new Set(items.map(item => item.id))
  const links = allLinks
    .filter(link => itemIds.has(String(link.from)) && itemIds.has(String(link.to)))
    .map(workspaceLink)
  for (const item of items) {
    if (item.kind !== 'indexed-evidence' || item.external?.reference === undefined) continue
    const referenced = item.external.reference.memoryId
    if (typeof referenced !== 'string' || !itemIds.has(referenced)) continue
    links.push({
      id: item.id + ':evidence-for:' + referenced,
      from: item.id,
      to: referenced,
      relation: 'evidence-for',
      strength: item.confidence,
      state: 'active',
      role: 'evidence',
    })
  }
  const uncertainty = [...new Set([
    ...field.uncertainty,
    ...items.flatMap(item => item.uncertainty),
  ])]
  const usedBudget = {
    ...budget,
    usedItems: items.length,
    usedTokens: selected.reduce((sum, candidate) => sum + estimateTokens(candidateText(candidate)), 0),
  }
  const unsigned = {
    schemaVersion: MEMORY_RECALL_SCHEMA_VERSION,
    cycleId,
    materializedVersion: state.version,
    currentField: field,
    query,
    budget: usedBudget,
    items,
    links,
    uncertainty,
  }
  return {
    ...unsigned,
    hash: hashModelInput(unsigned),
  }
}

export class MemoryRecallEngine {
  private readonly sources = new Map<string, MemoryRecallSource>()

  registerSource(source: MemoryRecallSource): () => void {
    if (source.id.trim() === '') throw new Error('memory recall source id must not be empty')
    this.sources.set(source.id, source)
    return () => {
      if (this.sources.get(source.id) === source) this.sources.delete(source.id)
    }
  }

  async recall(state: MemoryMaterializedState, input: MemoryRecallInput = {}): Promise<MemoryRecallResult> {
    const cycleId = input.cycleId?.trim() || 'recall-' + Date.now().toString(36)
    const query = normalizeQuery(input)
    const budget = normalizeBudget(input.budget)
    const recallGoalIds = query.goalIds?.length
      ? query.goalIds
      : state.currentField.goals
    const activeGoalIds = new Set(recallGoalIds.map(id => String(id)))
    const at = state.currentField.version === 0 ? undefined : state.currentField.updatedAt
    const currentScene = state.currentField.sceneId === undefined
      ? undefined
      : state.memories.find(memory => String(memory.id) === String(state.currentField.sceneId) && memory.form === 'scene') as Extract<RinMemory, { form: 'scene' }> | undefined
    const anchors = currentAnchors(state.currentField, query, state.memories, at, currentScene)
    const candidateMap: CandidateMap = new Map()
    const neighborhood = linkNeighborhood(state, anchors, boundedInt(input.budget?.linkDepth, DEFAULT_LINK_DEPTH, 0, 4), at, query.mode)
    for (const memory of state.memories) {
      if (!isRecallable(memory, query.mode, at, currentScene)) continue
      const id = String(memory.id)
      const narrativeTerms = terms(memoryNarrative(memory))
      const queryTerms = terms(query.text ?? '')
      const contextIds = memoryContextIds(memory)
      const participantFit = overlap(contextIds.participantIds, query.participantIds ?? [])
      const goalFit = overlap(contextIds.goalIds, query.goalIds ?? [])
      const sources: MemoryRecallSourceKind[] = []
      const reasons: string[] = []
      if (anchors.has(id)) {
        sources.push('current-field')
        reasons.push('current field anchor')
      }
      if (queryTerms.length > 0 && overlap(queryTerms, narrativeTerms) > 0) {
        sources.push('lexical')
        reasons.push('lexical cue fit')
      }
      if (neighborhood.ids.has(id) && !anchors.has(id)) {
        sources.push('typed-link')
        reasons.push('typed link neighborhood')
      }
      if (
        memory.dynamics.activation > 0.35
        || memory.dynamics.salience > 0.35
        || memory.dynamics.surprise > 0.35
        || memory.form === 'open-loop'
        || memory.form === 'prospect'
      ) {
        sources.push('dynamics')
        reasons.push('dynamic pressure')
      }
      if (participantFit > 0 || goalFit > 0) {
        sources.push('contextual')
        reasons.push('participant/goal context fit')
      }
      const signal = behaviorSignal(state, id)
      const loopSignal = openLoopPressureSignal(state, id, at, query.mode)
      if (loopSignal.pressure > 0) {
        sources.push('dynamics')
        reasons.push(...loopSignal.reasons)
      }
      if (signal.relevance > 0) {
        sources.push('behavior')
        reasons.push(...signal.reasons)
      }
      if (sources.length === 0) continue
      const nearby = linksForMemory([...neighborhood.links.values()], id)
      const utilityGoalIds = recallUtilityGoalIds(memory, state.currentField, activeGoalIds)
      addMemoryCandidate(
        candidateMap,
        memory,
        scoreMemory(memory, query, nearby, anchors, signal, loopSignal.pressure, utilityGoalIds, at, currentScene),
        sources,
        nearby,
        reasons,
      )
    }
    const sourceRecords: MemoryRecallTrace['sources'] = []
    const internalCandidates = [...candidateMap.values()]
    const internalKinds: MemoryRecallSourceKind[] = ['current-field', 'lexical', 'typed-link', 'dynamics', 'contextual', 'behavior']
    for (const kind of internalKinds) {
      sourceRecords.push({
        id: 'rin:' + kind,
        kind,
        candidateIds: internalCandidates
          .filter(candidate => candidate.sources.includes(kind))
          .map(candidate => candidate.id),
      })
    }
    for (const source of this.sources.values()) {
      try {
        const externalCandidates = await source.query({ query, state })
        const ids: string[] = []
        for (const external of externalCandidates) {
          const normalized = safeExternal(external, source.kind)
          if (normalized === undefined) continue
          addExternalCandidate(candidateMap, normalized, query, source.kind)
          ids.push(normalized.id)
        }
        sourceRecords.push({ id: source.id, kind: source.kind, candidateIds: [...new Set(ids)] })
      } catch (error: unknown) {
        sourceRecords.push({
          id: source.id,
          kind: source.kind,
          candidateIds: [],
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    const allCandidates = [...candidateMap.values()].sort((left, right) =>
      candidatePriority(right) - candidatePriority(left) || left.id.localeCompare(right.id))
    const coalitionLinks = state.links.filter(link =>
      isCurrentVersionLink(link, state.memories)
      && (query.mode === 'history' || at === undefined || isMemoryValidityActiveAt(link.validity, at)),
    )
    const collapsed = collapseDuplicates(allCandidates, coalitionLinks)
    const selection = selectCoalition(
      collapsed.unique,
      coalitionLinks,
      state.currentField,
      budget,
    )
    const workspace = safeWorkspace(
      cycleId,
      state,
      query,
      budget,
      selection.selected,
      coalitionLinks,
      state.currentField,
      selection.decisions,
    )
    const trace: MemoryRecallTrace = {
      schemaVersion: MEMORY_RECALL_SCHEMA_VERSION,
      cycleId,
      materializedVersion: state.version,
      query,
      budget: workspace.budget,
      sources: sourceRecords,
      candidates: allCandidates,
      suppressed: [...collapsed.suppressed, ...selection.suppressed],
      selectedIds: selection.selected.map(candidate => candidate.id),
      selection: selection.decisions,
    }
    return { workspace, trace }
  }
}
function actionChoiceScore(workspace: MemoryWorkspace, choice: MemoryActionChoice): number {
  const sourceIds = new Set(choice.sourceMemoryIds.map(id => String(id)))
  const fieldScores = (workspace.currentField.candidateActionSources ?? [])
    .filter(source => source.sourceMemoryIds.some(id => sourceIds.has(String(id))))
    .map(source => source.selectionValue)
  if (fieldScores.length > 0) return Math.max(...fieldScores)
  const matched = workspace.items.filter(item => sourceIds.has(String(item.id)))
  return matched.length === 0 ? 0 : Math.max(...matched.map(item =>
    item.score - 0.65 * item.scoreBreakdown.inhibition - 0.15 * item.scoreBreakdown.contradictionCost))
}

function actionChoiceIsRepresented(workspace: MemoryWorkspace, choice: MemoryActionChoice): boolean {
  const sourceIds = new Set(choice.sourceMemoryIds.map(id => String(id)))
  return (workspace.currentField.candidateActionSources ?? []).some(source =>
    source.sourceMemoryIds.some(id => sourceIds.has(String(id))))
    || workspace.items.some(item => sourceIds.has(String(item.id)))
}

function rankActionChoices(
  workspace: MemoryWorkspace,
  choices: readonly MemoryActionChoice[],
): { choice: MemoryActionChoice; score: number; represented: boolean }[] {
  return choices
    .map(choice => ({
      choice,
      score: actionChoiceScore(workspace, choice),
      represented: actionChoiceIsRepresented(workspace, choice),
    }))
    .sort((left, right) => right.score - left.score || left.choice.id.localeCompare(right.choice.id))
}

function recallScoreChanged(
  before: MemoryRecallScore,
  after: MemoryRecallScore,
): boolean {
  return (Object.keys(after) as Array<keyof MemoryRecallScore>).some(key =>
    Math.abs(after[key] - before[key]) > 0.000001,
  )
}

/**
 * Evaluates whether a behavior-linked recall change alters the next action choice.
 *
 * The evaluator consumes only two persisted recall workspaces and an explicit
 * choice set. It does not infer a reward or mutate cognition state.
 */
export function evaluateRecallBehavior(input: {
  before: MemoryRecallResult
  after: MemoryRecallResult
  choices: readonly MemoryActionChoice[]
}): MemoryRecallBehaviorEvaluation {
  if (input.choices.length < 2) throw new Error('recall behavior evaluation requires at least two action choices')
  const choiceIds = new Set<string>()
  for (const choice of input.choices) {
    if (choice.id.trim() === '' || choice.description.trim() === '') {
      throw new Error('recall behavior evaluation choices require non-empty ids and descriptions')
    }
    if (choiceIds.has(choice.id)) throw new Error('recall behavior evaluation choices must have unique ids')
    choiceIds.add(choice.id)
    if (choice.sourceMemoryIds.length === 0) {
      throw new Error('recall behavior evaluation choices require source memory ids')
    }
  }
  const beforeRanking = rankActionChoices(input.before.workspace, input.choices)
  const afterRanking = rankActionChoices(input.after.workspace, input.choices)
  const beforeTop = beforeRanking[0]
  const afterTop = afterRanking[0]
  if (beforeTop === undefined || afterTop === undefined) throw new Error('recall behavior evaluation could not rank choices')
  const beforeScores: Record<string, number> = {}
  const afterScores: Record<string, number> = {}
  for (const entry of beforeRanking) beforeScores[entry.choice.id] = entry.score
  for (const entry of afterRanking) afterScores[entry.choice.id] = entry.score
  const beforeSelected = input.before.trace.selectedIds.join('\u0000')
  const afterSelected = input.after.trace.selectedIds.join('\u0000')
  const scoreShift = input.choices.some(choice =>
    Math.abs((beforeScores[choice.id] ?? 0) - (afterScores[choice.id] ?? 0)) > 0.000001,
  )
  const beforeCandidates = new Map(input.before.trace.candidates.map(candidate => [candidate.id, candidate]))
  const afterCandidates = new Map(input.after.trace.candidates.map(candidate => [candidate.id, candidate]))
  const behaviorAffectedMemoryIds = [...new Set([...beforeCandidates.keys(), ...afterCandidates.keys()]
    .filter(id => {
      const before = beforeCandidates.get(id)
      const after = afterCandidates.get(id)
      const beforeBehavior = before?.sources.includes('behavior') ?? false
      const afterBehavior = after?.sources.includes('behavior') ?? false
      if (!beforeBehavior && !afterBehavior) return false
      if (before === undefined || after === undefined) return true
      return beforeBehavior !== afterBehavior || recallScoreChanged(before.score, after.score)
    }))].sort()
  const recallChanged = beforeSelected !== afterSelected || scoreShift
  const choiceChanged = beforeTop.choice.id !== afterTop.choice.id
  const beforeChoiceAvailable = beforeTop.represented
  const afterChoiceAvailable = afterTop.represented
  const reasons = [
    ...(behaviorAffectedMemoryIds.length === 0 ? [] : ['behavior-linked recall candidates changed the choice field']),
    ...(beforeSelected !== afterSelected ? ['selected recall coalition changed between cycles'] : []),
    ...(scoreShift ? ['one or more action-choice scores changed between cycles'] : []),
    ...(choiceChanged ? ['top-ranked action choice changed'] : ['top-ranked action choice did not change']),
    ...(beforeChoiceAvailable ? ['before top-ranked action choice is represented in the recall workspace'] : ['before top-ranked action choice has no recall workspace source']),
    ...(afterChoiceAvailable ? ['after top-ranked action choice is represented in the recall workspace'] : ['after top-ranked action choice has no recall workspace source']),
  ]
  return Object.freeze({
    beforeChoiceId: beforeTop.choice.id,
    afterChoiceId: afterTop.choice.id,
    beforeChoiceAvailable,
    afterChoiceAvailable,
    beforeChoiceScores: Object.freeze(beforeScores),
    afterChoiceScores: Object.freeze(afterScores),
    behaviorAffectedMemoryIds: Object.freeze(behaviorAffectedMemoryIds),
    recallChanged,
    choiceChanged,
    passed: behaviorAffectedMemoryIds.length > 0 && recallChanged && choiceChanged && beforeChoiceAvailable && afterChoiceAvailable,
    reasons: Object.freeze(reasons),
  })
}


function behaviorChoiceForAction(
  action: MemoryActionRecord,
  choices: readonly MemoryActionChoice[],
): { choice: MemoryActionChoice; sourceBound: boolean } | undefined {
  const actionText = normalizeText(action.description)
  const textMatches = choices.filter(choice => {
    const choiceText = normalizeText(choice.description)
    return choiceText !== ''
      && (actionText === choiceText || actionText.includes(choiceText) || choiceText.includes(actionText))
  })
  const sourceMatches = choices.filter(choice =>
    choice.sourceMemoryIds.some(sourceId =>
      action.sourceMemoryIds.some(actionSourceId => String(actionSourceId) === String(sourceId)),
    ),
  )
  const matches = textMatches.length > 0 ? textMatches : sourceMatches
  if (matches.length !== 1) return undefined
  const choice = matches[0]
  if (choice === undefined) return undefined
  return {
    choice,
    sourceBound: choice.sourceMemoryIds.some(sourceId =>
      action.sourceMemoryIds.some(actionSourceId => String(actionSourceId) === String(sourceId)),
    ),
  }
}

/**
 * Evaluates a persisted recall transition against the behavior records that
 * sit between the two recall workspaces.
 *
 * The pure workspace evaluator is useful for controlled comparisons. This
 * stronger evaluator additionally requires a real model-input binding,
 * action-selection use, action result, and feedback chain. It never mutates
 * cognition state and never infers a reward.
 */
export function evaluateRecordedRecallBehavior(input: {
  before: MemoryRecallRecord
  after: MemoryRecallRecord
  choices: readonly MemoryActionChoice[]
  action: MemoryActionRecord
  outcomes: readonly MemoryOutcomeRecord[]
  feedback: readonly MemoryFeedbackVector[]
  modelInputs: readonly MemoryModelInputRecord[]
  actionSelectionUses: readonly MemoryUseTrace[]
  actionPhase?: 'before' | 'after'
}): MemoryRecordedRecallBehaviorEvaluation {
  const actionPhase = input.actionPhase ?? 'before'
  if (input.before.cycleId === input.after.cycleId) {
    throw new Error('recorded recall behavior evaluation requires distinct recall cycles')
  }
  const expectedCycleId = actionPhase === 'before' ? input.before.cycleId : input.after.cycleId
  if (String(input.action.cycleId) !== expectedCycleId) {
    throw new Error('recorded recall behavior evaluation action is not in the selected recall phase')
  }
  const expectedWorkspaceHash = actionPhase === 'before'
    ? input.before.workspace.hash
    : input.after.workspace.hash
  const modelInputBound = input.modelInputs.some(record =>
    record.cycleId === expectedCycleId
      && record.workspaceHash === expectedWorkspaceHash
      && record.workspaceHash === input.action.workspaceHash,
  )
  const outcomeIds = input.outcomes
    .filter(outcome => String(outcome.actionId) === String(input.action.id))
    .map(outcome => String(outcome.id))
  const knownOutcomeIds = new Set(outcomeIds)
  const feedbackIds = input.feedback
    .filter(vector =>
      (vector.actionId !== undefined && String(vector.actionId) === String(input.action.id))
      || (vector.outcomeId !== undefined && knownOutcomeIds.has(String(vector.outcomeId))),
    )
    .map(vector => String(vector.id))
  const matched = behaviorChoiceForAction(input.action, input.choices)
  const actionSelectionUseIds = input.actionSelectionUses
    .filter(use =>
      use.surface === 'action-selection'
      && use.cycleId === expectedCycleId
      && input.action.sourceMemoryIds.some(id => String(id) === String(use.memoryId))
      && (matched === undefined
        || matched.choice.sourceMemoryIds.some(id => String(id) === String(use.memoryId))),
    )
    .map(use => use.id)
  const recall = evaluateRecallBehavior({
    before: input.before,
    after: input.after,
    choices: input.choices,
  })
  const materializationAdvanced = input.after.workspace.materializedVersion > input.before.workspace.materializedVersion
  const executedChoiceId = matched?.choice.id
  const expectedChoiceId = actionPhase === 'before' ? recall.beforeChoiceId : recall.afterChoiceId
  const actionMatchesChoice = executedChoiceId !== undefined && executedChoiceId === expectedChoiceId
  const chainComplete = outcomeIds.length > 0 && feedbackIds.length > 0
  const actionSourceBound = matched?.sourceBound ?? false
  const passed = recall.passed
    && modelInputBound
    && materializationAdvanced
    && actionMatchesChoice
    && actionSourceBound
    && actionSelectionUseIds.length > 0
    && chainComplete
  const reasons = [
    ...recall.reasons,
    ...(modelInputBound ? ['action was bound to the selected recall workspace through model input'] : ['action has no model-input binding for the selected recall workspace']),
    ...(materializationAdvanced ? ['the after recall observes a later materialized cognition version'] : ['before and after recall use the same or an older materialized cognition version']),
    ...(actionMatchesChoice ? ['persisted action matches the phase top-ranked choice'] : ['persisted action does not match the phase top-ranked choice']),
    ...(actionSourceBound ? ['persisted action source overlaps the selected choice source'] : ['persisted action source is not bound to a selected choice source']),
    ...(actionSelectionUseIds.length === 0 ? ['no persisted action-selection use was found for the selected source'] : ['persisted action-selection use is present']),
    ...(outcomeIds.length === 0 ? ['no persisted outcome is linked to the action'] : ['persisted outcome is linked to the action']),
    ...(feedbackIds.length === 0 ? ['no persisted feedback is linked to the action or its outcome'] : ['persisted feedback is linked to the action chain']),
  ]
  return Object.freeze({
    beforeCycleId: input.before.cycleId,
    afterCycleId: input.after.cycleId,
    actionId: String(input.action.id),
    actionPhase,
    ...(executedChoiceId === undefined ? {} : { executedChoiceId }),
    actionSourceBound,
    modelInputBound,
    materializationAdvanced,
    actionSelectionUseIds: Object.freeze(actionSelectionUseIds),
    outcomeIds: Object.freeze(outcomeIds),
    feedbackIds: Object.freeze(feedbackIds),
    chainComplete,
    recall,
    passed,
    reasons: Object.freeze(reasons),
  })
}

function stableValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') return undefined
  if (Array.isArray(value)) {
    return value.map(item => stableValue(item)).filter(item => item !== undefined)
  }
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (key === 'signal') continue
      const child = stableValue((value as Record<string, unknown>)[key])
      if (child !== undefined) output[key] = child
    }
    return output
  }
  return undefined
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return value
}

export function snapshotModelInput(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const snapshot = stableValue(value)
  const object = snapshot !== null && typeof snapshot === 'object' && !Array.isArray(snapshot)
    ? snapshot as Record<string, unknown>
    : {}
  return deepFreeze(object)
}

export function hashModelInput(value: unknown): string {
  const stable = stableValue(value)
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex')
}

function toMemoryCurrentFieldDto(field: CurrentField): MemoryCurrentField {
  return {
    ownerId: field.ownerId,
    version: field.version,
    updatedAt: field.updatedAt,
    ...(field.sceneId === undefined ? {} : { sceneId: String(field.sceneId) }),
    ...(field.sceneVersion === undefined ? {} : { sceneVersion: field.sceneVersion }),
    ...(field.sceneStatus === undefined ? {} : { sceneStatus: field.sceneStatus }),
    participants: field.participants.map(String),
    goals: field.goals.map(String),
    affect: { ...field.affect },
    predictions: field.predictions.map(String),
    predictionErrors: field.predictionErrors.map(error => ({ ...error })),
    activeOpenLoops: field.activeOpenLoops.map(String),
    candidateActions: [...field.candidateActions],
    ...(field.candidateActionSources === undefined ? {} : {
      candidateActionSources: field.candidateActionSources.map(source => ({
        action: source.action,
        sourceMemoryIds: source.sourceMemoryIds.map(String),
        utility: source.utility,
        inhibition: source.inhibition,
        selectionValue: source.selectionValue,
        reasons: [...source.reasons],
      })),
    }),
    activeMemoryCoalition: field.activeMemoryCoalition.map(String),
    uncertainty: [...field.uncertainty],
  }
}
export function toMemoryWorkspaceDto(workspace: MemoryWorkspace): MemoryWorkspaceDto {
  return {
    schemaVersion: MEMORY_WORKSPACE_CONTRACT_VERSION,
    cycleId: workspace.cycleId,
    materializedVersion: workspace.materializedVersion,
    currentField: toMemoryCurrentFieldDto(workspace.currentField),
    query: { ...workspace.query },
    budget: { ...workspace.budget },
    items: workspace.items.map(item => ({
      id: item.id,
      kind: item.kind,
      role: item.role,
      content: item.memory === undefined
        ? item.external?.content ?? ''
        : memoryNarrative(item.memory),
      ...(item.memory === undefined ? {} : { memoryId: String(item.memory.id) }),
      epistemic: item.epistemic,
      influence: item.influence,
      uncertainty: [...item.uncertainty],
      confidence: item.confidence,
      score: item.score,
      scoreBreakdown: item.scoreBreakdown,
      selectionReasons: [...item.selectionReasons],
      ...(item.external?.reference === undefined ? {} : { reference: item.external.reference }),
    })),
    links: workspace.links.map(link => ({
      id: link.id,
      from: link.from,
      to: link.to,
      relation: link.relation,
      strength: link.strength,
      state: link.state,
      role: link.role,
    })),
    uncertainty: [...workspace.uncertainty],
    hash: workspace.hash,
  }
}
function formatScore(score: MemoryRecallScore): string {
  return [
    'cue=' + score.cueFit.toFixed(2),
    'context=' + score.contextualFit.toFixed(2),
    'access=' + score.accessibility.toFixed(2),
    'salience=' + score.salience.toFixed(2),
    'utility=' + score.utility.toFixed(2),
    'loop=' + score.openLoopPressure.toFixed(2),
    'relation=' + score.relationRelevance.toFixed(2),
    'prediction=' + score.predictionRelevance.toFixed(2),
    'inhibit=' + score.inhibition.toFixed(2),
    'conflict=' + score.contradictionCost.toFixed(2),
    'uncertainty=' + score.uncertaintyPenalty.toFixed(2),
    'invalid=' + score.invalidityPenalty.toFixed(2),
    'total=' + score.total.toFixed(3),
  ].join(', ')
}
function renderWorkspaceCurrentField(
  field: CurrentField | undefined,
  itemIds: ReadonlySet<string>,
): string[] {
  if (field === undefined || field.sceneId === undefined || !itemIds.has(String(field.sceneId))) return []
  return [
    'current field:',
    '  scene: ' + String(field.sceneId) + ' (' + (field.sceneStatus ?? 'unknown') + ')',
    '  participants: ' + field.participants.join('; '),
    '  goals: ' + field.goals.join('; '),
    '  affect: valence=' + field.affect.valence.toFixed(2) + ', arousal=' + field.affect.arousal.toFixed(2) + ', control=' + field.affect.control.toFixed(2),
    '  predictions: ' + field.predictions.filter(id => itemIds.has(String(id))).join('; '),
    '  active open loops: ' + field.activeOpenLoops.filter(id => itemIds.has(String(id))).join('; '),
    '  candidate actions: ' + field.candidateActions.join('; '),
  ]
}

export function renderMemoryWorkspace(workspace: MemoryWorkspace, maxChars = 24_000): string {
  const currentFieldLines = renderWorkspaceCurrentField(
    workspace.currentField,
    new Set(workspace.items.map(item => item.id)),
  )
  if (workspace.items.length === 0 && workspace.uncertainty.length === 0 && currentFieldLines.length === 0) return ''
  const lines: string[] = [
    'Rin memory workspace cycle=' + workspace.cycleId
      + ' version=' + workspace.materializedVersion
      + ' items=' + workspace.budget.usedItems + '/' + workspace.budget.maxItems
      + ' tokens=' + workspace.budget.usedTokens + '/' + workspace.budget.maxTokens,
  ]
  if (workspace.uncertainty.length > 0) {
    lines.push('workspace uncertainty: ' + workspace.uncertainty.join('; '))
  }
  lines.push(...currentFieldLines)
  for (const item of workspace.items) {
    const content = item.memory === undefined
      ? item.external?.content ?? ''
      : memoryNarrative(item.memory)
    lines.push(
      '[' + item.role + '] ' + item.id
        + ' epistemic=' + item.epistemic
        + ' influence=' + item.influence
        + ' confidence=' + item.confidence.toFixed(2)
        + ' score=' + item.score.toFixed(3),
    )
    lines.push('  ' + content)
    lines.push('  score: ' + formatScore(item.scoreBreakdown))
    if (item.uncertainty.length > 0) lines.push('  uncertainty: ' + item.uncertainty.join('; '))
    if (item.selectionReasons.length > 0) lines.push('  selected because: ' + item.selectionReasons.join('; '))
  }
  if (workspace.links.length > 0) {
    lines.push('typed relations:')
    for (const link of workspace.links) {
      lines.push(
        '  ' + link.from + ' -[' + link.relation + '/' + link.role + '/' + link.state + ']-> ' + link.to,
      )
    }
  }
  const text = lines.join('\n')
  return text.length <= maxChars ? text : text.slice(0, Math.max(0, maxChars - 3)) + '...'
}
