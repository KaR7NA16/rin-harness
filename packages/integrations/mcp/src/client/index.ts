/**
 * MCP client Cordis entry point.
 *
 * Kept as a subpath entry so the host preserves the original dependency order:
 * the configuration store is installed first, then this bridge injects the
 * mcp and tools services and mounts one protocol client per enabled server.
 *
 * @module @rin/mcp/client
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { McpClientBridge } from './bridge.ts'
import { DEFAULT_TOOL_CALL_TIMEOUT_MS } from './map.ts'

export {
  McpClientBridge,
  loadClientInstance,
  type ChildInstance,
  type ClientLoader,
  type McpClientBridgeOptions,
} from './bridge.ts'
export {
  DEFAULT_FAIL_ON_STARTUP_ERROR,
  DEFAULT_TOOL_CALL_TIMEOUT_MS,
  mapServerConfig,
  selectServersToLoad,
  SERVER_NAME_PATTERN,
  type InvalidServer,
  type LoadableServer,
  type MapOptions,
  type MappingResult,
  type ServerSelection,
} from './map.ts'

export const name = 'mcp-client'
export const inject = ['mcp', 'tools']

export interface Config {
  toolCallTimeoutMs?: number
}

export const Config: z<Config> = z.object({
  toolCallTimeoutMs: z.number().required(false),
})

export function apply(ctx: Context, config: Config): void {
  const bridge = new McpClientBridge(ctx, {
    toolCallTimeoutMs: config.toolCallTimeoutMs ?? DEFAULT_TOOL_CALL_TIMEOUT_MS,
  })
  ctx.effect(() => {
    void bridge.start()
    return () => bridge.dispose()
  }, 'rin.mcp-client')
}
