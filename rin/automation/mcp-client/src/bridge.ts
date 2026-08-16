/**
 * rin mcp-client — bridge orchestration.
 *
 * Owns the live @deepseek-ai/dsh-mcp-client instances: on every store snapshot
 * it maps the non-disabled servers (see map.ts), disposes removed or changed
 * instances, and loads new or changed ones as one namespace-plugin instance
 * per server. It subscribes to ctx.mcp change notifications so config edits
 * hot-apply without a host restart.
 *
 * Child instances are mounted fire-and-forget: the bridge never awaits a
 * server connection, so a broken or hanging server cannot block host
 * activation or the other servers.
 *
 * @module @rin/mcp-client
 */

import { Context } from '@deepseek-ai/cordis'
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'
import { selectServersToLoad } from './map.ts'

/** One live child instance: a dsh-mcp-client fiber, or a test stub. */
export interface ChildInstance {
  /** Tear the child down; real fibers dispose idempotently. */
  dispose(): Promise<void> | void
}

/** How the bridge loads one child instance; overridable in tests. */
export type ClientLoader = (ctx: Context, config: mcpClient.Config) => ChildInstance

/** Default loader: mount one @deepseek-ai/dsh-mcp-client instance per server. */
export function loadClientInstance(ctx: Context, config: mcpClient.Config): ChildInstance {
  return ctx.plugin(mcpClient, config)
}

/** A tracked child plus the fingerprint it was loaded under. */
interface TrackedChild {
  instance: ChildInstance
  fingerprint: string
}

/** Construction options for the bridge. */
export interface McpClientBridgeOptions {
  /** Default per-tool-call timeout (ms) applied to every mapped server. */
  toolCallTimeoutMs: number
  /** Child loader override (tests); defaults to mounting dsh-mcp-client. */
  loadChild?: ClientLoader
}

/** Render an error as a log-line string. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Keep the live dsh-mcp-client instances in sync with the @rin/mcp store.
 *
 * One instance per server name, keyed by the store's unique name. Re-syncs
 * are serialized on an internal promise chain so concurrent store changes
 * never interleave their dispose/load phases.
 */
export class McpClientBridge {
  private readonly children = new Map<string, TrackedChild>()
  private readonly toolCallTimeoutMs: number
  private readonly loadChild: ClientLoader
  private syncChain: Promise<void> = Promise.resolve()
  private disposed = false
  private readonly unsubscribe: () => void

  /**
   * @param ctx - the plugin context (must expose the mcp store).
   * @param options - timeout default and child loader.
   */
  constructor(
    private readonly ctx: Context,
    options: McpClientBridgeOptions,
  ) {
    this.toolCallTimeoutMs = options.toolCallTimeoutMs
    this.loadChild = options.loadChild ?? loadClientInstance
    this.unsubscribe = ctx.mcp.onChange(() => {
      this.resync()
    })
  }

  /**
   * Kick off the initial synchronize-and-load pass.
   * @returns the pass promise; a store read failure is logged, never thrown.
   */
  start(): Promise<void> {
    return this.resync()
  }

  /**
   * Tear the bridge down: unsubscribe from store changes and dispose every
   * child instance. Idempotent.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribe()
    await Promise.allSettled([...this.children.values()].map(entry => entry.instance.dispose()))
    this.children.clear()
  }

  /** Serialized store re-sync; errors are logged, never thrown to listeners. */
  private resync(): Promise<void> {
    // A store read failure must not break the subscription loop or the host:
    // log it once and keep the chain alive for the next change.
    const run = this.syncChain.then(() => this.sync())
    this.syncChain = run.catch(() => {})
    return run.catch((error: unknown) => {
      this.ctx.logger.error('rin mcp-client: store re-sync failed: ' + describeError(error))
    })
  }

  /**
   * Reconcile the live children with a fresh store snapshot.
   *
   * Removed or now-unloadable servers are disposed; changed servers are
   * disposed and reloaded (fingerprint comparison over the mapped config);
   * new servers are loaded. Invalid servers are reported through the logger
   * (fail loud per server) and skipped.
   * @returns a promise resolving once the snapshot was reconciled.
   */
  async sync(): Promise<void> {
    const servers = await this.ctx.mcp.list()
    const selection = selectServersToLoad(servers, { toolCallTimeoutMs: this.toolCallTimeoutMs })
    for (const invalid of selection.invalid) {
      this.ctx.logger.error('rin mcp-client: skipping server "' + invalid.name + '": ' + invalid.reason)
    }
    for (const name of selection.disabled) {
      this.ctx.logger.info('rin mcp-client: server "' + name + '" is disabled — not loaded')
    }

    const desired = new Map(selection.load.map(entry => [entry.name, entry]))

    // Dispose servers that were removed, disabled, or became invalid.
    for (const [name, tracked] of this.children) {
      if (!desired.has(name)) {
        await tracked.instance.dispose()
        this.children.delete(name)
      }
    }

    // Load new servers; reload changed ones (fingerprint mismatch).
    for (const entry of selection.load) {
      const tracked = this.children.get(entry.name)
      if (tracked !== undefined && tracked.fingerprint === entry.fingerprint) continue
      if (tracked !== undefined) {
        await tracked.instance.dispose()
        this.children.delete(entry.name)
      }
      if (this.disposed) return
      const instance = this.loadChild(this.ctx, entry.config)
      this.children.set(entry.name, { instance, fingerprint: entry.fingerprint })
    }
  }
}
