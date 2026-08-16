/**
 * rin mcp-client — Cordis plugin entry.
 *
 * Bridges the @rin/mcp configuration store to the real MCP protocol client
 * (@deepseek-ai/dsh-mcp-client): on apply, and on every store change, the
 * configured non-disabled servers are mapped and mounted as one dsh-mcp-client
 * instance each, so each server's tools reach the model as
 * mcp__<server>__<tool>. The mapping and instance-lifecycle logic live in
 * map.ts / bridge.ts; this module owns the Cordis registration only.
 *
 * @module @rin/mcp-client
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { DEFAULT_TOOL_CALL_TIMEOUT_MS } from './map.ts'
import { McpClientBridge } from './bridge.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'mcp-client'

/**
 * Services required by this plugin: the mcp configuration store (ctx.mcp) and
 * the tool registry dsh-mcp-client publishes its tools to (ctx.tools).
 */
export const inject = ['mcp', 'tools']

/** Plugin configuration for the @rin/mcp-client bridge. */
export interface Config {
  /**
   * Default per-tool-call timeout (ms) applied to every mapped server;
   * defaults to the dsh-mcp-client default (60000).
   */
  toolCallTimeoutMs?: number
}

export const Config: z<Config> = z.object({
  toolCallTimeoutMs: z.number().required(false),
})

/**
 * Install the MCP bridge: subscribe to the store and load one client per
 * server. Child instances load asynchronously — the bridge never awaits a
 * server connection, so a broken server cannot block host activation.
 * @param ctx - the plugin context (injects mcp + tools).
 * @param config - the resolved bridge configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const bridge = new McpClientBridge(ctx, {
    toolCallTimeoutMs: config.toolCallTimeoutMs ?? DEFAULT_TOOL_CALL_TIMEOUT_MS,
  })
  ctx.effect(() => {
    void bridge.start()
    // The ctx.plugin() calls inside sync() register child fibers under this
    // fiber, so disposal cascades; bridge.dispose() makes the teardown
    // explicit and idempotent.
    return () => bridge.dispose()
  }, 'rin.mcp-client')
}
