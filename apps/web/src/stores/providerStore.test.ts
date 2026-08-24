import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OFFICIAL_DEFAULT_MODEL_ID } from '../constants/modelCatalog'
import { providersApi } from '../api/providers'
import type { ProviderTestResult, SavedProvider } from '../types/provider'
import { useProviderStore } from './providerStore'

const h = vi.hoisted(() => ({
  setModelMock: vi.fn(async () => {}),
  fetchAllMock: vi.fn(async () => {}),
}))

vi.mock('./settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      setModel: h.setModelMock,
      fetchAll: h.fetchAllMock,
    }),
  },
}))

vi.mock('../api/providers', () => ({
  providersApi: {
    list: vi.fn(),
    presets: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    activate: vi.fn(),
    activateOfficial: vi.fn(),
    test: vi.fn(),
    testConfig: vi.fn(),
  },
}))

function makeProvider(overrides: Partial<SavedProvider> = {}): SavedProvider {
  return {
    id: 'p1',
    presetId: 'preset-1',
    name: 'Provider',
    apiKey: 'key',
    baseUrl: 'http://localhost',
    apiFormat: 'anthropic',
    models: { main: 'model-main', haiku: 'model-h', sonnet: 'model-s', opus: 'model-o' },
    ...overrides,
  }
}

function makeTestResult(): ProviderTestResult {
  return { connectivity: { success: true, latencyMs: 10 } }
}

describe('providerStore', () => {
  beforeEach(() => {
    useProviderStore.setState({
      providers: [],
      activeId: null,
      hasLoadedProviders: false,
      presets: [],
      isLoading: false,
      isPresetsLoading: false,
      error: null,
    })
    vi.clearAllMocks()
  })

  it('loads providers and marks them as loaded', async () => {
    vi.mocked(providersApi.list).mockResolvedValue({ providers: [makeProvider()], activeId: 'p1' })

    await useProviderStore.getState().fetchProviders()

    expect(useProviderStore.getState()).toMatchObject({
      providers: [makeProvider()],
      activeId: 'p1',
      hasLoadedProviders: true,
      isLoading: false,
    })
  })

  it('records an error when listing providers fails', async () => {
    vi.mocked(providersApi.list).mockRejectedValue(new Error('boom'))

    await useProviderStore.getState().fetchProviders()

    expect(useProviderStore.getState().error).toBe('boom')
  })

  it('loads presets', async () => {
    vi.mocked(providersApi.presets).mockResolvedValue({ presets: [{ id: 'preset-1', name: 'Preset' } as never] })

    await useProviderStore.getState().fetchPresets()

    expect(useProviderStore.getState().presets).toHaveLength(1)
  })

  it('creates a provider and refreshes the list', async () => {
    const created = makeProvider()
    vi.mocked(providersApi.create).mockResolvedValue({ provider: created })
    vi.mocked(providersApi.list).mockResolvedValue({ providers: [created], activeId: 'p1' })

    const result = await useProviderStore.getState().createProvider({ presetId: 'preset-1', name: 'Provider', apiKey: 'k', baseUrl: 'http://localhost', models: created.models })

    expect(result.id).toBe('p1')
    expect(useProviderStore.getState().providers).toHaveLength(1)
  })

  it('deletes a provider and refreshes the list', async () => {
    vi.mocked(providersApi.delete).mockResolvedValue({ ok: true })
    vi.mocked(providersApi.list).mockResolvedValue({ providers: [], activeId: null })

    await useProviderStore.getState().deleteProvider('p1')

    expect(providersApi.delete).toHaveBeenCalledWith('p1')
  })

  it('activates a provider and syncs the default model', async () => {
    vi.mocked(providersApi.activate).mockResolvedValue({ ok: true })
    vi.mocked(providersApi.list).mockResolvedValue({ providers: [makeProvider()], activeId: 'p1' })

    await useProviderStore.getState().activateProvider('p1')

    expect(providersApi.activate).toHaveBeenCalledWith('p1')
    expect(h.setModelMock).toHaveBeenCalledWith('model-main')
    expect(h.fetchAllMock).toHaveBeenCalled()
  })

  it('activates the official default and resets the model', async () => {
    vi.mocked(providersApi.activateOfficial).mockResolvedValue({ ok: true })
    vi.mocked(providersApi.list).mockResolvedValue({ providers: [], activeId: null })

    await useProviderStore.getState().activateOfficial()

    expect(providersApi.activateOfficial).toHaveBeenCalled()
    expect(h.setModelMock).toHaveBeenCalledWith(OFFICIAL_DEFAULT_MODEL_ID)
    expect(h.fetchAllMock).toHaveBeenCalled()
  })

  it('tests a provider and returns the result', async () => {
    const result = makeTestResult()
    vi.mocked(providersApi.test).mockResolvedValue({ result })

    const returned = await useProviderStore.getState().testProvider('p1', { modelId: 'model-main' })

    expect(providersApi.test).toHaveBeenCalledWith('p1', { modelId: 'model-main' })
    expect(returned).toEqual(result)
  })

  it('tests an unpersisted config and returns the result', async () => {
    const result = makeTestResult()
    vi.mocked(providersApi.testConfig).mockResolvedValue({ result })

    const input = { baseUrl: 'http://localhost', apiKey: 'k', modelId: 'model-main' }
    const returned = await useProviderStore.getState().testConfig(input)

    expect(providersApi.testConfig).toHaveBeenCalledWith(input)
    expect(returned).toEqual(result)
  })
})
