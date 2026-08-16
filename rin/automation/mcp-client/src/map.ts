/**
 * rin mcp-client — pure config mapping between the @rin/mcp configuration
 * store and the @deepseek-ai/dsh-mcp-client plugin config.
 *
 * Cordis-free so the strip-types smoke test can exercise it directly. This
 * module owns the bridge's two explicit decision rules:
 *   - disabled servers are never loaded;
 *   - a server whose name fails the dsh serverName pattern or whose
 *     transport-required field (command / url) is empty is rejected per
 *     server with a reason — fail loud per server, never crash the host.
 *
 * @module @rin/mcp-client
 */

import type { McpServerConfig } from '@rin/mcp'
import type { Config as ClientConfig } from '@deepseek-ai/dsh-mcp-client'

/** The dsh serverName contract, mirrored here so mapping needs no client runtime. */
export const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** Default per-tool-call timeout (ms) applied to every mapped server. */
export const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000

/**
 * Startup-failure policy applied to every mapped server. Kept fixed at the
 * dsh default (false): a server whose initial connection fails must log and
 * enter its reconnect loop, never reject the host's bridge activation.
 */
export const DEFAULT_FAIL_ON_STARTUP_ERROR = false

/** One server rejected by mapping validation, with the reason. */
export interface InvalidServer {
  /** The configured server name (as stored). */
  name: string
  /** Human-readable rejection reason for the fail-loud log line. */
  reason: string
}

/** A server selected for loading, already mapped to the client plugin config. */
export interface LoadableServer {
  /** The client namespace — the store's server name. */
  name: string
  /** The mapped @deepseek-ai/dsh-mcp-client plugin config. */
  config: ClientConfig
  /**
   * Stable identity of the mapped config. The bridge compares fingerprints to
   * skip unchanged servers during re-sync; a status-only store change does
   * not alter it.
   */
  fingerprint: string
}

/** The selection result for one store snapshot. */
export interface ServerSelection {
  /** Non-disabled servers that passed validation, mapped to client configs. */
  load: LoadableServer[]
  /** Non-disabled servers rejected by validation (fail loud per server). */
  invalid: InvalidServer[]
  /** Disabled server names, intentionally not loaded. */
  disabled: string[]
}

/** The per-server tool-call timeout applied during mapping. */
export interface MapOptions {
  toolCallTimeoutMs: number
}

/** The outcome of mapping one server config. */
export type MappingResult =
  | { ok: true; config: ClientConfig }
  | { ok: false; error: string }

/**
 * Map one non-disabled server config to the dsh-mcp-client plugin config.
 *
 * `http` and `sse` both map onto the dsh streamable-http transport; stdio maps
 * onto the child-process transport with an empty cwd. The tool-call timeout
 * and startup-failure policy are the bridge's fixed per-server values.
 * @param server - the stored server config.
 * @param options - the mapping defaults (tool-call timeout).
 * @returns the mapped client config, or a per-server rejection reason.
 */
export function mapServerConfig(server: McpServerConfig, options: MapOptions): MappingResult {
  if (!SERVER_NAME_PATTERN.test(server.name)) {
    return {
      ok: false,
      error: 'name "' + server.name + '" does not match the dsh serverName pattern ' + SERVER_NAME_PATTERN.source,
    }
  }
  if (server.transport === 'stdio') {
    if (!server.command.trim()) {
      return { ok: false, error: 'stdio servers require a non-empty command' }
    }
    return {
      ok: true,
      config: {
        transport: 'stdio',
        serverName: server.name,
        command: server.command,
        args: server.args,
        env: server.env,
        cwd: '',
        toolCallTimeoutMs: options.toolCallTimeoutMs,
        failOnStartupError: DEFAULT_FAIL_ON_STARTUP_ERROR,
      },
    }
  }
  if (!server.url?.trim()) {
    return { ok: false, error: 'http/sse servers require a non-empty url' }
  }
  return {
    ok: true,
    config: {
      transport: 'streamable-http',
      serverName: server.name,
      url: server.url,
      headers: server.headers ?? {},
      toolCallTimeoutMs: options.toolCallTimeoutMs,
      failOnStartupError: DEFAULT_FAIL_ON_STARTUP_ERROR,
    },
  }
}

/**
 * Select the servers a store snapshot should load.
 *
 * Disabled servers are skipped silently (an intentional stored state);
 * invalid servers are reported with their reason so the bridge can fail loud
 * per server without aborting the remaining servers.
 * @param servers - the store snapshot (any order).
 * @param options - the mapping defaults.
 * @returns the load / invalid / disabled partition.
 */
export function selectServersToLoad(servers: readonly McpServerConfig[], options: MapOptions): ServerSelection {
  const load: LoadableServer[] = []
  const invalid: InvalidServer[] = []
  const disabled: string[] = []
  for (const server of servers) {
    if (server.status === 'disabled') {
      disabled.push(server.name)
      continue
    }
    const mapped = mapServerConfig(server, options)
    if (!mapped.ok) {
      invalid.push({ name: server.name, reason: mapped.error })
      continue
    }
    load.push({
      name: server.name,
      config: mapped.config,
      fingerprint: JSON.stringify(mapped.config),
    })
  }
  return { load, invalid, disabled }
}
