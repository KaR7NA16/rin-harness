import { memo, useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useUIStore, type SidebarGrouping, type WorkspaceView } from '../../stores/uiStore'
import { useTranslation } from '../../i18n'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { useTabStore } from '../../stores/tabStore'
import { useChatStore } from '../../stores/chatStore'
import { getSessionDisplayTitle } from '../../utils/sessionTitle'
import { NewSessionMenu } from './NewSessionMenu'
import { NewProjectDialog } from './NewProjectDialog'
import { resolveCurrentProject } from './NewSessionChooser'
import { ProjectFilter } from './ProjectFilter'
import { Icon, type IconName } from '../shared/Icon'
import { useCreateAndOpenSession } from '../../hooks/useCreateAndOpenSession'
import type { SessionListItem } from '../../types/session'
import { sessionsApi, type SessionSearchHit } from '../../api/sessions'
import { readStoredJson, writeStoredJson } from '../../lib/storage'
import {
  applyStoredOrder,
  useSidebarOrderStore,
  type SidebarOrderBy,
} from '../../stores/sidebarOrderStore'

const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
const COLLAPSED_PROJECTS_KEY = 'rin.sidebar.collapsedProjects.v1'
/** 每个项目组默认展开的会话行数（对齐 DSH 的 COLLAPSED_SESSION_LIMIT）。 */
const SESSION_ROW_LIMIT = 5
const TEMPORARY_GROUP_KEY = '__temporary__'
const BACKGROUND_HISTORY_PREFETCH_COUNT = 8
const HOVER_PREFETCH_DELAY_MS = 175

type SessionRef = { id: string; projectPath?: string }
type DragHalf = 'before' | 'after'

type SidebarDrag =
  | { kind: 'session'; id: string; projectKey: string; over: { id: string; half: DragHalf } | null }
  | { kind: 'project'; path: string; over: { id: string; half: DragHalf } | null }

type SidebarContextMenu =
  | (SessionRef & { kind: 'session'; x: number; y: number })
  | { kind: 'project'; projectPath: string; title: string; x: number; y: number }

type SidebarSessionGroup = {
  key: string
  projectPath?: string
  title: string
  path: string | null
  modifiedAt: string | null
  isTemporary: boolean
  sessions: SessionListItem[]
}

type SidebarSessionFilterScope = 'all' | 'project' | 'temporary'

function sessionKey(id: string, projectPath?: string): string {
  return `${id}:${projectPath ?? ''}`
}

function isTemporarySession(session: SessionListItem) {
  return session.isTemporary || (!session.workDir && !session.projectPath)
}

function readCollapsedGroupKeys(): string[] {
  const parsed = readStoredJson<unknown>(COLLAPSED_PROJECTS_KEY, [])
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : []
}

function writeCollapsedGroupKeys(keys: Set<string>) {
  writeStoredJson(COLLAPSED_PROJECTS_KEY, [...keys])
}

export function Sidebar() {
  const sessions = useSessionStore((s) => s.sessions)
  const selectedProjects = useSessionStore((s) => s.selectedProjects)
  const selectedSessionScope = useSessionStore((s) => s.selectedSessionScope)
  const hiddenProjectPaths = useSessionStore((s) => s.hiddenProjectPaths)
  const projectDisplayNames = useSessionStore((s) => s.projectDisplayNames)
  const renameProject = useSessionStore((s) => s.renameProject)
  const hideProject = useSessionStore((s) => s.hideProject)
  const error = useSessionStore((s) => s.error)
  const isLoading = useSessionStore((s) => s.isLoading)
  const fetchSessions = useSessionStore((s) => s.fetchSessions)
  const deleteSession = useSessionStore((s) => s.deleteSession)
  const renameSession = useSessionStore((s) => s.renameSession)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const sidebarWidth = useUIStore((s) => s.sidebarWidth)
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth)
  const sidebarGrouping = useUIStore((s) => s.sidebarGrouping)
  const setSidebarGrouping = useUIStore((s) => s.setSidebarGrouping)
  const sessionOrderBy = useSidebarOrderStore((s) => s.orderBy)
  const setSessionOrderBy = useSidebarOrderStore((s) => s.setOrderBy)
  const sessionOrderMap = useSidebarOrderStore((s) => s.sessionOrder)
  const projectOrderList = useSidebarOrderStore((s) => s.projectOrder)
  const archivedKeys = useSidebarOrderStore((s) => s.archivedKeys)
  const toggleArchived = useSidebarOrderStore((s) => s.toggleArchived)
  const [showArchived, setShowArchived] = useState(false)
  const [listPointerInside, setListPointerInside] = useState(false)
  const archivedKeySet = useMemo(() => new Set(archivedKeys), [archivedKeys])
  const archivedSessions = useMemo(
    () => sessions.filter((session) => archivedKeySet.has(sessionKey(session.id, session.projectPath))),
    [archivedKeySet, sessions],
  )
  const workspaceView = useUIStore((s) => s.workspaceView)
  const openWorkspaceViewAction = useUIStore((s) => s.openWorkspaceView)
  const closeWorkspaceView = useUIStore((s) => s.closeWorkspaceView)
  const settingsOpen = useUIStore((s) => s.settingsOpen)
  const openSettingsAction = useUIStore((s) => s.openSettings)
  const closeSettingsAction = useUIStore((s) => s.closeSettings)
  const openTerminalTab = useTabStore((s) => s.openTerminalTab)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const moreButtonRef = useRef<HTMLButtonElement>(null)

  const activeTabId = useTabStore((s) => s.activeTabId)
  const activeTab = useTabStore((s) => s.tabs.find((tab) => tab.sessionId === s.activeTabId))
  const closeTab = useTabStore((s) => s.closeTab)
  const disconnectSession = useChatStore((s) => s.disconnectSession)
  const prefetchHistory = useChatStore((s) => s.prefetchHistory)
  const t = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')
  const [hostSearchResults, setHostSearchResults] = useState<SessionSearchHit[] | null>(null)
  const [pendingSessionKey, setPendingSessionKey] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<SidebarContextMenu | null>(null)
  const [pendingDeleteSession, setPendingDeleteSession] = useState<SessionRef | null>(null)
  const [newSessionMenuOpen, setNewSessionMenuOpen] = useState(false)
  const [newProjectDialogOpen, setNewProjectDialogOpen] = useState(false)
  const [renamingSession, setRenamingSession] = useState<SessionRef | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renamingProjectPath, setRenamingProjectPath] = useState<string | null>(null)
  const [projectRenameValue, setProjectRenameValue] = useState('')
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<Set<string>>(
    () => new Set(readCollapsedGroupKeys()),
  )
  const renameInputRef = useRef<HTMLInputElement>(null)
  const projectRenameInputRef = useRef<HTMLInputElement>(null)
  const newSessionButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => { fetchSessions() }, [fetchSessions])

  useEffect(() => {
    if (sessions.length === 0) return
    let cancelled = false
    const queue = sessions.slice(0, BACKGROUND_HISTORY_PREFETCH_COUNT)
    let cursor = 0
    const timer = window.setTimeout(() => {
      const worker = async () => {
        while (!cancelled) {
          const session = queue[cursor]
          cursor += 1
          if (!session) return
          await prefetchHistory(session.id, session.projectPath)
        }
      }
      void Promise.all([worker(), worker()])
    }, 300)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [prefetchHistory, sessions])

  useEffect(() => {
    const activeKey = activeTab ? sessionKey(activeTab.sessionId, activeTab.projectPath) : activeTabId
    if (pendingSessionKey && pendingSessionKey === activeKey) setPendingSessionKey(null)
  }, [activeTab, activeTabId, pendingSessionKey])

  useEffect(() => {
    if (!contextMenu || sidebarOpen) return
    setContextMenu(null)
  }, [contextMenu, sidebarOpen])

  useEffect(() => {
    if (!settingsOpen) return
    setContextMenu(null)
    setNewSessionMenuOpen(false)
  }, [settingsOpen])

  // Host 端内容搜索：输入防抖 250ms 后请求 /api/search/sessions。
  useEffect(() => {
    const query = searchQuery.trim()
    if (!query) {
      setHostSearchResults(null)
      return
    }
    const timer = window.setTimeout(() => {
      const cancelled = false
      void sessionsApi.search(query)
        .then((response) => {
          if (cancelled) return
          setHostSearchResults(response.results)
        })
        .catch(() => {
          if (cancelled) return
          setHostSearchResults([])
        })
      return
    }, 250)
    return () => {
      window.clearTimeout(timer)
    }
  }, [searchQuery])

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)

    const closeOnEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setContextMenu(null)
      }
    }
    document.addEventListener('click', close)
    document.addEventListener('keydown', closeOnEsc)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('keydown', closeOnEsc)
    }
  }, [contextMenu])

  const groupedSessions = useMemo(
    () => buildSidebarSessionGroups({
      sessions,
      sessionFilterScope: selectedSessionScope,
      selectedProjectPaths: selectedProjects,
      hiddenProjectPaths,
      projectDisplayNames,
      searchQuery,
      fallbackProjectTitle: t('sidebar.other'),
      temporaryTitle: t('sidebar.temporarySessions'),
      getDisplayTitle: (session) => getSessionDisplayTitle(session, t),
      grouping: sidebarGrouping,
      orderBy: sessionOrderBy,
      sessionOrder: sessionOrderMap,
      projectOrder: projectOrderList,
      archivedKeys,
      timeGroupLabels: {
        today: t('sidebar.timeGroup.today'),
        yesterday: t('sidebar.timeGroup.yesterday'),
        last7days: t('sidebar.timeGroup.last7days'),
        last30days: t('sidebar.timeGroup.last30days'),
        older: t('sidebar.timeGroup.older'),
      },
    }),
    [hiddenProjectPaths, projectDisplayNames, searchQuery, selectedProjects, selectedSessionScope, sessions, sidebarGrouping, sessionOrderBy, sessionOrderMap, projectOrderList, t],
  )

  const visibleSessionCount = useMemo(
    () =>
      groupedSessions.flatSessions?.length ??
      groupedSessions.projectGroups.reduce((count, group) => count + group.sessions.length, 0) +
        (groupedSessions.temporaryGroup?.sessions.length ?? 0),
    [groupedSessions],
  )

  const currentProject = useMemo(() => {
    const resolved = resolveCurrentProject(selectedProjects, sessions)
      ?? (activeTab?.projectPath ? resolveCurrentProject([activeTab.projectPath], sessions) : undefined)
    if (!resolved) return undefined
    return {
      ...resolved,
      title: projectDisplayNames[resolved.projectPath] || resolved.title,
    }
  }, [activeTab?.projectPath, projectDisplayNames, selectedProjects, sessions])

  const activeKey = activeTab ? sessionKey(activeTab.sessionId, activeTab.projectPath) : activeTabId

  const handleSessionContextMenu = useCallback((e: React.MouseEvent, session: SessionRef) => {
    e.preventDefault()
    setNewSessionMenuOpen(false)
    setContextMenu({ kind: 'session', ...session, x: e.clientX, y: e.clientY })
  }, [])

  const [drag, setDrag] = useState<SidebarDrag | null>(null)
  const moveSession = useSidebarOrderStore((s) => s.moveSession)
  const moveProject = useSidebarOrderStore((s) => s.moveProject)

  const handleSessionDragStart = useCallback((e: React.DragEvent, session: SessionRef, projectKey: string) => {
    if (sessionOrderBy !== 'manual') return
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', session.id)
    setDrag({ kind: 'session', id: session.id, projectKey, over: null })
  }, [sessionOrderBy])

  const handleSessionDragOver = useCallback((e: React.DragEvent, session: SessionRef, projectKey: string) => {
    if (drag === null || drag.kind !== 'session' || drag.projectKey !== projectKey || drag.id === session.id) return
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const half: DragHalf = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    setDrag((current) => current !== null && current.kind === 'session' && current.over?.id === session.id && current.over.half === half
      ? current
      : current !== null && current.kind === 'session'
        ? { ...current, over: { id: session.id, half } }
        : current)
  }, [drag])

  const handleSessionDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (drag !== null && drag.kind === 'session' && drag.over !== null) {
      // after 表示插到 over 会话之后：锚点为该会话的下一个（或组尾 null）。
      const group = groupedSessions.projectGroups.find((candidate) => candidate.key === drag.projectKey)
      const overId = drag.over.id
      const anchor = drag.over.half === 'before'
        ? overId
        : (() => {
          if (group === undefined) return null
          const index = group.sessions.findIndex((session) => session.id === overId)
          return index === -1 || index + 1 >= group.sessions.length
            ? null
            : group.sessions[index + 1]!.id
        })()
      moveSession(drag.projectKey, drag.id, anchor)
    }
    setDrag(null)
  }, [drag, groupedSessions.projectGroups, moveSession])

  const handleProjectDragStart = useCallback((e: React.DragEvent, group: SidebarSessionGroup) => {
    if (sessionOrderBy !== 'manual' || !group.projectPath) return
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', group.projectPath)
    setDrag({ kind: 'project', path: group.projectPath, over: null })
  }, [sessionOrderBy])

  const handleProjectDragOver = useCallback((e: React.DragEvent, group: SidebarSessionGroup) => {
    if (drag === null || drag.kind !== 'project' || drag.path === group.projectPath || !group.projectPath) return
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const half: DragHalf = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    setDrag((current) => current !== null && current.kind === 'project' && current.over?.id === group.projectPath && current.over.half === half
      ? current
      : current !== null && current.kind === 'project'
        ? { ...current, over: { id: group.projectPath, half } }
        : current)
  }, [drag])

  const handleProjectDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (drag !== null && drag.kind === 'project' && drag.over !== null) {
      const overId = drag.over.id
      const anchor = drag.over.half === 'before'
        ? overId
        : (() => {
          const index = groupedSessions.projectGroups.findIndex((group) => group.projectPath === overId)
          return index === -1 || index + 1 >= groupedSessions.projectGroups.length
            ? null
            : groupedSessions.projectGroups[index + 1]!.projectPath
        })()
      if (anchor !== null) moveProject(drag.path, anchor)
    }
    setDrag(null)
  }, [drag, groupedSessions.projectGroups, moveProject])

  const handleDragEnd = useCallback(() => { setDrag(null) }, [])

  const handleProjectContextMenu = useCallback((e: React.MouseEvent, group: SidebarSessionGroup) => {
    if (!group.projectPath) return
    e.preventDefault()
    setNewSessionMenuOpen(false)
    setContextMenu({
      kind: 'project',
      projectPath: group.projectPath,
      title: group.title,
      x: e.clientX,
      y: e.clientY,
    })
  }, [])

  const handleDelete = useCallback((session: SessionRef) => {
    setContextMenu(null)
    setNewSessionMenuOpen(false)
    setPendingDeleteSession(session)
  }, [])

  const confirmDelete = useCallback(async () => {
    if (!pendingDeleteSession) return
    await deleteSession(pendingDeleteSession.id, pendingDeleteSession.projectPath)
    disconnectSession(pendingDeleteSession.id)
    closeTab(pendingDeleteSession.id, pendingDeleteSession.projectPath)
    setPendingDeleteSession(null)
  }, [closeTab, deleteSession, disconnectSession, pendingDeleteSession])

  const handleStartRename = useCallback((session: SessionRef, currentTitle: string) => {
    setContextMenu(null)
    setNewSessionMenuOpen(false)
    setRenamingSession(session)
    setRenameValue(currentTitle)
  }, [])

  const handleCancelRename = useCallback(() => {
    setRenamingSession(null)
    setRenameValue('')
  }, [])

  useEffect(() => {
    if (renamingSession) renameInputRef.current?.focus()
  }, [renamingSession])

  const handleFinishRename = useCallback(async () => {
    if (renamingSession && renameValue.trim()) {
      const nextTitle = renameValue.trim()
      await renameSession(renamingSession.id, nextTitle, renamingSession.projectPath)
      useTabStore.getState().updateTabTitle(
        renamingSession.id,
        nextTitle,
        renamingSession.projectPath,
      )
    }
    setRenamingSession(null)
    setRenameValue('')
  }, [renamingSession, renameValue, renameSession])

  const handleStartProjectRename = useCallback((projectPath: string, currentTitle: string) => {
    setContextMenu(null)
    setNewSessionMenuOpen(false)
    setRenamingProjectPath(projectPath)
    setProjectRenameValue(currentTitle)
  }, [])

  useEffect(() => {
    if (renamingProjectPath) projectRenameInputRef.current?.focus()
  }, [renamingProjectPath])

  const handleFinishProjectRename = useCallback(() => {
    if (renamingProjectPath && projectRenameValue.trim()) {
      renameProject(renamingProjectPath, projectRenameValue)
    }
    setRenamingProjectPath(null)
    setProjectRenameValue('')
  }, [projectRenameValue, renameProject, renamingProjectPath])

  const handleCancelProjectRename = useCallback(() => {
    setRenamingProjectPath(null)
    setProjectRenameValue('')
  }, [])

  const toggleGroup = useCallback((groupKey: string) => {
    setCollapsedGroupKeys((current) => {
      const next = new Set(current)
      if (next.has(groupKey)) {
        next.delete(groupKey)
      } else {
        next.add(groupKey)
      }
      writeCollapsedGroupKeys(next)
      return next
    })
  }, [])

  const removeProjectFromSidebar = useCallback((projectPath: string) => {
    hideProject(projectPath)
    setContextMenu(null)
    setCollapsedGroupKeys((current) => {
      if (!current.has(projectPath)) return current
      const next = new Set(current)
      next.delete(projectPath)
      writeCollapsedGroupKeys(next)
      return next
    })
  }, [hideProject])

  const startDraggingRef = useRef<(() => Promise<void>) | null>(null)

  useEffect(() => {
    if (!isTauri) return
    import(/* @vite-ignore */ '@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => {
        const win = getCurrentWindow()
        startDraggingRef.current = () => win.startDragging()
      })
      .catch(() => {})
  }, [])

  const handleSidebarDrag = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, textarea, select, a, [role="button"]')) return
    startDraggingRef.current?.()
  }, [])

  const createAndOpenSession = useCreateAndOpenSession()

  const handleNewSession = useCallback(() => {
    setContextMenu(null)
    setNewSessionMenuOpen((open) => !open)
  }, [])

  const openSession = useCallback((session: SessionListItem, displayTitle: string) => {
    const currentKey = sessionKey(session.id, session.projectPath)
    setNewSessionMenuOpen(false)
    setPendingSessionKey(currentKey)
    useTabStore.getState().switchToSession(session.id, displayTitle, session.projectPath)
    void useChatStore.getState().ensureSessionReady(session.id, session.projectPath)
  }, [])

  const openSearchHit = useCallback((hit: SessionSearchHit) => {
    const full = sessions.find((session) => session.id === hit.sessionId
      && (!hit.projectPath || session.projectPath === hit.projectPath))
    const item: SessionListItem = full ?? {
      id: hit.sessionId,
      title: hit.title,
      lastMessage: hit.snippet,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      messageCount: 0,
      projectPath: hit.projectPath,
      workDir: hit.workDir,
      workDirExists: true,
      isTemporary: false,
    }
    openSession(item, hit.title)
  }, [openSession, sessions])

  const widthDragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const startWidthDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    widthDragRef.current = { startX: e.clientX, startWidth: sidebarWidth }
    const onMove = (event: MouseEvent) => {
      const drag = widthDragRef.current
      if (!drag) return
      setSidebarWidth(drag.startWidth + (event.clientX - drag.startX))
    }
    const onUp = () => {
      widthDragRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [setSidebarWidth, sidebarWidth])

  const handleToggleSettings = useCallback(() => {
    if (settingsOpen) {
      closeSettingsAction()
    } else {
      openSettingsAction('settings')
    }
  }, [settingsOpen, openSettingsAction, closeSettingsAction])

  const openWorkspace = useCallback((view: WorkspaceView) => {
    setMoreMenuOpen(false)
    openWorkspaceViewAction(view)
  }, [openWorkspaceViewAction])

  return (
    <aside
      onMouseDown={handleSidebarDrag}
      className={`sidebar-panel native-ui-text relative flex h-full w-full select-none flex-col bg-[var(--color-surface-sidebar)] text-[var(--color-text-primary)] ${sidebarOpen ? '' : 'pointer-events-none'}`}
      data-state={sidebarOpen ? 'open' : 'closed'}
      aria-label="Sidebar"
      aria-hidden={sidebarOpen ? undefined : true}
    >
      {sidebarOpen && (
        <div
          aria-hidden="true"
          onMouseDown={startWidthDrag}
          className="absolute right-0 top-0 z-[5] h-full w-[5px] cursor-col-resize touch-none hover:bg-[var(--color-border-focus)]/40"
        />
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* ── 搜索 + 新建会话 ─────────────────────────────── */}
        <div className="shrink-0 px-[12px] pt-[12px]">
          <div className="relative">
            <Icon name="search" size={15} className="absolute left-[10px] top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
            <input
              id="sidebar-search"
              type="text"
              placeholder={t('sidebar.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="sidebar-search-field h-[30px] w-full rounded-[8px] border border-transparent bg-[var(--color-surface-search-bg)] pl-[32px] pr-[76px] text-[13px] text-[var(--color-text-primary)] outline-none transition-colors placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)] focus:bg-[var(--color-surface-container-lowest)]"
            />
            <div className="absolute right-[40px] top-1/2 -translate-y-1/2">
              <ProjectFilter variant="embedded" />
            </div>
            <button
              ref={newSessionButtonRef}
              id="sidebar-new-session"
              type="button"
              onClick={handleNewSession}
              title={t('sidebar.newSessionTitle')}
              aria-label={t('sidebar.newSession')}
              aria-haspopup="menu"
              aria-expanded={newSessionMenuOpen}
              className="absolute right-[4px] top-1/2 flex h-[24px] w-[24px] -translate-y-1/2 items-center justify-center rounded-[6px] bg-[var(--color-inverse-surface)] text-[var(--color-inverse-on-surface)] transition-all duration-100 hover:opacity-90 active:scale-[0.92]"
            >
              <Icon name="add" size={14} />
            </button>
          </div>
        </div>

        {/* ── 导航区（Finder 式 source list）───────────────── */}
        <nav aria-label={t('sidebar.section.workspaces')} className="shrink-0 px-[8px] pb-[6px] pt-[10px]">
          <SidebarSectionLabel>{t('sidebar.section.workspaces')}</SidebarSectionLabel>
          <SidebarNavRow
            icon="chat"
            label={t('sidebar.sessionsHome')}
            active={workspaceView === null}
            onClick={closeWorkspaceView}
          />
          <SidebarNavRow
            icon="notes"
            label={t('sidebar.notes')}
            active={workspaceView === 'notes'}
            onClick={() => openWorkspace('notes')}
          />
          <SidebarNavRow
            icon="folder"
            label={t('files.title')}
            active={workspaceView === 'files'}
            onClick={() => openWorkspace('files')}
          />
          <SidebarNavRow
            icon="schedule"
            label={t('sidebar.scheduled')}
            active={workspaceView === 'scheduled'}
            onClick={() => openWorkspace('scheduled')}
          />
          <SidebarNavRow
            icon="package"
            label={t('sandbox.title')}
            active={workspaceView === 'sandbox'}
            onClick={() => openWorkspace('sandbox')}
          />
          <SidebarNavRow
            icon="folder_open"
            label={t('sidebar.repository')}
            active={workspaceView === 'repository'}
            onClick={() => openWorkspace('repository')}
          />
          <SidebarNavRow
            icon="smart_toy"
            label={t('sidebar.agentConfiguration')}
            active={workspaceView === 'agents'}
            onClick={() => openWorkspace('agents')}
          />
          <SidebarMoreMenu
            open={moreMenuOpen}
            anchorRef={moreButtonRef}
            workspaceView={workspaceView}
            onToggle={() => setMoreMenuOpen((open) => !open)}
            onOpenWorkspace={openWorkspace}
            onOpenTerminal={() => {
              setMoreMenuOpen(false)
              openTerminalTab()
            }}
          />
        </nav>

        {/* ── 会话列表区 ──────────────────────────────────── */}
        <div data-testid="sidebar-session-list-section" className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between pl-[14px] pr-[10px] pt-[2px]">
            <SidebarSectionLabel>{showArchived ? t('sidebar.archived') : t('sidebar.section.sessions')}</SidebarSectionLabel>
            <div className="flex items-center gap-[4px]">
              <button
                type="button"
                aria-pressed={showArchived}
                title={showArchived ? t('sidebar.backToSessions') : t('sidebar.archived')}
                onClick={() => setShowArchived((value) => !value)}
                className={`flex h-[22px] items-center gap-[3px] rounded-[6px] px-[5px] text-[11px] font-semibold text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)] ${showArchived ? 'bg-[var(--color-surface-container-low)]' : ''}`}
              >
                <Icon name="archive" size={12} />
                {archivedKeys.length > 0 && <span className="tabular-nums">{archivedKeys.length}</span>}
              </button>
              <SidebarGroupingMenu
              grouping={sidebarGrouping}
              onSelect={setSidebarGrouping}
              orderBy={sessionOrderBy}
              onOrderBySelect={setSessionOrderBy}
            />
            </div>
          </div>

          <div
            className="sidebar-scroll-area min-h-0 flex-1"
            style={{ ['--sidebar-thumb-alpha' as never]: listPointerInside ? 1 : 0 }}
            onPointerEnter={() => setListPointerInside(true)}
            onPointerLeave={() => setListPointerInside(false)}
          >
            <div className="flex flex-col gap-[8px] px-[8px] pb-[16px] pt-[6px]">
              {error && (
                <div className="rounded-[10px] border border-[var(--color-error)]/20 bg-[var(--color-error)]/5 px-[12px] py-[10px]">
                  <div className="text-[11px] font-medium text-[var(--color-error)]">{t('sidebar.sessionListFailed')}</div>
                  <div className="mt-1 break-words text-[10px] text-[var(--color-text-tertiary)]">{error}</div>
                  <button onClick={() => fetchSessions()} className="mt-2 text-[10px] font-bold uppercase text-[var(--color-brand)] hover:underline">{t('common.retry')}</button>
                </div>
              )}

              {showArchived && (
                <div className="flex flex-col gap-[2px]">
                  {archivedSessions.length === 0 ? (
                    <div className="py-6 text-center text-[11px] text-[var(--color-text-tertiary)]">
                      {t('sidebar.noArchived')}
                    </div>
                  ) : (
                    archivedSessions.map((session) => {
                      const currentKey = sessionKey(session.id, session.projectPath)
                      return (
                        <SidebarSessionRow
                          key={currentKey}
                          session={session}
                          isActive={currentKey === (pendingSessionKey ?? activeKey)}
                          isRenaming={false}
                          renameValue=""
                          renameInputRef={renameInputRef}
                          onOpen={openSession}
                          onContextMenu={handleSessionContextMenu}
                          onDelete={handleDelete}
                          onStartRename={handleStartRename}
                          onRenameChange={setRenameValue}
                          onFinishRename={handleFinishRename}
                          onCancelRename={handleCancelRename}
                          drag={null}
                          projectKey="__archived__"
                          onDragStart={handleSessionDragStart}
                          onDragOver={handleSessionDragOver}
                          onDrop={handleSessionDrop}
                          onDragEnd={handleDragEnd}
                        />
                      )
                    })
                  )}
                </div>
              )}

              {!showArchived && hostSearchResults !== null && (
                <div className="flex flex-col gap-[2px]">
                  {hostSearchResults.length === 0 ? (
                    <div className="py-6 text-center text-[11px] text-[var(--color-text-tertiary)]">
                      {t('sidebar.noSearchResults')}
                    </div>
                  ) : (
                    hostSearchResults.map((hit) => (
                      <SidebarSearchResult
                        key={hit.sessionId + ':' + hit.projectPath}
                        hit={hit}
                        onOpen={() => openSearchHit(hit)}
                      />
                    ))
                  )}
                </div>
              )}

              {!showArchived && hostSearchResults === null && visibleSessionCount === 0 && (
                isLoading && sessions.length === 0 && !error ? (
                  <SessionListSkeleton />
                ) : (
                  <div className="py-6 text-center text-[11px] text-[var(--color-text-tertiary)]">
                    {searchQuery ? t('sidebar.noMatching') : t('sidebar.noSessions')}
                  </div>
                )
              )}

              {!showArchived && hostSearchResults === null && groupedSessions.flatSessions && (
                <div className="flex flex-col gap-[2px]">
                  {groupedSessions.flatSessions.map((session) => {
                    const currentKey = sessionKey(session.id, session.projectPath)
                    return (
                      <SidebarSessionRow
                        key={currentKey}
                        session={session}
                        isActive={currentKey === (pendingSessionKey ?? activeKey)}
                        isRenaming={renamingSession?.id === session.id && renamingSession.projectPath === session.projectPath}
                        renameValue={renamingSession?.id === session.id ? renameValue : ''}
                        renameInputRef={renameInputRef}
                        onOpen={openSession}
                        onContextMenu={handleSessionContextMenu}
                        onDelete={handleDelete}
                        onStartRename={handleStartRename}
                        onRenameChange={setRenameValue}
                        onFinishRename={handleFinishRename}
                        onCancelRename={handleCancelRename}
                        drag={drag}
                        projectKey="__flat__"
                        onDragStart={handleSessionDragStart}
                        onDragOver={handleSessionDragOver}
                        onDrop={handleSessionDrop}
                        onDragEnd={handleDragEnd}
                      />
                    )
                  })}
                </div>
              )}

              {!showArchived && hostSearchResults === null && !groupedSessions.flatSessions && groupedSessions.projectGroups.map((group) => (
                <SessionProjectGroup
                  key={group.key}
                  group={group}
                  expanded={searchQuery.trim().length > 0 || !collapsedGroupKeys.has(group.key)}
                  activeKey={pendingSessionKey ?? activeKey}
                  renamingSession={renamingSession}
                  renameValue={renameValue}
                  renameInputRef={renameInputRef}
                  renamingProjectPath={renamingProjectPath}
                  projectRenameValue={projectRenameValue}
                  projectRenameInputRef={projectRenameInputRef}
                  onToggleGroup={toggleGroup}
                  onOpenSession={openSession}
                  onSessionContextMenu={handleSessionContextMenu}
                  onProjectContextMenu={handleProjectContextMenu}
                  onDelete={handleDelete}
                  onStartSessionRename={handleStartRename}
                  onStartProjectRename={handleStartProjectRename}
                  onRenameChange={setRenameValue}
                  onFinishRename={handleFinishRename}
                  onCancelRename={handleCancelRename}
                  onProjectRenameChange={setProjectRenameValue}
                  onFinishProjectRename={handleFinishProjectRename}
                  onCancelProjectRename={handleCancelProjectRename}
                  drag={drag}
                  onSessionDragStart={handleSessionDragStart}
                  onSessionDragOver={handleSessionDragOver}
                  onSessionDrop={handleSessionDrop}
                  onProjectDragStart={handleProjectDragStart}
                  onProjectDragOver={handleProjectDragOver}
                  onProjectDrop={handleProjectDrop}
                  onDragEnd={handleDragEnd}
                />
              ))}

              {!showArchived && hostSearchResults === null && groupedSessions.temporaryGroup && (
                <SessionProjectGroup
                  group={groupedSessions.temporaryGroup}
                  expanded={searchQuery.trim().length > 0 || !collapsedGroupKeys.has(TEMPORARY_GROUP_KEY)}
                  activeKey={pendingSessionKey ?? activeKey}
                  renamingSession={renamingSession}
                  renameValue={renameValue}
                  renameInputRef={renameInputRef}
                  renamingProjectPath={renamingProjectPath}
                  projectRenameValue={projectRenameValue}
                  projectRenameInputRef={projectRenameInputRef}
                  onToggleGroup={toggleGroup}
                  onOpenSession={openSession}
                  onSessionContextMenu={handleSessionContextMenu}
                  onDelete={handleDelete}
                  onStartSessionRename={handleStartRename}
                  onStartProjectRename={handleStartProjectRename}
                  onRenameChange={setRenameValue}
                  onFinishRename={handleFinishRename}
                  onCancelRename={handleCancelRename}
                  onProjectRenameChange={setProjectRenameValue}
                  onFinishProjectRename={handleFinishProjectRename}
                  onCancelProjectRename={handleCancelProjectRename}
                  drag={drag}
                  onSessionDragStart={handleSessionDragStart}
                  onSessionDragOver={handleSessionDragOver}
                  onSessionDrop={handleSessionDrop}
                  onProjectDragStart={handleProjectDragStart}
                  onProjectDragOver={handleProjectDragOver}
                  onProjectDrop={handleProjectDrop}
                  onDragEnd={handleDragEnd}
                />
              )}
            </div>
          </div>
        </div>

        {/* ── 底部：设置 ─────────────────────────────────── */}
        <div className="shrink-0 border-t border-[var(--color-border-separator)] px-[8px] pb-[8px] pt-[6px]">
          <SidebarNavRow
            icon="settings"
            label={t('sidebar.settings')}
            active={settingsOpen}
            onClick={handleToggleSettings}
          />
        </div>
      </div>

      {contextMenu?.kind === 'session' && (
        <ContextMenuShell x={contextMenu.x} y={contextMenu.y} minWidth={136} label={t('sidebar.sessionScope')}>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const session = sessions.find((s) => s.id === contextMenu.id && s.projectPath === contextMenu.projectPath)
              handleStartRename(contextMenu, session ? getSessionDisplayTitle(session, t) : '')
            }}
            className="flex h-[32px] w-full items-center gap-2 rounded-[6px] px-2.5 text-left text-[12px] font-medium text-[var(--color-text-primary)] transition-colors duration-100 hover:bg-[var(--color-surface-hover)]"
          >
            <Icon name="edit" size={13} className="text-[var(--color-text-tertiary)]" />
            <span>{t('common.rename')}</span>
          </button>
          <div aria-hidden="true" className="mx-2 my-1 h-px bg-[var(--color-border-separator)]" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              toggleArchived(sessionKey(contextMenu.id, contextMenu.projectPath))
              setContextMenu(null)
            }}
            className="flex h-[32px] w-full items-center gap-2 rounded-[6px] px-2.5 text-left text-[12px] font-medium text-[var(--color-text-primary)] transition-colors duration-100 hover:bg-[var(--color-surface-hover)]"
          >
            <Icon name="archive" size={13} className="text-[var(--color-text-tertiary)]" />
            <span>{archivedKeySet.has(sessionKey(contextMenu.id, contextMenu.projectPath)) ? t('sidebar.unarchive') : t('sidebar.archive')}</span>
          </button>
          <div aria-hidden="true" className="mx-2 my-1 h-px bg-[var(--color-border-separator)]" />
          <button
            type="button"
            role="menuitem"
            onClick={() => handleDelete(contextMenu)}
            className="flex h-[32px] w-full items-center gap-2 rounded-[6px] px-2.5 text-left text-[12px] font-medium text-[var(--color-error)] transition-colors duration-100 hover:bg-[var(--color-error)]/10"
          >
            <Icon name="remove" size={13} />
            <span>{t('common.delete')}</span>
          </button>
        </ContextMenuShell>
      )}

      {contextMenu?.kind === 'project' && (
        <ContextMenuShell x={contextMenu.x} y={contextMenu.y} minWidth={184} label={contextMenu.title}>
          <button
            type="button"
            role="menuitem"
            onClick={() => handleStartProjectRename(contextMenu.projectPath, contextMenu.title)}
            className="flex h-[32px] w-full items-center gap-2 rounded-[6px] px-2.5 text-left text-[12px] font-medium text-[var(--color-text-primary)] transition-colors duration-100 hover:bg-[var(--color-surface-hover)]"
          >
            <Icon name="edit" size={13} className="text-[var(--color-text-tertiary)]" />
            <span>{t('common.rename')}</span>
          </button>
          <div aria-hidden="true" className="mx-2 my-1 h-px bg-[var(--color-border-separator)]" />
          <button
            type="button"
            role="menuitem"
            onClick={() => removeProjectFromSidebar(contextMenu.projectPath)}
            className="flex h-[32px] w-full items-center gap-2 rounded-[6px] px-2.5 text-left text-[12px] font-medium text-[var(--color-error)] transition-colors duration-100 hover:bg-[var(--color-error)]/10"
          >
            <Icon name="remove" size={13} />
            <span>{t('sidebar.removeProject')}</span>
          </button>
        </ContextMenuShell>
      )}

      <ConfirmDialog
        open={pendingDeleteSession !== null}
        onClose={() => setPendingDeleteSession(null)}
        onConfirm={confirmDelete}
        title={t('common.delete')}
        body={pendingDeleteSession ? t('sidebar.confirmDelete') : ''}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        confirmVariant="danger"
      />

      <NewSessionMenu
        open={newSessionMenuOpen}
        anchorRef={newSessionButtonRef}
        currentProject={currentProject}
        onClose={() => setNewSessionMenuOpen(false)}
        onCreate={createAndOpenSession}
        onCreateProject={() => {
          setNewSessionMenuOpen(false)
          setNewProjectDialogOpen(true)
        }}
      />

      <NewProjectDialog
        open={newProjectDialogOpen}
        onClose={() => setNewProjectDialogOpen(false)}
        onCreate={createAndOpenSession}
      />
    </aside>
  )
}

function ContextMenuShell({
  x,
  y,
  minWidth,
  label,
  children,
}: {
  x: number
  y: number
  minWidth: number
  label: string
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const menu = ref.current
    if (!menu) return
    const rect = menu.getBoundingClientRect()
    setPosition({
      left: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
    })
  }, [x, y])

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className="fixed z-50 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-background)] p-[4px] shadow-[var(--shadow-dropdown)]"
      style={{ left: position.left, top: position.top, minWidth }}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  )
}

/** Finder 式侧栏分组小标题 */
function SidebarSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-[8px] pb-[4px] pt-[6px] text-[11px] font-semibold tracking-[0.01em] text-[var(--color-text-tertiary)]">
      {children}
    </div>
  )
}

/** Finder 式导航行：图标 + 标签，激活时用 accent 填充 */
function SidebarNavRow({
  icon,
  label,
  active,
  onClick,
}: {
  icon: IconName
  label: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={`flex h-[30px] w-full items-center gap-[9px] rounded-[7px] px-[8px] text-left text-[13px] transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] ${
        active
          ? 'bg-[var(--color-surface-selected)] font-semibold text-[var(--color-text-primary)]'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      <Icon name={icon} size={16} className={`shrink-0 ${active ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)]'}`} />
      <span className="truncate">{label}</span>
    </button>
  )
}

/** 会话分组模式菜单（项目 / 时间 / 扁平），复用更多菜单的浮层交互。 */
function SidebarGroupingMenu({
  grouping,
  onSelect,
  orderBy,
  onOrderBySelect,
}: {
  grouping: SidebarGrouping
  onSelect: (grouping: SidebarGrouping) => void
  orderBy: SidebarOrderBy
  onOrderBySelect: (orderBy: SidebarOrderBy) => void
}) {
  const t = useTranslation()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement
      if (anchorRef.current?.contains(target)) return
      if (target.closest('[data-sidebar-grouping-menu="true"]')) return
      setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])


  const items: Array<{ key: SidebarGrouping; label: string }> = [
    { key: 'project', label: t('sidebar.groupingProject') },
    { key: 'time', label: t('sidebar.groupingTime') },
    { key: 'flat', label: t('sidebar.groupingFlat') },
  ]
  const orderItems: Array<{ key: SidebarOrderBy; label: string }> = [
    { key: 'updated', label: t('sidebar.orderByUpdated') },
    { key: 'manual', label: t('sidebar.orderByManual') },
  ]

  const currentLabel = items.find((item) => item.key === grouping)?.label ?? items[0]!.label

  return (
    <div className="relative">
      <button
        ref={anchorRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('sidebar.groupingLabel')}
        onClick={() => setOpen((value) => !value)}
        className="flex h-[22px] items-center gap-[4px] rounded-[6px] px-[6px] text-[11px] font-semibold text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]"
      >
        <Icon name="view_sidebar" size={12} />
        <span className="max-w-[56px] truncate">{currentLabel}</span>
        <Icon name="chevron_down" size={11} />
      </button>
      {open && (
        <div
          data-sidebar-grouping-menu="true"
          role="menu"
          aria-label={t('sidebar.groupingLabel')}
          className="absolute right-0 top-full z-[60] mt-[4px] w-[156px] rounded-[10px] border border-[var(--color-border)] bg-[var(--color-background)] p-[4px] shadow-[var(--shadow-dropdown)]"
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              aria-pressed={item.key === grouping}
              onClick={() => {
                onSelect(item.key)
                setOpen(false)
              }}
              className={`flex h-[30px] w-full items-center gap-[8px] rounded-[7px] px-[10px] text-left text-[12px] transition-colors duration-100 ${
                item.key === grouping
                  ? 'bg-[var(--color-surface-selected)] font-medium text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.key === grouping && <Icon name="check" size={13} />}
            </button>
          ))}
          <div aria-hidden="true" className="mx-2 my-1 h-px bg-[var(--color-border-separator)]" />
          <div className="px-[10px] pb-[2px] pt-[2px] text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
            {t('sidebar.orderByLabel')}
          </div>
          {orderItems.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              aria-pressed={item.key === orderBy}
              onClick={() => {
                onOrderBySelect(item.key)
                setOpen(false)
              }}
              className={`flex h-[30px] w-full items-center gap-[8px] rounded-[7px] px-[10px] text-left text-[12px] transition-colors duration-100 ${
                item.key === orderBy
                  ? 'bg-[var(--color-surface-selected)] font-medium text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.key === orderBy && <Icon name="check" size={13} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** 侧栏"更多工作区"溢出菜单（终端 / 知识空间 / Atlas / 查询 / 标签） */
function SidebarMoreMenu({
  open,
  anchorRef,
  workspaceView,
  onToggle,
  onOpenWorkspace,
  onOpenTerminal,
}: {
  open: boolean
  anchorRef: { current: HTMLButtonElement | null }
  workspaceView: WorkspaceView | null
  onToggle: () => void
  onOpenWorkspace: (view: WorkspaceView) => void
  onOpenTerminal: () => void
}) {
  const t = useTranslation()

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement
      if (anchorRef.current?.contains(target)) return
      if (target.closest('[data-sidebar-more-menu="true"]')) return
      onToggle()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onToggle()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, anchorRef, onToggle])

  const items: Array<{ key: string; label: string; icon: IconName; active: boolean; onClick: () => void }> = [
    { key: 'terminal', label: t('sidebar.terminal'), icon: 'terminal', active: false, onClick: onOpenTerminal },
    { key: 'codeGraph', label: t('knowledgeSpace.title'), icon: 'account_tree', active: workspaceView === 'codeGraph', onClick: () => onOpenWorkspace('codeGraph') },
    { key: 'atlas', label: t('atlas.title'), icon: 'hub', active: workspaceView === 'atlas', onClick: () => onOpenWorkspace('atlas') },
    { key: 'queries', label: t('queries.title'), icon: 'filter_list', active: workspaceView === 'queries', onClick: () => onOpenWorkspace('queries') },
    { key: 'tags', label: t('tags.title'), icon: 'tag', active: workspaceView === 'tags', onClick: () => onOpenWorkspace('tags') },
  ]

  return (
    <div className="relative">
      <button
        ref={(node) => { anchorRef.current = node }}
        type="button"
        onClick={onToggle}
        aria-haspopup="menu"
        aria-expanded={open}
        data-active={items.some((item) => item.active) ? 'true' : 'false'}
        className={`flex h-[30px] w-full items-center gap-[9px] rounded-[7px] px-[8px] text-left text-[13px] transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] ${
          items.some((item) => item.active)
            ? 'bg-[var(--color-surface-selected)] font-semibold text-[var(--color-text-primary)]'
            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
        }`}
      >
        <Icon name="more_horiz" size={16} className="shrink-0 text-[var(--color-text-tertiary)]" />
        <span className="truncate">{t('sidebar.more')}</span>
      </button>

      {open && (
        <div
          data-sidebar-more-menu="true"
          role="menu"
          aria-label={t('sidebar.more')}
          className="absolute left-0 top-full z-[60] mt-[2px] w-[176px] rounded-[10px] border border-[var(--color-border)] bg-[var(--color-background)] p-[4px] shadow-[var(--shadow-dropdown)]"
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              onClick={item.onClick}
              className={`flex h-[32px] w-full items-center gap-[10px] rounded-[7px] px-[10px] text-left text-[13px] transition-colors duration-100 ${
                item.active
                  ? 'bg-[var(--color-surface-selected)] font-medium text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              <Icon name={item.icon} size={15} className="shrink-0 text-[var(--color-text-tertiary)]" />
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const SessionProjectGroup = memo(function SessionProjectGroup({
  group,
  expanded,
  activeKey,
  renamingSession,
  renameValue,
  renameInputRef,
  renamingProjectPath,
  projectRenameValue,
  projectRenameInputRef,
  onToggleGroup,
  onOpenSession,
  onSessionContextMenu,
  onProjectContextMenu,
  onDelete,
  onStartSessionRename,
  onStartProjectRename,
  onRenameChange,
  onFinishRename,
  onCancelRename,
  onProjectRenameChange,
  onFinishProjectRename,
  onCancelProjectRename,
  drag,
  onSessionDragStart,
  onSessionDragOver,
  onSessionDrop,
  onProjectDragStart,
  onProjectDragOver,
  onProjectDrop,
  onDragEnd,
}: {
  group: SidebarSessionGroup
  expanded: boolean
  activeKey: string | null
  renamingSession: SessionRef | null
  renameValue: string
  renameInputRef: React.RefObject<HTMLInputElement>
  renamingProjectPath: string | null
  projectRenameValue: string
  projectRenameInputRef: React.RefObject<HTMLInputElement>
  onToggleGroup: (groupKey: string) => void
  onOpenSession: (session: SessionListItem, displayTitle: string) => void
  onSessionContextMenu: (event: React.MouseEvent, session: SessionRef) => void
  onProjectContextMenu?: (event: React.MouseEvent, group: SidebarSessionGroup) => void
  onDelete: (session: SessionRef) => void
  onStartSessionRename: (session: SessionRef, currentTitle: string) => void
  onStartProjectRename: (projectPath: string, currentTitle: string) => void
  onRenameChange: (value: string) => void
  onFinishRename: () => void
  onCancelRename: () => void
  onProjectRenameChange: (value: string) => void
  onFinishProjectRename: () => void
  onCancelProjectRename: () => void
  drag: SidebarDrag | null
  onSessionDragStart: (event: React.DragEvent, session: SessionRef, projectKey: string) => void
  onSessionDragOver: (event: React.DragEvent, session: SessionRef, projectKey: string) => void
  onSessionDrop: (event: React.DragEvent) => void
  onProjectDragStart: (event: React.DragEvent, group: SidebarSessionGroup) => void
  onProjectDragOver: (event: React.DragEvent, group: SidebarSessionGroup) => void
  onProjectDrop: (event: React.DragEvent) => void
  onDragEnd: () => void
}) {
  const t = useTranslation()

  return (
    <section className="flex flex-col" aria-label={group.title}>
      <div className="group/project relative">
        {renamingProjectPath === group.projectPath && !group.isTemporary ? (
          <input
            ref={projectRenameInputRef}
            value={projectRenameValue}
            maxLength={80}
            aria-label={`${t('common.rename')}: ${group.title}`}
            onChange={(event) => onProjectRenameChange(event.target.value)}
            onBlur={onFinishProjectRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onFinishProjectRename()
              if (event.key === 'Escape') onCancelProjectRename()
            }}
            className="h-[28px] w-full rounded-[7px] border border-[var(--color-border-focus)] bg-[var(--color-surface-container-lowest)] px-[10px] text-[12px] font-semibold text-[var(--color-text-primary)] outline-none"
          />
        ) : (
          <>
            <button
              type="button"
              aria-expanded={expanded}
              title={group.path ?? undefined}
              draggable={!group.isTemporary}
              onClick={() => onToggleGroup(group.key)}
              onContextMenu={group.isTemporary ? undefined : (event) => onProjectContextMenu?.(event, group)}
              onDragStart={group.isTemporary ? undefined : (event) => onProjectDragStart(event, group)}
              onDragOver={group.isTemporary ? undefined : (event) => onProjectDragOver(event, group)}
              onDrop={group.isTemporary ? undefined : onProjectDrop}
              onDragEnd={onDragEnd}
              className="relative flex h-[28px] w-full items-center gap-[6px] rounded-[7px] px-[8px] text-left text-[var(--color-text-secondary)] transition-colors duration-100 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
            >
              {drag !== null && drag.kind === 'project' && drag.over?.id === group.projectPath && drag.over.half === 'before' && (
                <span className="absolute left-[2px] right-[2px] top-[-2px] h-[2px] rounded-full bg-[var(--color-brand)]" aria-hidden="true" />
              )}
              {drag !== null && drag.kind === 'project' && drag.over?.id === group.projectPath && drag.over.half === 'after' && (
                <span className="absolute bottom-[-2px] left-[2px] right-[2px] h-[2px] rounded-full bg-[var(--color-brand)]" aria-hidden="true" />
              )}
              <Icon
                name="chevron_right"
                size={13}
                className={`shrink-0 text-[var(--color-text-tertiary)] transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
              />
              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold leading-[16px]">
                {group.title}
              </span>
              <span className="shrink-0 text-[10px] font-medium tabular-nums text-[var(--color-text-tertiary)]">
                {t('sidebar.projectSessionCount', { count: group.sessions.length })}
              </span>
              {!group.isTemporary && group.projectPath && (
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`${t('common.rename')}: ${group.title}`}
                  title={t('common.rename')}
                  onClick={(event) => {
                    event.stopPropagation()
                    onStartProjectRename(group.projectPath!, group.title)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.stopPropagation()
                      onStartProjectRename(group.projectPath!, group.title)
                    }
                  }}
                  className="flex h-[18px] w-[18px] items-center justify-center rounded-[5px] text-[var(--color-text-tertiary)] opacity-0 transition duration-100 hover:bg-[var(--color-surface-container-high)] hover:text-[var(--color-text-primary)] group-hover/project:opacity-100 focus-visible:opacity-100"
                >
                  <Icon name="edit" size={11} />
                </span>
              )}
            </button>
          </>
        )}
      </div>

      {expanded && (
        <div className="mt-[1px] flex flex-col">
          {group.sessions.slice(0, SESSION_ROW_LIMIT).map((session) => {
            const currentKey = sessionKey(session.id, session.projectPath)
            const isRenaming =
              renamingSession?.id === session.id && renamingSession.projectPath === session.projectPath
            return (
              <SidebarSessionRow
                key={currentKey}
                session={session}
                isActive={currentKey === activeKey}
                isRenaming={isRenaming}
                renameValue={isRenaming ? renameValue : ''}
                renameInputRef={renameInputRef}
                onOpen={onOpenSession}
                onContextMenu={onSessionContextMenu}
                onDelete={onDelete}
                onStartRename={onStartSessionRename}
                onRenameChange={onRenameChange}
                onFinishRename={onFinishRename}
                onCancelRename={onCancelRename}
                drag={drag}
                projectKey={group.key}
                onDragStart={onSessionDragStart}
                onDragOver={onSessionDragOver}
                onDrop={onSessionDrop}
                onDragEnd={onDragEnd}
              />
            )
          })}
          {group.sessions.length > SESSION_ROW_LIMIT && (
            <button
              type="button"
              onClick={() => onToggleGroup(group.key)}
              className="mt-[1px] flex h-[26px] w-full items-center gap-[6px] rounded-[7px] px-[8px] pl-[16px] text-left text-[11px] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]"
            >
              {t('sidebar.showMoreSessions', { count: group.sessions.length - SESSION_ROW_LIMIT })}
            </button>
          )}
        </div>
      )}
    </section>
  )
})

const SidebarSessionRow = memo(function SidebarSessionRow({
  session,
  isActive,
  isRenaming,
  renameValue,
  renameInputRef,
  onOpen,
  onContextMenu,
  onDelete,
  onStartRename,
  onRenameChange,
  onFinishRename,
  onCancelRename,
  drag,
  projectKey,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  session: SessionListItem
  isActive: boolean
  isRenaming: boolean
  renameValue: string
  renameInputRef: React.RefObject<HTMLInputElement>
  onOpen: (session: SessionListItem, displayTitle: string) => void
  onContextMenu: (event: React.MouseEvent, session: SessionRef) => void
  onDelete: (session: SessionRef) => void
  onStartRename: (session: SessionRef, currentTitle: string) => void
  onRenameChange: (value: string) => void
  onFinishRename: () => void
  onCancelRename: () => void
  drag: SidebarDrag | null
  projectKey: string
  onDragStart: (event: React.DragEvent, session: SessionRef, projectKey: string) => void
  onDragOver: (event: React.DragEvent, session: SessionRef, projectKey: string) => void
  onDrop: (event: React.DragEvent) => void
  onDragEnd: () => void
}) {
  const t = useTranslation()
  const displayTitle = useMemo(() => getSessionDisplayTitle(session, t), [session, t])
  const relativeTime = useMemo(() => formatRelativeTime(session.modifiedAt, t), [session.modifiedAt, t])
  const chatState = useChatStore((s) => s.sessions[session.id]?.chatState)
  const sessionStatus = chatState === 'permission_pending'
    ? 'attention'
    : chatState && chatState !== 'idle'
      ? 'running'
      : 'idle'
  const prefetchTimerRef = useRef<number | null>(null)
  const hoverTimerRef = useRef<number | null>(null)
  const [hoverCard, setHoverCard] = useState<{ x: number; y: number } | null>(null)

  const cancelPendingPrefetch = useCallback(() => {
    if (prefetchTimerRef.current !== null) {
      window.clearTimeout(prefetchTimerRef.current)
      prefetchTimerRef.current = null
    }
  }, [])

  useEffect(() => cancelPendingPrefetch, [cancelPendingPrefetch])

  const scheduleHoverCard = useCallback(() => {
    cancelPendingPrefetch()
    if (hoverTimerRef.current !== null) return
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null
      const row = document.getElementById(`sidebar-session-${CSS.escape(session.id)}`)
      if (!row) return
      const rect = row.getBoundingClientRect()
      setHoverCard({ x: rect.right + 8, y: rect.top })
    }, 300)
  }, [cancelPendingPrefetch, session.id])

  const cancelHoverCard = useCallback(() => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    setHoverCard(null)
  }, [])

  const handlePointerEnter = useCallback(() => {
    cancelPendingPrefetch()
    prefetchTimerRef.current = window.setTimeout(() => {
      prefetchTimerRef.current = null
      void useChatStore.getState().prefetchHistory(session.id, session.projectPath)
    }, HOVER_PREFETCH_DELAY_MS)
  }, [cancelPendingPrefetch, session.id, session.projectPath])

  const dragOverHalf = drag !== null && drag.kind === 'session' && drag.over?.id === session.id ? drag.over.half : null
  const isDragSource = drag !== null && drag.kind === 'session' && drag.id === session.id && drag.projectKey === projectKey

  return (
    <div
      id={`sidebar-session-${session.id}`}
      className="group/session relative"
      onPointerEnter={scheduleHoverCard}
      onPointerLeave={cancelHoverCard}
    >
      {hoverCard && (
        <SessionHoverCard
          title={displayTitle}
          workDir={session.workDir}
          modifiedAt={session.modifiedAt}
          messageCount={session.messageCount}
          status={sessionStatus}
          x={hoverCard.x}
          y={hoverCard.y}
        />
      )}
      {dragOverHalf === 'before' && (
        <span className="absolute left-[8px] right-[8px] top-[-2px] z-10 h-[2px] rounded-full bg-[var(--color-brand)]" aria-hidden="true" />
      )}
      {dragOverHalf === 'after' && (
        <span className="absolute bottom-[-2px] left-[8px] right-[8px] z-10 h-[2px] rounded-full bg-[var(--color-brand)]" aria-hidden="true" />
      )}
      {isRenaming ? (
        <input
          ref={renameInputRef}
          value={renameValue}
          maxLength={80}
          aria-label={`${t('common.rename')}: ${displayTitle}`}
          onChange={(e) => onRenameChange(e.target.value)}
          onBlur={onFinishRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onFinishRename()
            if (e.key === 'Escape') onCancelRename()
          }}
          className="h-[38px] w-full rounded-[7px] border border-[var(--color-border-focus)] bg-[var(--color-surface-container-lowest)] px-[10px] text-[13px] leading-normal text-[var(--color-text-primary)] outline-none"
        />
      ) : (
        <>
          <button
            onClick={() => onOpen(session, displayTitle)}
            onPointerEnter={handlePointerEnter}
            onPointerLeave={cancelPendingPrefetch}
            onContextMenu={(e) => onContextMenu(e, { id: session.id, projectPath: session.projectPath })}
            draggable={true}
            onDragStart={(e) => onDragStart(e, { id: session.id, projectPath: session.projectPath }, projectKey)}
            onDragOver={(e) => onDragOver(e, { id: session.id, projectPath: session.projectPath }, projectKey)}
            onDrop={onDrop}
            onDragEnd={onDragEnd}
            data-drag-source={isDragSource ? 'true' : undefined}
            title={session.workDir || undefined}
            className={`relative flex min-h-[40px] w-full items-start justify-between overflow-hidden rounded-[7px] px-[8px] py-[6px] pl-[16px] text-left transition-colors duration-100 ${
              isActive
                ? 'bg-[var(--color-inverse-surface)] text-[var(--color-inverse-on-surface)]'
                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
            }`}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-[1px] pr-[4px]">
              <div className="flex items-center gap-[6px]">
                {sessionStatus === 'running' && (
                  <span aria-hidden="true" title={t('sidebar.statusRunning')} className="h-[5px] w-[5px] shrink-0 rounded-full bg-[var(--color-signal)] animate-pulse-dot" />
                )}
                {sessionStatus === 'attention' && (
                  <span aria-hidden="true" title={t('sidebar.statusAttention')} className="h-[5px] w-[5px] shrink-0 rounded-full bg-[var(--color-warning)] animate-pulse-dot" />
                )}
                <span className={`min-w-0 flex-1 truncate text-[13px] font-medium leading-[17px] ${isActive ? '' : 'text-[var(--color-text-primary)]'}`}>
                  {displayTitle}
                </span>
                <span className={`shrink-0 text-[10px] font-medium tabular-nums leading-[17px] ${isActive ? 'opacity-55' : 'text-[var(--color-text-tertiary)]'}`}>
                  {relativeTime}
                </span>
              </div>
              {session.lastMessage && session.lastMessage !== displayTitle && (
                <p className={`truncate text-left text-[11px] leading-[15px] ${isActive ? 'opacity-60' : 'text-[var(--color-text-tertiary)]'}`}>
                  {session.lastMessage}
                </p>
              )}
              {session.workDir && !session.workDirExists && (
                <p className={`truncate text-left text-[10px] leading-[14px] ${isActive ? 'text-[var(--color-warning)]' : 'text-[var(--color-warning)]'}`}>
                  {t('sidebar.missingDir')}
                </p>
              )}
            </div>
          </button>
          <div className="absolute right-[6px] top-[5px] flex items-center gap-[2px] opacity-0 transition duration-100 group-hover/session:opacity-100 focus-within:opacity-100">
            <button
              type="button"
              aria-label={`${t('common.rename')}: ${displayTitle}`}
              title={t('common.rename')}
              onClick={(event) => {
                event.stopPropagation()
                onStartRename({ id: session.id, projectPath: session.projectPath }, displayTitle)
              }}
              className={`flex h-[22px] w-[22px] items-center justify-center rounded-[6px] transition-colors ${
                isActive
                  ? 'text-[var(--color-inverse-on-surface)]/60 hover:bg-white/10 hover:text-[var(--color-inverse-on-surface)]'
                  : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-container-high)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              <Icon name="edit" size={12} />
            </button>
            <button
              type="button"
              aria-label={`${t('common.delete')}: ${displayTitle}`}
              title={t('common.delete')}
              onClick={(e) => {
                e.stopPropagation()
                onDelete({ id: session.id, projectPath: session.projectPath })
              }}
              className={`flex h-[22px] w-[22px] items-center justify-center rounded-[6px] transition-colors ${
                isActive
                  ? 'text-[var(--color-inverse-on-surface)]/60 hover:bg-[var(--color-error)] hover:text-white'
                  : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-error)]/10 hover:text-[var(--color-error)]'
              }`}
            >
              <Icon name="close_one" size={12} />
            </button>
          </div>
        </>
      )}
    </div>
  )
})

/** Host 内容搜索结果行：标题 / 摘要 / 项目路径 / 命中数（对齐 DSH SearchResultItem）。 */
function SidebarSearchResult({ hit, onOpen }: { hit: SessionSearchHit; onOpen: () => void }) {
  const t = useTranslation()
  return (
    <button
      type="button"
      onClick={onOpen}
      title={hit.title}
      className="relative flex min-h-[40px] w-full flex-col gap-[2px] rounded-[7px] px-[8px] py-[6px] pl-[16px] text-left transition-colors duration-100 hover:bg-[var(--color-surface-hover)]"
    >
      <div className="flex items-center gap-[6px]">
        <Icon name="search" size={12} className="shrink-0 text-[var(--color-text-tertiary)]" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-[17px] text-[var(--color-text-primary)]">
          {hit.title}
        </span>
        <span className="shrink-0 text-[10px] font-medium tabular-nums text-[var(--color-text-tertiary)]">
          {t('sidebar.searchMatchCount', { count: hit.matchCount })}
        </span>
      </div>
      {hit.snippet && (
        <p className="truncate text-left text-[11px] leading-[15px] text-[var(--color-text-tertiary)]">
          {hit.snippet}
        </p>
      )}
      {hit.projectPath && (
        <p className="truncate text-left text-[10px] font-mono leading-[14px] text-[var(--color-text-tertiary)]">
          {hit.projectPath}
        </p>
      )}
    </button>
  )
}

/** 会话行 hover 详情卡片：标题 / 状态 / 时间 / 路径 / 消息数（对齐 DSH 的 hover card）。 */
function SessionHoverCard({
  title,
  workDir,
  modifiedAt,
  messageCount,
  status,
  x,
  y,
}: {
  title: string
  workDir: string | null
  modifiedAt: string
  messageCount: number
  status: 'idle' | 'running' | 'attention'
  x: number
  y: number
}) {
  const t = useTranslation()
  const statusLabel = status === 'running'
    ? t('sidebar.statusRunning')
    : status === 'attention'
      ? t('sidebar.statusAttention')
      : t('sidebar.statusIdle')
  const statusTone = status === 'running'
    ? 'bg-[var(--color-signal)]'
    : status === 'attention'
      ? 'bg-[var(--color-warning)]'
      : 'bg-[var(--color-border)]'
  return (
    <div
      className="pointer-events-none fixed z-[70] w-[220px] rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-[12px] shadow-[var(--shadow-dropdown)]"
      style={{ left: Math.min(x, window.innerWidth - 240), top: Math.max(8, y) }}
      role="tooltip"
    >
      <div className="flex items-start gap-[8px]">
        <span aria-hidden="true" className={`mt-[5px] h-[6px] w-[6px] shrink-0 rounded-full ${statusTone}`} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold leading-[16px] text-[var(--color-text-primary)]">{title}</div>
          <div className="mt-[2px] text-[10px] text-[var(--color-text-tertiary)]">{statusLabel} · {formatRelativeTime(modifiedAt, t)}</div>
        </div>
      </div>
      {workDir && (
        <div className="mt-[8px] truncate rounded-[6px] bg-[var(--color-surface-container-low)] px-[8px] py-[5px] font-mono text-[10px] text-[var(--color-text-secondary)]" title={workDir}>
          {workDir}
        </div>
      )}
      <div className="mt-[6px] text-[10px] text-[var(--color-text-tertiary)]">
        {t('sidebar.hoverMessageCount', { count: messageCount })}
      </div>
    </div>
  )
}

function SessionListSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-[6px]">
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <div
          key={index}
          className="flex min-h-[40px] w-full items-center gap-[8px] rounded-[7px] px-[16px] py-[6px]"
        >
          <span className="skeleton-shimmer block h-[13px] flex-1 rounded-full" style={{ maxWidth: `${62 + (index % 3) * 8}%` }} />
          <span className="skeleton-shimmer block h-[10px] w-[28px] rounded-full" />
        </div>
      ))}
    </div>
  )
}

function buildSidebarSessionGroups({
  sessions,
  sessionFilterScope,
  selectedProjectPaths,
  hiddenProjectPaths,
  projectDisplayNames,
  searchQuery,
  fallbackProjectTitle,
  temporaryTitle,
  getDisplayTitle,
  grouping = 'project',
  timeGroupLabels,
  orderBy = 'updated',
  sessionOrder,
  projectOrder,
  archivedKeys = [],
}: {
  sessions: SessionListItem[]
  sessionFilterScope: SidebarSessionFilterScope
  selectedProjectPaths: string[]
  hiddenProjectPaths: string[]
  projectDisplayNames: Record<string, string>
  searchQuery: string
  fallbackProjectTitle: string
  temporaryTitle: string
  getDisplayTitle: (session: SessionListItem) => string
  grouping?: SidebarGrouping
  orderBy?: SidebarOrderBy
  sessionOrder?: Record<string, string[]>
  projectOrder?: string[]
  archivedKeys?: string[]
  timeGroupLabels?: {
    today: string
    yesterday: string
    last7days: string
    last30days: string
    older: string
  }
}): { projectGroups: SidebarSessionGroup[]; temporaryGroup: SidebarSessionGroup | null; flatSessions: SessionListItem[] | null } {
  const query = searchQuery.trim().toLowerCase()
  const hidden = new Set(hiddenProjectPaths)
  const selectedProjectPath = selectedProjectPaths[0]
  const isTemporaryScope = sessionFilterScope === 'temporary'
  const isProjectScope = sessionFilterScope === 'project' && !!selectedProjectPath
  const isAllProjectScope = !isTemporaryScope && !isProjectScope
  const projectGroups = new Map<string, SidebarSessionGroup>()
  const temporarySessions: SessionListItem[] = []

  // 时间分组模式下按修改时间把会话分到对应分桶，替代项目分组。
  const timeBuckets = new Map<string, SidebarSessionGroup>()

  const sortedSessions = [...sessions].sort((a, b) =>
    new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()
  )

  const archived = new Set(archivedKeys)
  for (const session of sortedSessions) {
    const displayTitle = getDisplayTitle(session)
    const projectDisplayName = projectDisplayNames[session.projectPath]
    if (archived.has(sessionKey(session.id, session.projectPath))) continue
    if (query && !sessionMatchesSearch(session, displayTitle, query, projectDisplayName)) continue

    if (isTemporarySession(session)) {
      if (isAllProjectScope || isTemporaryScope) temporarySessions.push(session)
      continue
    }
    if (!session.projectPath || hidden.has(session.projectPath)) continue
    if (isTemporaryScope) continue
    if (isProjectScope && session.projectPath !== selectedProjectPath) continue

    if (grouping === 'time') {
      const bucketKey = timeBucketKey(session.modifiedAt)
      const previous = timeBuckets.get(bucketKey)
      if (!previous) {
        timeBuckets.set(bucketKey, {
          key: bucketKey,
          title: timeGroupTitle(bucketKey, timeGroupLabels),
          path: null,
          modifiedAt: session.modifiedAt || null,
          isTemporary: false,
          sessions: [session],
        })
      } else {
        previous.sessions.push(session)
      }
      continue
    }

    const previous = projectGroups.get(session.projectPath)
    const modifiedAt = session.modifiedAt || null
    const title = projectDisplayName || (session.workDir
      ? basename(session.workDir)
      : fallbackProjectTitleFromPath(session.projectPath, fallbackProjectTitle))

    if (!previous) {
      projectGroups.set(session.projectPath, {
        key: session.projectPath,
        projectPath: session.projectPath,
        title,
        path: session.workDir || null,
        modifiedAt,
        isTemporary: false,
        sessions: [session],
      })
      continue
    }

    previous.sessions.push(session)
    if (modifiedAt && (!previous.modifiedAt || modifiedAt > previous.modifiedAt)) {
      previous.modifiedAt = modifiedAt
      previous.title = title
      previous.path = session.workDir || previous.path
    }
  }

  const temporaryGroup = temporarySessions.length > 0
    ? {
        key: TEMPORARY_GROUP_KEY,
        title: temporaryTitle,
        path: null,
        modifiedAt: temporarySessions[0]?.modifiedAt ?? null,
        isTemporary: true,
        sessions: temporarySessions,
      }
    : null

  const groups = grouping === 'time' ? timeBuckets : projectGroups

  // 扁平模式：所有可见会话（含临时）合并为按修改时间降序的单列表。
  if (grouping === 'flat') {
    const flatSessions = [
      ...temporarySessions,
      ...sortedSessions.filter((session) => {
        if (isTemporarySession(session)) return false
        if (!session.projectPath || hidden.has(session.projectPath)) return false
        if (isTemporaryScope) return false
        if (isProjectScope && session.projectPath !== selectedProjectPath) return false
        return true
      }),
    ]
    const orderedFlat = orderBy === 'manual'
      ? flatSessions.map((session) => session.id)
      : flatSessions.map((session) => session.id)
    if (orderBy === 'manual') {
      const byId = new Map(flatSessions.map((session) => [session.id, session]))
      return {
        projectGroups: [],
        temporaryGroup: null,
        flatSessions: applyStoredOrder(orderedFlat, sessionOrder?.['__flat__'])
          .map((id) => byId.get(id))
          .filter((session): session is SessionListItem => session !== undefined),
      }
    }
    return { projectGroups: [], temporaryGroup: null, flatSessions }
  }

  const projectGroupsResult = [...groups.values()].sort((a, b) => {
    if (orderBy === 'manual' && projectOrder && projectOrder.length > 0) {
      const aIndex = projectOrder.indexOf(a.key)
      const bIndex = projectOrder.indexOf(b.key)
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex
      if (aIndex !== -1) return -1
      if (bIndex !== -1) return 1
    }
    if (a.modifiedAt && b.modifiedAt && a.modifiedAt !== b.modifiedAt) {
      return b.modifiedAt.localeCompare(a.modifiedAt)
    }
    if (a.modifiedAt && !b.modifiedAt) return -1
    if (!a.modifiedAt && b.modifiedAt) return 1
    return a.title.localeCompare(b.title)
  })

  // 手动排序时按存储顺序重排每个组内的会话。
  if (orderBy === 'manual' && sessionOrder) {
    for (const group of projectGroupsResult) {
      const stored = sessionOrder[group.key]
      if (stored && stored.length > 0) {
        const byId = new Map(group.sessions.map((session) => [session.id, session]))
        group.sessions = applyStoredOrder(group.sessions.map((session) => session.id), stored)
          .map((id) => byId.get(id))
          .filter((session): session is SessionListItem => session !== undefined)
      }
    }
  }

  return {
    projectGroups: projectGroupsResult,
    temporaryGroup,
    flatSessions: null,
  }
}

/** 把修改时间归入 Today/Yesterday/Last 7 days/Last 30 days/Older 桶。 */
function timeBucketKey(modifiedAt: string | null | undefined): string {
  if (!modifiedAt) return 'older'
  const modified = new Date(modifiedAt).getTime()
  if (Number.isNaN(modified)) return 'older'
  const now = Date.now()
  const dayMs = 24 * 60 * 60 * 1000
  const startOfToday = new Date(now).setHours(0, 0, 0, 0)
  const startOfYesterday = startOfToday - dayMs
  if (modified >= startOfToday) return 'today'
  if (modified >= startOfYesterday) return 'yesterday'
  if (modified >= now - 7 * dayMs) return 'last7days'
  if (modified >= now - 30 * dayMs) return 'last30days'
  return 'older'
}

function timeGroupTitle(
  bucketKey: string,
  labels: { today: string; yesterday: string; last7days: string; last30days: string; older: string } | undefined,
): string {
  switch (bucketKey) {
    case 'today': return labels?.today ?? 'Today'
    case 'yesterday': return labels?.yesterday ?? 'Yesterday'
    case 'last7days': return labels?.last7days ?? 'Last 7 Days'
    case 'last30days': return labels?.last30days ?? 'Last 30 Days'
    default: return labels?.older ?? 'Older'
  }
}

function sessionMatchesSearch(
  session: SessionListItem,
  displayTitle: string,
  query: string,
  projectDisplayName?: string,
) {
  return [
    displayTitle,
    session.lastMessage ?? '',
    session.workDir ?? '',
    projectDisplayName ?? '',
  ].some((value) => value.toLowerCase().includes(query))
}

function basename(path: string) {
  return path.split('/').filter(Boolean).pop() || path
}

function fallbackProjectTitleFromPath(projectPath: string, fallback: string) {
  if (!projectPath || projectPath === '_unknown') return fallback
  if (projectPath.includes('/')) return basename(projectPath) || fallback
  const segments = projectPath.split('-').filter(Boolean)
  return segments[segments.length - 1] || projectPath || fallback
}

function formatRelativeTime(dateStr: string, t: ReturnType<typeof useTranslation>): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return t('sidebar.time.now')
  if (min < 60) return t('sidebar.time.minutesAgo', { count: min })
  const hr = Math.floor(min / 60)
  if (hr < 24) return t('sidebar.time.hoursAgo', { count: hr })
  const day = Math.floor(hr / 24)
  if (day < 30) return t('sidebar.time.daysAgo', { count: day })
  return t('sidebar.time.monthsAgo', { count: Math.floor(day / 30) })
}
