/**
 * rin mcp-client — mapping unit tests.
 *
 * Exercises the pure store→client config mapping and the per-server selection
 * rules (disabled skip, name-pattern rejection, empty command/url rejection,
 * http/sse→streamable-http) with no Cordis runtime and no MCP connection.
 *
 * @module @rin/mcp-client
 */

import { describe, expect, it } from 'vitest'
import type { McpServerConfig } from '@rin/mcp'
import {
  DEFAULT_FAIL_ON_STARTUP_ERROR,
  DEFAULT_TOOL_CALL_TIMEOUT_MS,
  mapServerConfig,
  selectServersToLoad,
  SERVER_NAME_PATTERN,
} from '../src/map.ts'

const OPTIONS = { toolCallTimeoutMs: DEFAULT_TOOL_CALL_TIMEOUT_MS }

/** Build a stored server config with defaults, overriding the given fields. */
function server(partial: Partial<McpServerConfig>): McpServerConfig {
  return {
    name: 'srv',
    transport: 'stdio',
    command: 'node',
    args: [],
    env: {},
    status: 'checking',
    ...partial,
  }
}

describe('mapServerConfig', () => {
  it('maps a stdio server to the dsh stdio config', () => {
    const mapped = mapServerConfig(server({
      name: 'local-fs',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      env: { FOO: 'bar' },
    }), OPTIONS)
    expect(mapped.ok).toBe(true)
    if (!mapped.ok) return
    expect(mapped.config).toEqual({
      transport: 'stdio',
      serverName: 'local-fs',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      env: { FOO: 'bar' },
      cwd: '',
      toolCallTimeoutMs: DEFAULT_TOOL_CALL_TIMEOUT_MS,
      failOnStartupError: DEFAULT_FAIL_ON_STARTUP_ERROR,
    })
  })

  it('applies the configured tool-call timeout', () => {
    const mapped = mapServerConfig(server({ name: 'srv' }), { toolCallTimeoutMs: 42_000 })
    expect(mapped.ok).toBe(true)
    if (!mapped.ok) return
    expect(mapped.config.toolCallTimeoutMs).toBe(42_000)
  })

  it('maps an http server to the dsh streamable-http config', () => {
    const mapped = mapServerConfig(server({
      name: 'remote-api',
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer token' },
    }), OPTIONS)
    expect(mapped.ok).toBe(true)
    if (!mapped.ok) return
    expect(mapped.config).toEqual({
      transport: 'streamable-http',
      serverName: 'remote-api',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer token' },
      toolCallTimeoutMs: DEFAULT_TOOL_CALL_TIMEOUT_MS,
      failOnStartupError: DEFAULT_FAIL_ON_STARTUP_ERROR,
    })
  })

  it('maps an sse server to the same streamable-http config', () => {
    const mapped = mapServerConfig(server({
      name: 'sse-api',
      transport: 'sse',
      url: 'https://example.com/sse',
    }), OPTIONS)
    expect(mapped.ok).toBe(true)
    if (!mapped.ok) return
    expect(mapped.config.transport).toBe('streamable-http')
    expect(mapped.config.url).toBe('https://example.com/sse')
  })

  it('defaults missing http headers to an empty map', () => {
    const mapped = mapServerConfig(server({ name: 'srv', transport: 'http', url: 'https://x' }), OPTIONS)
    expect(mapped.ok).toBe(true)
    if (!mapped.ok) return
    expect(mapped.config.headers).toEqual({})
  })

  it('rejects a name that fails the dsh serverName pattern', () => {
    for (const bad of ['has space', 'dot.name', 'ümlaut', 'a'.repeat(33), '']) {
      const mapped = mapServerConfig(server({ name: bad }), OPTIONS)
      expect(mapped.ok).toBe(false)
      if (mapped.ok) continue
      expect(mapped.error).toContain('serverName pattern')
    }
  })

  it('accepts boundary-valid names', () => {
    expect(SERVER_NAME_PATTERN.test('a')).toBe(true)
    expect(SERVER_NAME_PATTERN.test('a'.repeat(32))).toBe(true)
    expect(SERVER_NAME_PATTERN.test('my_server-2')).toBe(true)
    for (const good of ['a', 'a'.repeat(32), 'my_server-2', 'ABC123']) {
      const mapped = mapServerConfig(server({ name: good }), OPTIONS)
      expect(mapped.ok).toBe(true)
    }
  })

  it('rejects a stdio server with an empty command', () => {
    const mapped = mapServerConfig(server({ name: 'srv', command: '  ' }), OPTIONS)
    expect(mapped.ok).toBe(false)
    if (!mapped.ok) expect(mapped.error).toContain('non-empty command')
  })

  it('rejects http and sse servers with an empty url', () => {
    for (const transport of ['http', 'sse'] as const) {
      const mapped = mapServerConfig(server({ name: 'srv', transport, url: undefined }), OPTIONS)
      expect(mapped.ok).toBe(false)
      if (!mapped.ok) expect(mapped.error).toContain('non-empty url')
      const blank = mapServerConfig(server({ name: 'srv', transport, url: '  ' }), OPTIONS)
      expect(blank.ok).toBe(false)
    }
  })
})

describe('selectServersToLoad', () => {
  it('loads every valid enabled server, skipping disabled and invalid ones', () => {
    const selection = selectServersToLoad([
      server({ name: 'ok-stdio' }),
      server({ name: 'ok-http', transport: 'http', url: 'https://x' }),
      server({ name: 'off', status: 'disabled' }),
      server({ name: 'bad name' }),
      server({ name: 'no-command', command: '' }),
    ], OPTIONS)
    expect(selection.load.map(entry => entry.name).sort()).toEqual(['ok-http', 'ok-stdio'])
    expect(selection.disabled).toEqual(['off'])
    expect(selection.invalid.map(entry => entry.name).sort()).toEqual(['bad name', 'no-command'])
    for (const invalid of selection.invalid) {
      expect(invalid.reason.length).toBeGreaterThan(0)
    }
  })

  it('produces a stable fingerprint per mapped config', () => {
    const first = selectServersToLoad([server({ name: 'srv', args: ['a'] })], OPTIONS)
    const second = selectServersToLoad([server({ name: 'srv', args: ['a'] })], OPTIONS)
    const changed = selectServersToLoad([server({ name: 'srv', args: ['b'] })], OPTIONS)
    expect(first.load[0]?.fingerprint).toBe(second.load[0]?.fingerprint)
    expect(first.load[0]?.fingerprint).not.toBe(changed.load[0]?.fingerprint)
  })

  it('keeps the fingerprint stable across a status-only change', () => {
    const checking = selectServersToLoad([server({ name: 'srv', status: 'checking' })], OPTIONS)
    const connected = selectServersToLoad([server({ name: 'srv', status: 'connected' })], OPTIONS)
    expect(checking.load[0]?.fingerprint).toBe(connected.load[0]?.fingerprint)
  })
})
