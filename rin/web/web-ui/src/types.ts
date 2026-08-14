/**
 * Domain types for the rin web UI. These mirror the JSON shapes returned by
 * the @rin/web-server read-only API, one interface per endpoint payload.
 */

export interface AssetMetadata {
  id: string
  name: string
  version: string
  source?: string
}

export type RepositoryRoot =
  | 'environments' | 'agents' | 'skills' | 'workflows' | 'tools'
  | 'knowledge' | 'policies' | 'outputs' | 'bundles'

export type RepositoryRoots = Partial<Record<RepositoryRoot, string>>

export interface AssetRepositoryManifest {
  apiVersion: string
  kind: string
  metadata: AssetMetadata
  spec: {
    mutable: boolean
    roots: RepositoryRoots
  }
}

export type RepositoryPackageEcosystem = 'python' | 'r' | 'node' | 'system' | 'latex' | 'other'

export interface EnvironmentPackage {
  id: string
  name: string
  ecosystem: RepositoryPackageEcosystem
  version?: string
  description?: string
  dependencies?: string[]
}

export interface EnvironmentPackageCatalog {
  apiVersion: string
  kind: string
  metadata: AssetMetadata
  spec: {
    ecosystem: RepositoryPackageEcosystem
    packages: Array<Omit<EnvironmentPackage, 'ecosystem'>>
  }
}

export interface EnvironmentProfile {
  apiVersion: string
  kind: string
  metadata: AssetMetadata
  spec: {
    packages: string[]
    verify?: {
      pythonImports?: string[]
      rPackages?: string[]
      commands?: string[]
    }
  }
}

export interface RepositoryAgentConfiguration {
  version: number
  kind: string
  name: string
  description: string
  systemPrompt: string
  model?: string
  permissionMode?: string
  tools: string[]
  resources: {
    environmentProfileId?: string
    skillIds: string[]
    workflowIds: string[]
  }
}

export interface AssetRepository {
  rootPath: string
  manifestPath: string
  manifest: AssetRepositoryManifest
  environmentCatalogs: EnvironmentPackageCatalog[]
  environmentPackages: EnvironmentPackage[]
  environmentProfiles: EnvironmentProfile[]
  agents: RepositoryAgentConfiguration[]
}

export type PreflightStatus = 'ready' | 'missing' | 'unsupported'

export interface InstallPreflightCheck {
  id: string
  status: PreflightStatus
  message: string
}

export interface InstallPlanStage {
  id: string
  commands: string[]
}

export interface ResolvedEnvironmentPlan {
  profileId: string
  profileVersion: string
  status: 'ready' | 'blocked'
  packageCount: number
  preflight: InstallPreflightCheck[]
  stages: InstallPlanStage[]
}

export type KnowledgeSourceKind = 'file' | 'folder'
export type KnowledgeSourceStatus = 'pending' | 'indexing' | 'ready' | 'empty' | 'error'

export interface KnowledgeSource {
  id: string
  path: string
  name: string
  kind: KnowledgeSourceKind
  status: KnowledgeSourceStatus
  error: string | null
  documentCount: number
  chunkCount: number
  sizeBytes: number
  createdAt: string
  updatedAt: string
  indexedAt: string | null
}

export interface KnowledgeDocument {
  id: string
  sourceId: string
  path: string
  relativePath: string
  title: string
  extension: string
  indexMode: 'text' | 'metadata'
  sizeBytes: number
  modifiedAt: string
  indexedAt: string
  error: string | null
}

export interface KnowledgeSearchResult {
  chunkId: number
  sourceId: string
  documentId: string
  sourceName: string
  title: string
  path: string
  excerpt: string
  score: number
}

export interface KnowledgeStats {
  sourceCount: number
  documentCount: number
  chunkCount: number
  sizeBytes: number
  indexingCount: number
}

export interface SessionSearchMessage {
  id: number
  role: string
  type: string
  content: string
  timestamp: string | null
  model: string | null
  line: number
  anchor?: boolean
}

export interface SessionMatch {
  line: number
  text: string
}

export interface SessionSearchHit {
  sessionId: string
  projectPath: string
  workDir: string | null
  title: string
  matchedRole?: string
  matchMessageId?: number
  snippet?: string
  messages: SessionSearchMessage[]
  bookendStart?: SessionSearchMessage[]
  bookendEnd?: SessionSearchMessage[]
  messagesBefore?: number
  messagesAfter?: number
  matchCount: number
  matches: SessionMatch[]
}

export interface SessionBrowseResult {
  success: true
  mode: 'browse'
  results: SessionSearchHit[]
  count: number
}

export interface SessionDiscoverResult {
  success: true
  mode: 'discover'
  query: string
  results: SessionSearchHit[]
  count: number
}

export interface SessionReadResult {
  success: true
  mode: 'read'
  sessionId: string
  projectPath: string
  title: string
  messages: SessionSearchMessage[]
  messagesBefore: number
  messagesAfter: number
  count: number
}

export type PromptMemoryTarget = 'soul' | 'brief' | 'user'

export interface PromptMemoryFile {
  target: PromptMemoryTarget
  filename: string
  path: string
  exists: boolean
  content: string
  entries: string[]
  format: 'empty' | 'plain' | 'entries'
  charCount: number
  limit: number
  overLimit: boolean
}

export interface PromptMemoryStatus {
  files: Record<PromptMemoryTarget, PromptMemoryFile>
}

export interface PromptMemoryReviewLogEntry {
  id: string
  timestamp: string
  sessionId: string
  trigger: 'explicit' | 'interval'
  target: 'user' | 'brief'
  action: 'add' | 'replace' | 'remove'
  changed: boolean
  content?: string
  oldText?: string
  message: string
}

export type SkillLearningMode = 'off' | 'suggest' | 'auto'

export interface SkillLearningConfig {
  version: number
  mode: SkillLearningMode
  minToolUses: number
  minConfidence: number
  autoApproveConfidence: number
  updatedAt?: string
}

export type SkillCandidateStatus = 'pending' | 'approved' | 'rejected' | 'failed'
export type SkillCandidateScope = 'project' | 'global'

export interface SkillCandidate {
  version: number
  id: string
  status: SkillCandidateStatus
  action: 'create' | 'update'
  scope: SkillCandidateScope
  projectRoot?: string
  name: string
  description: string
  whenToUse: string
  reason: string
  evidence: string[]
  confidence: number
  markdown: string
  sourceSessionId?: string
  sourceFingerprint: string
  sourceToolUses: number
  target?: { skillName: string; source: 'project' | 'user' }
  duplicate?: { skillName: string; score: number; decision: 'reuse' | 'merge' }
  createdAt: string
  updatedAt: string
  reviewedAt?: string
  outputPath?: string
  error?: string
}

export interface SkillLearningEvent {
  id: string
  kind: string
  createdAt: string
  projectRoot?: string
  sessionId?: string
  candidateId?: string
  skillName?: string
  message: string
  toolUseCount?: number
}

export interface SkillMemoryOverview {
  id: string
  skillName: string
  scope: SkillCandidateScope
  status: 'active' | 'stale' | 'archived' | 'pinned'
  useCount: number
  pendingCount: number
  evidenceCount: number
  lastUsedAt?: string
  summaryUpdatedAt?: string
  summary?: string
}

export interface SkillLearningOverview {
  config: SkillLearningConfig
  pendingCandidates: SkillCandidate[]
  recentCandidates: SkillCandidate[]
  events: SkillLearningEvent[]
  memories: SkillMemoryOverview[]
}

export interface SmartPruningStatus {
  enabled: boolean
  level: string
  mode: string
}

/** One skill-memory overview record (mirrors the web-server's projected shape). */
export interface SkillMemoryOverviewRecord {
  id: string
  skillName: string
  scope: 'global' | 'project'
  status: string
  useCount: number
  pendingCount: number
  evidenceCount: number
  lastUsedAt?: string
  summaryUpdatedAt?: string
  summary?: string
}

/** /api/knowledge/sources payload. */
export interface KnowledgeSourcesPayload { sources: KnowledgeSource[] }

/** /api/knowledge/documents payload. */
export interface KnowledgeDocumentsPayload { documents: KnowledgeDocument[] }

/** /api/knowledge/search payload. */
export interface KnowledgeSearchPayload { results: KnowledgeSearchResult[] }

/** /api/prompt-memory/review-logs payload. */
export interface PromptMemoryLogsPayload { logs: PromptMemoryReviewLogEntry[] }

/** /api/skill-memory/overview payload. */
export interface SkillMemoryOverviewPayload { skills: SkillMemoryOverviewRecord[] }

/** /api/evolution/overview payload (the endpoint returns this subset, no memories). */
export interface EvolutionOverview {
  config: SkillLearningConfig
  pendingCandidates: SkillCandidate[]
  recentCandidates: SkillCandidate[]
  events: SkillLearningEvent[]
}
