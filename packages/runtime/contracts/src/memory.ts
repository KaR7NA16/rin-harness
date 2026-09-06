/**
 * Stable API DTOs shared by application surfaces and runtime/domain packages.
 *
 * This package contains no storage, Cordis, HTTP, React, or platform behavior.
 *
 * @module @rin/contracts
 */

export const MEMORY_SCHEMA_VERSION = 2 as const

export const MEMORY_PROJECTIONS = [
  'prompt-memory',
  'notes',
  'knowledge',
  'session-search',
  'session',
  'canonical',
] as const

export type MemoryProjection = typeof MEMORY_PROJECTIONS[number]
export type MemoryRole = 'canonical' | 'source' | 'projection' | 'derived' | 'secret'

export interface MemoryProjectionDescriptor {
  id: MemoryProjection
  owner: string
  role: MemoryRole
  path: string
  rebuildable: boolean
  modelVisible: boolean
}
export interface MemoryCurrentFieldActionSource {
  action: string
  sourceMemoryIds: string[]
  utility: number
  inhibition: number
  selectionValue: number
  reasons: string[]
}
export interface MemoryCurrentField {
  ownerId: string
  version: number
  updatedAt: string
  sceneId?: string
  sceneVersion?: string
  sceneStatus?: 'open' | 'closed'
  participants: string[]
  goals: string[]
  affect: { valence: number; arousal: number; control: number }
  predictions: string[]
  predictionErrors: Array<{ expected: string; actual: string; magnitude: number }>
  activeOpenLoops: string[]
  candidateActions: string[]
  candidateActionSources?: MemoryCurrentFieldActionSource[]
  activeMemoryCoalition: string[]
  uncertainty: string[]
}


export const MEMORY_WORKSPACE_CONTRACT_VERSION = 2 as const
export type MemoryWorkspaceRoleDto = 'scene' | 'critical' | 'support' | 'conflict' | 'open-loop' | 'prospect' | 'context' | 'evidence'
export interface MemoryRecallScoreDto {
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
export interface MemoryWorkspaceItemDto {
  id: string
  kind: 'memory' | 'indexed-evidence'
  role: MemoryWorkspaceRoleDto
  memoryId?: string
  content: string
  epistemic: string
  influence: string
  uncertainty: string[]
  confidence: number
  score: number
  scoreBreakdown: MemoryRecallScoreDto
  selectionReasons: string[]
  reference?: Record<string, unknown>
}
export interface MemoryWorkspaceLinkDto {
  id: string
  from: string
  to: string
  relation: string
  strength: number
  state: string
  role: string
}
export interface MemoryWorkspaceDto {
  schemaVersion: typeof MEMORY_WORKSPACE_CONTRACT_VERSION
  cycleId: string
  materializedVersion: number
  query: Record<string, unknown>
  budget: { maxItems: number; maxTokens: number; usedItems: number; usedTokens: number }
  currentField: MemoryCurrentField
  items: MemoryWorkspaceItemDto[]
  links: MemoryWorkspaceLinkDto[]
  uncertainty: string[]
  hash: string
}
export interface MemoryModelInputRecordDto {
  id: string
  cycleId: string
  sequence: number
  sessionId?: string
  createdAt: string
  workspaceHash?: string
  inputHash: string
  input: Record<string, unknown>
}

export interface MemoryStorageManifest {
  sessionRoot: string
  settingsPath: string
  credentialsPath: string
  archiveRoot: string
  credentialsExcludedByDefault: true
}

export interface MemoryManifest {
  schemaVersion: typeof MEMORY_SCHEMA_VERSION
  generatedAt: string
  root: '.'
  canonical: {
    database: string
    manifest: string
  }
  storage: MemoryStorageManifest
  projections: MemoryProjectionDescriptor[]
  archive: {
    format: 'rin-archive'
    version: 2
    secretsExcludedByDefault: true
    externalSourcesCopied: boolean
  }
}

export const MEMORY_COGNITION_PROTOCOL_VERSION = 1 as const
export const MEMORY_COGNITION_STORAGE_VERSION = 5 as const
export type MemoryProjectionCheckpointStatus = 'clean' | 'dirty'
export interface MemoryProjectionCheckpoint {
  projection: MemoryProjection
  lastEventSeq: number
  materializedVersion: number
  stateHash: string
  status: MemoryProjectionCheckpointStatus
  dirtySinceEventSeq?: number
  updatedAt: string
}
export type MemoryActorKind = 'owner' | 'runtime' | 'model' | 'plugin' | 'background'
export type MemoryCommandType =
  | 'observe'
  | 'scene'
  | 'propose'
  | 'form'
  | 'consolidate'
  | 'decay'
  | 'transition'
  | 'record-use'
  | 'record-prediction'
  | 'record-action'
  | 'record-outcome'
  | 'record-behavior'
  | 'learn-disposition'
  | 'record-feedback'
  | 'link'
  | 'correct'
  | 'restrict-influence'
  | 'revoke-influence'
  | 'permit-influence'
  | 'erase-preview'
  | 'authorize-erase'
  | 'commit-erase'
export type MemoryEventType =
  | 'memory-observed'
  | 'scene-opened'
  | 'scene-extended'
  | 'scene-closed'
  | 'open-loop-opened'
  | 'open-loop-resolved'
  | 'memory-proposed'
  | 'memory-formed'
  | 'memory-transitioned'
  | 'memory-decayed'
  | 'memory-consolidated'
  | 'memory-used'
  | 'prediction-recorded'
  | 'action-recorded'
  | 'outcome-recorded'
  | 'disposition-learned'
  | 'feedback-recorded'
  | 'memory-linked'
  | 'memory-corrected'
  | 'influence-permitted'
  | 'influence-restricted'
  | 'influence-revoked'
  | 'erase-authorized'
  | 'erase-committed'

export interface MemoryActorDto {
  kind: MemoryActorKind
  id: string
}

export interface MemoryCommandEnvelopeDto {
  kind: 'memory-command'
  protocolVersion: typeof MEMORY_COGNITION_PROTOCOL_VERSION
  type: MemoryCommandType
  commandId: string
  correlationId: string
  actor: MemoryActorDto
  issuedAt: string
  payload: unknown
}

export interface MemoryEventEnvelopeDto {
  kind: 'memory-event'
  protocolVersion: typeof MEMORY_COGNITION_PROTOCOL_VERSION
  type: MemoryEventType
  eventId: string
  transactionId: string
  commandId: string
  position: number
  actor: MemoryActorDto
  occurredAt: string
  payload: unknown
}

export interface MemoryTransactionEnvelopeDto {
  kind: 'memory-transaction'
  protocolVersion: typeof MEMORY_COGNITION_PROTOCOL_VERSION
  transactionId: string
  commandId: string
  correlationId: string
  actor: MemoryActorDto
  openedAt: string
  committedAt: string
  command: MemoryCommandEnvelopeDto
  events: MemoryEventEnvelopeDto[]
}

export type MemoryRepresentationFormDto =
  | 'scene'
  | 'structure'
  | 'self-model'
  | 'person-model'
  | 'relationship-model'
  | 'disposition'
  | 'open-loop'
  | 'prospect'

export interface MemoryRepresentationDto {
  id: string
  form: MemoryRepresentationFormDto
  data: Record<string, unknown>
  state: {
    persistence: string
    activation: string
    integration: string
    epistemic: string
    influence: string
  }
  dynamics: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface MemorySceneSummaryDto {
  id: string
  version: string
  status: 'open' | 'closed'
  participants: string[]
  environment: string
  goals: string[]
  observationCount: number
  startedAt: string
  updatedAt: string
}

export interface MemoryRecallCycleSummaryDto {
  cycleId: string
  createdAt: string
  materializedVersion: number
  itemCount: number
}

export interface MemoryRecallCycleDto {
  cycleId: string
  createdAt: string
  materializedVersion: number
  itemCount: number
  workspace: Record<string, unknown>
  trace: Record<string, unknown>
}

export interface MemoryCorrectionRequestDto {
  memoryId: string
  replacement: { form: MemoryRepresentationFormDto; data: Record<string, unknown> }
  evidenceIds?: string[]
  explanation: string
  ownerId: string
}

export interface MemoryInfluenceRestrictRequestDto {
  memoryId: string
  surfaces: string[]
  reason: string
  ownerId: string
}

export interface MemoryInfluenceRevokeRequestDto {
  memoryId: string
  reason: string
  ownerId: string
}

export interface MemoryErasePreviewRequestDto {
  rootMemoryIds: string[]
}

export interface MemoryErasePreviewDto {
  rootMemoryIds: string[]
  erasedMemoryIds: string[]
  retractedLinkIds: string[]
  dependentMemoryIds: string[]
  unaffectedMemoryIds: string[]
  scopeHash: string
}

export interface MemoryEraseAuthorizationDto {
  authorizationId: string
  memoryIds: string[]
  expiresAt: string
  scopeHash: string
}

export interface MemoryEraseAuthorizeRequestDto {
  rootMemoryIds: string[]
  ownerId: string
  ttlMinutes?: number
}

export interface MemoryEraseAuthorizeResponseDto {
  authorization: MemoryEraseAuthorizationDto
  preview: MemoryErasePreviewDto
}

export interface MemoryEraseCommitRequestDto {
  authorizationId: string
  ownerId: string
}

export interface MemoryRestoreRequestDto {
  transactions: MemoryTransactionEnvelopeDto[]
}
