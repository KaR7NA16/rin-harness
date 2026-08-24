import { useTranslation } from '../../i18n'
import type {
  WorkspaceContext,
  WorkspaceResource,
  WorkspaceResourceLoadState,
} from '../../types/workspace'
import type {
  WorkspaceContextStoreSnapshot,
  WorkspaceResourceKey,
} from '../../stores/workspaceContextStore'
import { Button } from '../shared/Button'
import { Icon, type IconName } from '../shared/Icon'
import { Modal } from '../shared/Modal'
import {
  WORKSPACE_CONTEXT_STATUS_CLASSES,
  WORKSPACE_CONTEXT_STATUS_KEYS,
} from './workspaceContextPresentation'

export type WorkspaceOption = {
  path: string
  name: string
  sessionCount: number
}

type ResourceRowProps = {
  icon: IconName
  label: string
  resource: WorkspaceResource
  state: WorkspaceResourceLoadState
  error: string | null
  lastCheckedAt: number | null
  onRetry?: () => void
}

function ResourceRow({
  icon,
  label,
  resource,
  state,
  error,
  lastCheckedAt,
  onRetry,
}: ResourceRowProps) {
  const t = useTranslation()
  const statusLabel = t(WORKSPACE_CONTEXT_STATUS_KEYS[resource.status])
  const loading = state === 'loading'
  const detail = error
    ? t('workspace.context.dialog.error', { message: error })
    : resource.detail
  const lastChecked = lastCheckedAt
    ? t('workspace.context.dialog.lastChecked', {
      time: new Date(lastCheckedAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    })
    : t('workspace.context.dialog.notChecked')

  return (
    <div
      data-testid={'workspace-diagnostic-' + label.toLowerCase().replaceAll(' ', '-')}
      className="flex items-start gap-3 rounded-[10px] border border-[var(--color-border-separator)] bg-[var(--color-surface-container)] px-3 py-3"
    >
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-[var(--color-background)] text-[var(--color-text-tertiary)]">
        <Icon name={icon} size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[12px] font-semibold text-[var(--color-text-primary)]">{label}</span>
          <span
            className={
              'h-[6px] w-[6px] shrink-0 rounded-full ' +
              (loading ? 'animate-pulse bg-[var(--color-brand)]' : WORKSPACE_CONTEXT_STATUS_CLASSES[resource.status])
            }
          />
          <span className="text-[11px] text-[var(--color-text-secondary)]">{statusLabel}</span>
        </div>
        <div className="mt-1 truncate text-[11px] text-[var(--color-text-primary)]" title={detail ?? undefined}>
          {resource.name ?? statusLabel}
        </div>
        {detail && (
          <div className="mt-1 truncate text-[10px] text-[var(--color-text-tertiary)]" title={detail}>
            {detail}
          </div>
        )}
        <div className="mt-1 text-[10px] text-[var(--color-text-tertiary)]">{lastChecked}</div>
      </div>
      {onRetry && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          loading={loading}
          onClick={onRetry}
          aria-label={t('workspace.context.dialog.retry')}
          className="h-8 shrink-0 px-2 text-[11px]"
          icon={<Icon name="refresh" size={13} />}
        >
          <span className="hidden sm:inline">
            {loading ? t('workspace.context.dialog.retrying') : t('workspace.context.dialog.retry')}
          </span>
        </Button>
      )}
    </div>
  )
}

type WorkspaceContextDialogProps = {
  open: boolean
  onClose: () => void
  context: WorkspaceContext
  projectOptions: WorkspaceOption[]
  currentProjectPath: string | null
  onSelectProject: (projectPath: string) => void
  resources: WorkspaceContextStoreSnapshot
  agentsLoading: boolean
  agentsError: string | null
  agentsLastCheckedAt: number | null
  onRetryResource: (resource: WorkspaceResourceKey) => void
  onRetryAgents: () => void
}

export function WorkspaceContextDialog({
  open,
  onClose,
  context,
  projectOptions,
  currentProjectPath,
  onSelectProject,
  resources,
  agentsLoading,
  agentsError,
  agentsLastCheckedAt,
  onRetryResource,
  onRetryAgents,
}: WorkspaceContextDialogProps) {
  const t = useTranslation()

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('workspace.context.dialog.title')}
      width={640}
      footer={(
        <Button type="button" variant="secondary" size="sm" onClick={onClose}>
          {t('common.close')}
        </Button>
      )}
    >
      <div className="space-y-5">
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
            {t('workspace.context.dialog.workspace')}
          </div>
          <p className="mb-3 text-[12px] leading-5 text-[var(--color-text-secondary)]">
            {t('workspace.context.dialog.description')}
          </p>
          <div
            role="listbox"
            aria-label={t('workspace.context.dialog.workspace')}
            className="space-y-1.5"
          >
            {projectOptions.length === 0 ? (
              <div className="rounded-[10px] border border-dashed border-[var(--color-border-separator)] px-3 py-4 text-[12px] text-[var(--color-text-tertiary)]">
                {t('workspace.context.dialog.noWorkspaces')}
              </div>
            ) : (
              projectOptions.map((project) => {
                const selected = project.path === currentProjectPath
                return (
                  <button
                    key={project.path}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    data-testid={'workspace-option-' + project.path}
                    onClick={() => onSelectProject(project.path)}
                    className={
                      'flex w-full items-center gap-3 rounded-[10px] border px-3 py-2.5 text-left transition-colors ' +
                      (selected
                        ? 'border-[var(--color-border-focus)] bg-[var(--color-accent-glow)]'
                        : 'border-[var(--color-border-separator)] bg-[var(--color-surface-container)] hover:bg-[var(--color-surface-hover)]')
                    }
                  >
                    <Icon name="folder_open" size={14} className="shrink-0 text-[var(--color-text-tertiary)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-semibold text-[var(--color-text-primary)]">
                        {project.name}
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[10px] text-[var(--color-text-tertiary)]">
                        {project.path}
                      </span>
                    </span>
                    <span className="shrink-0 text-[10px] text-[var(--color-text-tertiary)]">
                      {project.sessionCount}
                    </span>
                    {selected && <Icon name="check" size={14} className="shrink-0 text-[var(--color-brand)]" />}
                  </button>
                )
              })
            )}
          </div>
          <p className="mt-2 text-[10px] text-[var(--color-text-tertiary)]">
            {t('workspace.context.dialog.workspaceHint')}
          </p>
        </div>

        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
            {t('workspace.context.dialog.resourceStatus')}
          </div>
          <div className="space-y-2">
            <ResourceRow
              icon="dns"
              label={t('workspace.context.backend')}
              resource={context.backend}
              state={resources.backend.state}
              error={resources.backend.error}
              lastCheckedAt={resources.backend.lastCheckedAt}
              onRetry={() => onRetryResource('backend')}
            />
            <ResourceRow
              icon="folder_open"
              label={t('workspace.context.repository')}
              resource={context.repository}
              state={resources.repositories.state}
              error={resources.repositories.error}
              lastCheckedAt={resources.repositories.lastCheckedAt}
              onRetry={() => onRetryResource('repositories')}
            />
            <ResourceRow
              icon="package"
              label={t('workspace.context.sandbox')}
              resource={context.sandbox}
              state={resources.sandboxes.state}
              error={resources.sandboxes.error}
              lastCheckedAt={resources.sandboxes.lastCheckedAt}
              onRetry={() => onRetryResource('sandboxes')}
            />
            <ResourceRow
              icon="smart_toy"
              label={t('workspace.context.agent')}
              resource={context.agentProfile}
              state={agentsLoading ? 'loading' : agentsError ? 'error' : 'ready'}
              error={agentsError}
              lastCheckedAt={agentsLastCheckedAt}
              onRetry={onRetryAgents}
            />
          </div>
        </div>
      </div>
    </Modal>
  )
}
