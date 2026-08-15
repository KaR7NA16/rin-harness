import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from '../../i18n'
import { Button } from './Button'
import { Icon } from './Icon'

type ConfirmDialogProps = {
  open: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
  title: string
  body: string
  confirmLabel: string
  cancelLabel: string
  confirmVariant?: 'primary' | 'danger'
  loading?: boolean
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel,
  cancelLabel,
  confirmVariant = 'primary',
  loading = false,
}: ConfirmDialogProps) {
  const t = useTranslation()
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const buttons = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])')
    const cancelButton = buttons && buttons.length >= 2 ? buttons[buttons.length - 2] : buttons?.[0]
    cancelButton?.focus()
    return () => previousFocus?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) onClose()
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [loading, onClose, open])

  if (!open) return null

  const handleClose = loading ? () => {} : onClose

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return
    const dialog = dialogRef.current
    if (!dialog) return
    const focusable = dialog.querySelectorAll<HTMLElement>('button:not([disabled])')
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!first || !last) return
    if (!dialog.contains(document.activeElement)) {
      event.preventDefault()
      first.focus()
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    createPortal(
      <div className="settings-ui native-ui-text fixed inset-0 z-[200] flex items-center justify-center p-6 animate-fade-in">
        <div
          className="absolute inset-0 bg-[var(--color-overlay-scrim)] opacity-70"
          onClick={handleClose}
        />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onKeyDown={handleKeyDown}
          className="relative flex w-full max-w-[360px] flex-col overflow-hidden rounded-[8px] border border-[var(--color-border-separator)] bg-[var(--color-surface-container-lowest)] shadow-[var(--shadow-dropdown)] animate-modal-in"
        >
          <div className="flex items-start justify-between gap-4 px-4 pb-3 pt-4">
            <div className="min-w-0">
              <h2 className="text-[14px] font-semibold leading-5 text-[var(--color-text-primary)]">
                {title}
              </h2>
              <p className="mt-1.5 text-[12px] leading-5 text-[var(--color-text-secondary)]">
                {body}
              </p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              aria-label={t('common.close')}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-[var(--color-text-tertiary)] transition-colors duration-100 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-40"
            >
              <Icon name="close" size={13} />
            </button>
          </div>
          <div className="flex justify-end gap-2 px-4 pb-4 pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={loading}
              className="h-[32px] rounded-[6px] px-3 shadow-none"
            >
              {cancelLabel}
            </Button>
            <Button
              variant={confirmVariant}
              size="sm"
              onClick={() => void onConfirm()}
              loading={loading}
              className="h-[32px] rounded-[6px] px-3 shadow-none"
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>,
      document.body,
    )
  )
}
