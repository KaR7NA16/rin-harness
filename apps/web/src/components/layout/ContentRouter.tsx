import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'
import { EmptySession } from '../../pages/EmptySession'

const ActiveSession = lazy(() => import('../../pages/ActiveSession').then((module) => ({ default: module.ActiveSession })))

const ScheduledTasks = lazy(() => import('../../features/scheduledTasks').then((module) => ({ default: module.ScheduledTasks })))
const Notes = lazy(() => import('../../pages/Notes').then((module) => ({ default: module.Notes })))
const Files = lazy(() => import('../../pages/Files').then((module) => ({ default: module.Files })))
const KnowledgeSpace = lazy(() => import('../../pages/KnowledgeSpace').then((module) => ({ default: module.KnowledgeSpace })))
const Atlas = lazy(() => import('../../pages/Atlas').then((module) => ({ default: module.Atlas })))
const Queries = lazy(() => import('../../pages/Queries').then((module) => ({ default: module.Queries })))
const Tags = lazy(() => import('../../pages/Tags').then((module) => ({ default: module.Tags })))
const Sandboxes = lazy(() => import('../../pages/Sandboxes').then((module) => ({ default: module.Sandboxes })))
const RepositoryWorkspace = lazy(() => import('../../pages/RepositoryWorkspace').then((module) => ({ default: module.RepositoryWorkspace })))
const AgentWorkspace = lazy(() => import('../../pages/AgentWorkspace').then((module) => ({ default: module.AgentWorkspace })))
const Terminal = lazy(() => import('../../pages/Terminal').then((module) => ({ default: module.Terminal })))

const WARM_SESSION_PANEL_COUNT = 2

/** Shared fallback for lazily mounted workspace/terminal pages. */
function RouteFallback() {
  return (
    <div className="flex h-full items-center justify-center text-[13px] text-[var(--color-text-tertiary)]">
      Loading...
    </div>
  )
}

function Suspended({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>
}

export function ContentRouter() {
  const activeTabId = useTabStore((s) => s.activeTabId)
  const tabs = useTabStore((s) => s.tabs)
  const recentSessionIds = useTabStore((s) => s.recentSessionIds)
  const activeTab = tabs.find((t) => t.sessionId === activeTabId)
  const activeTabType = activeTab?.type
  const openSettings = useUIStore((s) => s.openSettings)
  const setPendingSettingsTab = useUIStore((s) => s.setPendingSettingsTab)
  const workspaceView = useUIStore((s) => s.workspaceView)
  const sessionPanelIds = [
    ...(activeTabId && activeTabType === 'session' ? [activeTabId] : []),
    ...recentSessionIds,
  ]
    .filter((sessionId, index, ids) => ids.indexOf(sessionId) === index)
    .slice(0, WARM_SESSION_PANEL_COUNT)

  useEffect(() => {
    if (activeTabType !== 'backup') return
    openSettings('settings')
    setPendingSettingsTab('sessionBackup')
  }, [activeTabType, openSettings, setPendingSettingsTab])

  // Non-session pages (ScheduledTasks)
  const legacyWorkspaceView =
    activeTabType === 'scheduled' || activeTabType === 'notes' || activeTabType === 'files' || activeTabType === 'codeGraph'
      || activeTabType === 'sandbox' || activeTabType === 'repository' || activeTabType === 'agents'
      ? activeTabType
      : null
  const resolvedWorkspaceView = workspaceView ?? legacyWorkspaceView
  const nonSessionPage: ReactNode =
    resolvedWorkspaceView === 'scheduled' ? <Suspended><ScheduledTasks /></Suspended>
    : resolvedWorkspaceView === 'notes' ? <Suspended><Notes /></Suspended>
    : resolvedWorkspaceView === 'files' ? <Suspended><Files /></Suspended>
    : resolvedWorkspaceView === 'codeGraph' ? <Suspended><KnowledgeSpace /></Suspended>
    : resolvedWorkspaceView === 'atlas' ? <Suspended><Atlas /></Suspended>
    : resolvedWorkspaceView === 'queries' ? <Suspended><Queries /></Suspended>
    : resolvedWorkspaceView === 'tags' ? <Suspended><Tags /></Suspended>
    : resolvedWorkspaceView === 'sandbox' ? <Suspended><Sandboxes /></Suspended>
    : resolvedWorkspaceView === 'repository' ? <Suspended><RepositoryWorkspace /></Suspended>
    : resolvedWorkspaceView === 'agents' ? <Suspended><AgentWorkspace /></Suspended>
    : null

  const showEmptySession = !resolvedWorkspaceView && (!activeTabId || !activeTabType)

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      {showEmptySession && (
        <div className="content-route-panel content-route-panel--active absolute inset-0 flex min-h-0 flex-col overflow-hidden">
          <EmptySession />
        </div>
      )}

      {/* Keep the current and previous chat trees mounted. Recreating Virtuoso
          on every switch forces it to remeasure rows and rebuild the scrollbar;
          two warm panels remove that churn without retaining every session. */}
      {sessionPanelIds.map((sessionId) => {
        const tab = tabs.find((candidate) => candidate.sessionId === sessionId)
        const isActive = !resolvedWorkspaceView && sessionId === activeTabId && activeTabType === 'session'
        return (
          <div
            key={sessionId}
            aria-hidden={!isActive}
            data-session-panel={sessionId}
            className={`content-route-panel absolute inset-0 flex min-h-0 flex-col overflow-hidden ${
              isActive
                ? 'content-route-panel--active visible z-10 opacity-100'
                : 'content-route-panel--inactive invisible pointer-events-none z-0 opacity-0'
            }`}
          >
            <Suspended>
              <ActiveSession sessionId={sessionId} projectPath={tab?.projectPath} isActive={isActive} />
            </Suspended>
          </div>
        )
      })}

      {/* Terminal tabs are first-class tabs, not workspace views */}
      {activeTabType === 'terminal' && activeTabId && (
        <div
          className="content-route-panel content-route-panel--active absolute inset-0 z-10 flex min-h-0 flex-col overflow-hidden"
        >
          <Suspended><Terminal terminalId={activeTabId} spawnCommand={activeTab?.spawnCommand} cwd={activeTab?.cwd} /></Suspended>
        </div>
      )}

      {/* Non-session pages sit above session panels */}
      {nonSessionPage && (
        <div
          className="content-route-panel content-route-panel--active absolute inset-0 z-10 flex min-h-0 flex-col overflow-hidden"
        >
          {nonSessionPage}
        </div>
      )}
    </div>
  )
}
