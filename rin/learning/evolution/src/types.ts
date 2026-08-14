/**
 * rin evolution — skill learning domain model.
 *
 * Owns the shared identity schema for the skill self-evolution loop: the
 * learning configuration, candidate and event records, and the overview
 * projections. The store, approval, and reviewer modules own behavior; the
 * runtime injects configuration roots and model access as adapters.
 *
 * @module @rin/evolution
 */

export const EVOLUTION_API_VERSION = 'rin.dev/v1' as const

export type SkillLearningMode = 'off' | 'suggest' | 'auto'

export type SkillLearningConfig = {
  version: 1
  mode: SkillLearningMode
  minToolUses: number
  minConfidence: number
  autoApproveConfidence: number
  updatedAt?: string
}

export type SkillCandidateStatus = 'pending' | 'approved' | 'rejected' | 'failed'
export type SkillCandidateScope = 'project' | 'global'
export type SkillCandidateAction = 'create' | 'update'

export type SkillCandidateTarget = {
  skillName: string
  source: 'project' | 'user'
}

export type SkillCandidate = {
  version: 1
  id: string
  status: SkillCandidateStatus
  action: SkillCandidateAction
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
  target?: SkillCandidateTarget
  duplicate?: {
    skillName: string
    score: number
    decision: 'reuse' | 'merge'
  }
  createdAt: string
  updatedAt: string
  reviewedAt?: string
  outputPath?: string
  error?: string
}

export type SkillLearningEventKind =
  | 'review-skipped'
  | 'review-started'
  | 'candidate-created'
  | 'candidate-auto-approved'
  | 'no-candidate'
  | 'candidate-reused'
  | 'review-failed'
  | 'candidate-approved'
  | 'candidate-rejected'

export type SkillLearningEvent = {
  id: string
  kind: SkillLearningEventKind
  createdAt: string
  projectRoot?: string
  sessionId?: string
  candidateId?: string
  skillName?: string
  message: string
  toolUseCount?: number
}

export type SkillLearningState = {
  version: 1
  candidates: SkillCandidate[]
  events: SkillLearningEvent[]
}

export type SkillMemoryOverview = {
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

export type SkillLearningOverview = {
  config: SkillLearningConfig
  pendingCandidates: SkillCandidate[]
  recentCandidates: SkillCandidate[]
  events: SkillLearningEvent[]
  memories: SkillMemoryOverview[]
}

export const DEFAULT_SKILL_LEARNING_CONFIG: SkillLearningConfig = {
  version: 1,
  mode: 'auto',
  minToolUses: 6,
  minConfidence: 0.78,
  autoApproveConfidence: 0.92,
}

/**
 * Configuration roots the runtime injects to locate the skill learning store
 * and the skills output directories. projectConfigRoot is required only for
 * project-scoped candidates.
 */
export type EvolutionRoots = {
  globalConfigRoot: string
  projectConfigRoot?: string
}

/** One content block of an assistant or user message (adapter-provided). */
export type EvolutionMessageBlock = {
  type: string
  [key: string]: unknown
}

/**
 * Minimal message shape the reviewer needs: role, content (text or blocks),
 * and an optional meta flag for invisible transcript entries.
 */
export type EvolutionMessage = {
  type: 'user' | 'assistant'
  message: {
    role: 'user' | 'assistant'
    content: string | EvolutionMessageBlock[]
  }
  isMeta?: boolean
}

/**
 * Minimal existing-skill shape the reviewer needs to build the catalog and
 * feed the creation gate. A superset of the skill-memory gate comparable.
 */
export type EvolutionSkill = {
  name: string
  description?: string
  whenToUse?: string
  source?: string
  loadedFrom?: string
  skillRoot?: string
  hasUserSpecifiedDescription?: boolean
}

/** Injected model adapter: turns a review prompt into a completion string. */
export type EvolutionReviewModel = (prompt: string, model: string) => Promise<string>

/** One review pass input, matching the runtime's post-turn hook surface. */
export type EvolutionReviewInput = {
  querySource: string
  /** The active session id (for dedup, fingerprints, and provenance). */
  sessionId: string
  /** The project configuration root (required for project-scoped skills). */
  projectRoot?: string
  messages: EvolutionMessage[]
  toolUseContext: {
    agentId?: unknown
    options: {
      commands: readonly EvolutionSkill[]
      mainLoopModel: string
    }
  }
}

/** Optional runtime adapters the reviewer and approval call back into. */
export type EvolutionAdapters = {
  reviewModel: EvolutionReviewModel
  clearCatalog?: () => void | Promise<void>
  appendNotice?: (text: string) => void
  logDebug?: (message: string) => void
}
