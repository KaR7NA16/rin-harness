/**
 * rin mcp-client — bridge lifecycle tests.
 *
 * Drives the bridge with a real Cordis root context, a fake ctx.mcp store,
 * and a stubbed child loader, so no real MCP connection is ever made. Covers
 * initial load, per-server skip rules, change-driven re-sync (new / removed /
 * changed / disabled / status-only), disposal, and store-read failure
 * containment.
 *
 * @module @rin/mcp/client
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { McpServerConfig } from '@rin/mcp'
import type { Config as ClientConfig } from '@deepseek-ai/dsh-mcp-client'
import { McpClientBridge, type ClientLoader } from '../src/client/bridge.ts'

/** A fake ctx.mcp store backed by an in-memory server list. */
function fakeStore(initial: McpServerConfig[]) {
  const listeners = new Set<() => void>()
  const store = {
    servers: initial,
    listeners,
    list(): Promise<McpServerConfig[]> {
      return Promise.resolve(store.servers.map(copyServer))
    },
    onChange(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    emitChange(): void {
      for (const listener of listeners) listener()
    },
  }
  return store
}

/** Deep-copy one server so callers cannot mutate the store's snapshot. */
function copyServer(server: McpServerConfig): McpServerConfig {
  return {
    ...server,
    args: [...server.args],
    env: { ...server.env },
    headers: server.headers === undefined ? undefined : { ...server.headers },
  }
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

interface Harness {
  ctx: Context
  store: ReturnType<typeof fakeStore>
  bridge: McpClientBridge
  loaded: ClientConfig[]
  disposed: string[]
  errors: string[]
  infos: string[]
  release: () => Promise<void>
}

/** Build a fresh context with a fake store and a stub-loaded bridge. */
async function setup(initial: McpServerConfig[], timeout = 42_000): Promise<Harness> {
  const ctx = new Context()
  const store = fakeStore(initial)
  const releaseProvide = ctx.provide('mcp', store)
  const loaded: ClientConfig[] = []
  const disposed: string[] = []
  const errors: string[] = []
  const infos: string[] = []
  const logger = {
    error: (message: string) => {
      errors.push(String(message))
    },
    info: (message: string) => {
      infos.push(String(message))
    },
    warn: () => {},
    debug: () => {},
    success: () => {},
    trace: () => {},
    log: () => {},
    getLevel: () => 3,
    setLevel: () => {},
    extend: () => logger,
    prefix: '',
  }
  ;(ctx as { logger: unknown }).logger = logger
  const loader: ClientLoader = (_ctx, config) => {
    loaded.push(config)
    return {
      dispose: () => {
        disposed.push(config.serverName)
      },
    }
  }
  const bridge = new McpClientBridge(ctx, { toolCallTimeoutMs: timeout, loadChild: loader })
  await bridge.start()
  return {
    ctx,
    store,
    bridge,
    loaded,
    disposed,
    errors,
    infos,
    release: async () => {
      await bridge.dispose()
      releaseProvide()
    },
  }
}

/** Wait one macrotask so any chained re-sync has fully settled. */
async function flush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('McpClientBridge', () => {
  it('loads one stub instance per valid enabled server with the mapped config', async () => {
    const h = await setup([
      server({ name: 'fs', command: 'npx', args: ['server.js'], env: { A: '1' } }),
      server({ name: 'api', transport: 'http', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer t' } }),
    ])
    expect(h.loaded).toHaveLength(2)
    const fsConfig = h.loaded.find(config => config.serverName === 'fs')
    expect(fsConfig).toEqual({
      transport: 'stdio',
      serverName: 'fs',
      command: 'npx',
      args: ['server.js'],
      env: { A: '1' },
      cwd: '',
      toolCallTimeoutMs: 42_000,
      failOnStartupError: false,
    })
    const apiConfig = h.loaded.find(config => config.serverName === 'api')
    expect(apiConfig).toEqual({
      transport: 'streamable-http',
      serverName: 'api',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer t' },
      toolCallTimeoutMs: 42_000,
      failOnStartupError: false,
    })
    await h.release()
  })

  it('skips disabled servers silently and reports invalid servers per server', async () => {
    const h = await setup([
      server({ name: 'good' }),
      server({ name: 'off', status: 'disabled' }),
      server({ name: 'bad name' }),
    ])
    expect(h.loaded.map(config => config.serverName)).toEqual(['good'])
    expect(h.disposed).toEqual([])
    expect(h.infos.some(line => line.includes('"off" is disabled'))).toBe(true)
    expect(h.errors.some(line => line.includes('skipping server "bad name"'))).toBe(true)
    await h.release()
  })

  it('re-syncs when a server is added', async () => {
    const h = await setup([server({ name: 'a' })])
    expect(h.loaded).toHaveLength(1)
    h.store.servers.push(server({ name: 'b' }))
    h.store.emitChange()
    await vi.waitFor(() => expect(h.loaded).toHaveLength(2))
    expect(h.loaded.some(config => config.serverName === 'b')).toBe(true)
    await h.release()
  })

  it('re-syncs when a server is removed', async () => {
    const h = await setup([server({ name: 'a' }), server({ name: 'b' })])
    h.store.servers = h.store.servers.filter(entry => entry.name !== 'a')
    h.store.emitChange()
    await vi.waitFor(() => expect(h.disposed).toContain('a'))
    // 'a' must not be reloaded: the loaded history keeps exactly its original entry.
    expect(h.loaded.filter(config => config.serverName === 'a')).toHaveLength(1)
    expect(h.loaded.filter(config => config.serverName === 'b')).toHaveLength(1)
    await h.release()
  })

  it('re-syncs when a server config changes (dispose + reload that server only)', async () => {
    const h = await setup([server({ name: 'a' }), server({ name: 'b' })])
    h.store.servers = h.store.servers.map(entry =>
      entry.name === 'a' ? server({ name: 'a', args: ['changed'] }) : entry)
    h.store.emitChange()
    await vi.waitFor(() => expect(h.disposed).toContain('a'))
    await vi.waitFor(() => expect(h.loaded.filter(config => config.serverName === 'a')).toHaveLength(2))
    expect(h.loaded.filter(config => config.serverName === 'b')).toHaveLength(1)
    expect(h.disposed).not.toContain('b')
    await h.release()
  })

  it('does not reload a server on a status-only change', async () => {
    const h = await setup([server({ name: 'a', status: 'checking' })])
    h.store.servers = h.store.servers.map(entry =>
      entry.name === 'a' ? server({ name: 'a', status: 'connected' }) : entry)
    h.store.emitChange()
    await flush()
    expect(h.loaded.filter(config => config.serverName === 'a')).toHaveLength(1)
    expect(h.disposed).toEqual([])
    await h.release()
  })

  it('unloads a server when it is toggled to disabled', async () => {
    const h = await setup([server({ name: 'a' })])
    h.store.servers = h.store.servers.map(entry =>
      entry.name === 'a' ? server({ name: 'a', status: 'disabled' }) : entry)
    h.store.emitChange()
    await vi.waitFor(() => expect(h.disposed).toContain('a'))
    await h.release()
  })

  it('reloads a server when a previously invalid name becomes valid', async () => {
    const h = await setup([server({ name: 'bad name' })])
    expect(h.loaded).toHaveLength(0)
    h.store.servers = [server({ name: 'fixed-name' })]
    h.store.emitChange()
    await vi.waitFor(() => expect(h.loaded.some(config => config.serverName === 'fixed-name')).toBe(true))
    await h.release()
  })

  it('dispose tears down every child and unsubscribes from store changes', async () => {
    const h = await setup([server({ name: 'a' }), server({ name: 'b' })])
    await h.bridge.dispose()
    expect(h.disposed.sort()).toEqual(['a', 'b'])
    const loadedAfterDispose = h.loaded.length
    h.store.servers.push(server({ name: 'c' }))
    h.store.emitChange()
    await flush()
    expect(h.loaded.length).toBe(loadedAfterDispose)
    await h.release()
  })

  it('contains a store read failure in the re-sync log path', async () => {
    const h = await setup([server({ name: 'a' })])
    h.store.list = () => Promise.reject(new Error('store exploded'))
    h.store.emitChange()
    await vi.waitFor(() => expect(h.errors.some(line => line.includes('re-sync failed: store exploded'))).toBe(true))
    expect(h.loaded).toHaveLength(1)
    await h.release()
  })
})
