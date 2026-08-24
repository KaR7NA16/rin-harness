import { create } from 'zustand'
import { pluginsApi } from '../api/plugins'
import type {
  PluginDetail,
  PluginListResponse,
  PluginScope,
  PluginSummary,
} from '../types/plugin'

type PluginStore = {
  plugins: PluginSummary[]
  marketplaces: PluginListResponse['marketplaces']
  summary: PluginListResponse['summary'] | null
  selectedPlugin: PluginDetail | null
  isLoading: boolean
  isDetailLoading: boolean
  isApplying: boolean
  error: string | null
  fetchPlugins: (cwd?: string) => Promise<void>
  fetchPluginDetail: (id: string, cwd?: string) => Promise<void>
  enablePlugin: (id: string, scope?: PluginScope, cwd?: string) => Promise<string>
  disablePlugin: (id: string, scope?: PluginScope, cwd?: string) => Promise<string>
  clearSelection: () => void
}

export const usePluginStore = create<PluginStore>((set, get) => ({
  plugins: [],
  marketplaces: [],
  summary: null,
  selectedPlugin: null,
  isLoading: false,
  isDetailLoading: false,
  isApplying: false,
  error: null,

  fetchPlugins: async (cwd) => {
    set({ isLoading: true, error: null })
    try {
      const data = await pluginsApi.list(cwd)
      set({
        plugins: data.plugins,
        marketplaces: data.marketplaces,
        summary: data.summary,
        isLoading: false,
      })
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },

  fetchPluginDetail: async (id, cwd) => {
    set({ isDetailLoading: true, error: null })
    try {
      const { detail } = await pluginsApi.detail(id, cwd)
      set({ selectedPlugin: detail, isDetailLoading: false })
    } catch (err) {
      set({
        isDetailLoading: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },

  enablePlugin: async (id, scope, cwd) => {
    return runAction(
      () => pluginsApi.enable({ id, scope }),
      set,
      get,
      cwd,
    )
  },

  disablePlugin: async (id, scope, cwd) => {
    return runAction(
      () => pluginsApi.disable({ id, scope }),
      set,
      get,
      cwd,
    )
  },

  clearSelection: () => set({ selectedPlugin: null }),
}))

async function runAction(
  action: () => Promise<{ ok: true; message: string }>,
  set: (updater: Partial<PluginStore>) => void,
  get: () => PluginStore,
  cwd?: string,
): Promise<string> {
  set({ isApplying: true, error: null })
  try {
    const { message } = await action()
    await get().fetchPlugins(cwd)
    const selected = get().selectedPlugin
    if (selected) {
      await get().fetchPluginDetail(selected.id, cwd)
    }
    set({ isApplying: false })
    return message
  } catch (err) {
    set({
      isApplying: false,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}
