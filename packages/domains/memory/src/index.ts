/**
 * rin memory — canonical local memory catalog and injection audit.
 *
 * Notes, Knowledge, Session Search, and prompt-memory remain independent
 * projections. This service owns stable memory identity, lifecycle, provenance
 * references, and the record of model-visible memory versions.
 *
 * @module @rin/memory
 */
import { randomUUID } from 'node:crypto'

import { Context, Service } from '@deepseek-ai/cordis'
import { buildMemoryManifest, normalizeMemoryStorage, writeMemoryManifestSync } from './manifest.ts'
import { assertMemoryInfluenceDependencies, MemoryCognitionDatabase, MemoryMaterializer, computeEraseScope } from './store.ts'
import type { MemoryEraseAuthorization, MemoryErasePreview, MemoryMaterializedState } from './store.ts'
import { evaluateRecordedRecallBehavior, MemoryRecallEngine, hashModelInput, snapshotModelInput } from './recall.ts'
import {
  RuntimeCognitionIngestor,
  isRuntimeSessionEvent,
  mapRuntimeBehaviorFact,
  mapRuntimeSessionEvent,
  selectCandidateActionSources,
  type RuntimeMemoryFact,
  type RuntimeSceneHint,
  type RuntimeSessionEvent,
} from './runtime.ts'
import {
  createBackgroundActor,
  createMemoryCommandId,
  createMemoryCorrelationId,
  createMemoryEventId,
  createMemoryTransactionId,
  createMemoryConsolidationTransaction,
  createMemoryDecayTransaction,
  createMemoryUseTransaction,
  createMemoryPredictionTransaction,
  createMemoryActionTransaction,
  createMemoryOutcomeTransaction,
  createMemoryInfluencePermissionTransaction,
  createMemoryInfluenceRestrictionTransaction,
  createMemoryInfluenceRevocationTransaction,
  createMemoryCorrectionTransaction,
  createMemoryEraseAuthorizationTransaction,
  createMemoryEraseCommitTransaction,
  createMemoryAuthorizationId,
  createMemoryFeedbackTransaction,
  createMemoryBehaviorTransaction,
  createMemoryDispositionLearningTransaction,
  createModelActor,
  createModelProposalTransaction,
  createMemoryRepresentationFormationTransaction,
  createOwnerActor,
  createRuntimeActor,
  type MemoryCandidate,
  type MemoryBehaviorBatch,
  type MemoryAuthorizationId,
  type MemoryEvent,
  type MemoryTransaction,
} from './events.ts'
import { createMemory, isMemoryValidityActiveAt, transitionMemory } from './model.ts'
import type {
  CurrentField,
  MemoryActionRecord,
  MemoryDraft,
  MemoryFeedbackVector,
  MemoryForm,
  MemoryOutcomeRecord,
  EvidenceId,
  MemoryPredictionRecord,
  MemoryInfluenceSurface,
  MemoryId,
} from './model.ts'
import { consolidateMemory, deriveMemoryRepresentationCandidates, formMemoryRepresentation, formMemoryRepresentations, learnDispositionFromFeedback, planConsolidationSchedule } from './consolidation.ts'
import type {
  MemoryConsolidationDecision,
  MemoryConsolidationResult,
  MemoryConsolidationSchedule,
  MemoryDecayResult,
  MemoryDispositionLearningResult,
  MemoryFormationCandidateInput,
  MemoryRepresentationFormationCandidate,
  MemoryUsePurpose,
  MemoryUseSurface,
  MemoryUseTrace,
} from './consolidation.ts'
import type {
  MemoryModelInputRecord,
  MemoryModelInputRecordInput,
  MemoryRecallRecord,
  MemoryPersistedRecallBehaviorInput,
  MemoryRecallInput,
  MemoryRecallResult,
  MemoryRecallSource,
  MemoryRecordedRecallBehaviorEvaluation,
} from './recall.ts'
import type {
  MemoryManifest,
  MemoryProjection,
  MemoryProjectionCheckpoint,
} from './types.ts'

export * from './types.ts'
export * from './model.ts'
export * from './events.ts'
export * from './runtime.ts'
export * from './consolidation.ts'
export * from './recall.ts'
export { buildMemoryManifest, normalizeMemoryStorage, readMemoryManifest, writeMemoryManifestSync } from './manifest.ts'
export {
  MemoryCognitionDatabase,
  MemoryMaterializer,
  createEmptyMaterializedState,
  hashMaterializedState,
  queryMaterializedLinks,
} from './store.ts'
export type {
  MemoryCommitFaultContext,
  MemoryCommitFaultInjector,
  MemoryCommitFaultStage,
  MemoryEraseAuthorization,
  MemoryMaterializedState,
  MemoryLinkQuery,
} from './store.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    memory: MemoryStore
  }
}

export interface MemoryPluginConfig {
  dbPath: string
  manifestPath: string
  homeRoot: string
  sessionRoot?: string
  settingsPath?: string
  credentialsPath?: string
  archiveRoot?: string
  /**
   * Optional explicit identity/goal context for runtime scenes. If omitted,
   * runtime scenes remain session/scene scoped and are not promoted to a
   * cross-session identity.
   */
  runtimeSceneDefaults?: Pick<RuntimeSceneHint, 'participants' | 'goals'>
}

export type MemoryRepresentationProposalInput = Readonly<{
  candidate: Omit<MemoryCandidate, 'kind'>
  sourceSceneIds: readonly MemoryId[]
  independentEvidenceIds?: readonly string[]
  at?: string
}>

export type MemoryRepresentationFormationCommitInput = Readonly<{
  memoryId: MemoryId
  previousVersion: string
  sourceSceneIds: readonly MemoryId[]
  evidenceIds: readonly EvidenceId[]
  independentEvidenceIds?: readonly EvidenceId[]
  explanation: string
  at?: string
}>

export type MemoryInfluencePermissionInput = Readonly<{
  memoryId: MemoryId
  previousVersion: string
  surfaces: readonly MemoryInfluenceSurface[]
  reason: string
  ownerId: string
  at?: string
}>

/** Owner intent that revises one representation's content in place. */
export type MemoryCorrectionInput = Readonly<{
  memoryId: MemoryId
  replacement: Readonly<{ form: MemoryForm['form']; data: Record<string, unknown> }>
  evidenceIds?: readonly EvidenceId[]
  explanation: string
  ownerId: string
  at?: string
}>

/** Owner intent that limits one representation's behavioral influence to the named surfaces. */
export type MemoryInfluenceRestrictionInput = Readonly<{
  memoryId: MemoryId
  surfaces: readonly MemoryInfluenceSurface[]
  reason: string
  ownerId: string
  at?: string
}>

/** Owner intent that permanently blocks one representation's behavioral influence. */
export type MemoryInfluenceRevocationInput = Readonly<{
  memoryId: MemoryId
  reason: string
  ownerId: string
  at?: string
}>

/** Owner intent that binds one erase scope, its computed preview hash, and an expiry. */
export type MemoryEraseAuthorizeInput = Readonly<{
  rootMemoryIds: readonly MemoryId[]
  ownerId: string
  ttlMinutes?: number
  at?: string
}>

export type MemoryEraseAuthorizationResult = Readonly<{
  authorization: MemoryEraseAuthorization
  preview: MemoryErasePreview
  transaction: MemoryTransaction
}>

/** Owner intent that atomically consumes one erase authorization. */
export type MemoryEraseCommitInput = Readonly<{
  authorizationId: MemoryAuthorizationId
  ownerId: string
  at?: string
}>

export type MemoryEraseCommitResult = Readonly<{
  transaction: MemoryTransaction
  erasedMemoryIds: readonly MemoryId[]
}>

/** A model-output event that explicitly consumed relationship-aware memory. */
export type MemoryRelationshipExpressionInput = Readonly<{
  expressionId: string
  cycleId: string
  workspaceHash: string
  memoryIds: readonly MemoryId[]
  usedAt: string
}>

export type MemoryCognitionMaintenanceResult = Readonly<{
  at: string
  dispositionLearning: readonly MemoryDispositionLearningResult[]
  representationFormation: readonly MemoryRepresentationFormationCandidate[]
  consolidation: MemoryConsolidationSchedule
}>

export abstract class MemoryStore extends Service {
  constructor(ctx: Context) {
    super(ctx, 'memory')
  }

  abstract recall(input?: MemoryRecallInput): Promise<MemoryRecallResult>
  abstract registerRecallSource(source: MemoryRecallSource): () => void
  abstract setRecallCue(sessionId: string, text: string): void
  abstract recordModelInput(input: MemoryModelInputRecordInput): MemoryModelInputRecord
  abstract listModelInputs(cycleId?: string, limit?: number): MemoryModelInputRecord[]
  abstract recordMemoryUse(use: MemoryUseTrace): MemoryTransaction
  abstract recordRelationshipExpression(input: MemoryRelationshipExpressionInput): readonly MemoryTransaction[]
  abstract recordPrediction(prediction: MemoryPredictionRecord): MemoryTransaction
  abstract recordAction(action: MemoryActionRecord): MemoryTransaction
  abstract recordOutcome(outcome: MemoryOutcomeRecord): MemoryTransaction
  abstract recordFeedback(feedback: MemoryFeedbackVector): MemoryTransaction
  abstract recordBehavior(batch: MemoryBehaviorBatch): MemoryTransaction
  abstract planRepresentationFormation(
    candidates: readonly MemoryFormationCandidateInput[],
    at?: string,
  ): readonly MemoryRepresentationFormationCandidate[]
  abstract deriveRepresentationFormation(at?: string): readonly MemoryRepresentationFormationCandidate[]
  abstract proposeRepresentationFormation(input: MemoryRepresentationProposalInput): MemoryRepresentationProposalResult
  abstract commitRepresentationFormation(input: MemoryRepresentationFormationCommitInput): MemoryTransaction
  abstract recordModelProposal(candidate: Omit<MemoryCandidate, 'kind'>): MemoryTransaction
  abstract permitInfluence(input: MemoryInfluencePermissionInput): MemoryTransaction
  abstract correctUnderstanding(input: MemoryCorrectionInput): MemoryTransaction
  abstract restrictInfluence(input: MemoryInfluenceRestrictionInput): MemoryTransaction
  abstract revokeInfluence(input: MemoryInfluenceRevocationInput): MemoryTransaction
  abstract requestErasePreview(rootMemoryIds: readonly MemoryId[]): MemoryErasePreview
  abstract authorizeErase(input: MemoryEraseAuthorizeInput): MemoryEraseAuthorizationResult
  abstract commitAuthorizedErase(input: MemoryEraseCommitInput): MemoryEraseCommitResult
  abstract planDispositionLearning(dispositionId: MemoryId, actionId: string, at?: string, explanation?: string): MemoryDispositionLearningResult
  abstract commitDispositionLearning(result: MemoryDispositionLearningResult): MemoryTransaction
  abstract runBackgroundMaintenance(at?: string): readonly MemoryDispositionLearningResult[]
  abstract runCognitionMaintenance(at?: string, maxConsolidationItems?: number): MemoryCognitionMaintenanceResult
  abstract planConsolidation(at?: string, maxItems?: number): MemoryConsolidationSchedule
  abstract listMemoryUseTraces(memoryId?: MemoryId, cycleId?: string, limit?: number): MemoryUseTrace[]
  abstract commitConsolidationDecision(
    schedule: MemoryConsolidationSchedule,
    decision: MemoryConsolidationDecision,
  ): MemoryTransaction
  abstract commitConsolidation(result: MemoryConsolidationResult): MemoryTransaction
  abstract commitDecay(result: MemoryDecayResult): MemoryTransaction
  abstract getRecallRecord(cycleId: string): MemoryRecallRecord | undefined
  abstract listRecallRecords(limit?: number): MemoryRecallRecord[]
  abstract evaluatePersistedRecallBehavior(
    input: MemoryPersistedRecallBehaviorInput,
  ): MemoryRecordedRecallBehaviorEvaluation
  abstract getManifest(): MemoryManifest
  abstract prepareForArchive(): void
  abstract getCurrentField(): CurrentField
  abstract readCognitionState(): MemoryMaterializedState
  abstract getProjectionCheckpoint(projection: MemoryProjection): MemoryProjectionCheckpoint
  abstract requireProjectionReady(projection: MemoryProjection): MemoryProjectionCheckpoint
  abstract markProjectionDirty(projection: MemoryProjection): MemoryProjectionCheckpoint
  abstract markProjectionCleanAtCurrent(
    projection: MemoryProjection,
    materializedVersion: number,
    stateHash: string,
    updatedAt?: string,
  ): MemoryProjectionCheckpoint
  abstract exportCognitionJournal(): readonly MemoryTransaction[]
  abstract restoreCognitionJournal(transactions: readonly MemoryTransaction[]): number
  abstract ingestRuntimeEvent(sessionId: string, event: RuntimeSessionEvent, hint?: RuntimeSceneHint): MemoryTransaction | null
}

export type MemoryRepresentationProposalResult = Readonly<{
  formation: MemoryRepresentationFormationCandidate
  transaction: MemoryTransaction
}>

export class FileMemoryStore extends MemoryStore {
  private readonly cognitionDatabase: MemoryCognitionDatabase
  private readonly runtimeIngestor: RuntimeCognitionIngestor
  private readonly manifest: MemoryManifest
  private readonly recallEngine = new MemoryRecallEngine()
  private readonly pendingRecallCues = new Map<string, string>()
  private readonly pendingRecallCycles = new Map<string, string[]>()
  private readonly workspaceHashes = new Map<string, string>()
  private readonly runtimeSceneDefaults: Pick<RuntimeSceneHint, 'participants' | 'goals'> | undefined

  constructor(ctx: Context, config: MemoryPluginConfig) {
    super(ctx)
    if (!config || config.dbPath.trim() === '' || config.manifestPath.trim() === '' || config.homeRoot.trim() === '') {
      throw new Error('rin memory: dbPath, manifestPath, and homeRoot are required')
    }
    this.cognitionDatabase = new MemoryCognitionDatabase(config.dbPath)
    this.runtimeSceneDefaults = config.runtimeSceneDefaults
    this.runtimeIngestor = new RuntimeCognitionIngestor(this.cognitionDatabase)
    const storage = normalizeMemoryStorage(config.homeRoot, {
      sessionRoot: config.sessionRoot,
      settingsPath: config.settingsPath,
      credentialsPath: config.credentialsPath,
      archiveRoot: config.archiveRoot,
    })
    this.manifest = buildMemoryManifest(new Date().toISOString(), storage)
    writeMemoryManifestSync(config.manifestPath, this.manifest)
  }

  override getManifest(): MemoryManifest {
    return this.manifest
  }

  override getCurrentField(): CurrentField {
    return this.cognitionDatabase.readMaterializedState().currentField
  }
  override readCognitionState(): MemoryMaterializedState {
    return this.cognitionDatabase.readMaterializedState()
  }
  override getProjectionCheckpoint(projection: MemoryProjection): MemoryProjectionCheckpoint {
    return this.cognitionDatabase.getProjectionCheckpoint(projection)
  }
  override requireProjectionReady(projection: MemoryProjection): MemoryProjectionCheckpoint {
    return this.cognitionDatabase.requireProjectionReady(projection)
  }
  override markProjectionDirty(projection: MemoryProjection): MemoryProjectionCheckpoint {
    return this.cognitionDatabase.markProjectionDirty(projection)
  }
  override markProjectionCleanAtCurrent(
    projection: MemoryProjection,
    materializedVersion: number,
    stateHash: string,
    updatedAt?: string,
  ): MemoryProjectionCheckpoint {
    return this.cognitionDatabase.markProjectionCleanAtCurrent(
      projection,
      materializedVersion,
      stateHash,
      updatedAt,
    )
  }
  override prepareForArchive(): void {
    this.cognitionDatabase.prepareForArchive()
  }

  override exportCognitionJournal(): readonly MemoryTransaction[] {
    return this.cognitionDatabase.listTransactions(1_000_000)
  }

  /**
   * Restores a previously exported cognition journal into an empty store.
   *
   * Transactions are appended in order and the materialized state is rebuilt
   * by deterministic replay; erasures recover their committed semantics. The
   * restore refuses a store whose journal already has content so an export
   * can never be merged into unrelated cognition state.
   */
  override restoreCognitionJournal(transactions: readonly MemoryTransaction[]): number {
    if (this.cognitionDatabase.listTransactions(1).length > 0) {
      throw new Error('rin memory: cognition journal restore requires an empty store')
    }
    let restored = 0
    for (const transaction of transactions) {
      this.cognitionDatabase.appendTransaction(transaction)
      restored += 1
    }
    return restored
  }

  override ingestRuntimeEvent(sessionId: string, event: RuntimeSessionEvent, hint?: RuntimeSceneHint): MemoryTransaction | null {
    const defaults = this.runtimeSceneDefaults
    const effectiveHint = defaults === undefined && hint === undefined
      ? undefined
      : {
          ...(defaults ?? {}),
          ...(hint ?? {}),
        }
    return this.runtimeIngestor.ingest(sessionId, event, effectiveHint)
  }
  override async recall(input: MemoryRecallInput = {}): Promise<MemoryRecallResult> {
    const suppliedQuery = typeof input.query === 'string' ? { text: input.query } : { ...(input.query ?? {}) }
    const sessionId = suppliedQuery.sessionId
    const pendingCue = sessionId === undefined ? undefined : this.pendingRecallCues.get(sessionId)
    const query = pendingCue !== undefined && suppliedQuery.text === undefined
      ? { ...suppliedQuery, text: pendingCue }
      : suppliedQuery
    const result = await this.recallEngine.recall(this.readCognitionState(), { ...input, query })
    this.cognitionDatabase.appendRecallRecord({ ...result, cycleId: result.trace.cycleId, createdAt: new Date().toISOString() })
    if (sessionId !== undefined) {
      this.pendingRecallCues.delete(sessionId)
      const cycles = this.pendingRecallCycles.get(sessionId) ?? []
      cycles.push(result.trace.cycleId)
      this.pendingRecallCycles.set(sessionId, cycles)
    }
    this.workspaceHashes.set(result.trace.cycleId, result.workspace.hash)
    return result
  }

  override registerRecallSource(source: MemoryRecallSource): () => void {
    return this.recallEngine.registerSource(source)
  }

  override setRecallCue(sessionId: string, text: string): void {
    const normalized = text.trim()
    if (sessionId.trim() === '' || normalized === '') return
    this.pendingRecallCues.set(sessionId, normalized.slice(-8_000))
  }

  /**
   * Resolve a session's model-input slot from memory when the in-process
   * recall queue was lost during a Host restart. A single unbound persisted
   * recall is safe to recover; ambiguity remains explicitly unbound so an
   * input cannot be attributed to the wrong workspace.
   */
  private resolvePendingRecallCycle(sessionId: string): string | undefined {
    const cycles = this.pendingRecallCycles.get(sessionId)
    if (cycles !== undefined && cycles.length > 0) {
      const cycleId = cycles.shift()
      if (cycles.length === 0) this.pendingRecallCycles.delete(sessionId)
      else this.pendingRecallCycles.set(sessionId, cycles)
      return cycleId
    }
    const recalls = this.cognitionDatabase.listRecallRecords(10_000)
      .filter(record => record.trace.query.sessionId === sessionId)
    if (recalls.length === 0) return undefined
    const modelInputs = this.cognitionDatabase.listModelInputs(undefined, 10_000)
    const unbound = recalls.filter(record => !modelInputs.some(input =>
      input.cycleId === record.cycleId && input.workspaceHash === record.workspace.hash,
    ))
    if (unbound.length !== 1) return undefined
    return unbound[0]?.cycleId
  }

  override recordModelInput(input: MemoryModelInputRecordInput): MemoryModelInputRecord {
    let cycleId = input.cycleId
    if (cycleId === undefined && input.sessionId !== undefined) {
      cycleId = this.resolvePendingRecallCycle(input.sessionId)
    }
    const resolvedCycleId = cycleId ?? 'unbound-' + randomUUID()
    const snapshot = snapshotModelInput(input.input)
    const record: MemoryModelInputRecord = {
      id: 'model-input-' + randomUUID(),
      cycleId: resolvedCycleId,
      sequence: 0,
      createdAt: new Date().toISOString(),
      inputHash: hashModelInput(snapshot),
      input: snapshot,
    }
    if (input.sessionId !== undefined) record.sessionId = input.sessionId
    const workspaceHash = this.workspaceHashes.get(resolvedCycleId)
      ?? this.cognitionDatabase.getRecallRecord(resolvedCycleId)?.workspace.hash
    if (workspaceHash !== undefined) record.workspaceHash = workspaceHash
    const stored = this.cognitionDatabase.appendModelInput(record)
    this.recordBoundMemoryUses({
      recordId: stored.id,
      cycleId: stored.cycleId,
      ...(stored.workspaceHash === undefined ? {} : { workspaceHash: stored.workspaceHash }),
      surface: 'model-input',
      purpose: 'answer',
      usedAt: stored.createdAt,
    })
    return stored
  }

  /**
   * Records only the canonical workspace memories that participated in a bound
   * model-input or action-selection operation. Recall alone is candidate
   * activation; these two boundaries are the points where memory can influence
   * Rin's next response.
   */
  private recordBoundMemoryUses(input: {
    recordId: string
    cycleId: string
    workspaceHash?: string
    memoryIds?: readonly string[]
    surface: MemoryUseSurface
    purpose: MemoryUsePurpose
    usedAt: string
  }): void {
    if (input.workspaceHash === undefined) return
    const recall = this.cognitionDatabase.getRecallRecord(input.cycleId)
    if (recall === undefined || recall.workspace.hash !== input.workspaceHash) return
    const allowedMemoryIds = input.memoryIds === undefined ? undefined : new Set(input.memoryIds)
    const currentState = this.readCognitionState()
    const currentMemories = new Map(
      currentState.memories.map(memory => [String(memory.id), memory]),
    )
    const recordedMemoryIds = new Set<string>()
    for (const item of recall.workspace.items) {
      if (
        item.memory === undefined
        || (allowedMemoryIds !== undefined && !allowedMemoryIds.has(String(item.memory.id)))
        || !item.memory.dynamics.influenceSurfaces.includes(input.surface)
      ) continue
      const current = currentMemories.get(String(item.memory.id))
      if (current === undefined || current.updatedAt !== item.memory.updatedAt) continue
      this.recordMemoryUse({
        id: 'memory-use-' + input.surface + '-' + input.recordId + '-' + String(item.memory.id),
        cycleId: input.cycleId,
        memoryId: item.memory.id,
        memoryVersion: item.memory.updatedAt,
        surface: input.surface,
        purpose: input.purpose,
        usedAt: input.usedAt,
      })
      recordedMemoryIds.add(String(item.memory.id))
    }
    if (input.surface === 'model-input') {
      const field = recall.workspace.currentField
      const fieldVisible = currentState.version === recall.workspace.materializedVersion
        && field?.sceneId !== undefined
        && recall.workspace.items.some(item => item.id === String(field.sceneId))
      if (fieldVisible) {
        for (const source of field?.candidateActionSources ?? []) {
          for (const memoryId of source.sourceMemoryIds) {
            if (recordedMemoryIds.has(String(memoryId))) continue
            const current = currentMemories.get(String(memoryId))
            if (current === undefined || !current.dynamics.influenceSurfaces.includes(input.surface)) continue
            this.recordMemoryUse({
              id: 'memory-use-' + input.surface + '-' + input.recordId + '-' + String(current.id),
              cycleId: input.cycleId,
              memoryId: current.id,
              memoryVersion: current.updatedAt,
              surface: input.surface,
              purpose: input.purpose,
              usedAt: input.usedAt,
            })
            recordedMemoryIds.add(String(current.id))
          }
        }
      }
    }
  }

  override listModelInputs(cycleId?: string, limit?: number): MemoryModelInputRecord[] {
    return this.cognitionDatabase.listModelInputs(cycleId, limit)
  }
  override recordBehavior(batch: MemoryBehaviorBatch): MemoryTransaction {
    const action = batch.action
    const recall = action === undefined
      ? undefined
      : this.cognitionDatabase.getRecallRecord(action.cycleId)
    if (action !== undefined) {
      if (recall === undefined) throw new Error('rin memory: action cycle is not a persisted recall cycle')
      if (recall.workspace.hash !== action.workspaceHash) {
        throw new Error('rin memory: action workspace hash does not match the persisted recall workspace')
      }
      const modelInput = this.cognitionDatabase.listModelInputs(action.cycleId)
        .find(input => input.workspaceHash === action.workspaceHash)
      if (modelInput === undefined) {
        throw new Error('rin memory: action requires a model input with the same workspace hash')
      }
    }
    const timestamps = [
      batch.prediction?.createdAt,
      batch.action?.occurredAt,
      batch.outcome?.occurredAt,
      batch.feedback?.occurredAt,
    ].filter((value): value is string => value !== undefined)
    if (timestamps.length === 0) throw new Error('rin memory: behavior batch is empty')
    const openedAt = timestamps.reduce((earliest, value) =>
      Date.parse(value) < Date.parse(earliest) ? value : earliest,
    )
    const committedAt = timestamps.reduce((latest, value) =>
      Date.parse(value) > Date.parse(latest) ? value : latest,
    )
    const cycleId = batch.action?.cycleId
      ?? batch.outcome?.cycleId
      ?? batch.feedback?.cycleId
      ?? batch.prediction?.cycleId
    if (cycleId === undefined) throw new Error('rin memory: behavior batch has no cycle')
    const identity = String(batch.action?.id ?? batch.outcome?.id ?? batch.feedback?.id ?? batch.prediction?.id)
    const transaction = createMemoryBehaviorTransaction({
      actor: createRuntimeActor('rin-runtime'),
      ...(batch.prediction === undefined ? {} : { prediction: batch.prediction }),
      ...(batch.action === undefined ? {} : { action: batch.action }),
      ...(batch.outcome === undefined ? {} : { outcome: batch.outcome }),
      ...(batch.feedback === undefined ? {} : { feedback: batch.feedback }),
      commandId: createMemoryCommandId('record-behavior-' + identity),
      eventId: createMemoryEventId('behavior-recorded-' + identity),
      transactionId: createMemoryTransactionId('behavior-transaction-' + identity),
      correlationId: createMemoryCorrelationId('workspace-' + String(cycleId)),
      issuedAt: openedAt,
      committedAt,
    })
    const committed = this.appendBehaviorTransaction(transaction)
    if (action !== undefined && recall !== undefined) {
      const candidateActionSources = recall.workspace.currentField?.candidateActionSources
      const actionSelectionMemoryIds = candidateActionSources === undefined || candidateActionSources.length === 0
        ? action.sourceMemoryIds
        : selectCandidateActionSources(action.description, candidateActionSources)
          .flatMap(source => source.sourceMemoryIds)
      this.recordBoundMemoryUses({
        recordId: String(action.id),
        cycleId: String(action.cycleId),
        workspaceHash: action.workspaceHash,
        memoryIds: actionSelectionMemoryIds,
        surface: 'action-selection',
        purpose: 'action',
        usedAt: action.occurredAt,
      })
    }
    return committed
  }
  private appendBehaviorTransaction(transaction: MemoryTransaction): MemoryTransaction {
    const previous = this.readCognitionState()
    new MemoryMaterializer().apply(transaction, previous)
    return this.cognitionDatabase.appendTransaction(transaction)
  }

  override recordPrediction(prediction: MemoryPredictionRecord): MemoryTransaction {
    const transaction = createMemoryPredictionTransaction({
      actor: createRuntimeActor('rin-runtime'),
      prediction,
      commandId: createMemoryCommandId('record-prediction-' + prediction.id),
      eventId: createMemoryEventId('prediction-recorded-' + prediction.id),
      transactionId: createMemoryTransactionId('prediction-transaction-' + prediction.id),
      correlationId: createMemoryCorrelationId('workspace-' + prediction.cycleId),
      issuedAt: prediction.createdAt,
      committedAt: prediction.createdAt,
    })
    return this.appendBehaviorTransaction(transaction)
  }

  override recordAction(action: MemoryActionRecord): MemoryTransaction {
    const recall = this.cognitionDatabase.getRecallRecord(action.cycleId)
    if (recall === undefined) throw new Error('rin memory: action cycle is not a persisted recall cycle')
    if (recall.workspace.hash !== action.workspaceHash) {
      throw new Error('rin memory: action workspace hash does not match the persisted recall workspace')
    }
    const modelInput = this.cognitionDatabase.listModelInputs(action.cycleId)
      .find(input => input.workspaceHash === action.workspaceHash)
    if (modelInput === undefined) {
      throw new Error('rin memory: action requires a model input with the same workspace hash')
    }
    const transaction = createMemoryActionTransaction({
      actor: createRuntimeActor('rin-runtime'),
      action,
      commandId: createMemoryCommandId('record-action-' + action.id),
      eventId: createMemoryEventId('action-recorded-' + action.id),
      transactionId: createMemoryTransactionId('action-transaction-' + action.id),
      correlationId: createMemoryCorrelationId('workspace-' + action.cycleId),
      issuedAt: action.occurredAt,
      committedAt: action.occurredAt,
    })
    const committed = this.appendBehaviorTransaction(transaction)
    const candidateActionSources = recall.workspace.currentField?.candidateActionSources
    const actionSelectionMemoryIds = candidateActionSources === undefined || candidateActionSources.length === 0
      ? action.sourceMemoryIds
      : selectCandidateActionSources(action.description, candidateActionSources)
        .flatMap(source => source.sourceMemoryIds)
    this.recordBoundMemoryUses({
      recordId: String(action.id),
      cycleId: action.cycleId,
      workspaceHash: action.workspaceHash,
      memoryIds: actionSelectionMemoryIds,
      surface: 'action-selection',
      purpose: 'action',
      usedAt: action.occurredAt,
    })
    return committed
  }

  override recordOutcome(outcome: MemoryOutcomeRecord): MemoryTransaction {
    const transaction = createMemoryOutcomeTransaction({
      actor: createRuntimeActor('rin-runtime'),
      outcome,
      commandId: createMemoryCommandId('record-outcome-' + outcome.id),
      eventId: createMemoryEventId('outcome-recorded-' + outcome.id),
      transactionId: createMemoryTransactionId('outcome-transaction-' + outcome.id),
      correlationId: createMemoryCorrelationId('workspace-' + outcome.cycleId),
      issuedAt: outcome.occurredAt,
      committedAt: outcome.occurredAt,
    })
    return this.appendBehaviorTransaction(transaction)
  }

  override recordFeedback(feedback: MemoryFeedbackVector): MemoryTransaction {
    const transaction = createMemoryFeedbackTransaction({
      actor: createRuntimeActor('rin-runtime'),
      feedback,
      commandId: createMemoryCommandId('record-feedback-' + feedback.id),
      eventId: createMemoryEventId('feedback-recorded-' + feedback.id),
      transactionId: createMemoryTransactionId('feedback-transaction-' + feedback.id),
      correlationId: createMemoryCorrelationId('workspace-' + feedback.cycleId),
      issuedAt: feedback.occurredAt,
      committedAt: feedback.occurredAt,
    })
    return this.appendBehaviorTransaction(transaction)
  }
  override planRepresentationFormation(
    candidates: readonly MemoryFormationCandidateInput[],
    at = new Date().toISOString(),
  ): readonly MemoryRepresentationFormationCandidate[] {
    const state = this.readCognitionState()
    return formMemoryRepresentations({
      scenes: state.memories.filter(memory => memory.form === 'scene'),
      links: state.links.filter(link => link.state !== 'retracted'),
      actions: state.actions,
      outcomes: state.outcomes,
      feedback: state.feedback,
      predictions: state.predictions,
      candidates,
      at,
    })
  }
  override deriveRepresentationFormation(
    at = new Date().toISOString(),
  ): readonly MemoryRepresentationFormationCandidate[] {
    const state = this.readCognitionState()
    const input = {
      scenes: state.memories.filter(memory => memory.form === 'scene'),
      links: state.links.filter(link => link.state !== 'retracted'),
      actions: state.actions,
      outcomes: state.outcomes,
      feedback: state.feedback,
      predictions: state.predictions,
      at,
    }
    return formMemoryRepresentations({
      ...input,
      candidates: deriveMemoryRepresentationCandidates(input),
    })
  }
  override proposeRepresentationFormation(input: MemoryRepresentationProposalInput): MemoryRepresentationProposalResult {
    const at = input.at ?? new Date().toISOString()
    const state = this.readCognitionState()
    for (const sourceSceneId of input.sourceSceneIds) {
      const source = state.memories.find(memory => memory.id === sourceSceneId)
      if (source === undefined || source.form !== 'scene') {
        throw new Error('rin memory: representation source must be a materialized scene')
      }
    }
    const [formation] = this.planRepresentationFormation([
      {
        memory: input.candidate.memory,
        sourceSceneIds: input.sourceSceneIds,
        ...(input.independentEvidenceIds === undefined ? {} : { independentEvidenceIds: input.independentEvidenceIds }),
      },
    ], at)
    if (formation === undefined) throw new Error('rin memory: representation formation produced no candidate')
    const transaction = this.recordModelProposal({
      ...input.candidate,
      sourceMemoryIds: [...input.sourceSceneIds],
    })
    return Object.freeze({ formation, transaction })
  }
  override commitRepresentationFormation(
    input: MemoryRepresentationFormationCommitInput,
  ): MemoryTransaction {
    const state = this.readCognitionState()
    const current = state.memories.find(memory => String(memory.id) === String(input.memoryId))
    if (current === undefined) {
      throw new Error('rin memory: representation formation references an unknown memory')
    }
    if (current.updatedAt !== input.previousVersion) {
      throw new Error('rin memory: representation formation source version is stale')
    }
    const proposal = this.cognitionDatabase
      .listTransactions(10_000)
      .flatMap(transaction => transaction.events)
      .find((event): event is Extract<MemoryEvent, { type: 'memory-proposed' }> =>
        event.type === 'memory-proposed'
        && String(event.payload.candidate.memory.id) === String(input.memoryId)
        && event.payload.candidate.memory.updatedAt === input.previousVersion,
      )
    if (proposal === undefined) {
      throw new Error('rin memory: representation formation requires a persisted model proposal')
    }
    const proposedSources = proposal.payload.candidate.sourceMemoryIds ?? []
    const requestedSources = input.sourceSceneIds.map(String)
    if (
      proposedSources.length !== requestedSources.length
      || proposedSources.some(sourceId => !requestedSources.includes(String(sourceId)))
    ) {
      throw new Error('rin memory: formation sources do not match the persisted model proposal')
    }
    const proposalSupportLinks = state.links.filter(link =>
      link.state === 'active'
      && link.relation === 'supports'
      && String(link.to) === String(input.memoryId)
      && link.toVersion === input.previousVersion,
    )
    for (const sourceId of requestedSources) {
      const source = state.memories.find(memory => String(memory.id) === sourceId)
      const binding = proposalSupportLinks.find(link => String(link.from) === sourceId)
      if (source === undefined || binding === undefined || binding.fromVersion !== source.updatedAt) {
        throw new Error('rin memory: representation formation source scene version is stale')
      }
    }
    const evidenceIds = [...input.evidenceIds]
    const proposalEvidence = new Set(proposal.payload.candidate.evidenceIds.map(String))
    if (proposal.payload.candidate.evidenceIds.some(evidenceId => !evidenceIds.some(id => String(id) === String(evidenceId)))) {
      throw new Error('rin memory: formation evidence must retain the model proposal evidence')
    }
    const independentEvidenceIds = [...(input.independentEvidenceIds ?? evidenceIds)]
    const at = input.at ?? new Date().toISOString()
    const [formation] = formMemoryRepresentations({
      scenes: state.memories.filter(memory => memory.form === 'scene'),
      links: state.links.filter(link => link.state !== 'retracted'),
      actions: state.actions,
      outcomes: state.outcomes,
      feedback: state.feedback,
      predictions: state.predictions,
      candidates: [{
        memory: current,
        sourceSceneIds: input.sourceSceneIds,
        independentEvidenceIds: independentEvidenceIds.map(String),
      }],
      at,
    })
    if (formation === undefined || !formation.stable) {
      const reasons = formation?.reasons.join('; ') ?? 'formation candidate is missing'
      throw new Error('rin memory: representation formation is not ready: ' + reasons)
    }
    if (evidenceIds.length === 0 || proposalEvidence.size === 0) {
      throw new Error('rin memory: formation evidence cannot be empty or detached from the proposal')
    }
    const result = formMemoryRepresentation({
      memory: current,
      sourceSceneIds: input.sourceSceneIds,
      evidenceIds,
      independentEvidenceIds,
      at,
      explanation: input.explanation,
    })
    const transaction = createMemoryRepresentationFormationTransaction({
      actor: createBackgroundActor('rin-representation-formation'),
      result,
      commandId: createMemoryCommandId('form-representation-' + String(result.memoryId) + '-' + result.previousVersion),
      eventId: createMemoryEventId('representation-formed-' + String(result.memoryId) + '-' + result.previousVersion),
      transactionId: createMemoryTransactionId('representation-formation-transaction-' + String(result.memoryId) + '-' + result.previousVersion),
      correlationId: createMemoryCorrelationId('representation-formation-' + String(result.memoryId) + '-' + result.previousVersion),
      issuedAt: result.previousVersion,
    })
    new MemoryMaterializer().apply(transaction, state)
    return this.cognitionDatabase.appendTransaction(transaction)
  }

  override recordModelProposal(
    candidate: Omit<MemoryCandidate, 'kind'>,
  ): MemoryTransaction {
    const version = candidate.memory.updatedAt
    const transaction = createModelProposalTransaction({
      actor: createModelActor('rin-model'),
      candidate,
      commandId: createMemoryCommandId('propose-' + String(candidate.memory.id) + '-' + version),
      eventId: createMemoryEventId('memory-proposed-' + String(candidate.memory.id) + '-' + version),
      transactionId: createMemoryTransactionId('proposal-transaction-' + String(candidate.memory.id) + '-' + version),
      correlationId: createMemoryCorrelationId('proposal-' + String(candidate.memory.id) + '-' + version),
      issuedAt: version,
    })
    const previous = this.readCognitionState()
    new MemoryMaterializer().apply(transaction, previous)
    return this.cognitionDatabase.appendTransaction(transaction)
  }
  override permitInfluence(input: MemoryInfluencePermissionInput): MemoryTransaction {
    const current = this.readCognitionState().memories.find(memory => memory.id === input.memoryId)
    if (current === undefined) {
      throw new Error('rin memory: influence permission references an unknown memory')
    }
    if (current.updatedAt !== input.previousVersion) {
      throw new Error('rin memory: influence permission source version is stale')
    }
    assertMemoryInfluenceDependencies(this.readCognitionState(), current)
    const at = input.at ?? new Date().toISOString()
    const permitted = transitionMemory(current, {
      type: 'influence',
      to: 'permitted',
      surfaces: input.surfaces,
      at,
    })
    const transaction = createMemoryInfluencePermissionTransaction({
      actor: createOwnerActor(input.ownerId),
      memoryId: input.memoryId,
      previousVersion: input.previousVersion,
      memory: permitted,
      surfaces: input.surfaces,
      reason: input.reason,
      commandId: createMemoryCommandId('permit-influence-' + String(input.memoryId) + '-' + input.previousVersion),
      eventId: createMemoryEventId('influence-permitted-' + String(input.memoryId) + '-' + input.previousVersion),
      transactionId: createMemoryTransactionId('influence-permission-transaction-' + String(input.memoryId) + '-' + input.previousVersion),
      correlationId: createMemoryCorrelationId('influence-permission-' + String(input.memoryId) + '-' + input.previousVersion),
      issuedAt: at,
      committedAt: permitted.updatedAt,
    })
    const previous = this.readCognitionState()
    new MemoryMaterializer().apply(transaction, previous)
    return this.cognitionDatabase.appendTransaction(transaction)
  }
  override correctUnderstanding(input: MemoryCorrectionInput): MemoryTransaction {
    const current = this.readCognitionState().memories.find(memory => memory.id === input.memoryId)
    if (current === undefined) {
      throw new Error('rin memory: correction references an unknown memory')
    }
    const at = input.at ?? new Date().toISOString()
    // createMemory revalidates the form/data pairing, so widening the drafted
    // envelope through the replacement is safe here.
    const replaced = createMemory({
      ...current,
      ...input.replacement,
      updatedAt: at,
    } as MemoryDraft)
    // Corrected content is new content: a standing permit must not carry over.
    const corrected = replaced.state.influence === 'permitted'
      ? transitionMemory(replaced, { type: 'influence', to: 'blocked', surfaces: [], at })
      : replaced
    const transaction = createMemoryCorrectionTransaction({
      actor: createOwnerActor(input.ownerId),
      memoryId: input.memoryId,
      memory: corrected,
      evidenceIds: input.evidenceIds ?? [],
      explanation: input.explanation,
      commandId: createMemoryCommandId('correct-' + String(input.memoryId) + '-' + randomUUID()),
      eventId: createMemoryEventId('memory-corrected-' + String(input.memoryId) + '-' + randomUUID()),
      transactionId: createMemoryTransactionId('correction-transaction-' + String(input.memoryId) + '-' + randomUUID()),
      correlationId: createMemoryCorrelationId('correction-' + String(input.memoryId) + '-' + randomUUID()),
      issuedAt: at,
      committedAt: corrected.updatedAt,
    })
    const previous = this.readCognitionState()
    new MemoryMaterializer().apply(transaction, previous)
    return this.cognitionDatabase.appendTransaction(transaction)
  }
  override restrictInfluence(input: MemoryInfluenceRestrictionInput): MemoryTransaction {
    const current = this.readCognitionState().memories.find(memory => memory.id === input.memoryId)
    if (current === undefined) {
      throw new Error('rin memory: influence restriction references an unknown memory')
    }
    const at = input.at ?? new Date().toISOString()
    const restricted = transitionMemory(current, {
      type: 'influence',
      to: 'restricted',
      surfaces: input.surfaces,
      at,
    })
    const transaction = createMemoryInfluenceRestrictionTransaction({
      actor: createOwnerActor(input.ownerId),
      memoryId: input.memoryId,
      memory: restricted,
      surfaces: input.surfaces,
      reason: input.reason,
      commandId: createMemoryCommandId('restrict-influence-' + String(input.memoryId) + '-' + randomUUID()),
      eventId: createMemoryEventId('influence-restricted-' + String(input.memoryId) + '-' + randomUUID()),
      transactionId: createMemoryTransactionId('influence-restriction-transaction-' + String(input.memoryId) + '-' + randomUUID()),
      correlationId: createMemoryCorrelationId('influence-restriction-' + String(input.memoryId) + '-' + randomUUID()),
      issuedAt: at,
      committedAt: restricted.updatedAt,
    })
    const previous = this.readCognitionState()
    new MemoryMaterializer().apply(transaction, previous)
    return this.cognitionDatabase.appendTransaction(transaction)
  }
  override revokeInfluence(input: MemoryInfluenceRevocationInput): MemoryTransaction {
    const current = this.readCognitionState().memories.find(memory => memory.id === input.memoryId)
    if (current === undefined) {
      throw new Error('rin memory: influence revocation references an unknown memory')
    }
    const at = input.at ?? new Date().toISOString()
    const revoked = transitionMemory(current, { type: 'influence', to: 'revoked', surfaces: [], at })
    const transaction = createMemoryInfluenceRevocationTransaction({
      actor: createOwnerActor(input.ownerId),
      memoryId: input.memoryId,
      memory: revoked,
      reason: input.reason,
      commandId: createMemoryCommandId('revoke-influence-' + String(input.memoryId) + '-' + randomUUID()),
      eventId: createMemoryEventId('influence-revoked-' + String(input.memoryId) + '-' + randomUUID()),
      transactionId: createMemoryTransactionId('influence-revocation-transaction-' + String(input.memoryId) + '-' + randomUUID()),
      correlationId: createMemoryCorrelationId('influence-revocation-' + String(input.memoryId) + '-' + randomUUID()),
      issuedAt: at,
      committedAt: revoked.updatedAt,
    })
    const previous = this.readCognitionState()
    new MemoryMaterializer().apply(transaction, previous)
    return this.cognitionDatabase.appendTransaction(transaction)
  }
  override requestErasePreview(rootMemoryIds: readonly MemoryId[]): MemoryErasePreview {
    return computeEraseScope(this.readCognitionState(), rootMemoryIds)
  }
  override authorizeErase(input: MemoryEraseAuthorizeInput): MemoryEraseAuthorizationResult {
    const state = this.readCognitionState()
    const preview = computeEraseScope(state, input.rootMemoryIds)
    const at = input.at ?? new Date().toISOString()
    const ttlMinutes = input.ttlMinutes ?? 15
    if (!Number.isFinite(ttlMinutes) || ttlMinutes <= 0) {
      throw new Error('rin memory: erase authorization ttl must be a positive number of minutes')
    }
    const expiresAt = new Date(Date.parse(at) + ttlMinutes * 60_000).toISOString()
    const authorizationId = createMemoryAuthorizationId('erase-auth-' + preview.scopeHash + '-' + randomUUID())
    const transaction = createMemoryEraseAuthorizationTransaction({
      actor: createOwnerActor(input.ownerId),
      authorizationId,
      memoryIds: preview.erasedMemoryIds,
      expiresAt,
      scopeHash: preview.scopeHash,
      commandId: createMemoryCommandId('authorize-erase-' + String(authorizationId)),
      eventId: createMemoryEventId('erase-authorized-' + String(authorizationId)),
      transactionId: createMemoryTransactionId('erase-authorization-transaction-' + String(authorizationId)),
      correlationId: createMemoryCorrelationId('erase-authorization-' + String(authorizationId)),
      issuedAt: at,
      committedAt: at,
    })
    new MemoryMaterializer().apply(transaction, state)
    this.cognitionDatabase.appendTransaction(transaction)
    return {
      authorization: {
        authorizationId,
        memoryIds: preview.erasedMemoryIds,
        expiresAt,
        scopeHash: preview.scopeHash,
      },
      preview,
      transaction,
    }
  }
  override commitAuthorizedErase(input: MemoryEraseCommitInput): MemoryEraseCommitResult {
    const state = this.readCognitionState()
    const authorization = state.eraseAuthorizations.find(
      item => item.authorizationId === input.authorizationId,
    )
    if (authorization === undefined) {
      throw new Error('rin memory: erase commit references an unknown authorization')
    }
    const at = input.at ?? new Date().toISOString()
    if (Date.parse(at) > Date.parse(authorization.expiresAt)) {
      throw new Error('rin memory: erase authorization is expired')
    }
    if (this.cognitionDatabase.listEraseCommittedAuthorizationIds().includes(String(input.authorizationId))) {
      throw new Error('rin memory: erase authorization was already consumed')
    }
    if (authorization.memoryIds.some(id => state.erasedMemoryIds.includes(id))) {
      throw new Error('rin memory: erase authorization scope has drifted; request a new authorization')
    }
    const preview = computeEraseScope(state, authorization.memoryIds)
    if (preview.scopeHash !== authorization.scopeHash) {
      throw new Error('rin memory: erase authorization scope has drifted; request a new authorization')
    }
    const transaction = createMemoryEraseCommitTransaction({
      actor: createOwnerActor(input.ownerId),
      authorizationId: input.authorizationId,
      memoryIds: [...authorization.memoryIds],
      commandId: createMemoryCommandId('commit-erase-' + String(input.authorizationId) + '-' + randomUUID()),
      eventId: createMemoryEventId('erase-committed-' + String(input.authorizationId) + '-' + randomUUID()),
      transactionId: createMemoryTransactionId('erase-commit-transaction-' + String(input.authorizationId) + '-' + randomUUID()),
      correlationId: createMemoryCorrelationId('erase-commit-' + String(input.authorizationId) + '-' + randomUUID()),
      issuedAt: at,
      committedAt: at,
    })
    new MemoryMaterializer().apply(transaction, state)
    this.cognitionDatabase.appendTransaction(transaction)
    return { transaction, erasedMemoryIds: [...authorization.memoryIds] }
  }
  override planDispositionLearning(dispositionId: MemoryId, actionId: string, at = new Date().toISOString(), explanation = 'feedback consolidation from the canonical behavior chain'): MemoryDispositionLearningResult {
    const state = this.readCognitionState()
    const memory = state.memories.find(item => item.id === dispositionId)
    if (memory === undefined || memory.form !== 'disposition') {
      throw new Error('rin memory: disposition learning references an unknown disposition')
    }
    const action = state.actions.find(item => String(item.id) === actionId)
    if (action === undefined) throw new Error('rin memory: disposition learning references an unknown action')
    return learnDispositionFromFeedback({
      disposition: memory,
      action,
      outcomes: state.outcomes,
      feedback: state.feedback,
      predictions: state.predictions,
      at,
      explanation,
    })
  }
  override commitDispositionLearning(result: MemoryDispositionLearningResult): MemoryTransaction {
    const current = this.readCognitionState().memories.find(memory => memory.id === result.dispositionId)
    if (current === undefined || current.form !== 'disposition') {
      throw new Error('rin memory: disposition learning references an unknown disposition')
    }
    if (current.updatedAt !== result.previousVersion) {
      throw new Error('rin memory: disposition learning source version is stale')
    }
    const transaction = createMemoryDispositionLearningTransaction({
      actor: createBackgroundActor('rin-disposition-learning'),
      result,
      commandId: createMemoryCommandId('learn-disposition-' + result.dispositionId + '-' + result.previousVersion),
      eventId: createMemoryEventId('disposition-learned-' + result.dispositionId + '-' + result.previousVersion),
      transactionId: createMemoryTransactionId('disposition-learning-transaction-' + result.dispositionId + '-' + result.previousVersion),
      correlationId: createMemoryCorrelationId('disposition-learning-' + result.dispositionId + '-' + result.previousVersion),
      issuedAt: result.previousVersion,
      committedAt: result.memory.updatedAt,
    })
    return this.appendBehaviorTransaction(transaction)
  }
  override runBackgroundMaintenance(at = new Date().toISOString()): readonly MemoryDispositionLearningResult[] {
    const initial = this.readCognitionState()
    const pairs = new Map<string, { dispositionId: MemoryId; actionId: string }>()
    const addPair = (dispositionId: MemoryId, actionId: string): void => {
      pairs.set(String(dispositionId) + '|' + actionId, { dispositionId, actionId })
    }
    const findUniqueDispositionAction = (dispositionId: string): MemoryActionRecord | undefined => {
      const disposition = initial.memories.find(memory => String(memory.id) === dispositionId)
      if (disposition?.form !== 'disposition') return undefined
      const supportingActionIds = new Set((disposition.data.supportingActionIds ?? []).map(String))
      const supportingActions = initial.actions.filter(action =>
        supportingActionIds.has(String(action.id)) || action.sourceMemoryIds.some(id => String(id) === dispositionId))
      return supportingActions.length === 1 ? supportingActions[0] : undefined
    }
    const addActionPairs = (action: MemoryActionRecord, dispositionId?: MemoryId): void => {
      if (dispositionId !== undefined) addPair(dispositionId, String(action.id))
      for (const sourceMemoryId of action.sourceMemoryIds) {
        const source = initial.memories.find(memory => memory.id === sourceMemoryId)
        if (source?.form === 'disposition') addPair(source.id, String(action.id))
      }
    }
    for (const outcome of initial.outcomes) {
      const action = initial.actions.find(item => String(item.id) === String(outcome.actionId))
      if (action !== undefined) addActionPairs(action)
    }
    for (const vector of initial.feedback) {
      const outcome = vector.outcomeId === undefined
        ? undefined
        : initial.outcomes.find(item => String(item.id) === String(vector.outcomeId))
      const directDispositionAction = vector.actionId === undefined
        && vector.outcomeId === undefined
        && vector.dispositionId !== undefined
        ? findUniqueDispositionAction(String(vector.dispositionId))
        : undefined
      const actionId = vector.actionId ?? outcome?.actionId ?? directDispositionAction?.id
      if (actionId === undefined) continue
      const action = initial.actions.find(item => String(item.id) === String(actionId))
      if (action === undefined) continue
      addActionPairs(action, vector.dispositionId)
    }
    const committed: MemoryDispositionLearningResult[] = []
    for (const pair of pairs.values()) {
      const state = this.readCognitionState()
      const disposition = state.memories.find(memory => memory.id === pair.dispositionId)
      const action = state.actions.find(item => String(item.id) === pair.actionId)
      if (disposition?.form !== 'disposition' || action === undefined) continue
      const knownOutcomeIds = new Set((disposition.data.supportingOutcomeIds ?? []).map(String))
      const knownFeedbackIds = new Set((disposition.data.supportingFeedbackIds ?? []).map(String))
      const outcomes = state.outcomes.filter(outcome => outcome.actionId === action.id)
      const feedback = state.feedback.filter(vector =>
        vector.actionId === action.id
        || (vector.outcomeId !== undefined && outcomes.some(outcome => outcome.id === vector.outcomeId))
        || (
          vector.dispositionId === disposition.id
          && vector.actionId === undefined
          && vector.outcomeId === undefined
        )
      )
      if (!outcomes.some(outcome => !knownOutcomeIds.has(String(outcome.id)))
        && !feedback.some(vector => !knownFeedbackIds.has(String(vector.id)))) continue
      const currentMs = Date.parse(disposition.updatedAt)
      const requestedMs = Date.parse(at)
      const learningAt = new Date(Math.max(requestedMs, currentMs + 1)).toISOString()
      const result = this.planDispositionLearning(
        pair.dispositionId,
        pair.actionId,
        learningAt,
        'background maintenance absorbed new action outcome and feedback into the disposition',
      )
      this.commitDispositionLearning(result)
      committed.push(result)
    }
    return Object.freeze(committed)
  }
  override runCognitionMaintenance(at = new Date().toISOString(), maxConsolidationItems?: number): MemoryCognitionMaintenanceResult {
    const dispositionLearning = this.runBackgroundMaintenance(at)
    const representationFormation = this.deriveRepresentationFormation(at)
    const consolidation = this.planConsolidation(at, maxConsolidationItems)
    return Object.freeze({
      at,
      dispositionLearning,
      representationFormation,
      consolidation,
    })
  }
  override recordMemoryUse(use: MemoryUseTrace): MemoryTransaction {
    const transaction = createMemoryUseTransaction({
      actor: createRuntimeActor('rin-runtime'),
      use,
      commandId: createMemoryCommandId('record-use-' + use.id),
      eventId: createMemoryEventId('memory-used-' + use.id),
      transactionId: createMemoryTransactionId('memory-use-transaction-' + use.id),
      correlationId: createMemoryCorrelationId('memory-use-' + use.id),
      issuedAt: use.usedAt,
    })
    const trace = transaction.command.type === 'record-use'
      ? transaction.command.payload.use
      : undefined
    if (trace === undefined) throw new Error('rin memory: use transaction did not contain a use trace')
    const current = this.readCognitionState().memories.find(memory => memory.id === trace.memoryId)
    if (current === undefined) throw new Error('rin memory: use trace references an unknown memory')
    if (current.updatedAt !== trace.memoryVersion) {
      throw new Error('rin memory: use trace version does not match the current memory')
    }
    if (current.state.persistence === 'archived' || current.state.persistence === 'erased') {
      throw new Error('rin memory: archived or erased memory cannot be used')
    }
    if (current.state.epistemic === 'superseded' || current.state.epistemic === 'rejected') {
      throw new Error('rin memory: terminal epistemic memory cannot be used')
    }
    if (!current.dynamics.influenceSurfaces.includes(trace.surface)) {
      throw new Error('rin memory: use trace surface is not permitted by the current memory')
    }
    if (!isMemoryValidityActiveAt(current.dynamics.validity, trace.usedAt)) {
      throw new Error('rin memory: use trace is outside the memory validity interval')
    }
    if (this.cognitionDatabase.getRecallRecord(trace.cycleId) === undefined) {
      throw new Error('rin memory: use trace cycle is not a persisted recall cycle')
    }
    return this.cognitionDatabase.appendTransaction(transaction)
  }
  override recordRelationshipExpression(input: MemoryRelationshipExpressionInput): readonly MemoryTransaction[] {
    if (input.expressionId.trim() === '' || /\s/.test(input.expressionId)) {
      throw new Error('rin memory: relationship expression id must be a non-empty token without whitespace')
    }
    const memoryIds = input.memoryIds.map(String)
    if (new Set(memoryIds).size !== memoryIds.length) {
      throw new Error('rin memory: relationship expression memory ids must be unique')
    }
    if (memoryIds.length === 0) return []
    const recall = this.cognitionDatabase.getRecallRecord(input.cycleId)
    if (recall === undefined) {
      throw new Error('rin memory: relationship expression requires a persisted recall cycle')
    }
    if (recall.workspace.hash !== input.workspaceHash) {
      throw new Error('rin memory: relationship expression workspace hash does not match the persisted recall workspace')
    }
    const workspaceMemories = new Map(
      recall.workspace.items.flatMap(item =>
        item.kind === 'memory' && item.memory !== undefined
          ? [[String(item.memory.id), item.memory] as const]
          : [],
      ),
    )
    const currentMemories = new Map(
      this.readCognitionState().memories.map(memory => [String(memory.id), memory] as const),
    )
    for (const memoryId of input.memoryIds) {
      const workspaceMemory = workspaceMemories.get(String(memoryId))
      if (workspaceMemory === undefined) {
        throw new Error('rin memory: relationship expression memory is not in the persisted recall workspace')
      }
      const current = currentMemories.get(String(memoryId))
      if (current === undefined || current.updatedAt !== workspaceMemory.updatedAt) {
        throw new Error('rin memory: relationship expression memory version is stale')
      }
      if (!current.dynamics.influenceSurfaces.includes('relationship-expression')) {
        throw new Error('rin memory: relationship expression surface is not permitted by the current memory')
      }
    }
    return Object.freeze(input.memoryIds.map(memoryId => this.recordMemoryUse({
      id: 'memory-use-relationship-expression-' + input.expressionId + '-' + String(memoryId),
      cycleId: input.cycleId,
      memoryId,
      memoryVersion: currentMemories.get(String(memoryId))?.updatedAt ?? '',
      surface: 'relationship-expression',
      purpose: 'relationship-expression',
      usedAt: input.usedAt,
    })))
  }
  override listMemoryUseTraces(memoryId?: MemoryId, cycleId?: string, limit?: number): MemoryUseTrace[] {
    return this.cognitionDatabase.listMemoryUseTraces(memoryId, cycleId, limit)
  }
  override planConsolidation(at = new Date().toISOString(), maxItems?: number): MemoryConsolidationSchedule {
    const state = this.readCognitionState()
    return planConsolidationSchedule({
      memories: state.memories,
      links: state.links,
      useTraces: this.listMemoryUseTraces(),
      at,
      ...(maxItems === undefined ? {} : { maxItems }),
    })
  }
  override commitConsolidationDecision(
    schedule: MemoryConsolidationSchedule,
    decision: MemoryConsolidationDecision,
  ): MemoryTransaction {
    const workItem = schedule.items.find(item =>
      String(item.memoryId) === String(decision.memoryId)
      && item.memoryVersion === decision.memoryVersion
      && item.useTraceId === decision.useTraceId,
    )
    if (workItem === undefined) {
      throw new Error('rin memory: consolidation decision is not bound to the supplied schedule')
    }
    const memory = this.readCognitionState().memories.find(item => item.id === decision.memoryId)
    if (memory === undefined) {
      throw new Error('rin memory: consolidation decision references an unknown memory')
    }
    const result = consolidateMemory({
      memory,
      labile: workItem.labile,
      operation: decision.operation,
      basis: decision.basis,
      evidenceIds: decision.evidenceIds,
      ...(decision.independentEvidenceIds === undefined ? {} : { independentEvidenceIds: decision.independentEvidenceIds }),
      at: decision.at,
      explanation: decision.explanation,
      ...(decision.replacement === undefined ? {} : { replacement: decision.replacement }),
      ...(decision.parts === undefined ? {} : { parts: decision.parts }),
    })
    return this.commitConsolidation(result)
  }

  override commitConsolidation(result: MemoryConsolidationResult): MemoryTransaction {
    const source = result.resultingMemories[0]
    if (source === undefined) throw new Error('rin memory: consolidation result has no source memory')
    const use = this.cognitionDatabase
      .listMemoryUseTraces(result.memoryId)
      .find(trace => trace.id === result.labile.useTraceId)
    if (use === undefined) throw new Error('rin memory: consolidation requires a persisted use trace')
    if (use.memoryId !== result.memoryId || use.memoryVersion !== result.previousVersion) {
      throw new Error('rin memory: consolidation use trace does not match the source version')
    }
    const usedAt = Date.parse(use.usedAt)
    if (usedAt < Date.parse(result.labile.openedAt) || usedAt > Date.parse(result.labile.expiresAt)) {
      throw new Error('rin memory: consolidation use is outside the labile window')
    }
    const current = this.readCognitionState().memories.find(memory => memory.id === result.memoryId)
    if (current === undefined) throw new Error('rin memory: consolidation references an unknown memory')
    if (current.updatedAt !== result.previousVersion) {
      throw new Error('rin memory: consolidation source version is stale')
    }
    const transaction = createMemoryConsolidationTransaction({
      actor: createRuntimeActor('rin-consolidation'),
      result,
      commandId: createMemoryCommandId('consolidate-' + result.memoryId + '-' + result.previousVersion),
      eventId: createMemoryEventId('memory-consolidated-' + result.memoryId + '-' + result.previousVersion),
      transactionId: createMemoryTransactionId('consolidation-transaction-' + result.memoryId + '-' + result.previousVersion),
      correlationId: createMemoryCorrelationId('consolidation-' + result.memoryId + '-' + result.previousVersion),
      issuedAt: result.labile.openedAt,
      committedAt: source.updatedAt,
    })
    return this.cognitionDatabase.appendTransaction(transaction)
  }



  override commitDecay(result: MemoryDecayResult): MemoryTransaction {
    const current = this.readCognitionState().memories.find(memory => memory.id === result.memoryId)
    if (current === undefined) throw new Error('rin memory: decay references an unknown memory')
    if (current.updatedAt !== result.previousVersion) {
      throw new Error('rin memory: decay source version is stale')
    }
    const transaction = createMemoryDecayTransaction({
      actor: createBackgroundActor('rin-decay'),
      result,
      commandId: createMemoryCommandId('decay-' + result.memoryId + '-' + result.previousVersion),
      eventId: createMemoryEventId('memory-decayed-' + result.memoryId + '-' + result.previousVersion),
      transactionId: createMemoryTransactionId('decay-transaction-' + result.memoryId + '-' + result.previousVersion),
      correlationId: createMemoryCorrelationId('decay-' + result.memoryId + '-' + result.previousVersion),
      issuedAt: result.previousVersion,
      committedAt: result.memory.updatedAt,
    })
    return this.cognitionDatabase.appendTransaction(transaction)
  }

  override getRecallRecord(cycleId: string): MemoryRecallRecord | undefined {
    return this.cognitionDatabase.getRecallRecord(cycleId)
  }

  override listRecallRecords(limit?: number): MemoryRecallRecord[] {
    return this.cognitionDatabase.listRecallRecords(limit)
  }

  override evaluatePersistedRecallBehavior(
    input: MemoryPersistedRecallBehaviorInput,
  ): MemoryRecordedRecallBehaviorEvaluation {
    const before = this.cognitionDatabase.getRecallRecord(input.beforeCycleId)
    const after = this.cognitionDatabase.getRecallRecord(input.afterCycleId)
    if (before === undefined) {
      throw new Error('rin memory: persisted behavior evaluation references an unknown before recall cycle')
    }
    if (after === undefined) {
      throw new Error('rin memory: persisted behavior evaluation references an unknown after recall cycle')
    }
    const actionPhase = input.actionPhase ?? 'before'
    const phaseCycleId = actionPhase === 'before' ? before.cycleId : after.cycleId
    const state = this.readCognitionState()
    const phaseActions = state.actions.filter(action => String(action.cycleId) === phaseCycleId)
    const action = input.actionId === undefined
      ? phaseActions.length === 1 ? phaseActions[0] : undefined
      : state.actions.find(candidate => String(candidate.id) === input.actionId)
    if (action === undefined) {
      throw new Error(
        input.actionId === undefined
          ? 'rin memory: persisted behavior evaluation requires one action in the selected recall phase'
          : 'rin memory: persisted behavior evaluation references an unknown action',
      )
    }
    if (String(action.cycleId) !== phaseCycleId) {
      throw new Error('rin memory: persisted behavior evaluation action is not in the selected recall phase')
    }
    const outcomes = state.outcomes.filter(outcome => outcome.actionId === action.id)
    const outcomeIds = new Set(outcomes.map(outcome => String(outcome.id)))
    const feedback = state.feedback.filter(vector =>
      (vector.actionId !== undefined && vector.actionId === action.id)
      || (vector.outcomeId !== undefined && outcomeIds.has(String(vector.outcomeId))),
    )
    return evaluateRecordedRecallBehavior({
      before,
      after,
      choices: input.choices,
      action,
      outcomes,
      feedback,
      modelInputs: this.cognitionDatabase.listModelInputs(String(action.cycleId)),
      actionSelectionUses: this.cognitionDatabase.listMemoryUseTraces(undefined, String(action.cycleId)),
      actionPhase,
    })
  }
}

export const name = 'memory'
export const inject: string[] = []

export function apply(ctx: Context, config: MemoryPluginConfig): void {
  ctx.plugin(FileMemoryStore, config)
  const activeSessionIds = new Set<string>()
  const continuityBySession = new Map<string, string>()
  const disposeCreated = ctx.on(
    'session/created' as never,
    ((session: unknown) => {
      const sessionId = runtimeSessionId(session)
      if (sessionId !== undefined) activeSessionIds.add(sessionId)
    }) as never,
    { global: true } as never,
  )
  const disposeDisposed = ctx.on(
    'session/disposed' as never,
    ((session: unknown) => {
      const sessionId = runtimeSessionId(session)
      if (sessionId === undefined) return
      activeSessionIds.delete(sessionId)
      continuityBySession.delete(sessionId)
      const memory = ctx.get('memory')
      if (memory !== undefined) {
        try {
          memory.runBackgroundMaintenance(new Date().toISOString())
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error)
          ctx.logger.error('rin memory: background maintenance failed after session disposal: ' + message)
        }
      }
    }) as never,
    { global: true } as never,
  )
  const disposeEvent = ctx.on(
    'session/event' as never,
    ((...args: unknown[]) => {
      const session = args[0]
      const event = args[1]
      const sessionId = runtimeSessionId(session)
      if (typeof sessionId !== 'string' || !isRuntimeSessionEvent(event)) return
      const memory = ctx.get('memory')
      if (memory === undefined) return
      try {
        const hint = inferRuntimeSceneHint(
          memory,
          activeSessionIds,
          continuityBySession,
          sessionId,
          event,
        )
        const fact = mapRuntimeSessionEvent(sessionId, event)
        memory.ingestRuntimeEvent(sessionId, event, hint)
        if (fact !== null) {
          recordRuntimeBehavior(memory, fact)
          if (fact.feedback !== undefined) {
            memory.runBackgroundMaintenance(fact.occurredAt)
          }
        }
        rememberRuntimeSceneContinuity(memory, continuityBySession, sessionId, event)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        ctx.logger.error(
          'rin memory: failed to ingest session event ' + sessionId + ':' + event.seq + ': ' + message,
        )
      }
    }) as never,
    { global: true } as never,
  )
  const disposePreStep = ctx.on(
    'agent/pre-step' as never,
    ((payload: unknown) => {
      const record = asRecord(payload)
      const sessionId = record === undefined
        ? undefined
        : runtimeSessionId(record.agent) ?? runtimeSessionId(record.session)
      const cue = record === undefined ? '' : runtimeText(record.messages)
      if (sessionId === undefined || cue === '') return
      const memory = ctx.get('memory')
      memory?.setRecallCue(sessionId, cue)
    }) as never,
    { global: true } as never,
  )
  const disposeModelInput = ctx.on(
    'llm/stream' as never,
    ((options: unknown, next: () => AsyncIterable<unknown>) => {
      const memory = ctx.get('memory')
      const request = asRecord(options)
      if (memory !== undefined && request !== undefined) {
        const input = snapshotModelInput(request)
        const sessionId = typeof input.sessionId === 'string' ? input.sessionId : undefined
        memory.recordModelInput({
          ...(sessionId === undefined ? {} : { sessionId }),
          input,
        })
      }
      return next()
    }) as never,
    { global: true } as never,
  )

  ctx.effect(() => () => {
    disposeCreated()
    disposeDisposed()
    disposeEvent()
    disposePreStep()
    disposeModelInput()
    activeSessionIds.clear()
    continuityBySession.clear()
  }, 'rin/memory.runtime-events')
}
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function runtimeText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) return value.map(runtimeText).filter(Boolean).join('\n').trim()
  const record = asRecord(value)
  if (record === undefined) return ''
  const preferred = ['content', 'text', 'messages', 'parts', 'input']
  return preferred.map(key => runtimeText(record[key])).filter(Boolean).join('\n').trim()
}

function resolveRuntimeBehaviorRecall(
  fact: RuntimeMemoryFact,
  state: MemoryMaterializedState,
  recalls: readonly MemoryRecallRecord[],
  modelInputs: readonly MemoryModelInputRecord[],
): MemoryRecallRecord | undefined {
  const sessionRecalls = recalls.filter(record => record.trace.query.sessionId === fact.sessionId)
  const sessionActions = state.actions
    .filter(action => action.sessionId === fact.sessionId)
    .sort((left, right) =>
      Date.parse(right.occurredAt) - Date.parse(left.occurredAt)
      || String(right.id).localeCompare(String(left.id)),
    )
  if (fact.kind === 'action') {
    const pending = sessionRecalls.filter(record =>
      modelInputs.some(input =>
        input.sessionId === fact.sessionId
        && input.cycleId === record.cycleId
        && input.workspaceHash === record.workspace.hash,
      )
      && !state.actions.some(action =>
        action.sessionId === fact.sessionId && action.cycleId === record.cycleId,
      ),
    )
    if (pending.length === 1) return pending[0]
    if (pending.length > 1) return undefined

    // A tool call can be a continuation of the current action cycle. It does
    // not need a second model-input record when the action was already bound.
    if (fact.eventType === 'tool/call') {
      const latestAction = sessionActions[0]
      return latestAction === undefined
        ? undefined
        : sessionRecalls.find(record => record.cycleId === latestAction.cycleId)
    }
    // An assistant message without one unique model-input-backed recall is
    // unsafe to attribute: several in-flight recalls must stay unbound.
    return undefined
  }

  const latestAction = sessionActions[0]
  return latestAction === undefined
    ? undefined
    : sessionRecalls.find(record => record.cycleId === latestAction.cycleId)
}

function recordRuntimeBehavior(memory: MemoryStore, fact: RuntimeMemoryFact): void {
  const state = memory.readCognitionState()
  const recalls = memory.listRecallRecords(10_000)
  const modelInputs = memory.listModelInputs(undefined, 10_000)
  const linkedOutcome = fact.feedback?.outcomeId === undefined
    ? undefined
    : state.outcomes.find(outcome => String(outcome.id) === fact.feedback?.outcomeId)
  const directDispositionActions = fact.feedback?.actionId === undefined
    && fact.feedback?.outcomeId === undefined
    && fact.feedback?.dispositionId !== undefined
    && fact.feedback?.correlationKey === undefined
    && fact.correlationKey === undefined
    ? state.actions.filter(action => action.sourceMemoryIds.some(id =>
      String(id) === String(fact.feedback?.dispositionId),
    ))
    : []
  const linkedAction = state.actions
    .filter(action =>
      fact.feedback?.actionId !== undefined
        ? String(action.id) === fact.feedback.actionId
        : linkedOutcome !== undefined
          ? String(action.id) === String(linkedOutcome.actionId)
        : directDispositionActions.length > 0
          ? directDispositionActions.length === 1
            && String(action.id) === String(directDispositionActions[0]?.id)
        : (
            (fact.correlationKey !== undefined && action.correlationKey === fact.correlationKey)
            || (fact.feedback?.correlationKey !== undefined && action.correlationKey === fact.feedback.correlationKey)
          ),
    )
    .sort((left, right) =>
      Date.parse(right.occurredAt) - Date.parse(left.occurredAt)
      || String(right.id).localeCompare(String(left.id)),
    )[0]
  const originRecall = linkedAction === undefined
    ? resolveRuntimeBehaviorRecall(fact, state, recalls, modelInputs)
    : recalls.find(item => item.cycleId === linkedAction.cycleId)
  const cycleId = originRecall?.cycleId ?? linkedAction?.cycleId
  const workspaceHash = originRecall?.workspace.hash ?? linkedAction?.workspaceHash
  if (cycleId === undefined || workspaceHash === undefined) return
  const originSceneId = originRecall?.workspace.currentField?.sceneId ?? state.currentField.sceneId
  const workspaceMemoryIds = originRecall?.workspace.items.flatMap(item =>
    item.kind === 'memory' && item.memory !== undefined ? [item.memory.id] : [],
  ) ?? linkedAction?.sourceMemoryIds
  if (workspaceMemoryIds === undefined) return
  const mutation = mapRuntimeBehaviorFact(fact, {
    cycleId,
    workspaceHash,
    ...(originSceneId === undefined ? {} : { sceneId: originSceneId }),
    workspaceMemoryIds,
    ...(originRecall?.workspace.currentField?.candidateActionSources === undefined ? {} : {
      candidateActionSources: originRecall.workspace.currentField.candidateActionSources,
    }),
    goals: originRecall?.workspace.currentField?.goals ?? [],
    actions: state.actions,
    outcomes: state.outcomes,
    predictions: state.predictions,
  })
  const hasBehavior = mutation.prediction !== undefined
    || mutation.action !== undefined
    || mutation.outcome !== undefined
    || mutation.feedback !== undefined
  const relationshipExpression = fact.relationshipExpression
  if (hasBehavior && relationshipExpression !== undefined) {
    if (
      originRecall === undefined
      || originRecall.cycleId !== relationshipExpression.cycleId
      || originRecall.workspace.hash !== relationshipExpression.workspaceHash
    ) {
      throw new Error('rin memory: relationship expression binding does not match the behavior workspace')
    }
  }
  if (hasBehavior) memory.recordBehavior(mutation)
  if (hasBehavior && relationshipExpression !== undefined) {
    memory.recordRelationshipExpression({
      expressionId: 'runtime-expression-' + encodeURIComponent(fact.sessionId) + '-' + fact.eventSeq,
      cycleId: relationshipExpression.cycleId,
      workspaceHash: relationshipExpression.workspaceHash,
      memoryIds: relationshipExpression.memoryIds,
      usedAt: fact.occurredAt,
    })
  }
}


function runtimeSessionId(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const id = (value as { id?: unknown }).id
  return typeof id === 'string' && id.trim() !== '' ? id : undefined
}

function isMeaningfulRuntimeEvent(event: RuntimeSessionEvent): boolean {
  return event.type === 'user/message'
    || event.type === 'assistant/message'
    || event.type === 'tool/call'
    || event.type === 'tool/result'
    || event.type === 'turn/end'
}

function inferRuntimeSceneHint(
  memory: MemoryStore,
  activeSessionIds: ReadonlySet<string>,
  continuityBySession: ReadonlyMap<string, string>,
  sessionId: string,
  event: RuntimeSessionEvent,
): RuntimeSceneHint | undefined {
  const assigned = continuityBySession.get(sessionId)
  if (assigned !== undefined) return { continuityKey: assigned }
  if (!isMeaningfulRuntimeEvent(event) || activeSessionIds.size !== 1) return undefined

  const state = memory.readCognitionState()
  const current = state.memories.find(item => item.id === state.currentField.sceneId)
  if (current?.form !== 'scene' || current.data.lifecycle?.status !== 'open') return undefined
  const continuityKey = current.data.lifecycle.continuityKey
  return { continuityKey }
}

function rememberRuntimeSceneContinuity(
  memory: MemoryStore,
  continuityBySession: Map<string, string>,
  sessionId: string,
  event: RuntimeSessionEvent,
): void {
  if (continuityBySession.has(sessionId) || !isMeaningfulRuntimeEvent(event)) return
  const state = memory.readCognitionState()
  const scene = state.memories.find(item =>
    item.form === 'scene'
    && item.data.runtimeEventRefs?.some(ref =>
      ref.sessionId === sessionId && ref.eventSeq === event.seq,
    ),
  )
  if (scene?.form === 'scene' && scene.data.lifecycle !== undefined) {
    continuityBySession.set(sessionId, scene.data.lifecycle.continuityKey)
  }
}
