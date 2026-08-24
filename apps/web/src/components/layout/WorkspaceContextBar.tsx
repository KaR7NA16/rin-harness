import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from '../../i18n'
import { useAgentStore } from '../../stores/agentStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTabStore } from '../../stores/tabStore'
import { useWorkspaceContextStore } from '../../stores/workspaceContextStore'
import { getSessionDisplayTitle } from '../../utils/sessionTitle'
import { useUIStore } from '../../stores/uiStore'
import { Icon, type IconName } from '../shared/Icon'
import { WorkspaceContextDialog, type WorkspaceOption } from './WorkspaceContextDialog'
import {
  WORKSPACE_CONTEXT_STATUS_CLASSES,
  WORKSPACE_CONTEXT_STATUS_KEYS,
} from './workspaceContextPresentation'
import {
  resolveWorkspaceContext,
  type WorkspaceContextStatus,
  type WorkspaceResource,
} from '../../types/workspace'

type ContextChipProps = {
  icon: IconName
  label: string
  resource: WorkspaceResource
  statusLabel: string
  loading: boolean
  onActivate?: () => void
}

function ContextChip({ icon, label, resource, statusLabel, loading, onActivate }: ContextChipProps) {
  const value = resource.name ?? statusLabel
  const content = (
    <>
      <Icon name={icon} size={13} className="shrink-0 text-[var(--color-text-tertiary)]" />
      <span className="hidden shrink-0 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-tertiary)] sm:inline">
        {label}
      </span>
      <span className="min-w-0 truncate text-[11px] font-medium text-[var(--color-text-primary)]">{value}</span>
      <span
        className={
          'h-[6px] w-[6px] shrink-0 rounded-full ' +
          (loading ? 'animate-pulse bg-[var(--color-brand)]' : WORKSPACE_CONTEXT_STATUS_CLASSES[resource.status])
        }
      />
      <span className="hidden shrink-0 text-[10px] text-[var(--color-text-tertiary)] lg:inline">{statusLabel}</span>
    </>
  )
  const className = "flex min-w-0 items-center gap-[7px] border-l border-[var(--color-border-separator)] pl-[10px] first:border-l-0 first:pl-0"

  if (onActivate) {
    return (
      <button
        type="button"
        data-testid={'workspace-context-' + label.toLowerCase().replaceAll(' ', '-')}
        className={className + " cursor-pointer text-left hover:bg-[var(--color-surface-hover)]"}
        aria-label={label + ': ' + value + ' / ' + statusLabel}
        title={resource.detail ?? value}
        onClick={onActivate}
      >
        {content}
      </button>
    )
  }

  return (
    <div
      data-testid={'workspace-context-' + label.toLowerCase().replaceAll(' ', '-')}
      className={className}
      aria-label={label + ': ' + value + ' / ' + statusLabel}
      title={resource.detail ?? value}
    >
      {content}
    </div>
  )
}


/** Shows the active workspace and the verified state of its runtime resources. */
export function WorkspaceContextBar() {
  const t = useTranslation()
  const selectedProjectPaths = useSessionStore((state) => state.selectedProjects)
  const availableProjects = useSessionStore((state) => state.availableProjects)
  const projectDisplayNames = useSessionStore((state) => state.projectDisplayNames)
  const setSelectedProjects = useSessionStore((state) => state.setSelectedProjects)
  const activeTabId = useTabStore((state) => state.activeTabId)
  const activeTab = useTabStore((state) => state.tabs.find((tab) => tab.sessionId === activeTabId))
  const recentSessionIds = useTabStore((state) => state.recentSessionIds)
  const switchToSession = useTabStore((state) => state.switchToSession)
  const sessions = useSessionStore((state) => state.sessions)
  const selectedAgent = useAgentStore((state) => state.selectedAgent)
  const openWorkspaceView = useUIStore((state) => state.openWorkspaceView)
  const activeAgents = useAgentStore((state) => state.activeAgents)
  const allAgents = useAgentStore((state) => state.allAgents)
  const agentsLoading = useAgentStore((state) => state.isLoading)
  const agentsError = useAgentStore((state) => state.error)
  const fetchAgents = useAgentStore((state) => state.fetchAgents)
  const agentsLastCheckedAt = useAgentStore((state) => state.lastCheckedAt)
  const resourceSnapshot = useWorkspaceContextStore()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const context = useMemo(
    () => resolveWorkspaceContext({
      activeTab,
      selectedProjectPaths,
      recentSessionIds,
      repositoriesError: resourceSnapshot.repositories.error,
      sessions,
      repositories: resourceSnapshot.repositories.items,
      sandboxError: resourceSnapshot.sandboxes.error,
      repositoriesState: resourceSnapshot.repositories.state,
      sandboxProfiles: resourceSnapshot.sandboxes.items,
      backendError: resourceSnapshot.backend.error,
      sandboxState: resourceSnapshot.sandboxes.state,
      backendState: resourceSnapshot.backend.state,
      backendStatus: resourceSnapshot.backend.health?.status ?? null,
      selectedAgent,
      activeAgents,
      agentsState: agentsLoading ? 'loading' : agentsError ? 'error' : allAgents.length > 0 ? 'ready' : 'idle',
    }),
    [
      activeAgents,
      activeTab,
      agentsError,
      agentsLoading,
      allAgents,
      recentSessionIds,
      resourceSnapshot.backend.error,
      resourceSnapshot.backend.health?.status,
      resourceSnapshot.backend.state,
      resourceSnapshot.repositories.error,
      resourceSnapshot.repositories.items,
      resourceSnapshot.repositories.state,
      resourceSnapshot.sandboxes.error,
      resourceSnapshot.sandboxes.items,
      resourceSnapshot.sandboxes.state,
      selectedAgent,
      selectedProjectPaths,
      sessions,
    ],
  )

  useEffect(() => {
    if (resourceSnapshot.backend.state !== 'idle'
      && resourceSnapshot.repositories.state !== 'idle'
      && resourceSnapshot.sandboxes.state !== 'idle') return
    void resourceSnapshot.refresh()
  }, [resourceSnapshot.backend.state, resourceSnapshot.repositories.state, resourceSnapshot.sandboxes.state, resourceSnapshot.refresh])

  useEffect(() => {
    void fetchAgents(context.rootPath ?? undefined)
  }, [context.rootPath, fetchAgents])

  const statusLabel = (status: WorkspaceContextStatus) => t(WORKSPACE_CONTEXT_STATUS_KEYS[status])

  const projectOptions = useMemo<WorkspaceOption[]>(
    () => availableProjects.map((path) => ({
      path,
      name: projectDisplayNames[path]
        ?? sessions.find((session) => session.projectPath === path)?.workDir?.split(/[\\/]/).filter(Boolean).at(-1)
        ?? path,
      sessionCount: sessions.filter((session) => session.projectPath === path).length,
    })),
    [availableProjects, projectDisplayNames, sessions],
  )
  const currentProjectPath = activeTab?.projectPath
    ?? sessions.find((session) => session.id === context.sessionId)?.projectPath
    ?? selectedProjectPaths[0]
    ?? null

  const selectProject = (projectPath: string) => {
    setSelectedProjects([projectPath])
    const session = sessions.find((candidate) => candidate.projectPath === projectPath && !candidate.isTemporary)
    if (session) {
      switchToSession(session.id, getSessionDisplayTitle(session, t), session.projectPath)
    }
    setDetailsOpen(false)
  }
  const isRefreshing = resourceSnapshot.backend.state === 'loading'
    || resourceSnapshot.repositories.state === 'loading'
    || resourceSnapshot.sandboxes.state === 'loading'
    || agentsLoading

  const refreshContext = async () => {
    await Promise.allSettled([
      resourceSnapshot.refresh(),
      fetchAgents(context.rootPath ?? undefined),
    ])
  }

  return (
    <>
      <header
      data-testid="workspace-context-bar"
      className="native-ui-text flex min-h-[48px] shrink-0 items-center gap-[12px] border-b border-[var(--color-border-separator)] bg-[var(--color-background)] px-[14px]"
    >
      <button
        type="button"
        data-testid="workspace-context-identity"
        aria-label={t('workspace.context.openDetails')}
        title={t('workspace.context.openDetails')}
        onClick={() => setDetailsOpen(true)}
        className="flex min-w-0 flex-1 items-center gap-[9px] rounded-[9px] text-left hover:bg-[var(--color-surface-hover)]"
      >
        <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] bg-[var(--color-accent-glow)] text-[var(--color-brand)]">
          <Icon name="workspaces" size={15} />
        </span>
        <span className="min-w-0">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-tertiary)]">
            {t('workspace.context.label')}
          </span>
          <span className="flex min-w-0 items-center gap-[7px]">
            <span className="truncate text-[13px] font-semibold text-[var(--color-text-primary)]">{context.name}</span>
            <Icon name="expand_more" size={13} className="shrink-0 text-[var(--color-text-tertiary)]" />
            {context.rootPath && (
              <span className="hidden max-w-[280px] truncate font-mono text-[10px] text-[var(--color-text-tertiary)] md:inline" title={context.rootPath}>
                {context.rootPath}
              </span>
            )}
          </span>
        </span>
      </button>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-[10px] overflow-x-auto no-scrollbar">
        <ContextChip icon="folder_open" label={t('workspace.context.repository')} resource={context.repository} statusLabel={statusLabel(context.repository.status)} loading={resourceSnapshot.repositories.state === 'loading'} onActivate={() => openWorkspaceView('repository')} />
        <ContextChip icon="dns" label={t('workspace.context.backend')} resource={context.backend} statusLabel={statusLabel(context.backend.status)} loading={resourceSnapshot.backend.state === 'loading'} />
        <ContextChip icon="package" label={t('workspace.context.sandbox')} resource={context.sandbox} statusLabel={statusLabel(context.sandbox.status)} loading={resourceSnapshot.sandboxes.state === 'loading'} onActivate={() => openWorkspaceView('sandbox')} />
        <ContextChip icon="smart_toy" label={t('workspace.context.agent')} resource={context.agentProfile} statusLabel={statusLabel(context.agentProfile.status)} loading={agentsLoading} onActivate={() => openWorkspaceView('agents')} />
      </div>

      <button
        type="button"
        data-testid="workspace-context-refresh"
        aria-label={t('workspace.context.refresh')}
        title={t('workspace.context.refresh')}
        disabled={isRefreshing}
        onClick={() => void refreshContext()}
        className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-default disabled:opacity-40"
      >
        <Icon name="refresh" size={14} className={isRefreshing ? 'animate-spin' : undefined} />
      </button>
      </header>
      <WorkspaceContextDialog
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        context={context}
        projectOptions={projectOptions}
        currentProjectPath={currentProjectPath}
        onSelectProject={selectProject}
        resources={resourceSnapshot}
        agentsLoading={agentsLoading}
        agentsError={agentsError}
        agentsLastCheckedAt={agentsLastCheckedAt}
        onRetryResource={(resource) => void resourceSnapshot.refreshResource(resource)}
        onRetryAgents={() => void fetchAgents(context.rootPath ?? undefined)}
      />
    </>
  )
}
