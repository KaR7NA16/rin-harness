import { useEffect, useState } from 'react'
import { Sidebar } from './Sidebar'
import { ContentRouter } from './ContentRouter'
import { ToastContainer } from '../shared/Toast'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUIStore, type SettingsTab } from '../../stores/uiStore'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import { initializeDesktopServerUrl } from '../../lib/desktopRuntime'
import { TabBar } from './TabBar'
import { StatusBar } from './StatusBar'
import { StartupErrorView } from './StartupErrorView'
import { SettingsPanel } from './SettingsPanel'
import { useTabStore } from '../../stores/tabStore'
import { useChatStore } from '../../stores/chatStore'

const BOOT_SPLASH_REMOVE_DELAY_MS = 16

const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
const isLinux = typeof navigator !== 'undefined' && /Linux/.test(navigator.platform)

function dismissBootSplash() {
  const splash = document.getElementById('boot-splash')
  if (!splash) return () => {}

  splash.classList.add('boot-splash-exit')
  const remove = () => splash.remove()
  const timeout = window.setTimeout(remove, BOOT_SPLASH_REMOVE_DELAY_MS)

  return () => {
    window.clearTimeout(timeout)
  }
}

export function AppShell() {
  const fetchSettings = useSettingsStore((s) => s.fetchAll)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const sidebarWidth = useUIStore((s) => s.sidebarWidth)
  const settingsOpen = useUIStore((s) => s.settingsOpen)
  const closeSettings = useUIStore((s) => s.closeSettings)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const [ready, setReady] = useState(false)
  const [startupError, setStartupError] = useState<string | null>(null)

  useEffect(() => {
    if (settingsOpen) closeSettings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId])

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      try {
        await initializeDesktopServerUrl()
      } catch (error) {
        if (!cancelled) {
          setStartupError(error instanceof Error ? error.message : String(error))
        }
        return
      }

      await Promise.all([
        fetchSettings().catch((error) => {
          console.warn('[desktop] Failed to load startup settings:', error)
        }),
        useTabStore.getState().restoreTabs().catch((error) => {
          console.warn('[desktop] Failed to restore startup tabs:', error)
        }),
      ])

      const { activeTabId: activeId, tabs } = useTabStore.getState()
      const activeTab = tabs.find((tab) => tab.sessionId === activeId)
      if (activeId && activeTab?.type === 'session') {
        try {
          await useChatStore.getState().ensureSessionReady(activeTab.sessionId, activeTab.projectPath)
        } catch (error) {
          console.warn('[desktop] Failed to prepare the startup session:', error)
        }
      }

      if (!cancelled) setReady(true)
    }

    void bootstrap()
    return () => { cancelled = true }
  }, [fetchSettings])

  useEffect(() => {
    let unlisten: (() => void) | undefined
    import(/* @vite-ignore */ '@tauri-apps/api/event')
      .then(({ listen }) =>
        listen<string>('native-menu-navigate', (event) => {
          const target = event.payload as SettingsTab | 'settings'
          useUIStore.getState().openSettings(target)
        }),
      )
      .then((fn) => { unlisten = fn })
      .catch(() => {})
    return () => { unlisten?.() }
  }, [])

  useEffect(() => {
    if (!isTauri) return
    const handler = (e: MouseEvent) => {
      if (!(e.target instanceof HTMLElement)) return
      if (!e.target.closest('[data-tauri-drag-region]')) return
      if (e.target.closest('button, a, input, textarea, select, [role="button"]')) return
      import('@tauri-apps/api/window')
        .then(({ getCurrentWindow }) => getCurrentWindow().toggleMaximize())
        .catch(() => {})
    }
    document.addEventListener('dblclick', handler)
    return () => document.removeEventListener('dblclick', handler)
  }, [])

  useEffect(() => {
    if (isTauri && isLinux) {
      document.documentElement.setAttribute('data-webview', 'webkit2gtk')
    }
  }, [])

  useEffect(() => {
    if (!ready && !startupError) return
    return dismissBootSplash()
  }, [ready, startupError])

  useKeyboardShortcuts()

  if (startupError) {
    return <StartupErrorView error={startupError} />
  }

  if (!ready) {
    return null
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-transparent font-sans text-[var(--color-text-primary)]">
      <div className="relative flex h-full w-full overflow-hidden bg-transparent">
        <div
          className={`relative z-20 h-full shrink-0 overflow-hidden ${sidebarOpen ? '' : 'w-0'}`}
          style={{ width: sidebarOpen ? sidebarWidth : undefined, transition: sidebarOpen ? undefined : 'width 0s var(--motion-sidebar-duration)' }}
        >
          <div
            className={`sidebar-panel-slider h-full border-r border-[var(--color-border-separator)] bg-[var(--color-surface-sidebar)] ${sidebarOpen ? '' : '-translate-x-full pointer-events-none'}`}
            style={{ width: sidebarWidth }}
          >
            <Sidebar />
          </div>
        </div>
        <main
          id="content-area"
          className="relative z-10 flex min-w-0 w-0 flex-1 flex-col overflow-hidden bg-[var(--color-background)] transition-colors duration-150"
        >
          <TabBar />
          <ContentRouter />
          <StatusBar />
          {/* 全屏设置 sheet：覆盖内容区（TabBar / 内容 / StatusBar），左侧 Sidebar 保持可见可点 */}
          <SettingsPanel visible={settingsOpen} />
        </main>
        <ToastContainer />
      </div>
    </div>
  )
}
