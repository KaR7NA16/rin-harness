import { useState } from 'react'
import { useTranslation } from '../../i18n'
import { Icon } from '../shared/Icon'

type InitializedSectionProps = {
  tools: string[]
}

/** Collapsed "Initialized your session" section shown at the top of a session,
 * listing the tools and skills the CLI registered during startup. */
export function InitializedSection({ tools }: InitializedSectionProps) {
  const t = useTranslation()
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="flex w-full justify-center px-[24px] py-[8px]">
      <div data-chat-content-column className="w-full max-w-[878px]">
        <div className="overflow-hidden rounded-[12px] border border-[var(--color-border-separator)] bg-[var(--color-surface-container)]">
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)]/50"
          >
            <Icon name={expanded ? 'expand_less' : 'expand_more'} size={14} className="shrink-0 text-[var(--color-outline)]" />
            <span className="flex-1 truncate font-medium text-[var(--color-text-secondary)]">
              {t('chat.initializedSection')}
            </span>
            <span className="label-micro text-[var(--color-text-tertiary)]">
              {tools.length}
            </span>
            <Icon name="check_circle" size={14} className="shrink-0 text-[var(--color-success)]" />
          </button>

          {expanded && (
            <div className="border-t border-[var(--color-border-separator)] px-3 py-2">
              <div className="flex flex-wrap gap-1.5">
                {tools.map((tool) => (
                  <span
                    key={tool}
                    className="rounded-full border border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--color-text-secondary)]"
                  >
                    {tool}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}