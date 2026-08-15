import { beforeEach, describe, expect, it, vi } from 'vitest'

import { adaptersApi } from '../api/adapters'
import { useAdapterStore } from './adapterStore'

vi.mock('../api/adapters', () => ({
  adaptersApi: {
    getConfig: vi.fn(),
    updateConfig: vi.fn(),
  },
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}))

describe('adapterStore', () => {
  beforeEach(() => {
    useAdapterStore.setState({ config: {}, isLoading: false, error: null })
    vi.clearAllMocks()
  })

  it('loads the adapter config', async () => {
    const config = { serverUrl: 'http://localhost' }
    vi.mocked(adaptersApi.getConfig).mockResolvedValue(config)

    await useAdapterStore.getState().fetchConfig()

    expect(useAdapterStore.getState()).toMatchObject({ config, isLoading: false })
  })

  it('records an error message when loading fails', async () => {
    vi.mocked(adaptersApi.getConfig).mockRejectedValue(new Error('boom'))

    await useAdapterStore.getState().fetchConfig()

    expect(useAdapterStore.getState()).toMatchObject({ isLoading: false, error: 'boom' })
  })

  it('updates config from the server response', async () => {
    const config = { serverUrl: 'http://localhost:9000' }
    vi.mocked(adaptersApi.updateConfig).mockResolvedValue(config)

    await useAdapterStore.getState().updateConfig({ serverUrl: 'http://localhost:9000' })

    expect(adaptersApi.updateConfig).toHaveBeenCalledWith({ serverUrl: 'http://localhost:9000' })
    expect(useAdapterStore.getState().config).toEqual(config)
  })

  it('generates a six-character pairing code and persists it', async () => {
    vi.mocked(adaptersApi.updateConfig).mockImplementation(async (patch) => {
      const config = { ...useAdapterStore.getState().config, ...patch }
      useAdapterStore.setState({ config })
      return config
    })

    const code = await useAdapterStore.getState().generatePairingCode()

    expect(code).toHaveLength(6)
    const pairing = useAdapterStore.getState().config.pairing
    expect(pairing?.code).toBe(code)
    expect(pairing?.expiresAt).toBeGreaterThan(pairing!.createdAt!)
  })

  it('removes a paired user from a configured platform', async () => {
    const config = {
      telegram: {
        botToken: 'x',
        pairedUsers: [
          { userId: 1, displayName: 'a', pairedAt: 0 },
          { userId: 2, displayName: 'b', pairedAt: 0 },
        ],
      },
    }
    useAdapterStore.setState({ config })
    vi.mocked(adaptersApi.updateConfig).mockImplementation(async (patch) => {
      const next = { ...useAdapterStore.getState().config, ...patch }
      useAdapterStore.setState({ config: next })
      return next
    })

    await useAdapterStore.getState().removePairedUser('telegram', 1)

    expect(useAdapterStore.getState().config.telegram?.pairedUsers).toEqual([
      { userId: 2, displayName: 'b', pairedAt: 0 },
    ])
  })

  it('is a no-op when removing a user from an unconfigured platform', async () => {
    await useAdapterStore.getState().removePairedUser('feishu', 1)

    expect(adaptersApi.updateConfig).not.toHaveBeenCalled()
  })
})
