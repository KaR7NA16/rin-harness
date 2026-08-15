/**
 * rin agents — auto-projection seam into the dsh agent-presets user root.
 *
 * `projectRepositoryAgents()` materialises repository agents as dsh presets,
 * but only when a caller invokes it. This module gives that projection a
 * trigger point on the dsh agent lifecycle: it listens for the global
 * `agent/created` event and re-projects the configured repository's agents
 * whenever their content changed since the last successful projection, so a
 * burst of agent creation never causes a redundant full rewrite.
 *
 * The seam is structural — it imports no Cordis types, only node: builtins and
 * the package's own repository/projection modules — so it is strip-types
 * smoke-testable. The listener never throws synchronously: a projection
 * failure is logged loudly through the seam logger and the returned promise
 * settles, so it can never veto the agent publication it observed.
 *
 * @module @rin/agents
 */

import { listRepositoryAgents } from './repository-agents.ts'
import { projectRepositoryAgents } from './projection.ts'
import { resolveDefaultPresetRoot } from './paths.ts'

/** The dsh lifecycle event that triggers an auto-projection. */
export const AUTO_PROJECT_EVENT = 'agent/created'

/** Payload of the dsh `agent/created` emit; the agent itself is not consumed. */
export interface AgentCreatedPayload {
  /** The newly published agent, carried for the event contract. */
  agent: unknown
}

/** Minimal logger surface the seam reports through when present. */
export interface AgentsLogger {
  warn?(...args: unknown[]): void
  error?(...args: unknown[]): void
}

/** The minimal context surface the auto-projection seam consumes. */
export interface AgentsSeam {
  /** Register an event listener; returns its disposer. */
  on(event: string, listener: (payload: AgentCreatedPayload) => unknown, opts?: Record<string, unknown>): () => void
  /** Logger for fail-loud projection reporting; absent means no reporting. */
  logger?: AgentsLogger
}

/** Configuration consumed by the auto-projection seam. */
export interface AgentsSeamConfig {
  /** Enable the `agent/created` trigger; absent defaults to true. */
  autoProject?: boolean
  /** Repository root projected on each trigger; empty means none configured. */
  defaultRepositoryRoot?: string
  /** Preset root receiving presets; absent resolves the default user root. */
  presetRoot?: string
}

/**
 * Compute a content fingerprint of one repository's agents.
 *
 * One `name:revision` line per agent, in repository order. The revision is the
 * file's content digest, so creating, editing, or deleting an agent changes
 * the fingerprint — letting a caller skip a projection whose output would not
 * change.
 * @param repositoryRoot - the repository root.
 * @returns the fingerprint, or '' when the repository holds no agents.
 */
export async function computeRepositoryFingerprint(repositoryRoot: string): Promise<string> {
  return (await listRepositoryAgents(repositoryRoot))
    .map(agent => `${agent.name}:${agent.revision}`)
    .join('\n')
}

/**
 * Debounced auto-projection state: remembers the fingerprint of the last
 * successful projection and re-projects only when the repository changed.
 */
export class AgentProjectionCore {
  private lastFingerprint: string | undefined
  private readonly config: AgentsSeamConfig

  /**
   * @param config - the seam configuration this core projects.
   */
  constructor(config: AgentsSeamConfig) {
    this.config = config
  }

  /**
   * Handle one `agent/created` event.
   *
   * Projects the configured repository root into the preset root when the
   * repository content changed since the last successful projection, and skips
   * the write otherwise. A missing repository root is a no-op — the empty
   * default means "pass one explicitly".
   * @returns fulfillment when the projection (or the skip) settles.
   */
  onAgentCreated(): Promise<void> {
    const repositoryRoot = (this.config.defaultRepositoryRoot ?? '').trim()
    if (repositoryRoot === '') return Promise.resolve()
    const presetRoot = this.config.presetRoot ?? resolveDefaultPresetRoot()
    return this.projectIfChanged(repositoryRoot, presetRoot)
  }

  /** Project when the repository fingerprint differs from the last projection. */
  private async projectIfChanged(repositoryRoot: string, presetRoot: string): Promise<void> {
    const fingerprint = await computeRepositoryFingerprint(repositoryRoot)
    if (fingerprint === this.lastFingerprint) return
    await projectRepositoryAgents(repositoryRoot, presetRoot)
    this.lastFingerprint = fingerprint
  }
}

/**
 * Register the auto-projection listener on the seam.
 *
 * When `autoProject` is false this returns a no-op disposer without listening.
 * Otherwise it registers an `agent/created` listener that drives
 * {@link AgentProjectionCore.onAgentCreated} and reports any projection failure
 * through the seam logger, settling instead of re-throwing so a failure can
 * never veto the agent publication it observed.
 * @param ctx - the seam to listen on.
 * @param config - the auto-projection configuration.
 * @returns the listener disposer.
 */
export function registerAgentsSeam(ctx: AgentsSeam, config: AgentsSeamConfig = {}): () => void {
  if (config.autoProject === false) return () => {}
  const core = new AgentProjectionCore(config)
  return ctx.on(AUTO_PROJECT_EVENT, () =>
    core.onAgentCreated().catch((error: unknown) => {
      ctx.logger?.error?.(`rin agents: repository-agent projection failed: ${describeError(error)}`)
    }),
  )
}

/** Render an error as a log-line string. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
