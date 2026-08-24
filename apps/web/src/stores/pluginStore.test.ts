import { beforeEach, describe, expect, it, vi } from 'vitest'

import { pluginsApi } from '../api/plugins'
import type { PluginDetail, PluginListResponse, PluginSummary } from '../types/plugin'
import { usePluginStore } from './pluginStore'

vi.mock('../api/plugins', () => ({
  pluginsApi: {
    list: vi.fn(),
    detail: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
  },
}))

function makePlugin(overrides: Partial<PluginSummary> = {}): PluginSummary {
  return {
    id: 'p1',
    name: 'Plugin',
    marketplace: 'market',
    scope: 'user',
    enabled: true,
    hasErrors: false,
    isBuiltin: false,
    componentCounts: { commands: 0, agents: 0, skills: 0, hooks: 0, mcpServers: 0, lspServers: 0 },
    errors: [],
    ...overrides,
  }
}

function makeListResponse(overrides: Partial<PluginListResponse> = {}): PluginListResponse {
  return {
    plugins: [makePlugin()],
    marketplaces: [],
    summary: { total: 1, enabled: 1, errorCount: 0, marketplaceCount: 0 },
    ...overrides,
  }
}

function makeDetail(): PluginDetail {
  return {
    ...makePlugin(),
    capabilities: { commands: [], agents: [], skills: [], hooks: [], mcpServers: [], lspServers: [] },
    commandEntries: [],
    agentEntries: [],
    hookEntries: [],
    skillEntries: [],
    mcpServerEntries: [],
  }
}

describe('pluginStore', () => {
  beforeEach(() => {
    usePluginStore.setState({
      plugins: [],
      marketplaces: [],
      summary: null,
      selectedPlugin: null,
      isLoading: false,
      isDetailLoading: false,
      isApplying: false,
      error: null,
    })
    vi.clearAllMocks()
  })

  it('loads the plugin list', async () => {
    const response = makeListResponse()
    vi.mocked(pluginsApi.list).mockResolvedValue(response)

    await usePluginStore.getState().fetchPlugins()

    expect(pluginsApi.list).toHaveBeenCalledWith(undefined)
    expect(usePluginStore.getState().plugins).toEqual(response.plugins)
    expect(usePluginStore.getState().summary).toEqual(response.summary)
  })

  it('records an error when listing fails', async () => {
    vi.mocked(pluginsApi.list).mockRejectedValue(new Error('boom'))

    await usePluginStore.getState().fetchPlugins()

    expect(usePluginStore.getState().error).toBe('boom')
  })

  it('loads a plugin detail', async () => {
    vi.mocked(pluginsApi.detail).mockResolvedValue({ detail: makeDetail() })

    await usePluginStore.getState().fetchPluginDetail('p1')

    expect(pluginsApi.detail).toHaveBeenCalledWith('p1', undefined)
    expect(usePluginStore.getState().selectedPlugin?.id).toBe('p1')
  })

  it('enables a plugin and refreshes the list', async () => {
    vi.mocked(pluginsApi.enable).mockResolvedValue({ ok: true, message: 'enabled' })
    vi.mocked(pluginsApi.list).mockResolvedValue(makeListResponse())

    const message = await usePluginStore.getState().enablePlugin('p1')

    expect(pluginsApi.enable).toHaveBeenCalledWith({ id: 'p1', scope: undefined })
    expect(message).toBe('enabled')
  })

  it('rethrows and records the error when an action fails', async () => {
    vi.mocked(pluginsApi.disable).mockRejectedValue(new Error('boom'))

    await expect(usePluginStore.getState().disablePlugin('p1')).rejects.toThrow('boom')

    expect(usePluginStore.getState().error).toBe('boom')
    expect(usePluginStore.getState().isApplying).toBe(false)
  })

  it('clears the selection', () => {
    usePluginStore.setState({ selectedPlugin: makeDetail() })

    usePluginStore.getState().clearSelection()

    expect(usePluginStore.getState().selectedPlugin).toBeNull()
  })
})
