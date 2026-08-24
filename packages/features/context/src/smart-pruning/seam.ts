/**
 * rin smart pruning — dsh session-surface seam.
 *
 * Registers the `agent/pre-step` trigger that drives the deterministic
 * dedup + superseded-read pass over each agent's session surface (see
 * seam-core.ts). The level and enabled flag are read live from the
 * `ctx.smartPruning` store on every trigger, so `setLevel`/`setEnabled`
 * hot-apply without re-registration. The seam is structural — it imports no
 * Cordis types — so it is strip-types smoke-testable.
 *
 * @module @rin/context
 */

import type { SmartPruningLevel } from './types.ts'
import { pruneSessionSurface, type PruneSession } from './seam-core.ts'

/** The dsh step-boundary event that triggers a pruning pass. */
export const PRE_STEP_EVENT = 'agent/pre-step'

/** Structural subset of the `ctx.smartPruning` store the seam reads. */
export interface SmartPruningStoreLike {
  /** @returns the live enabled/level state. */
  getStatus(): { enabled: boolean; level: SmartPruningLevel }
}

/** Structural subset of the optional `ctx.tokenMeter` used for shadow pricing. */
export interface TokenMeterLike {
  /** Heuristically price one model-visible message. */
  estimateMessage(message: unknown): number
}

/** The `agent/pre-step` payload, narrowed to the fields the seam consumes. */
export interface PreStepPayload {
  /** The agent whose session is pruned before the step enters. */
  agent: { session: PruneSession }
}

/** Minimal logger surface the seam reports through when present. */
export interface SmartPruningLogger {
  warn?(...args: unknown[]): void
}

/** The minimal context surface the seam consumes. */
export interface SmartPruningSeam {
  /** Resolve a service by name; undefined when absent. */
  get(name: string): unknown
  /** Register an event listener; returns its disposer. */
  on(event: string, listener: (payload: PreStepPayload, next: () => Promise<unknown>) => unknown | Promise<unknown>): () => void
  /** Logger for fail-loud reporting; absent means no reporting. */
  logger?: SmartPruningLogger
}

/**
 * Register the pruning trigger on the seam.
 *
 * The listener reads the store's live state on each trigger, so it prunes
 * only while `enabled` is true and uses the current `level`. Failures are
 * reported through the seam logger and never veto the step: the handler
 * always delegates via `next()` so the waterfall cannot be short-circuited.
 * @param ctx - the seam to listen on (must expose the `smartPruning` store).
 * @returns the listener disposer.
 */
export function registerSeam(ctx: SmartPruningSeam): () => void {
  return ctx.on(PRE_STEP_EVENT, (payload, next) => {
    try {
      const store = ctx.get('smartPruning') as SmartPruningStoreLike | undefined
      if (!store) return next()
      const { enabled, level } = store.getStatus()
      if (!enabled) return next()
      const session = payload.agent.session
      const meter = ctx.get('tokenMeter') as TokenMeterLike | undefined
      const estimate = meter === undefined ? undefined : (message: unknown) => meter.estimateMessage(message)
      pruneSessionSurface(session, level, estimate)
      return next()
    } catch (error: unknown) {
      ctx.logger?.warn?.('rin smart-pruning: session pruning failed: ' + describeError(error))
      return next()
    }
  })
}

/** Render an error as a log-line string. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
