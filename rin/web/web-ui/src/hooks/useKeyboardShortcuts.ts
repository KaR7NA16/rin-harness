import { useEffect, useRef } from 'react'
import { useChatStore } from '../stores/chatStore'
import { useTabStore } from '../stores/tabStore'
import { useUIStore } from '../stores/uiStore'

export function useKeyboardShortcuts() {
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const closeModal = useUIStore((s) => s.closeModal)
  const activeModal = useUIStore((s) => s.activeModal)
  const openSettings = useUIStore((s) => s.openSettings)
  const stopGeneration = useChatStore((s) => s.stopGeneration)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const tabs = useTabStore((s) => s.tabs)
  const closeTab = useTabStore((s) => s.closeTab)
  const setActiveTab = useTabStore((s) => s.setActiveTab)
  const chatState = useChatStore((s) => activeTabId ? s.sessions[activeTabId]?.chatState ?? 'idle' : 'idle')

  const activeModalRef = useRef(activeModal)
  activeModalRef.current = activeModal
  const chatStateRef = useRef(chatState)
  chatStateRef.current = chatState
  const activeTabIdRef = useRef(activeTabId)
  activeTabIdRef.current = activeTabId
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey

      // Cmd+N — New session (same as the sidebar "+" button)
      if (meta && e.key === 'n') {
        e.preventDefault()
        setSidebarOpen(true)
        requestAnimationFrame(() => {
          const button = document.getElementById('sidebar-new-session') as HTMLButtonElement | null
          button?.click()
        })
      }

      // Cmd+B — Toggle sidebar
      if (meta && e.key === 'b') {
        e.preventDefault()
        toggleSidebar()
      }

      // Cmd+K — Focus search (sidebar search input)
      if (meta && e.key === 'k') {
        e.preventDefault()
        setSidebarOpen(true)
        requestAnimationFrame(() => {
          const searchInput = document.querySelector('#sidebar-search') as HTMLInputElement | null
          searchInput?.focus()
          searchInput?.select()
        })
      }

      // Cmd+W — Close the active tab
      if (meta && e.key === 'w') {
        const id = activeTabIdRef.current
        if (id) {
          e.preventDefault()
          closeTab(id)
        }
      }

      // Cmd+, — Open settings (same as the IconRail gear button)
      if (meta && e.key === ',') {
        e.preventDefault()
        openSettings('settings')
      }

      // Ctrl+Tab / Ctrl+Shift+Tab — Cycle tabs in array order
      if (e.ctrlKey && e.key === 'Tab') {
        const currentTabs = tabsRef.current
        if (currentTabs.length > 1) {
          e.preventDefault()
          const found = currentTabs.findIndex((tab) => tab.sessionId === activeTabIdRef.current)
          const index = found === -1 ? 0 : found
          const step = e.shiftKey ? -1 : 1
          const next = currentTabs[(index + step + currentTabs.length) % currentTabs.length]
          if (next) setActiveTab(next.sessionId)
        }
      }

      // Escape — Close modal or clear state
      if (e.key === 'Escape') {
        if (activeModalRef.current) {
          closeModal()
        }
      }

      // Cmd+. — Stop generation
      if (meta && e.key === '.') {
        if (chatStateRef.current !== 'idle' && activeTabIdRef.current) {
          e.preventDefault()
          stopGeneration(activeTabIdRef.current)
        }
      }
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [closeModal, setSidebarOpen, toggleSidebar, stopGeneration, openSettings, closeTab, setActiveTab])
}
