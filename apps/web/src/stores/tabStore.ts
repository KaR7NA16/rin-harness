import { create } from 'zustand'
import { sessionsApi } from '../api/sessions'
import { t } from '../i18n'
import { useUIStore } from './uiStore'
import { getDefaultSessionTitle, getSessionDisplayTitle, getSessionTitleText } from '../utils/sessionTitle'
import { readStoredValue, writeStoredValue, removeStoredValue } from '../lib/storage'

const TAB_STORAGE_KEY = 'rin-open-tabs'

export const TERMINAL_TAB_PREFIX = '__terminal__'

export type TabType = 'session' | 'scheduled' | 'terminal' | 'notes' | 'files' | 'codeGraph' | 'sandbox' | 'backup' | 'repository' | 'agents'

export type Tab = {
  sessionId: string
  /** 终端标签可选: 自定义启动命令 (如容器 exec) */
  spawnCommand?: string[]
  cwd?: string
  projectPath?: string
  title: string
  type: TabType
  status: 'idle' | 'running' | 'error'
}

type TabPersistence = {
  openTabs: Array<{ sessionId: string; projectPath?: string; title: string; type?: TabType; status?: Tab['status']; spawnCommand?: string[]; cwd?: string }>
  activeTabId: string | null
}

type TabStore = {
  tabs: Tab[]
  activeTabId: string | null
  /** Last N session-type tab IDs visited — kept mounted for instant switching */
  recentSessionIds: string[]
  /** Navigation history for title bar back/forward arrows (browser-style) */
  navHistory: string[]
  navIndex: number

  openTab: (sessionId: string, title: string, type?: TabType, projectPath?: string) => void
  openTerminalTab: (options?: { title?: string; spawnCommand?: string[]; cwd?: string }) => string
  switchToSession: (sessionId: string, title: string, projectPath?: string) => void
  closeTab: (sessionId: string, projectPath?: string) => void
  setActiveTab: (sessionId: string) => void
  updateTabTitle: (sessionId: string, title: string, projectPath?: string) => void
  updateTabStatus: (sessionId: string, status: Tab['status']) => void
  replaceTabSession: (oldSessionId: string, newSessionId: string, projectPath?: string) => void
  moveTab: (fromIndex: number, toIndex: number) => void
  goBack: () => void
  goForward: () => void

  saveTabs: () => void
  restoreTabs: () => Promise<void>
}

const RECENT_MAX = 5

function addToRecent(ids: string[], id: string): string[] {
  return [id, ...ids.filter((x) => x !== id)].slice(0, RECENT_MAX)
}

function nextTerminalNumber(tabs: Tab[]): number {
  const used = tabs
    .filter((tab) => tab.type === 'terminal')
    .map((tab) => {
      const match = tab.title.match(/^Terminal\s+(\d+)$/)
      return match ? Number(match[1]) : 0
    })
  return Math.max(0, ...used) + 1
}

function matchesSessionLocator(tab: Tab, sessionId: string, projectPath?: string): boolean {
  if (tab.sessionId !== sessionId) return false
  if (!projectPath) return true
  return !tab.projectPath || tab.projectPath === projectPath
}

const NAV_HISTORY_MAX = 50

/** Record a visit to a tabId: truncate forward history, then append the tabId. */
function recordNavigation(
  history: string[],
  index: number,
  tabId: string,
): { history: string[]; index: number } {
  if (history[index] === tabId && index >= 0) return { history, index }
  const nextHistory = [...history.slice(0, index + 1), tabId]
  return { history: nextHistory.slice(-NAV_HISTORY_MAX), index: nextHistory.length - 1 }
}

export const useTabStore = create<TabStore>((set, get) => ({
  tabs: [],
  activeTabId: null,
  recentSessionIds: [],
  navHistory: [],
  navIndex: -1,

  openTab: (sessionId, title, type = 'session', projectPath) => {
    const { tabs, recentSessionIds, navHistory, navIndex } = get()
    const existing = tabs.find((tab) => tab.sessionId === sessionId)
    const newRecent = type === 'session' ? addToRecent(recentSessionIds, sessionId) : recentSessionIds
    const navigation = recordNavigation(navHistory, navIndex, sessionId)

    if (existing) {
      set({
        tabs: tabs.map((tab) =>
          tab.sessionId === sessionId ? { ...tab, title, type, projectPath } : tab,
        ),
        activeTabId: sessionId,
        recentSessionIds: newRecent,
        navHistory: navigation.history,
        navIndex: navigation.index,
      })
    } else {
      set({
        tabs: [...tabs, { sessionId, projectPath, title, type, status: 'idle' }],
        activeTabId: sessionId,
        recentSessionIds: newRecent,
        navHistory: navigation.history,
        navIndex: navigation.index,
      })
    }

    useUIStore.getState().closeWorkspaceView()
    get().saveTabs()
  },

  openTerminalTab: (options?: { title?: string; spawnCommand?: string[]; cwd?: string }) => {
    const tabs = get().tabs
    const nextNumber = nextTerminalNumber(tabs)
    let terminalId = `${TERMINAL_TAB_PREFIX}${nextNumber}`
    let suffix = nextNumber
    while (tabs.some((tab) => tab.sessionId === terminalId)) {
      suffix += 1
      terminalId = `${TERMINAL_TAB_PREFIX}${suffix}`
    }
    const title = options?.title ?? `Terminal ${nextNumber}`
    get().openTab(terminalId, title, 'terminal')
    if (options?.spawnCommand || options?.cwd) {
      set((s) => ({
        tabs: s.tabs.map((tab) =>
          tab.sessionId === terminalId ? { ...tab, ...(options.spawnCommand ? { spawnCommand: options.spawnCommand } : {}), ...(options.cwd ? { cwd: options.cwd } : {}) } : tab,
        ),
      }))
      get().saveTabs()
    }
    return terminalId
  },

  switchToSession: (sessionId, title, projectPath) => {
    get().openTab(sessionId, title, 'session', projectPath)
  },

  closeTab: (sessionId, projectPath) => {
    const { tabs, activeTabId, recentSessionIds, navHistory, navIndex } = get()
    const index = tabs.findIndex((tab) => matchesSessionLocator(tab, sessionId, projectPath))
    if (index < 0) return

    const newTabs = tabs.filter((tab) => !matchesSessionLocator(tab, sessionId, projectPath))
    let newActiveId = activeTabId
    let newRecent = recentSessionIds.filter((id) => id !== sessionId)

    if (activeTabId === sessionId) {
      if (newTabs.length === 0) {
        newActiveId = null
      } else if (index >= newTabs.length) {
        newActiveId = newTabs[newTabs.length - 1]!.sessionId
      } else {
        newActiveId = newTabs[index]!.sessionId
      }

      const newActiveTab = newTabs.find((tab) => tab.sessionId === newActiveId)
      if (newActiveTab?.type === 'session' && newActiveId) {
        newRecent = addToRecent(newRecent, newActiveId)
      }
    }

    // Prune the closed tab from navigation history and re-anchor the index.
    const newNavHistory = navHistory.filter((id) => id !== sessionId)
    const newNavIndex = Math.max(-1, Math.min(navIndex, newNavHistory.length - 1))

    set({ tabs: newTabs, activeTabId: newActiveId, recentSessionIds: newRecent, navHistory: newNavHistory, navIndex: newNavIndex })
    get().saveTabs()
  },

  setActiveTab: (sessionId) => {
    const { tabs, recentSessionIds, navHistory, navIndex } = get()
    const tab = tabs.find((candidate) => candidate.sessionId === sessionId)
    if (!tab) return
    const navigation = recordNavigation(navHistory, navIndex, sessionId)
    set({
      activeTabId: sessionId,
      recentSessionIds: tab.type === 'session' ? addToRecent(recentSessionIds, sessionId) : recentSessionIds,
      navHistory: navigation.history,
      navIndex: navigation.index,
    })
    useUIStore.getState().closeWorkspaceView()
    get().saveTabs()
  },

  updateTabTitle: (sessionId, title, projectPath) => {
    set((s) => ({
      tabs: s.tabs.map((tab) =>
        matchesSessionLocator(tab, sessionId, projectPath) ? { ...tab, title } : tab,
      ),
    }))
    get().saveTabs()
  },

  updateTabStatus: (sessionId, status) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.sessionId === sessionId ? { ...t, status } : t)),
    }))
  },

  replaceTabSession: (oldSessionId, newSessionId, projectPath) => {
    const { activeTabId, recentSessionIds, tabs } = get()
    const oldTab = tabs.find((tab) => tab.sessionId === oldSessionId)
    if (!oldTab || oldTab.type !== 'session') {
      get().openTab(newSessionId, getDefaultSessionTitle(t), 'session', projectPath)
      return
    }

    set((s) => ({
      tabs: s.tabs.map((tab) =>
        tab.sessionId === oldSessionId
          ? { ...tab, sessionId: newSessionId, projectPath, title: getDefaultSessionTitle(t), status: 'idle' }
          : tab,
      ),
      activeTabId: activeTabId === oldSessionId ? newSessionId : activeTabId,
      recentSessionIds: addToRecent(
        recentSessionIds.map((id) => (id === oldSessionId ? newSessionId : id)),
        newSessionId,
      ),
    }))
    get().saveTabs()
  },

  moveTab: (fromIndex, toIndex) => {
    if (fromIndex === toIndex) return
    const { tabs } = get()
    if (fromIndex < 0 || fromIndex >= tabs.length || toIndex < 0 || toIndex >= tabs.length) return
    const newTabs = [...tabs]
    const [moved] = newTabs.splice(fromIndex, 1)
    if (!moved) return
    newTabs.splice(toIndex, 0, moved)
    set({ tabs: newTabs })
    get().saveTabs()
  },

  goBack: () => {
    const { navHistory, navIndex, tabs, recentSessionIds } = get()
    if (navIndex <= 0 || navHistory.length === 0) return
    const nextIndex = navIndex - 1
    const targetId = navHistory[nextIndex]
    if (!targetId) return
    const tab = tabs.find((candidate) => candidate.sessionId === targetId)
    if (!tab) return
    set({
      activeTabId: targetId,
      navIndex: nextIndex,
      recentSessionIds: tab.type === 'session'
        ? addToRecent(recentSessionIds, targetId)
        : recentSessionIds,
    })
    useUIStore.getState().closeWorkspaceView()
    get().saveTabs()
  },

  goForward: () => {
    const { navHistory, navIndex, tabs, recentSessionIds } = get()
    if (navIndex < 0 || navIndex >= navHistory.length - 1) return
    const nextIndex = navIndex + 1
    const targetId = navHistory[nextIndex]
    if (!targetId) return
    const tab = tabs.find((candidate) => candidate.sessionId === targetId)
    if (!tab) return
    set({
      activeTabId: targetId,
      navIndex: nextIndex,
      recentSessionIds: tab.type === 'session'
        ? addToRecent(recentSessionIds, targetId)
        : recentSessionIds,
    })
    useUIStore.getState().closeWorkspaceView()
    get().saveTabs()
  },

  saveTabs: () => {
    const { tabs, activeTabId } = get()
    const persistentTabs = tabs.filter((tab) => tab.type === 'session' || tab.type === 'terminal')
    if (persistentTabs.length === 0) {
      removeStoredValue(TAB_STORAGE_KEY)
      return
    }

    const data: TabPersistence = {
      openTabs: persistentTabs.map((tab) => ({
        sessionId: tab.sessionId,
        projectPath: tab.projectPath,
        title: tab.title,
        type: tab.type,
        status: tab.status,
        ...(tab.spawnCommand ? { spawnCommand: tab.spawnCommand } : {}),
        ...(tab.cwd ? { cwd: tab.cwd } : {}),
      })),
      activeTabId: activeTabId && persistentTabs.some((tab) => tab.sessionId === activeTabId)
        ? activeTabId
        : persistentTabs[0]!.sessionId,
    }
    writeStoredValue(TAB_STORAGE_KEY, JSON.stringify(data))
  },

  restoreTabs: async () => {
    try {
      const raw = readStoredValue(TAB_STORAGE_KEY)
      if (!raw) return

      const parsed = JSON.parse(raw) as Partial<TabPersistence> & {
        activeTitle?: string
        activeType?: TabType
      }
      const persistedTabs = (parsed.openTabs && parsed.openTabs.length > 0
        ? parsed.openTabs
        : parsed.activeTabId
          ? [{
              sessionId: parsed.activeTabId,
              title: parsed.activeTitle || getDefaultSessionTitle(t),
              type: parsed.activeType || 'session',
            }]
          : [])
        // Tool workspaces moved to the rail and are intentionally transient.
        // Filtering here also migrates legacy persisted tool tabs in place.
        .filter((tab) => !tab.type || tab.type === 'session' || tab.type === 'terminal')
      if (persistedTabs.length === 0) {
        removeStoredValue(TAB_STORAGE_KEY)
        return
      }

      // Session tab — verify session still exists
      const { sessions } = await sessionsApi.list({ limit: 200 })
      const restoredTabs: Tab[] = persistedTabs
        .filter((tab) => {
          if (tab.type === 'terminal') return true
          return sessions.some((session) =>
            session.id === tab.sessionId && (!tab.projectPath || session.projectPath === tab.projectPath),
          )
        })
        .map((tab) => {
          if (tab.type === 'terminal') {
            return {
              sessionId: tab.sessionId,
              title: tab.title || 'Terminal',
              type: 'terminal',
              status: 'idle',
              ...(tab.cwd ? { cwd: tab.cwd } : {}),
              ...(tab.spawnCommand ? { spawnCommand: tab.spawnCommand } : {}),
            }
          }
          const session = sessions.find((candidate) =>
            candidate.id === tab.sessionId && (!tab.projectPath || candidate.projectPath === tab.projectPath),
          )
          return {
            sessionId: tab.sessionId,
            projectPath: session?.projectPath ?? tab.projectPath,
            title: session ? getSessionDisplayTitle(session, t) : getSessionTitleText(tab.title, t),
            type: 'session',
            status: tab.status || 'idle',
          }
        })

      if (restoredTabs.length === 0) {
        removeStoredValue(TAB_STORAGE_KEY)
        return
      }

      const activeId =
        parsed.activeTabId && restoredTabs.some((tab) => tab.sessionId === parsed.activeTabId)
          ? parsed.activeTabId
          : restoredTabs[0]!.sessionId

      const activeTab = restoredTabs.find((tab) => tab.sessionId === activeId)
      const recentSessionIds = [
        ...(activeTab?.type === 'session' ? [activeId] : []),
        ...restoredTabs
          .filter((tab) => tab.type === 'session' && tab.sessionId !== activeId)
          .map((tab) => tab.sessionId),
      ].slice(0, RECENT_MAX)

      const navHistory = restoredTabs.map((tab) => tab.sessionId)
      set({
        tabs: restoredTabs,
        activeTabId: activeId,
        recentSessionIds,
        navHistory,
        navIndex: navHistory.findIndex((id) => id === activeId),
      })
      get().saveTabs()
    } catch { /* noop */ }
  },
}))
