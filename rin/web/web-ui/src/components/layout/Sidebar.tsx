import { memo, useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useUIStore, type SidebarGrouping } from '../../stores/uiStore'
import { useTranslation } from '../../i18n'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { useTabStore } from '../../stores/tabStore'
import { useChatStore } from '../../stores/chatStore'
import { getSessionDisplayTitle } from '../../utils/sessionTitle'
import { NewSessionMenu } from './NewSessionMenu'
import { NewProjectDialog } from './NewProjectDialog'
import { SkillsConfigBrowser } from './SkillsConfigBrowser'
import { resolveCurrentProject } from './NewSessionChooser'
import { ProjectFilter } from './ProjectFilter'
import { Icon } from '../shared/Icon'
import { useCreateAndOpenSession } from '../../hooks/useCreateAndOpenSession'
import type { SessionListItem } from '../../types/session'
import { readStoredJson, writeStoredJson } from '../../lib/storage'

const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
const COLLAPSED_PROJECTS_KEY = 'rin.sidebar.collapsedProjects.v1'
const LEGACY_COLLAPSED_PROJECTS_KEY = 'cybercode.sidebar.collapsedProjects.v1'
const TEMPORARY_GROUP_KEY = '__temporary__'
const BACKGROUND_HISTORY_PREFETCH_COUNT = 8
const HOVER_PREFETCH_DELAY_MS = 175

type SessionRef = { id: string; projectPath?: string }
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
  const parsed = readStoredJson<unknown>(COLLAPSED_PROJECTS_KEY, LEGACY_COLLAPSED_PROJECTS_KEY, [])
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
  const settingsOpen = useUIStore((s) => s.settingsOpen)
  const sidebarGrouping = useUIStore((s) => s.sidebarGrouping)
  const setSidebarGrouping = useUIStore((s) => s.setSidebarGrouping)

  const activeTabId = useTabStore((s) => s.activeTabId)
  const activeTab = useTabStore((s) => s.tabs.find((tab) => tab.sessionId === s.activeTabId))
  const closeTab = useTabStore((s) => s.closeTab)
  const disconnectSession = useChatStore((s) => s.disconnectSession)
  const prefetchHistory = useChatStore((s) => s.prefetchHistory)
  const t = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')
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
  const [skillsConfigBrowserOpen, setSkillsConfigBrowserOpen] = useState(false)
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
      timeGroupLabels: {
        today: t('sidebar.timeGroup.today'),
        yesterday: t('sidebar.timeGroup.yesterday'),
        last7days: t('sidebar.timeGroup.last7days'),
        last30days: t('sidebar.timeGroup.last30days'),
        older: t('sidebar.timeGroup.older'),
      },
    }),
    [hiddenProjectPaths, projectDisplayNames, searchQuery, selectedProjects, selectedSessionScope, sessions, sidebarGrouping, t],
  )

  const visibleSessionCount = useMemo(
    () =>
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

  return (
    <aside
      onMouseDown={handleSidebarDrag}
      className={`sidebar-panel native-ui-text relative flex h-full w-full select-none flex-col bg-[var(--color-surface-sidebar)] text-[var(--color-text-primary)] ${sidebarOpen ? '' : 'pointer-events-none'}`}
      data-state={sidebarOpen ? 'open' : 'closed'}
      aria-label="Sidebar"
      aria-hidden={sidebarOpen ? undefined : true}
    >
      <div className="flex flex-1 flex-col overflow-hidden pt-[8px]">
        <div className="px-[16px]">
          <div className="relative">
            <Icon name="search" size={16} className="absolute left-[16px] top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
            <input
              id="sidebar-search"
              type="text"
              placeholder={t('sidebar.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-[44px] w-full rounded-full border-2 border-[var(--color-sidebar-search-border)] bg-[var(--color-sidebar-search-bg)] pl-[40px] pr-[74px] text-[13px] font-medium text-[var(--color-text-primary)] outline-none transition-colors placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)]"
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
              className="absolute right-[8px] top-1/2 flex h-[28px] w-[28px] -translate-y-1/2 items-center justify-center rounded-full bg-[var(--color-inverse-surface)] text-[var(--color-inverse-on-surface)] shadow-sm transition-all duration-100 hover:opacity-90 active:scale-[0.92]"
            >
              <Icon name="add" size={16} />
            </button>
          </div>

          <div
            role="group"
            aria-label={t('sidebar.groupingLabel')}
            className="mb-[10px] mt-[10px] flex items-center gap-[2px] rounded-[8px] bg-[var(--color-surface-container)] p-[2px]"
          >
            <button
              type="button"
              aria-pressed={sidebarGrouping === 'project'}
              onClick={() => setSidebarGrouping('project')}
              className={`flex h-[24px] flex-1 items-center justify-center rounded-[6px] text-[11px] font-bold transition-colors ${sidebarGrouping === 'project' ? 'bg-[var(--color-surface-container-high)] text-[var(--color-text-primary)] shadow-sm' : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'}`}
            >
              {t('sidebar.groupingProject')}
            </button>
            <button
              type="button"
              aria-pressed={sidebarGrouping === 'time'}
              onClick={() => setSidebarGrouping('time')}
              className={`flex h-[24px] flex-1 items-center justify-center rounded-[6px] text-[11px] font-bold transition-colors ${sidebarGrouping === 'time' ? 'bg-[var(--color-surface-container-high)] text-[var(--color-text-primary)] shadow-sm' : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'}`}
            >
              {t('sidebar.groupingTime')}
            </button>
          </div>
        </div>

        <div data-testid="sidebar-session-list-section" className="scrollbar-no-track flex-1 overflow-y-auto no-scrollbar">
          <div className="mt-[12px] flex flex-col gap-[10px] px-[12px] pb-[16px]">
            {error && (
              <div className="rounded-[12px] border border-[var(--color-error)]/20 bg-[var(--color-error)]/5 px-4 py-3">
                <div className="text-[11px] font-medium text-[var(--color-error)]">{t('sidebar.sessionListFailed')}</div>
                <div className="mt-1 break-words text-[10px] text-[var(--color-text-tertiary)]">{error}</div>
                <button onClick={() => fetchSessions()} className="mt-2 text-[10px] font-bold uppercase text-[var(--color-brand)] hover:underline">{t('common.retry')}</button>
              </div>
            )}

            {visibleSessionCount === 0 && (
              isLoading && sessions.length === 0 && !error ? (
                <SessionListSkeleton />
              ) : (
                <div className="py-6 text-center text-[11px] italic text-[var(--color-text-tertiary)]">
                  {searchQuery ? t('sidebar.noMatching') : t('sidebar.noSessions')}
                </div>
              )
            )}

            {groupedSessions.projectGroups.map((group) => (
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
              />
            ))}

            {groupedSessions.temporaryGroup && (
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
              />
            )}
          </div>
        </div>

        <div className="border-t border-[var(--color-border-separator)] px-[10px] pb-[10px] pt-[8px]">
          <button
            type="button"
            onClick={() => setSkillsConfigBrowserOpen(true)}
            className="flex h-[36px] w-full items-center gap-2 rounded-[8px] px-[10px] text-[12px] font-medium text-[var(--color-text-secondary)] transition-colors duration-100 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
          >
            <Icon name="folder_open" size={14} className="shrink-0 text-[var(--color-text-tertiary)]" />
            <span className="truncate">{t('sidebar.skillsConfigDir')}</span>
          </button>
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

      <SkillsConfigBrowser
        open={skillsConfigBrowserOpen}
        onClose={() => setSkillsConfigBrowserOpen(false)}
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
      className="fixed z-50 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-background)] p-[4px] shadow-[0_10px_28px_rgba(0,0,0,0.14)]"
      style={{ left: position.left, top: position.top, minWidth }}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
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
}) {
  const t = useTranslation()

  return (
    <section className="flex flex-col gap-[6px]" aria-label={group.title}>
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
            className="h-[40px] w-full rounded-[8px] border border-[var(--color-border-focus)] bg-[var(--color-surface-container-lowest)] px-[12px] text-[12px] font-bold text-[var(--color-text-primary)] outline-none ring-2 ring-[var(--color-brand)]/15"
          />
        ) : (
          <>
            <button
              type="button"
              aria-expanded={expanded}
              title={group.path ?? undefined}
              onClick={() => onToggleGroup(group.key)}
              onContextMenu={group.isTemporary ? undefined : (event) => onProjectContextMenu?.(event, group)}
              className="flex h-[40px] w-full items-center gap-[9px] rounded-[8px] px-[8px] text-left text-[var(--color-text-secondary)] transition-colors duration-100 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
            >
              <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[6px] bg-[var(--color-surface-container)] text-[var(--color-text-tertiary)] transition-colors group-hover/project:bg-[var(--color-surface-container-high)]">
                {group.isTemporary
                  ? <Icon name="bolt" size={14} />
                  : group.projectPath
                    ? <Icon name="folder" size={14} />
                    : <Icon name="schedule" size={14} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-bold leading-[16px] text-[var(--color-text-primary)]">
                  {group.title}
                </span>
              </span>
              <span className={`shrink-0 rounded-full bg-[var(--color-surface-container)] px-[6px] py-[2px] text-[10px] font-bold text-[var(--color-text-tertiary)] transition-opacity ${group.isTemporary ? '' : 'group-hover/project:opacity-0'}`}>
                {t('sidebar.projectSessionCount', { count: group.sessions.length })}
              </span>
              <Icon
                name="expand_more"
                size={14}
                className={`shrink-0 text-[var(--color-text-tertiary)] transition-transform duration-100 ${expanded ? '' : '-rotate-90'}`}
              />
            </button>
            {!group.isTemporary && group.projectPath && (
              <button
                type="button"
                aria-label={`${t('common.rename')}: ${group.title}`}
                title={t('common.rename')}
                onClick={() => onStartProjectRename(group.projectPath!, group.title)}
                className="absolute right-[31px] top-[8px] flex h-[24px] w-[24px] items-center justify-center rounded-[6px] text-[var(--color-text-tertiary)] opacity-0 transition duration-100 hover:bg-[var(--color-surface-container-high)] hover:text-[var(--color-text-primary)] group-hover/project:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
              >
                <Icon name="edit" size={12} />
              </button>
            )}
          </>
        )}
      </div>

      {expanded && (
        <div className="flex flex-col gap-2 pl-[6px]">
          {group.sessions.map((session) => {
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
              />
            )
          })}
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

  const cancelPendingPrefetch = useCallback(() => {
    if (prefetchTimerRef.current !== null) {
      window.clearTimeout(prefetchTimerRef.current)
      prefetchTimerRef.current = null
    }
  }, [])

  useEffect(() => cancelPendingPrefetch, [cancelPendingPrefetch])

  const handlePointerEnter = useCallback(() => {
    cancelPendingPrefetch()
    prefetchTimerRef.current = window.setTimeout(() => {
      prefetchTimerRef.current = null
      void useChatStore.getState().prefetchHistory(session.id, session.projectPath)
    }, HOVER_PREFETCH_DELAY_MS)
  }, [cancelPendingPrefetch, session.id, session.projectPath])

  return (
    <div className="group/session relative">
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
          className="h-[60px] w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-[15px] py-[11px] text-[13px] leading-normal text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
        />
      ) : (
        <>
          <button
            onClick={() => onOpen(session, displayTitle)}
            onPointerEnter={handlePointerEnter}
            onPointerLeave={cancelPendingPrefetch}
            onContextMenu={(e) => onContextMenu(e, { id: session.id, projectPath: session.projectPath })}
            title={session.workDir || undefined}
            className={`relative flex min-h-[60px] w-full items-center justify-between overflow-hidden rounded-[8px] border px-[15px] py-[11px] text-left transition-colors duration-100 ${
              isActive
                ? 'border-[var(--color-border-focus)] bg-[var(--color-inverse-surface)] text-[var(--color-inverse-on-surface)] shadow-none'
                : 'border-[var(--color-border-separator)] bg-[var(--color-surface-container-lowest)] text-[var(--color-text-secondary)] group-hover/session:border-[var(--color-border)] group-hover/session:bg-[var(--color-surface-hover)]'
            }`}
          >
            {/* 左缘 accent 竖条 */}
            {isActive && (
              <span aria-hidden="true" className="absolute left-[4px] top-1/2 h-[26px] w-[3px] -translate-y-1/2 rounded-full bg-[var(--color-signal)]" />
            )}
            <div className="flex w-full items-center">
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-start justify-between gap-2">
                  {sessionStatus === 'running' && (
                    <span aria-hidden="true" title={t('sidebar.statusRunning')} className="mt-[4px] h-[6px] w-[6px] shrink-0 rounded-full bg-[var(--color-signal)] animate-pulse-dot" />
                  )}
                  {sessionStatus === 'attention' && (
                    <span aria-hidden="true" title={t('sidebar.statusAttention')} className="mt-[4px] h-[6px] w-[6px] shrink-0 rounded-full bg-[var(--color-warning)] animate-pulse-dot" />
                  )}
                  <span className={`min-w-0 flex-1 truncate text-[13px] font-bold leading-normal ${isActive ? 'text-[var(--color-inverse-on-surface)]' : 'text-[var(--color-text-primary)]'}`}>
                    {displayTitle}
                  </span>
                  {session.workDir && !session.workDirExists && (
                    <span className="shrink-0 text-[9px] font-bold text-[var(--color-warning)]">
                      {t('sidebar.missingDir')}
                    </span>
                  )}
                  <span className={`mt-0.5 shrink-0 text-[10px] font-bold ${isActive ? 'text-[var(--color-inverse-on-surface)]/45' : 'text-[var(--color-text-tertiary)]'}`}>
                    {relativeTime}
                  </span>
                </div>
                {session.lastMessage && session.lastMessage !== displayTitle && (
                  <p className={`mt-[2px] truncate pr-[42px] text-left text-[11px] font-medium leading-normal ${isActive ? 'text-[var(--color-inverse-on-surface)]/65' : 'text-[var(--color-text-tertiary)]'}`}>
                    {session.lastMessage}
                  </p>
                )}
              </div>
            </div>
          </button>
          <button
            type="button"
            aria-label={`${t('common.rename')}: ${displayTitle}`}
            title={t('common.rename')}
            onClick={(event) => {
              event.stopPropagation()
              onStartRename({ id: session.id, projectPath: session.projectPath }, displayTitle)
            }}
            className="absolute bottom-[5px] right-[28px] flex h-[24px] w-[24px] items-center justify-center opacity-0 transition duration-100 group-hover/session:opacity-100 focus-visible:opacity-100"
          >
            <span className={`flex h-[17px] w-[17px] items-center justify-center rounded-full border shadow-none backdrop-blur-sm ${
              isActive
                ? 'border-white/10 bg-white/7 text-[var(--color-inverse-on-surface)]/45 hover:bg-white/12 hover:text-[var(--color-inverse-on-surface)]/72'
                : 'border-[var(--color-border)]/35 bg-[var(--color-surface-container-high)]/48 text-[var(--color-text-tertiary)] hover:border-[var(--color-border)]/55 hover:bg-[var(--color-surface-container-highest)]/72 hover:text-[var(--color-text-secondary)]'
            }`}>
              <Icon name="edit" size={9} />
            </span>
          </button>
          <button
            type="button"
            aria-label={`${t('common.delete')}: ${displayTitle}`}
            title={t('common.delete')}
            onClick={(e) => {
              e.stopPropagation()
              onDelete({ id: session.id, projectPath: session.projectPath })
            }}
            className="absolute bottom-[5px] right-[6px] flex h-[24px] w-[24px] items-center justify-center opacity-0 transition duration-100 group-hover/session:opacity-100 focus-visible:opacity-100"
          >
            <span className={`flex h-[17px] w-[17px] items-center justify-center rounded-full border shadow-none backdrop-blur-sm ${
              isActive
                ? 'border-white/10 bg-white/7 text-[var(--color-inverse-on-surface)]/45 hover:border-[var(--color-error)]/50 hover:bg-[var(--color-error)]/80 hover:text-white'
                : 'border-[var(--color-border)]/35 bg-[var(--color-surface-container-high)]/48 text-[var(--color-text-tertiary)] hover:border-[var(--color-error)]/45 hover:bg-[var(--color-error)]/12 hover:text-[var(--color-error)]'
            }`}>
              <Icon name="close_one" size={9} />
            </span>
          </button>
        </>
      )}
    </div>
  )
})

function SessionListSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2 pl-[6px]">
      {[0, 1, 2, 3].map((index) => (
        <div
          key={index}
          className="flex min-h-[60px] w-full flex-col justify-center gap-[8px] rounded-[8px] border border-[var(--color-border-separator)] bg-[var(--color-surface-container-lowest)] px-[15px] py-[11px]"
        >
          <span className="skeleton-shimmer block h-[13px] w-[62%] rounded-full" />
          <span className="skeleton-shimmer block h-[11px] w-[86%] rounded-full" />
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
  timeGroupLabels?: {
    today: string
    yesterday: string
    last7days: string
    last30days: string
    older: string
  }
}): { projectGroups: SidebarSessionGroup[]; temporaryGroup: SidebarSessionGroup | null } {
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

  for (const session of sortedSessions) {
    const displayTitle = getDisplayTitle(session)
    const projectDisplayName = projectDisplayNames[session.projectPath]
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

  return {
    projectGroups: [...groups.values()].sort((a, b) => {
      if (a.modifiedAt && b.modifiedAt && a.modifiedAt !== b.modifiedAt) {
        return b.modifiedAt.localeCompare(a.modifiedAt)
      }
      if (a.modifiedAt && !b.modifiedAt) return -1
      if (!a.modifiedAt && b.modifiedAt) return 1
      return a.title.localeCompare(b.title)
    }),
    temporaryGroup,
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
