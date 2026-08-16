import { lazy, Suspense, useEffect, useRef } from 'react'
import { useUIStore } from '../../stores/uiStore'
import { useTranslation } from '../../i18n'

const Settings = lazy(() => import('../../pages/Settings').then((module) => ({ default: module.Settings })))

type Props = {
  visible: boolean
  reserveRightRail?: boolean
}

export function SettingsPanel({ visible, reserveRightRail = false }: Props) {
  const closeSettings = useUIStore((s) => s.closeSettings)
  const t = useTranslation()
  const panelRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!visible) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.focus()
    return () => previousFocus?.focus()
  }, [visible])

  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Defer to any open modal dialog so ESC closes the modal first
      const childDialogOpen = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'))
        .some((dialog) => dialog !== panelRef.current)
      if (childDialogOpen) return
      closeSettings()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, closeSettings])

  if (!visible) return null
  return (
    <section
      role="dialog"
      aria-modal="true"
      ref={panelRef}
      tabIndex={-1}
      aria-label={t('sidebar.settings')}
      data-testid="settings-panel"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeSettings()
      }}
      className={`settings-ui settings-panel-overlay native-ui-text absolute bottom-0 left-0 top-0 z-[90] flex flex-col items-center justify-center bg-black/10 p-[16px] dark:bg-black/45 ${reserveRightRail ? 'right-[var(--sidebar-rail-width)]' : 'right-0'}`}
    >
      <div className="settings-panel-card flex h-[88vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-[14px] border border-[var(--color-border-separator)] bg-[var(--color-background)] shadow-[var(--shadow-window)]">
        <div className="min-h-0 flex-1 flex flex-col overflow-hidden">
          <div key="settings-home" className="settings-panel-content min-h-0 flex flex-1 flex-col overflow-hidden">
            <Suspense fallback={<div className="flex h-full items-center justify-center text-[13px] text-[var(--color-text-tertiary)]">Loading settings...</div>}>
              <Settings />
            </Suspense>
          </div>
        </div>
      </div>
    </section>
  )
}
