import { useState, useRef, useEffect } from 'react'
import {
  Check,
  ChevronUp,
  Shield,
  ShieldAlert,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useChatStore } from '../../stores/chatStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTabStore } from '../../stores/tabStore'
import { useTranslation } from '../../i18n'
import type { PermissionMode } from '../../types/settings'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { Tooltip } from '../shared/Tooltip'

const MODE_ICONS: Record<PermissionMode, LucideIcon> = {
  'read-only': Shield,
  'workspace-write': ShieldCheck,
  'danger-full-access': ShieldAlert,
}

type Props = {
  workDir?: string
  /** Controlled mode: override current value */
  value?: PermissionMode
  /** Controlled mode: called on change instead of updating global store */
  onChange?: (mode: PermissionMode) => void
  variant?: 'pill' | 'icon'
}

export function PermissionModeSelector({ workDir: workDirProp, value, onChange, variant = 'pill' }: Props = {}) {
  const t = useTranslation()
  const { permissionMode: storeMode, setPermissionMode } = useSettingsStore()
  const setSessionPermissionMode = useChatStore((s) => s.setSessionPermissionMode)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const sessions = useSessionStore((s) => s.sessions)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const [open, setOpen] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const isControlled = value !== undefined
  const currentMode = isControlled ? value : storeMode
  const isIconVariant = variant === 'icon'

  const PERMISSION_ITEMS: Array<{
    value: PermissionMode
    label: string
    description: string
    icon: LucideIcon
    color?: string
  }> = [
    {
      value: 'read-only',
      label: t('permMode.readOnly'),
      description: t('permMode.readOnlyDesc'),
      icon: Shield,
    },
    {
      value: 'workspace-write',
      label: t('permMode.workspaceWrite'),
      description: t('permMode.workspaceWriteDesc'),
      icon: ShieldCheck,
    },
    {
      value: 'danger-full-access',
      label: t('permMode.dangerFullAccess'),
      description: t('permMode.dangerFullAccessDesc'),
      icon: ShieldAlert,
      color: 'text-[var(--color-error)]',
    },
  ]

  const MODE_LABELS: Record<PermissionMode, string> = {
    'read-only': t('permMode.label.readOnly'),
    'workspace-write': t('permMode.label.workspaceWrite'),
    'danger-full-access': t('permMode.label.dangerFullAccess'),
  }

  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const workDir = workDirProp || activeSession?.workDir || '~'
  const CurrentModeIcon = MODE_ICONS[currentMode] ?? ShieldCheck
  const isDangerMode = currentMode === 'danger-full-access'

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={MODE_LABELS[currentMode]}
        title={isIconVariant ? MODE_LABELS[currentMode] : undefined}
        className={isIconVariant
          ? `group relative flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border transition-colors duration-100 ${
              isDangerMode
                ? 'border-[var(--color-error)]/40 text-[var(--color-error)] hover:bg-[var(--color-error)]/10'
                : open
                  ? 'border-[var(--color-border-separator)] bg-[var(--color-surface-hover)] text-[var(--color-text-primary)]'
                  : 'border-transparent text-[var(--color-text-tertiary)] hover:border-[var(--color-border-separator)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
            }`
          : 'flex h-[36px] items-center gap-[6px] rounded-full border border-[var(--color-border)] bg-[var(--color-surface-container)] px-[14px] text-[13px] font-bold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'}
      >
        <CurrentModeIcon size={isIconVariant ? 18 : 16} strokeWidth={2.15} />
        {isIconVariant ? (
          !open && <Tooltip label={MODE_LABELS[currentMode]} />
        ) : (
          <>
            <span>{MODE_LABELS[currentMode]}</span>
            <ChevronUp size={14} strokeWidth={2.2} />
          </>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-[140] mb-[10px] w-[320px] overflow-hidden rounded-[24px] border-2 border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-[8px] shadow-[var(--shadow-dropdown)]">
          <div className="flex items-center gap-[10px] px-[10px] py-[8px]">
            <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border border-[var(--color-border-separator)] bg-[var(--color-surface-container)] text-[var(--color-text-secondary)]">
              <ShieldCheck size={16} strokeWidth={2.1} />
            </div>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold leading-tight text-[var(--color-text-primary)]">
                {t('permMode.executionPermissions')}
              </div>
              <div className="mt-[2px] text-[11px] font-medium leading-tight text-[var(--color-text-tertiary)]">
                {MODE_LABELS[currentMode]}
              </div>
            </div>
          </div>

          <div className="space-y-[4px]">
            {PERMISSION_ITEMS.map((item) => {
              const ItemIcon = item.icon
              const isSelected = item.value === currentMode
              return (
                <button
                  key={item.value}
                  onClick={() => {
                    if (item.value === 'danger-full-access') {
                      setOpen(false)
                      setConfirmDialog(true)
                      return
                    }
                    if (isControlled) {
                      onChange?.(item.value)
                    } else {
                      void setPermissionMode(item.value)
                      if (activeTabId) setSessionPermissionMode(activeTabId, item.value)
                    }
                    setOpen(false)
                  }}
                  className={`
                    group flex min-h-[64px] w-full items-center gap-[10px] rounded-[16px] px-[10px] py-[9px] text-left transition-colors
                    ${isSelected ? 'bg-[var(--color-surface-selected)]' : 'hover:bg-[var(--color-surface-hover)]'}
                  `}
                >
                  <div className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border border-[var(--color-border-separator)] bg-[var(--color-surface-container)] ${item.color || 'text-[var(--color-text-secondary)]'}`}>
                    <ItemIcon size={17} strokeWidth={2.05} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-[13px] ${isSelected ? 'font-semibold text-[var(--color-text-primary)]' : 'font-medium text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]'}`}>
                      {item.label}
                    </div>
                    <div className="mt-[2px] line-clamp-2 text-[11px] font-medium leading-[1.35] text-[var(--color-text-tertiary)]">
                      {item.description}
                    </div>
                  </div>
                  {isSelected && (
                    <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[var(--color-text-primary)] text-[var(--color-background)]">
                      <Check size={13} strokeWidth={2.4} />
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDialog}
        onClose={() => setConfirmDialog(false)}
        onConfirm={() => {
          if (isControlled) {
            onChange?.('danger-full-access')
          } else {
            void setPermissionMode('danger-full-access')
            if (activeTabId) setSessionPermissionMode(activeTabId, 'danger-full-access')
          }
          setConfirmDialog(false)
        }}
        title={t('permMode.enableBypassTitle')}
        body={t('permMode.enableBypassConfirmBody', { workDir })}
        confirmLabel={t('permMode.enableBypassBtn')}
        cancelLabel={t('common.cancel')}
        confirmVariant="danger"
      />
    </div>
  )
}
