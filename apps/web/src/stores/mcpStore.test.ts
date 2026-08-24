import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mcpApi } from '../api/mcp'
import type { McpServerRecord } from '../types/mcp'
import { useMcpStore } from './mcpStore'

vi.mock('../api/mcp', () => ({
  mcpApi: {
    list: vi.fn(),
    status: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    toggle: vi.fn(),
    reconnect: vi.fn(),
  },
}))

function makeServer(overrides: Partial<McpServerRecord> = {}): McpServerRecord {
  return {
    name: 'server-a',
    scope: 'user',
    transport: 'stdio',
    enabled: true,
    status: 'connected',
    statusLabel: 'Connected',
    configLocation: '~/.rin/mcp/servers.json',
    summary: 'A server',
    canEdit: true,
    canRemove: true,
    canReconnect: true,
    canToggle: true,
    config: { type: 'stdio', command: 'node', args: [], env: {} },
    ...overrides,
  }
}

describe('mcpStore', () => {
  beforeEach(() => {
    useMcpStore.setState({
      servers: [],
      selectedServer: null,
      isLoading: false,
      error: null,
    })
    vi.clearAllMocks()
  })

  it('loads and dedups servers across project paths', async () => {
    vi.mocked(mcpApi.list)
      .mockResolvedValueOnce({ servers: [makeServer({ name: 'local', scope: 'project' })] })
      .mockResolvedValueOnce({ servers: [makeServer({ name: 'local', scope: 'project' })] })

    await useMcpStore.getState().fetchServers(['/a', '/b'])

    expect(mcpApi.list).toHaveBeenCalledWith('/a')
    expect(mcpApi.list).toHaveBeenCalledWith('/b')
    expect(useMcpStore.getState().servers.map((s) => s.projectPath)).toEqual(['/a', '/b'])
  })

  it('dedups global servers returned for multiple contexts', async () => {
    vi.mocked(mcpApi.list).mockResolvedValue({ servers: [makeServer({ scope: 'user' })] })

    await useMcpStore.getState().fetchServers(['/a', '/b'])

    expect(useMcpStore.getState().servers).toHaveLength(1)
  })

  it('falls back to a single context when no project paths are given', async () => {
    vi.mocked(mcpApi.list).mockResolvedValue({ servers: [] })

    await useMcpStore.getState().fetchServers(undefined, '/repo')

    expect(mcpApi.list).toHaveBeenCalledWith('/repo')
  })

  it('records an error message when listing fails', async () => {
    vi.mocked(mcpApi.list).mockRejectedValue(new Error('boom'))

    await useMcpStore.getState().fetchServers()

    expect(useMcpStore.getState()).toMatchObject({ isLoading: false, error: 'boom' })
  })

  it('creates a server and selects it', async () => {
    const created = makeServer({ name: 'new-server' })
    vi.mocked(mcpApi.create).mockResolvedValue({ server: created })

    const result = await useMcpStore
      .getState()
      .createServer('new-server', { scope: 'user', config: created.config })

    expect(mcpApi.create).toHaveBeenCalledWith('new-server', { scope: 'user', config: created.config }, undefined)
    expect(result.name).toBe('new-server')
    expect(useMcpStore.getState().selectedServer?.name).toBe('new-server')
    expect(useMcpStore.getState().servers).toHaveLength(1)
  })

  it('replaces the matching server on update', async () => {
    const existing = makeServer({ name: 'server-a' })
    useMcpStore.setState({ servers: [existing], selectedServer: existing })
    const updated = makeServer({ name: 'server-a', status: 'failed', statusLabel: 'Failed' })
    vi.mocked(mcpApi.update).mockResolvedValue({ server: updated })

    await useMcpStore.getState().updateServer(existing, { scope: 'user', config: updated.config })

    expect(useMcpStore.getState().servers[0]?.status).toBe('failed')
    expect(useMcpStore.getState().selectedServer?.status).toBe('failed')
  })

  it('removes a server and clears the selection when it was selected', async () => {
    const server = makeServer({ name: 'server-a' })
    useMcpStore.setState({ servers: [server], selectedServer: server })
    vi.mocked(mcpApi.remove).mockResolvedValue({ ok: true })

    await useMcpStore.getState().deleteServer(server)

    expect(mcpApi.remove).toHaveBeenCalledWith('server-a', 'user', undefined)
    expect(useMcpStore.getState().servers).toHaveLength(0)
    expect(useMcpStore.getState().selectedServer).toBeNull()
  })

  it('toggles a server and keeps the selection in sync', async () => {
    const existing = makeServer({ name: 'server-a' })
    useMcpStore.setState({ servers: [existing], selectedServer: existing })
    const toggled = makeServer({ name: 'server-a', enabled: false, status: 'disabled', statusLabel: 'Disabled' })
    vi.mocked(mcpApi.toggle).mockResolvedValue({ server: toggled })

    const result = await useMcpStore.getState().toggleServer(existing)

    expect(result.enabled).toBe(false)
    expect(useMcpStore.getState().servers[0]?.enabled).toBe(false)
  })

  it('reconnects a server and updates its record', async () => {
    const existing = makeServer({ name: 'server-a' })
    useMcpStore.setState({ servers: [existing] })
    const reconnected = makeServer({ name: 'server-a', status: 'checking', statusLabel: 'Checking' })
    vi.mocked(mcpApi.reconnect).mockResolvedValue({ server: reconnected })

    await useMcpStore.getState().reconnectServer(existing)

    expect(mcpApi.reconnect).toHaveBeenCalledWith('server-a', undefined)
    expect(useMcpStore.getState().servers[0]?.status).toBe('checking')
  })

  it('refreshes a server status', async () => {
    const existing = makeServer({ name: 'server-a' })
    useMcpStore.setState({ servers: [existing] })
    const refreshed = makeServer({ name: 'server-a', status: 'needs-auth', statusLabel: 'Needs auth' })
    vi.mocked(mcpApi.status).mockResolvedValue({ server: refreshed })

    await useMcpStore.getState().refreshServerStatus(existing)

    expect(mcpApi.status).toHaveBeenCalledWith('server-a', undefined)
    expect(useMcpStore.getState().servers[0]?.status).toBe('needs-auth')
  })

  it('selects a server', () => {
    const server = makeServer({ name: 'server-b' })

    useMcpStore.getState().selectServer(server)

    expect(useMcpStore.getState().selectedServer).toBe(server)
  })
})
