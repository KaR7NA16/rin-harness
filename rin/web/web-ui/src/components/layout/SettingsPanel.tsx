import { lazy, Suspense, useEffect, useRef } from 'react'
import { useUIStore } from '../../stores/uiStore'
import { useTranslation } from '../../i18n'

const Settings = lazy(() => import('../../pages/Settings').then((module) => ({ default: module.Settings })))

type Props = {
  visible: boolean
}

/**
 * macOS System Settings 式全屏 sheet。
 *
 * 覆盖整个内容区（TabBar / ContentRouter / StatusBar），左侧 Sidebar 保持可见可点；
 * 无遮罩、无圆角浮层 —— 设置是一个"窗口级"体验，而非模态弹窗。
 */
export function SettingsPanel({ visible }: Props) {
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
      className="settings-ui settings-panel-sheet native-ui-text absolute inset-0 z-[90] flex flex-col overflow-hidden bg-[var(--color-background)]"
    >
      <Suspense fallback={<div className="flex h-full items-center justify-center text-[13px] text-[var(--color-text-tertiary)]">Loading settings...</div>}>
        <div key="settings-home" className="settings-panel-content flex min-h-0 flex-1 flex-col overflow-hidden">
          <Settings />
        </div>
      </Suspense>
    </section>
  )
}
