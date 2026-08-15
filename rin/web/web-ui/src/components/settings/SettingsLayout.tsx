import type { ReactNode } from 'react'
import { Icon } from '../shared/Icon'
import { useTranslation } from '../../i18n'
import { SETTINGS_SAVE_POLICIES, type SettingsSaveMode } from './settingsSavePolicy'

export function SettingsPage({
  title,
  description,
  icon,
  action,
  saveMode,
  children,
}: {
  title?: string
  description?: string
  icon?: string
  action?: ReactNode
  saveMode?: SettingsSaveMode
  children: ReactNode
}) {
  const t = useTranslation()
  const savePolicy = saveMode ? SETTINGS_SAVE_POLICIES[saveMode] : undefined
  const hasHeader = !!(title || description || action || savePolicy)
  return (
    <div className="settings-page flex w-full max-w-[760px] flex-col gap-[24px]">
      {hasHeader && (
        <header className="flex min-h-[48px] items-start justify-between gap-[16px]">
          <div className="flex min-w-0 items-start gap-[10px]">
            {icon && (
              <span className="mt-[1px] flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[8px] bg-[var(--color-surface-container-low)] text-[var(--color-text-secondary)]">
                <Icon name={icon} size={15} />
              </span>
            )}
            <div className="min-w-0">
              {title && (
                <h1 className="text-[17px] font-semibold leading-[24px] text-[var(--color-text-primary)]">
                  {title}
                </h1>
              )}
              {description && (
                <p className="mt-[4px] text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">
                  {description}
                </p>
              )}
              {savePolicy && (
                <span
                  className="mt-[7px] inline-flex rounded-full border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-[8px] py-[3px] text-[10px] font-semibold text-[var(--color-text-tertiary)]"
                  data-save-mode={saveMode}
                  title={t(savePolicy.description as never)}
                >
                  {t(savePolicy.label as never)}
                </span>
              )}
            </div>
          </div>
          {action && <div className="flex flex-shrink-0 items-center gap-[8px] pt-[2px]">{action}</div>}
        </header>
      )}
      {children}
    </div>
  )
}

export function SettingsSection({
  title,
  description,
  action,
  saveMode,
  children,
}: {
  title?: string
  description?: string
  action?: ReactNode
  saveMode?: SettingsSaveMode
  children: ReactNode
}) {
  const t = useTranslation()
  const savePolicy = saveMode ? SETTINGS_SAVE_POLICIES[saveMode] : undefined
  const hasHeader = !!(title || description || action || savePolicy)
  return (
    <section className="overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-container)]">
      {hasHeader && (
        <header className="flex min-h-[64px] items-center justify-between gap-[16px] border-b border-[var(--color-border-separator)] px-[20px] py-[12px]">
          <div className="min-w-0">
            {title && (
              <h2 className="text-[13px] font-semibold leading-[18px] text-[var(--color-text-primary)]">
                {title}
              </h2>
            )}
            {description && (
              <p className="mt-[4px] text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">
                {description}
              </p>
            )}
            {savePolicy && (
              <span
                className="mt-[6px] inline-flex rounded-full border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-[8px] py-[3px] text-[10px] font-semibold text-[var(--color-text-tertiary)]"
                data-save-mode={saveMode}
                title={t(savePolicy.description as never)}
              >
                {t(savePolicy.label as never)}
              </span>
            )}
          </div>
          {action && <div className="flex-shrink-0">{action}</div>}
        </header>
      )}
      <div className="divide-y divide-[var(--color-border-separator)]">
        {children}
      </div>
    </section>
  )
}

export function SettingsRow({
  label,
  hint,
  children,
  align = 'center',
  settingId,
}: {
  label?: string
  hint?: string
  children: ReactNode
  align?: 'center' | 'start'
  settingId?: string
}) {
  const hasLabel = !!(label || hint)
  return (
    <div
      className={`settings-row flex min-h-[64px] gap-[16px] px-[20px] py-[12px] ${align === 'start' ? 'items-start' : 'items-center'} ${hasLabel ? '' : 'justify-end'}`}
      data-setting-id={settingId}
    >
      {hasLabel && (
        <div className="min-w-0 flex-1">
          {label && (
            <div className="text-[13px] font-semibold leading-[18px] text-[var(--color-text-primary)]">
              {label}
            </div>
          )}
          {hint && (
            <p className="mt-[4px] text-[12px] leading-[18px] text-[var(--color-text-tertiary)]">
              {hint}
            </p>
          )}
        </div>
      )}
      <div className="settings-row-control flex-shrink-0">{children}</div>
    </div>
  )
}

export function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  itemTitle,
  itemBadge,
  disabled = false,
}: {
  items: Array<{ value: T; label: string }>
  value: T
  onChange: (next: T) => void
  ariaLabel?: string
  itemTitle?: (value: T) => string | undefined
  itemBadge?: (value: T) => ReactNode
  disabled?: boolean
}) {
  return (
    <div
      className="settings-segmented-control inline-flex h-[32px] items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-[3px]"
      role="group"
      aria-label={ariaLabel}
    >
      {items.map((item) => {
        const isActive = item.value === value
        const badge = itemBadge?.(item.value)
        return (
          <button
            key={item.value}
            type="button"
            disabled={disabled}
            aria-pressed={isActive}
            onClick={() => onChange(item.value)}
            title={itemTitle?.(item.value)}
            className={`flex h-[24px] min-w-[52px] cursor-pointer items-center justify-center gap-[6px] rounded-full px-[12px] text-[12px] font-semibold transition-colors duration-150 ${
              isActive
                ? 'bg-[var(--color-inverse-surface)] text-[var(--color-inverse-on-surface)] shadow-[0_3px_10px_rgba(0,0,0,0.10)]'
                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {item.label}
            {badge != null && badge !== false && (
              <span
                className={`min-w-[18px] rounded-[6px] px-[4px] text-center text-[10px] leading-[18px] ${
                  isActive
                    ? 'bg-[var(--color-inverse-on-surface)]/20 text-[var(--color-inverse-on-surface)]'
                    : 'bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)]'
                }`}
              >
                {badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  ariaLabel,
  disabled = false,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  ariaLabel?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[20px] w-[36px] items-center rounded-full transition-colors duration-200 focus:outline-none focus-visible:shadow-[var(--shadow-focus-ring)] disabled:cursor-not-allowed disabled:opacity-60 ${
        disabled ? '' : 'cursor-pointer'
      } ${
        checked ? 'bg-[var(--color-inverse-surface)]' : 'bg-[var(--color-border)]'
      }`}
    >
      <span
        className={`inline-block h-[16px] w-[16px] rounded-full bg-[var(--color-inverse-on-surface)] shadow-[0_2px_4px_rgba(0,0,0,0.20),0_1px_1px_rgba(0,0,0,0.04)] transition-transform duration-200 ${
          checked ? 'translate-x-[18px]' : 'translate-x-[2px]'
        }`}
      />
    </button>
  )
}
