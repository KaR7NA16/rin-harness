import type { ReactNode } from 'react'

type PageHeaderProps = {
  /** Small uppercase section label rendered above the title. */
  eyebrow?: ReactNode
  /** Optional leading icon rendered inside the eyebrow row. */
  eyebrowIcon?: ReactNode
  title: ReactNode
  description?: ReactNode
  /** Right-aligned action buttons. */
  actions?: ReactNode
}

/**
 * Shared workspace page header: eyebrow label, title, description, and a
 * right-aligned action area. One consistent header pattern for every
 * workspace view (仓库 / Agent 配置 / 记忆中心 / …).
 */
export function PageHeader({ eyebrow, eyebrowIcon, title, description, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow !== undefined && (
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-signal)]">
            {eyebrowIcon}
            {eyebrow}
          </div>
        )}
        <h1 className={`text-[22px] font-semibold text-[var(--color-text-primary)] ${eyebrow !== undefined ? 'mt-1' : ''}`}>
          {title}
        </h1>
        {description !== undefined && (
          <p className="mt-1 max-w-[720px] text-[13px] leading-5 text-[var(--color-text-tertiary)]">{description}</p>
        )}
      </div>
      {actions !== undefined && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}
