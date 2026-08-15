/**
 * rin evolution — dsh seam projection wiring.
 *
 * The only projection today is the opt-in automatic-review trigger adapter.
 * The review loop itself is model-driven and entered manually through the
 * web-server route; the evolution core has no session- or period-driven
 * trigger design, so this module exposes the wiring point and its switch
 * without inventing a review loop. The structural seam keeps the module free
 * of the Cordis import graph, so the wiring is strip-types smoke-testable.
 *
 * @module @rin/evolution
 */

/** The session lifecycle event the opt-in trigger subscribes to. */
export const EVOLUTION_TRIGGER_EVENT = 'session/created'

/** The minimal context surface the trigger adapter consumes (subset of Cordis Context). */
export interface EvolutionSeam {
  /** Register an event listener; returns its disposer. */
  on(event: string, listener: (payload: unknown) => void | Promise<void>): () => void
}

/** The opt-in trigger configuration surface (subset of EvolutionPluginConfig). */
export interface EvolutionTriggerConfig {
  /** Opt-in automatic review trigger; defaults to off. */
  autoTrigger?: boolean
  /** Optional non-durable debug logging adapter. */
  logDebug?: (message: string) => void
}

/**
 * Register the opt-in automatic-review trigger adapter.
 *
 * Disabled by default: when `config.autoTrigger` is not `true` this registers
 * nothing and returns a no-op disposer. When enabled it subscribes to
 * {@link EVOLUTION_TRIGGER_EVENT}; the handler is a wiring point only — the
 * evolution loop has no session→review mapping, so it records a debug line and
 * leaves the actual review invocation to that future mapping.
 *
 * @param seam - the minimal context surface.
 * @param config - the resolved trigger configuration.
 * @returns a disposer removing the registered listener (no-op when disabled).
 */
export function registerEvolutionTriggers(
  seam: EvolutionSeam,
  config: EvolutionTriggerConfig,
): () => void {
  if (config.autoTrigger !== true) return () => {}
  return seam.on(EVOLUTION_TRIGGER_EVENT, () => {
    config.logDebug?.(
      '[skill-learning] automatic review trigger fired on ' + EVOLUTION_TRIGGER_EVENT
      + '; the session→review mapping is a wiring point and not yet implemented',
    )
  })
}

/**
 * Register every evolution seam projection on the shared context.
 *
 * Currently delegates to {@link registerEvolutionTriggers}. The listener is
 * registered through the seam's own `on`, so the host context owns its
 * disposal (Cordis disposes `ctx.on` registrations with the fiber).
 *
 * @param seam - the minimal context surface (subset of Cordis Context).
 * @param config - the resolved trigger configuration.
 * @returns the trigger disposer (no-op when autoTrigger is disabled).
 */
export function registerSeam(
  seam: EvolutionSeam,
  config: EvolutionTriggerConfig,
): () => void {
  return registerEvolutionTriggers(seam, config)
}
