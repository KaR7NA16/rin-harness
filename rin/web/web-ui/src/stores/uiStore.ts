import { create } from 'zustand'
import type { ThemeMode } from '../types/settings'

const THEME_STORAGE_KEY = 'cybercode-theme'

function getStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch { /* localStorage unavailable */ }
  return 'light'
}

export function applyTheme(theme: ThemeMode) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', theme)
  document.documentElement.style.colorScheme = theme
}

export function initializeTheme() {
  applyTheme(getStoredTheme())
}

export type Toast = {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  message: string
  duration?: number
}

export type SettingsTab =
  | 'overview'
  | 'providers'
  | 'permissions'
  | 'general'
  | 'adapters'
  | 'terminal'
  | 'mcp'
  | 'agents'
  | 'memory'
  | 'skills'
  | 'plugins'
  | 'computerUse'
  | 'sessionBackup'
  | 'agentMigration'
  | 'tokenOptimization'
  | 'about'
  | 'behavior'

export type SettingsPanelView =
  | SettingsTab
  | 'settings'
  | 'scheduled'
  | 'notes'
  | 'tokenOptimization'
  | 'codeGraph'
  | 'agentMigration'

export type WorkspaceView =
  | 'notes'
  | 'scheduled'
  | 'codeGraph'
  | 'sandbox'
  | 'repository'
  | 'agents'
  | 'monitor'

type ActiveView = 'code' | 'scheduled' | 'terminal' | 'history' | 'settings'

export type SidebarGrouping = 'project' | 'time'

const SIDEBAR_GROUPING_STORAGE_KEY = 'cybercode-sidebar-grouping'

function getStoredSidebarGrouping(): SidebarGrouping {
  try {
    const stored = localStorage.getItem(SIDEBAR_GROUPING_STORAGE_KEY)
    if (stored === 'time' || stored === 'project') return stored
  } catch { /* localStorage unavailable */ }
  return 'project'
}

type UIStore = {
  theme: ThemeMode
  sidebarOpen: boolean
  activeView: ActiveView
  pendingSettingsTab: SettingsTab | null
  activeSettingsTab: SettingsTab
  settingsOpen: boolean
  settingsPanelView: SettingsPanelView
  workspaceView: WorkspaceView | null
  /** Which settings page is shown directly in the content area via the icon rail.
   * Deprecated: rail entries now open the shared floating settings panel. */
  railSettingsView: SettingsTab | null
  activeModal: string | null
  toasts: Toast[]
  sidebarGrouping: SidebarGrouping

  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setActiveView: (view: ActiveView) => void
  setPendingSettingsTab: (tab: SettingsTab | null) => void
  setActiveSettingsTab: (tab: SettingsTab) => void
  openSettings: (view?: SettingsPanelView) => void
  openWorkspaceView: (view: WorkspaceView) => void
  closeWorkspaceView: () => void
  closeSettings: () => void
  setRailSettingsView: (view: SettingsTab | null) => void
  openModal: (id: string) => void
  closeModal: () => void
  addToast: (toast: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
  setSidebarGrouping: (grouping: SidebarGrouping) => void
}

let toastCounter = 0

export const useUIStore = create<UIStore>((set) => ({
  theme: getStoredTheme(),
  sidebarOpen: true,
  activeView: 'code',
  pendingSettingsTab: null,
  activeSettingsTab: 'overview',
  settingsOpen: false,
  settingsPanelView: 'settings',
  workspaceView: null,
  railSettingsView: null,
  activeModal: null,
  toasts: [],
  sidebarGrouping: getStoredSidebarGrouping(),

  setTheme: (theme) => {
    applyTheme(theme)
    try { localStorage.setItem(THEME_STORAGE_KEY, theme) } catch { /* noop */ }
    set({ theme })
  },

  toggleTheme: () => {
    set((state) => {
      const next = state.theme === 'light' ? 'dark' : 'light'
      applyTheme(next)
      try { localStorage.setItem(THEME_STORAGE_KEY, next) } catch { /* noop */ }
      return { theme: next }
    })
  },

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setActiveView: (view) => set({ activeView: view }),
  setPendingSettingsTab: (tab) => set({ pendingSettingsTab: tab }),
  setActiveSettingsTab: (tab) => set({ activeSettingsTab: tab }),
  openSettings: (view = 'settings') => set(() => {
    const isDirectPanel = view === 'scheduled' || view === 'notes' || view === 'codeGraph'
    const nextTab = view === 'settings' || isDirectPanel ? 'overview' : view
    if (isDirectPanel) {
      return {
        settingsOpen: false,
        settingsPanelView: 'settings',
        pendingSettingsTab: null,
        workspaceView: view,
        railSettingsView: null,
      }
    }
    return {
      settingsOpen: true,
      settingsPanelView: 'settings',
      pendingSettingsTab: nextTab,
      activeSettingsTab: nextTab,
      workspaceView: null,
      railSettingsView: null,
    }
  }),
  closeSettings: () => set({ settingsOpen: false }),
  openWorkspaceView: (workspaceView) => set({
    workspaceView,
    settingsOpen: false,
    railSettingsView: null,
  }),
  closeWorkspaceView: () => set({ workspaceView: null }),
  setRailSettingsView: (view) => set(view
    ? {
        settingsOpen: true,
        settingsPanelView: 'settings',
        pendingSettingsTab: view,
        activeSettingsTab: view,
        railSettingsView: null,
      }
    : { settingsOpen: false, railSettingsView: null }),
  openModal: (id) => set({ activeModal: id }),
  closeModal: () => set({ activeModal: null }),

  addToast: (toast) => {
    const id = `toast-${++toastCounter}`
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }))
    // Auto-remove after duration
    const duration = toast.duration ?? 4000
    if (duration > 0) {
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
      }, duration)
    }
  },

  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setSidebarGrouping: (grouping) => {
    try { localStorage.setItem(SIDEBAR_GROUPING_STORAGE_KEY, grouping) } catch { /* noop */ }
    set({ sidebarGrouping: grouping })
  },
}))
