import { create } from 'zustand'
import type { ThemeMode } from '../types/settings'
import { readStoredValue, writeStoredValue } from '../lib/storage'

const THEME_STORAGE_KEY = 'rin-theme'
const SIDEBAR_WIDTH_STORAGE_KEY = 'rin.sidebar.width.v1'
const SIDEBAR_WIDTH_DEFAULT = 260

function getStoredSidebarWidth(): number {
  const parsed = Number(readStoredValue(SIDEBAR_WIDTH_STORAGE_KEY))
  return Number.isFinite(parsed) && parsed >= 180 && parsed <= 520 ? parsed : SIDEBAR_WIDTH_DEFAULT
}

function getStoredTheme(): ThemeMode {
  const stored = readStoredValue(THEME_STORAGE_KEY)
  return stored === 'light' || stored === 'dark' ? stored : 'light'
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
  | 'mcp'
  | 'memory'
  | 'skills'
  | 'plugins'
  | 'computerUse'
  | 'sessionBackup'
  | 'agentMigration'
  | 'about'
  | 'behavior'
  | 'tokenOptimization'

export type WorkspaceView =
  | 'notes'
  | 'files'
  | 'scheduled'
  | 'codeGraph'
  | 'atlas'
  | 'queries'
  | 'tags'
  | 'sandbox'
  | 'repository'
  | 'agents'

export type SidebarGrouping = 'project' | 'time' | 'flat'

const SIDEBAR_GROUPING_STORAGE_KEY = 'rin-sidebar-grouping'

function getStoredSidebarGrouping(): SidebarGrouping {
  const stored = readStoredValue(SIDEBAR_GROUPING_STORAGE_KEY)
  return stored === 'time' || stored === 'project' || stored === 'flat' ? stored : 'project'
}

type UIStore = {
  theme: ThemeMode
  sidebarOpen: boolean
  sidebarWidth: number
  setSidebarWidth: (width: number) => void
  pendingSettingsTab: SettingsTab | null
  activeSettingsTab: SettingsTab
  settingsOpen: boolean
  workspaceView: WorkspaceView | null
  activeModal: string | null
  toasts: Toast[]
  sidebarGrouping: SidebarGrouping
  /** Note the Queries page asked the Notes workspace to open on next mount. */
  pendingNotePath: string | null

  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setPendingSettingsTab: (tab: SettingsTab | null) => void
  setActiveSettingsTab: (tab: SettingsTab) => void
  openSettings: (view?: SettingsTab | 'settings') => void
  openWorkspaceView: (view: WorkspaceView) => void
  closeWorkspaceView: () => void
  closeSettings: () => void
  openModal: (id: string) => void
  closeModal: () => void
  addToast: (toast: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
  setSidebarGrouping: (grouping: SidebarGrouping) => void
  setPendingNotePath: (path: string | null) => void
}

let toastCounter = 0

export const useUIStore = create<UIStore>((set) => ({
  theme: getStoredTheme(),
  sidebarOpen: true,
  sidebarWidth: getStoredSidebarWidth(),
  pendingSettingsTab: null,
  activeSettingsTab: 'overview',
  settingsOpen: false,
  workspaceView: null,
  activeModal: null,
  toasts: [],
  sidebarGrouping: getStoredSidebarGrouping(),
  pendingNotePath: null,

  setTheme: (theme) => {
    applyTheme(theme)
    writeStoredValue(THEME_STORAGE_KEY, theme)
    set({ theme })
  },

  toggleTheme: () => {
    set((state) => {
      const next = state.theme === 'light' ? 'dark' : 'light'
      applyTheme(next)
      writeStoredValue(THEME_STORAGE_KEY, next)
      return { theme: next }
    })
  },

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarWidth: (width) => {
    const clamped = Math.min(520, Math.max(180, Math.round(width)))
    writeStoredValue(SIDEBAR_WIDTH_STORAGE_KEY, String(clamped))
    set({ sidebarWidth: clamped })
  },
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setPendingSettingsTab: (tab) => set({ pendingSettingsTab: tab }),
  setActiveSettingsTab: (tab) => set({ activeSettingsTab: tab }),
  openSettings: (view = 'settings') => set(() => {
    const nextTab = view === 'settings' ? 'overview' : view
    return {
      settingsOpen: true,
      pendingSettingsTab: nextTab,
      activeSettingsTab: nextTab,
      workspaceView: null,
    }
  }),
  closeSettings: () => set({ settingsOpen: false }),
  openWorkspaceView: (workspaceView) => set({
    workspaceView,
    settingsOpen: false,
  }),
  closeWorkspaceView: () => set({ workspaceView: null }),
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
    writeStoredValue(SIDEBAR_GROUPING_STORAGE_KEY, grouping)
    set({ sidebarGrouping: grouping })
  },

  setPendingNotePath: (path) => set({ pendingNotePath: path }),
}))
