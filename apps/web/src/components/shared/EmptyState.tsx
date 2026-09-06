import type { ReactNode } from 'react'

type EmptyStateProps = {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  /** Primary call-to-action rendered below the description. */
  action?: ReactNode
  /** Extra minimum height so the empty state anchors tall panels. */
  minHeight?: number
}

/**
 * Shared empty-state panel (icon + title + description + optional CTA),
 * following the 定时任务 empty-state pattern. Use it instead of bare
 * "暂无 X" lines so every empty view teaches the next action.
 */
export function EmptyState({ icon, title, description, action, minHeight = 260 }: EmptyStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-[16px] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-6 text-center"
      style={{ minHeight }}
    >
      {icon !== undefined && (
        <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-surface)] text-[var(--color-text-tertiary)]">
          {icon}
        </span>
      )}
      <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)]">{title}</h2>
      {description !== undefined && (
        <p className="mt-2 max-w-[420px] text-[13px] leading-5 text-[var(--color-text-tertiary)]">{description}</p>
      )}
      {action !== undefined && <div className="mt-5 flex gap-2">{action}</div>}
    </div>
  )
}
