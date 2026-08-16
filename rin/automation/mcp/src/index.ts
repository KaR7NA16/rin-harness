/**
 * rin mcp — Cordis plugin entry.
 *
 * Exposes a ctx.mcp service: file-backed MCP server configuration CRUD over
 * a versioned JSON document (default ~/.rin/mcp/servers.json). The pure
 * implementation lives in store.ts; this module owns the Cordis registration
 * only. Configuration management only — no MCP protocol connection or tool
 * forwarding.
 *
 * @module @rin/mcp
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { McpChangeListener } from './store.ts'
import type { McpServerConfig, McpServerInput, McpServerPatch } from './types.ts'
import { FileMcpStore, resolveMcpStoreRoot } from './store.ts'

export type * from './types.ts'
export {
  FileMcpStore,
  defaultMcpStoreRoot,
  resolveMcpStoreRoot,
  SERVERS_FILENAME,
} from './store.ts'
export type { McpChangeListener, McpStoreOptions } from './store.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    mcp: McpStore
  }
}

/** The MCP configuration-management service exposed on the shared context. */
export class McpStore extends Service {
  private readonly store: FileMcpStore

  /** @param ctx - the plugin context. @param config - the resolved plugin configuration. */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'mcp')
    this.store = new FileMcpStore({ storeRoot: resolveMcpStoreRoot(config.storeRoot) })
  }

  /** @returns every server config, sorted by name. */
  list(): Promise<McpServerConfig[]> {
    return this.store.list()
  }

  /** @param name - the server name. @returns the server, or null when unknown. */
  get(name: string): Promise<McpServerConfig | null> {
    return this.store.get(name)
  }

  /** @param input - the server fields. @returns the created server. */
  create(input: McpServerInput): Promise<McpServerConfig> {
    return this.store.create(input)
  }

  /** @param name - the server name. @param patch - the fields to merge. @returns the patched server. */
  update(name: string, patch: McpServerPatch): Promise<McpServerConfig> {
    return this.store.update(name, patch)
  }

  /** @param name - the server name. @returns true when the server was removed. */
  remove(name: string): Promise<boolean> {
    return this.store.remove(name)
  }

  /**
   * Subscribe to store mutations (create/update/remove).
   * @param listener - the change listener; receives no payload, re-read the store.
   * @returns a disposer that unsubscribes the listener.
   */
  onChange(listener: McpChangeListener): () => void {
    return this.store.onChange(listener)
  }
}

export const name = 'mcp'
export const inject: string[] = []

/** Plugin configuration: an optional store root (defaults to ~/.rin/mcp). */
export interface Config {
  storeRoot?: string
}

export const Config: z<Config> = z.object({
  storeRoot: z.string().required(false),
})

/**
 * Install the file-backed MCP configuration service.
 *
 * @param ctx - the plugin context.
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.plugin(McpStore, config)
}
