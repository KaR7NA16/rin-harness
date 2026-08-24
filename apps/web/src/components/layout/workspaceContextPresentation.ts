import type { TranslationKey } from '../../i18n'
import type { WorkspaceContextStatus } from '../../types/workspace'

export const WORKSPACE_CONTEXT_STATUS_KEYS: Record<WorkspaceContextStatus, TranslationKey> = {
  declared: 'workspace.context.status.declared',
  available: 'workspace.context.status.available',
  configured: 'workspace.context.status.configured',
  installed: 'workspace.context.status.installed',
  mounted: 'workspace.context.status.mounted',
  active: 'workspace.context.status.active',
  failed: 'workspace.context.status.failed',
  unavailable: 'workspace.context.status.unavailable',
  unknown: 'workspace.context.status.unknown',
}

export const WORKSPACE_CONTEXT_STATUS_CLASSES: Record<WorkspaceContextStatus, string> = {
  declared: 'bg-[var(--color-text-tertiary)]',
  available: 'bg-[var(--color-info)]',
  configured: 'bg-[var(--color-brand)]',
  installed: 'bg-[var(--color-brand)]',
  mounted: 'bg-[var(--color-brand)]',
  active: 'bg-[var(--color-success)]',
  failed: 'bg-[var(--color-error)]',
  unavailable: 'bg-[var(--color-warning)]',
  unknown: 'bg-[var(--color-text-tertiary)]/60',
}
