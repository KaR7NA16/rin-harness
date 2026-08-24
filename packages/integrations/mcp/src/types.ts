/**
 * rin mcp — domain model.
 *
 * Owns the values crossing the MCP configuration-management seam: the server
 * transport and status enums, the persisted server record, the caller-supplied
 * create/patch inputs, and the versioned on-disk document. The file-backed
 * store owns persistence; this module owns the schema only, so it stays free
 * of any dsh runtime import.
 *
 * @module @rin/mcp
 */

/** The on-disk MCP store document version. */
export const MCP_STORE_SCHEMA_VERSION = 1 as const

/** The editable MCP server transports aligned with the legacy desktop UI. */
export type McpTransport = 'stdio' | 'http' | 'sse'

/**
 * The lifecycle status of one server. Configuration management alone reports
 * 'checking' (unverified) and 'disabled'; 'connected', 'needs-auth', and
 * 'failed' are reserved for the deferred protocol-connection layer.
 */
export type McpServerStatus = 'checking' | 'connected' | 'needs-auth' | 'failed' | 'disabled'

/**
 * One persisted MCP server configuration. 'name' is the unique key. 'stdio'
 * servers use 'command', 'args', and 'env'; 'http'/'sse' servers use 'url' and
 * 'headers'.
 */
export interface McpServerConfig {
  /** Unique server name (the legacy desktop identifier). */
  name: string
  transport: McpTransport
  /** Executable for 'stdio' servers; empty for 'http'/'sse'. */
  command: string
  args: string[]
  env: Record<string, string>
  /** Endpoint for 'http'/'sse' servers. */
  url?: string
  headers?: Record<string, string>
  status: McpServerStatus
}

/** The caller-supplied fields for a new server. */
export interface McpServerInput {
  name: string
  transport?: McpTransport
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  status?: McpServerStatus
}

/** The caller-mutable fields of an existing server (name is immutable). */
export type McpServerPatch = Partial<Omit<McpServerConfig, 'name'>>

/** The versioned MCP store document serialized to disk. */
export interface McpStoreDocument {
  version: typeof MCP_STORE_SCHEMA_VERSION
  servers: McpServerConfig[]
}
