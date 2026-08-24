/**
 * rin session-search — dsh seam registration.
 *
 * Adapts the real Cordis Context to the structural SessionSearchSeam and
 * constructs the SessionSearchCore, which listens for session lifecycle edges
 * and registers the model-visible rin_session_search / rin_session_stats
 * tools. This module is the only place that touches @deepseek-ai/cordis and
 * @deepseek-ai/dsh-tools; all logic lives in the dependency-free core.
 *
 * @module @rin/memory/session-search
 */

import { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  resolveSessionSearchConfig,
  SessionSearchCore,
  type SessionSearchSeam,
  type SessionSearchTool,
} from './seam-core.ts'
import type { SessionSearchRoots } from './types.ts'

/** Plugin configuration: index placement plus optional projection policy. */
export interface Config extends SessionSearchRoots {
  /** Optional explicit database path overriding the configRoot-derived default. */
  dbPath?: string
  /** Optional home directory for temporary-session classification. */
  homeDir?: string
  /** Optional project-path normalization policy. */
  projectPathForWorkingDirectory?: (workDir: string) => string
}

/** Wrap one structural tool descriptor into a registry-ready dsh tool. */
function toDshTool(tool: SessionSearchTool) {
  // The descriptor is built to satisfy defineTool's input structurally; the
  // any keeps defineTool's schema generics from recursing (TS2321 on the wide
  // DefineToolOptions instantiation). Shape is enforced by tools-core + smoke.
  // oxlint-disable-next-line no-explicit-any -- structural seam: TS2321 on the wide DefineToolOptions union
  return tool as any
}

/**
 * Register the seam projection: session indexing plus the search/stats tools.
 * @param ctx - the plugin context (must inject tools).
 * @param config - the resolved plugin configuration.
 */
export function registerSeam(ctx: Context, config: Config): void {
  const seam: SessionSearchSeam = {
    tools: {
      register(tool) {
        return ctx.tools.register(defineTool(toDshTool(tool)))
      },
    },
    on: (event, listener, options) =>
      ctx.on(event as never, listener as never, options as never),
    effect: disposer => {
      // ctx.effect expects the body to return an effect (disposer); a bare
      // void-returning callback is not one, so wrap it in a disposing body.
      ctx.effect(() => disposer, 'rin/session-search.dispose')
    },
    logger: ctx.logger,
  }
  void new SessionSearchCore(seam, resolveSessionSearchConfig(config))
}
