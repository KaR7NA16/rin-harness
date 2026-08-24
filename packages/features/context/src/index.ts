/**
 * @rin/context — aggregate entry for context-budget capabilities.
 *
 * Smart pruning, token optimization, and codegraph share one package because
 * they participate in the same context-budget lifecycle. Their implementation
 * and seam modules remain isolated under src/.
 *
 * @module @rin/context
 */

import { Context } from '@deepseek-ai/cordis'
import { apply as applySmartPruningPlugin } from './smart-pruning/plugin.ts'
import type { SmartPruningConfig } from './smart-pruning/types.ts'
import { apply as applyTokenOptimizationPlugin } from './token-optimization/plugin.ts'
import type { Config as TokenOptimizationConfig } from './token-optimization/plugin.ts'
import { apply as applyCodeGraphPlugin } from './codegraph/plugin.ts'

export type * from './smart-pruning/types.ts'
export type { OptimizationMessage } from './smart-pruning/core.ts'
export {
  SmartPruningService,
  SmartPruningStore,
  isSmartPruningLevel,
  pruneMessagesForAPI,
} from './smart-pruning/plugin.ts'

export {
  cleanPromptText,
  cleanSystemPromptParts,
  TokenOptimizationCore,
  TokenOptimizationStore,
} from './token-optimization/plugin.ts'
export type {
  PromptAssembly,
  TokenKnobConfig,
  TokenOptimizationSeam,
  TokenOptimizationStatus,
} from './token-optimization/plugin.ts'

export type * from './codegraph/analysis.ts'
export {
  CODEGRAPH_BUNDLED_LANGUAGES,
  CodeGraphService,
  FileCodeGraphService,
  confidenceForProvenance,
  formatCodeGraphArchitecture,
  getCodeGraphArchitecture,
  getCodeGraphVisualization,
} from './codegraph/plugin.ts'
export type {
  CodeGraphGlobalStatus,
  CodeGraphState,
  CodeGraphStats,
  CodeGraphStatus,
} from './codegraph/plugin.ts'

/** Cordis loader name for the aggregate context package. */
export const name = 'context'
/** The aggregate package has no mandatory service injection of its own. */
export const inject: string[] = []

/** Configuration for the independently switchable context modules. */
export interface Config {
  smartPruning?: SmartPruningConfig
  tokenOptimization?: TokenOptimizationConfig
}

/**
 * Install smart pruning, token optimization, and codegraph.
 *
 * @param ctx - the shared Cordis context.
 * @param config - optional per-module policies.
 */
export function apply(ctx: Context, config: Config = {}): void {
  applySmartPruningPlugin(ctx, config.smartPruning ?? {})
  applyTokenOptimizationPlugin(ctx, config.tokenOptimization ?? {})
  applyCodeGraphPlugin(ctx)
}
