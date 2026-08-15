/**
 * rin mcp — file-backed MCP server configuration store.
 *
 * Implements CRUD over a versioned JSON document (default ~/.rin/mcp/servers.json).
 * The class is plain (no Cordis) so the strip-types smoke script can exercise
 * it directly; index.ts binds it into the ctx.mcp service. It owns input
 * normalization and validation at the durable-file boundary only.
 *
 * @module @rin/mcp
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  MCP_STORE_SCHEMA_VERSION,
  type McpServerConfig,
  type McpServerInput,
  type McpServerPatch,
  type McpServerStatus,
  type McpStoreDocument,
  type McpTransport,
} from './types.ts'

/** The store filename inside the store root. */
export const SERVERS_FILENAME = 'servers.json'

/** The accepted transport values. */
const TRANSPORTS: readonly McpTransport[] = ['stdio', 'http', 'sse']

/** The accepted status values. */
const STATUSES: readonly McpServerStatus[] = ['checking', 'connected', 'needs-auth', 'failed', 'disabled']

/**
 * Resolve the default store root.
 *
 * @param home - the home directory (defaults to the current user's home).
 * @returns the default ~/.rin/mcp directory.
 */
export function defaultMcpStoreRoot(home = homedir()): string {
  return join(home, '.rin', 'mcp')
}

/**
 * Resolve the configured store root, falling back to ~/.rin/mcp.
 *
 * @param configured - the Config.storeRoot value, when set.
 * @returns the absolute store-root directory.
 */
export function resolveMcpStoreRoot(configured?: string): string {
  return configured && configured.trim() ? resolve(configured) : defaultMcpStoreRoot()
}

/** Construction options for a file-backed store. */
export interface McpStoreOptions {
  /** Absolute or cwd-relative directory holding servers.json. */
  storeRoot: string
}

/** Whether an error is a missing-file (ENOENT) error. */
function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

/** Require a non-empty server name and return it trimmed. */
function assertName(name: unknown): string {
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error('rin mcp: server name is required')
  }
  return name.trim()
}

/** Coerce a transport value, defaulting to 'stdio'. */
function assertTransport(transport: unknown): McpTransport {
  if (transport === undefined || transport === '') return 'stdio'
  if (TRANSPORTS.includes(transport as McpTransport)) return transport as McpTransport
  throw new Error('rin mcp: unsupported transport: ' + String(transport))
}

/** Coerce a status value, defaulting to 'checking'. */
function assertStatus(status: unknown): McpServerStatus {
  if (status === undefined) return 'checking'
  if (STATUSES.includes(status as McpServerStatus)) return status as McpServerStatus
  throw new Error('rin mcp: unsupported status: ' + String(status))
}

/** Coerce an args value to a string array, defaulting to []. */
function assertStringArray(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('rin mcp: args must be an array of strings')
  return value.map((entry, index) => {
    if (typeof entry !== 'string') throw new Error('rin mcp: args[' + index + '] must be a string')
    return entry
  })
}

/** Coerce a value to a string map, defaulting to {}. */
function assertStringRecord(value: unknown, field: string): Record<string, string> {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('rin mcp: ' + field + ' must be a string map')
  }
  const out: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') throw new Error('rin mcp: ' + field + '.' + key + ' must be a string')
    out[key] = entry
  }
  return out
}

/** Reject a config whose transport-specific required field is empty. */
function validateConfig(config: McpServerConfig): void {
  if (config.transport === 'stdio') {
    if (!config.command.trim()) throw new Error('rin mcp: command is required for stdio servers')
  } else if (!config.url?.trim()) {
    throw new Error('rin mcp: url is required for http/sse servers')
  }
}

/** Build a validated server config from caller input, applying defaults. */
function normalizeInput(input: McpServerInput): McpServerConfig {
  const transport = assertTransport(input.transport)
  const config: McpServerConfig = {
    name: assertName(input.name),
    transport,
    command: typeof input.command === 'string' ? input.command : '',
    args: assertStringArray(input.args),
    env: assertStringRecord(input.env, 'env'),
    status: assertStatus(input.status),
  }
  if (input.url !== undefined) config.url = typeof input.url === 'string' ? input.url.trim() : ''
  if (input.headers !== undefined) config.headers = assertStringRecord(input.headers, 'headers')
  validateConfig(config)
  return config
}

/** Merge a patch onto a stored config and re-validate the result. */
function applyPatch(current: McpServerConfig, patch: McpServerPatch): McpServerConfig {
  const transport = patch.transport !== undefined ? assertTransport(patch.transport) : current.transport
  const next: McpServerConfig = {
    name: current.name,
    transport,
    command: patch.command !== undefined ? (typeof patch.command === 'string' ? patch.command : '') : current.command,
    args: patch.args !== undefined ? assertStringArray(patch.args) : current.args,
    env: patch.env !== undefined ? assertStringRecord(patch.env, 'env') : current.env,
    status: patch.status !== undefined ? assertStatus(patch.status) : current.status,
  }
  const url = patch.url !== undefined ? (typeof patch.url === 'string' ? patch.url.trim() : '') : current.url
  if (url !== undefined) next.url = url
  const headers = patch.headers !== undefined ? assertStringRecord(patch.headers, 'headers') : current.headers
  if (headers !== undefined) next.headers = headers
  validateConfig(next)
  return next
}

/** Deep-copy a server so callers cannot mutate the store cache. */
function cloneServer(server: McpServerConfig): McpServerConfig {
  const copy: McpServerConfig = {
    name: server.name,
    transport: server.transport,
    command: server.command,
    args: [...server.args],
    env: { ...server.env },
    status: server.status,
  }
  if (server.url !== undefined) copy.url = server.url
  if (server.headers !== undefined) copy.headers = { ...server.headers }
  return copy
}

/** Parse and validate the on-disk document. */
function parseDocument(text: string, path: string): McpServerConfig[] {
  let raw: unknown
  try {
    raw = JSON.parse(text) as unknown
  } catch (error) {
    throw new Error('rin mcp: invalid JSON in ' + path + ': ' + (error instanceof Error ? error.message : String(error)))
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('rin mcp: invalid store document in ' + path)
  }
  const document = raw as { version?: unknown; servers?: unknown }
  if (document.version !== MCP_STORE_SCHEMA_VERSION) {
    throw new Error('rin mcp: unsupported store version in ' + path + ': ' + String(document.version))
  }
  if (!Array.isArray(document.servers)) {
    throw new Error('rin mcp: invalid servers list in ' + path)
  }
  return document.servers.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error('rin mcp: invalid server at index ' + index + ' in ' + path)
    }
    return normalizeInput(entry as McpServerInput)
  })
}

/** Serialize the on-disk document with a trailing newline. */
function stringifyDocument(document: McpStoreDocument): string {
  return JSON.stringify(document, null, 2) + '\n'
}

/**
 * File-backed MCP server configuration store. Reads and writes the versioned
 * JSON document, caching the parsed list in memory.
 */
export class FileMcpStore {
  private readonly storeRoot: string
  private cache: McpServerConfig[] | null = null

  /** @param options - the store-root directory. */
  constructor(options: McpStoreOptions) {
    this.storeRoot = resolve(options.storeRoot)
  }

  /** @returns the absolute servers.json path. */
  private get serversPath(): string {
    return join(this.storeRoot, SERVERS_FILENAME)
  }

  /**
   * List every server, sorted by name.
   * @returns the server configs.
   */
  async list(): Promise<McpServerConfig[]> {
    const servers = await this.load()
    return servers.map(cloneServer).sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * Read one server by name.
   * @param name - the server name.
   * @returns the server, or null when unknown.
   */
  async get(name: string): Promise<McpServerConfig | null> {
    const server = (await this.load()).find(entry => entry.name === name)
    return server ? cloneServer(server) : null
  }

  /**
   * Create a server. Fails when the name already exists.
   * @param input - the server fields.
   * @returns the created server.
   */
  async create(input: McpServerInput): Promise<McpServerConfig> {
    const servers = await this.load()
    const server = normalizeInput(input)
    if (servers.some(entry => entry.name === server.name)) {
      throw new Error('rin mcp: server already exists: ' + server.name)
    }
    await this.save([...servers, server])
    return cloneServer(server)
  }

  /**
   * Patch an existing server by name.
   * @param name - the server name.
   * @param patch - the fields to merge.
   * @returns the patched server.
   */
  async update(name: string, patch: McpServerPatch): Promise<McpServerConfig> {
    const servers = await this.load()
    const index = servers.findIndex(entry => entry.name === name)
    if (index < 0) throw new Error('rin mcp: server not found: ' + name)
    const next = [...servers]
    next[index] = applyPatch(next[index]!, patch)
    await this.save(next)
    return cloneServer(next[index]!)
  }

  /**
   * Remove a server by name.
   * @param name - the server name.
   * @returns true when the server existed and was removed.
   */
  async remove(name: string): Promise<boolean> {
    const servers = await this.load()
    if (!servers.some(entry => entry.name === name)) return false
    await this.save(servers.filter(entry => entry.name !== name))
    return true
  }

  private async load(): Promise<McpServerConfig[]> {
    if (this.cache) return this.cache
    const text = await readFile(this.serversPath, 'utf8').catch((error: unknown) => {
      if (isMissingFile(error)) return null
      throw error
    })
    this.cache = text === null ? [] : parseDocument(text, this.serversPath)
    return this.cache
  }

  private async save(servers: McpServerConfig[]): Promise<void> {
    this.cache = servers
    await mkdir(dirname(this.serversPath), { recursive: true })
    await writeFile(this.serversPath, stringifyDocument({
      version: MCP_STORE_SCHEMA_VERSION,
      servers,
    }), 'utf8')
  }
}
