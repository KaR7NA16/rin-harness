/**
 * rin mcp-client — strip-types smoke test.
 *
 * Run from the package directory:
 *   node --experimental-strip-types tests/mcp-client.smoke.ts
 *
 * Exercises the plain (Cordis-free) mapping core directly: stdio and
 * http/sse → streamable-http mapping, disabled skip, name-pattern rejection,
 * and empty command/url rejection. No MCP connection is made.
 *
 * @module @rin/mcp/client
 */

import type { McpServerConfig } from '@rin/mcp'
import { selectServersToLoad } from '../src/client/map.ts'

/** Throw a clear error when a smoke expectation fails. */
function check(condition: boolean, message: string): void {
  if (!condition) throw new Error('smoke assertion failed: ' + message)
}

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

const options = { toolCallTimeoutMs: 60_000 }

const selection = selectServersToLoad([
  server({ name: 'local-fs', command: 'node', args: ['server.js'], env: { FOO: 'bar' } }),
  server({ name: 'remote-api', transport: 'sse', url: 'https://example.com/sse' }),
  server({ name: 'off', status: 'disabled' }),
  server({ name: 'bad name' }),
  server({ name: 'no-url', transport: 'http' }),
], options)

check(selection.load.length === 2, 'two valid servers selected')
const fs = selection.load.find(entry => entry.name === 'local-fs')
check(fs !== undefined, 'stdio server selected')
if (fs) {
  check(fs.config.transport === 'stdio', 'stdio transport mapped')
  check(fs.config.serverName === 'local-fs', 'serverName mapped')
  check(fs.config.cwd === '', 'cwd defaults to empty')
  check(fs.config.toolCallTimeoutMs === 60_000, 'default tool-call timeout applied')
  check(fs.config.failOnStartupError === false, 'failOnStartupError stays false')
}
const sse = selection.load.find(entry => entry.name === 'remote-api')
check(sse !== undefined, 'sse server selected')
if (sse) {
  check(sse.config.transport === 'streamable-http', 'sse maps onto streamable-http')
  check(sse.config.url === 'https://example.com/sse', 'sse url preserved')
}
check(selection.disabled.join(',') === 'off', 'disabled server skipped')
check(selection.invalid.length === 2, 'two invalid servers reported')
check(selection.invalid.some(entry => entry.name === 'bad name'), 'name-pattern rejection reported')
check(selection.invalid.some(entry => entry.name === 'no-url'), 'empty-url rejection reported')

console.log('MCP-CLIENT-SMOKE-OK', { load: selection.load.length, invalid: selection.invalid.length, disabled: selection.disabled.length })
