/**
 * rin mcp — strip-types smoke test.
 *
 * Run from the package directory:
 *   node --experimental-strip-types tests/mcp.smoke.ts
 *
 * Exercises the plain (Cordis-free) FileMcpStore against a temp directory:
 * create/list/get/update/remove with JSON persistence, reload from disk,
 * duplicate/unknown-name errors, and transport/status validation.
 *
 * @module @rin/mcp
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileMcpStore, SERVERS_FILENAME } from '../src/store.ts'
import { MCP_STORE_SCHEMA_VERSION } from '../src/types.ts'

/** Throw a clear error when a smoke expectation fails. */
function check(condition: boolean, message: string): void {
  if (!condition) throw new Error('smoke assertion failed: ' + message)
}

/** Assert that a promise rejects (any error) and otherwise fail. */
async function rejects(promise: Promise<unknown>, message: string): Promise<void> {
  try {
    await promise
  } catch {
    return
  }
  throw new Error('smoke assertion failed: expected rejection for ' + message)
}

const root = await mkdtemp(join(tmpdir(), 'rin-mcp-smoke-'))
try {
  const store = new FileMcpStore({ storeRoot: root })

  // create a stdio server (transport defaults to 'stdio', status to 'checking')
  const stdio = await store.create({
    name: 'local-fs',
    command: 'node',
    args: ['server.js'],
    env: { FOO: 'bar' },
  })
  check(stdio.transport === 'stdio', 'stdio transport defaults')
  check(stdio.status === 'checking', 'status defaults to checking')
  check(stdio.command === 'node', 'command stored')
  check(stdio.args.join(',') === 'server.js', 'args stored')
  check(stdio.env.FOO === 'bar', 'env stored')

  // create an http server with headers
  const http = await store.create({
    name: 'remote-api',
    transport: 'http',
    url: 'https://example.com/mcp',
    headers: { Authorization: 'Bearer token' },
  })
  check(http.transport === 'http', 'http transport stored')
  check(http.url === 'https://example.com/mcp', 'url stored')
  check(http.headers?.Authorization === 'Bearer token', 'headers stored')
  check(http.command === '', 'http server has empty command')

  // list sorts by name and returns deep copies
  const listed = await store.list()
  check(listed.length === 2, 'two servers listed')
  check(listed[0]?.name === 'local-fs', 'list sorted by name (local-fs first)')
  check(listed[1]?.name === 'remote-api', 'list sorted by name (remote-api second)')
  listed[0]!.args.push('mutated')
  check((await store.get('local-fs'))!.args.length === 1, 'list returns copies (cache not mutated)')

  // get by name
  check((await store.get('remote-api'))?.url === 'https://example.com/mcp', 'get by name')
  check((await store.get('missing')) === null, 'get unknown name returns null')

  // reload from disk in a fresh store
  const reloaded = new FileMcpStore({ storeRoot: root })
  check((await reloaded.list()).length === 2, 'reload from disk sees both servers')
  const raw = await readFile(join(root, SERVERS_FILENAME), 'utf8')
  const document = JSON.parse(raw) as { version: number; servers: unknown[] }
  check(document.version === MCP_STORE_SCHEMA_VERSION, 'document carries schema version')
  check(document.servers.length === 2, 'document carries both servers')
  check(raw.endsWith('\n'), 'document ends with a trailing newline')

  // update merges a patch and re-validates
  const patched = await store.update('local-fs', { env: { BAR: 'baz' }, status: 'disabled' })
  check(patched.env.BAR === 'baz', 'update merges env')
  check(patched.status === 'disabled', 'update stores status')
  check(patched.command === 'node', 'update preserves untouched command')
  check(patched.name === 'local-fs', 'update cannot change name')

  // remove
  check((await store.remove('remote-api')) === true, 'remove returns true when removed')
  check((await store.remove('remote-api')) === false, 'remove returns false when unknown')
  check((await store.list()).length === 1, 'one server remains after remove')

  // duplicate create
  await rejects(store.create({ name: 'local-fs', command: 'node' }), 'duplicate create')
  // update unknown name
  await rejects(store.update('missing', { status: 'disabled' }), 'update unknown name')
  // stdio without command
  await rejects(store.create({ name: 'no-command' }), 'stdio without command')
  // http without url
  await rejects(store.create({ name: 'no-url', transport: 'http' }), 'http without url')
  // bad transport
  await rejects(store.create({ name: 'bad-transport', transport: 'ws' as never, command: 'x' }), 'bad transport')
  // bad status
  await rejects(store.create({ name: 'bad-status', command: 'x', status: 'gone' as never }), 'bad status')

  console.log('MCP-SMOKE-OK', { servers: (await store.list()).length, version: document.version })
} finally {
  await rm(root, { recursive: true, force: true })
}
