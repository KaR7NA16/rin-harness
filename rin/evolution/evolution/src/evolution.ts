/**
 * rin evolution — skill self-evolution orchestration.
 *
 * createEvolution(roots, adapters) composes the candidate store, approval,
 * and model-driven reviewer into one closed loop, and projects prompt-memory
 * insights for the consolidation side. It depends on no runtime types beyond
 * the injected model adapter; the deterministic creation gate is delegated to
 * skill memory.
 *
 * @module @rin/evolution
 */

import { buildPromptMemoryInsights } from '../../../memory/prompt-memory/src/insights.ts'
import { readPromptMemoryReviewLogs } from '../../../memory/prompt-memory/src/reviewLog.ts'
import { readPromptMemoryFile } from '../../../memory/prompt-memory/src/store.ts'
import type {
  PromptMemoryInsights,
  PromptMemoryRoots,
} from '../../../memory/prompt-memory/src/types.ts'
import { createEvolutionApproval } from './approval.ts'
import { createEvolutionReviewer } from './reviewer.ts'
import { createEvolutionStore } from './store.ts'
import type { EvolutionAdapters, EvolutionRoots } from './types.ts'

/**
 * Project prompt-memory entries and the auto-review log into categorized
 * insights. Reads USER.md and BRIEF.md entries plus the review log, then
 * delegates to prompt-memory's pure insight builder.
 *
 * @param params.roots - the prompt-memory configuration root.
 * @param params.limit - review-log entries to read (default 50).
 */
export async function projectPromptMemoryInsights(params: {
  roots: PromptMemoryRoots
  limit?: number
}): Promise<PromptMemoryInsights> {
  const [userFile, briefFile, logs] = await Promise.all([
    readPromptMemoryFile(params.roots, '', 'user', { seed: false }),
    readPromptMemoryFile(params.roots, '', 'brief', { seed: false }),
    readPromptMemoryReviewLogs(params.roots, params.limit ?? 50),
  ])
  return buildPromptMemoryInsights({
    files: {
      user: { entries: userFile.entries },
      brief: { entries: briefFile.entries },
    },
    logs: logs.map(log => ({
      timestamp: log.timestamp,
      trigger: log.trigger,
      target: log.target,
      changed: log.changed,
      ...(log.content === undefined ? {} : { content: log.content }),
    })),
  })
}

/**
 * Compose the candidate store, approval, and reviewer into one skill learning
 * loop bound to the injected configuration roots and model adapter.
 *
 * @param deps.roots - the global and optional project configuration roots.
 * @param deps.adapters - the injected model and callback adapters.
 */
export function createEvolution(deps: {
  roots: EvolutionRoots
  adapters: EvolutionAdapters
}) {
  const { roots, adapters } = deps
  const store = createEvolutionStore(roots)
  const approval = createEvolutionApproval({
    roots,
    store,
    clearCatalog: adapters.clearCatalog,
    logDebug: adapters.logDebug,
  })
  const reviewer = createEvolutionReviewer({
    store,
    approval,
    reviewModel: adapters.reviewModel,
    appendNotice: adapters.appendNotice,
    logDebug: adapters.logDebug,
  })

  return {
    // configuration and state
    readConfig: store.readConfig,
    updateConfig: store.updateConfig,
    readState: store.readState,
    ensureRoot: store.ensureRoot,
    // candidates and events
    saveCandidate: store.saveCandidate,
    getCandidate: store.getCandidate,
    updateCandidate: store.updateCandidate,
    recordEvent: store.recordEvent,
    approveCandidate: approval.approveCandidate,
    rejectCandidate: approval.rejectCandidate,
    // visibility and overview
    isCandidateVisibleFromCwd: store.isCandidateVisibleFromCwd,
    isEventVisibleFromCwd: store.isEventVisibleFromCwd,
    listSkillMemoryOverview: store.listSkillMemoryOverview,
    projectPromptMemoryInsights,
    // review loop
    executeReview: reviewer.executeReview,
    drainPendingReviews: reviewer.drainPendingReviews,
    resetForTesting: reviewer.resetForTesting,
  }
}

export type Evolution = ReturnType<typeof createEvolution>
