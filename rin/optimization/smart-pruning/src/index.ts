/**
 * rin smart pruning — Cordis plugin entry.
 *
 * Exposes a ctx.smartPruning service: the deterministic tool-result optimizer
 * that deduplicates repeated results, omits superseded file reads, and
 * truncates over-budget output. The core module (core.ts) owns the algorithm;
 * this module owns the Cordis registration only.
 *
 * @module @rin/smart-pruning
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { SmartPruningService } from './core.ts'
import type { OptimizationMessage } from './core.ts'
import type {
  SmartPruningConfig,
  SmartPruningLevel,
  SmartPruningStats,
  SmartPruningStatus,
} from './types.ts'

export type * from './types.ts'
export type { OptimizationMessage } from './core.ts'
export {
  SmartPruningService,
  pruneMessagesForAPI,
  isSmartPruningLevel,
} from './core.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    smartPruning: SmartPruningStore
  }
}

/** The smart-pruning service exposed on the shared context. */
export class SmartPruningStore extends Service {
  private readonly service: SmartPruningService

  constructor(ctx: Context, config: SmartPruningConfig = {}) {
    super(ctx, 'smartPruning')
    this.service = new SmartPruningService(config)
  }

  /** @returns the current enabled/level state. */
  getStatus(): SmartPruningStatus {
    return this.service.getStatus()
  }

  /** Enable or disable pruning for subsequent optimizeMessages calls. */
  setEnabled(enabled: boolean): SmartPruningStatus {
    return this.service.setEnabled(enabled)
  }

  /** Change the pruning policy level. Throws on an unknown level. */
  setLevel(level: SmartPruningLevel): SmartPruningStatus {
    return this.service.setLevel(level)
  }

  /**
   * Optimize one message list in place (newest-first).
   * @param messages - the message list to optimize.
   * @returns the rewritten messages and aggregate pruning stats.
   */
  optimizeMessages<T extends OptimizationMessage>(
    messages: readonly T[],
  ): { messages: T[]; stats: SmartPruningStats } {
    return this.service.optimizeMessages(messages)
  }

  /** Restore the constructor configuration; test hook. */
  resetForTesting(): void {
    this.service.resetForTesting()
  }
}

export const name = 'smart-pruning'
export const inject = []

/** Install the smart-pruning service into the shared context. */
export function apply(ctx: Context): void {
  ctx.plugin(SmartPruningStore)
}
