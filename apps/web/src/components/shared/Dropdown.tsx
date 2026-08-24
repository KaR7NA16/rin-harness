import { useState, useRef, useEffect, type ReactNode } from 'react'
import { Icon } from './Icon'

type DropdownItem<T extends string> = {
  value: T
  label: string
  description?: string
  icon?: ReactNode
}

type DropdownProps<T extends string> = {
  items: DropdownItem<T>[]
  value: T
  onChange: (value: T) => void
  trigger: ReactNode
  width?: string | number
  align?: 'left' | 'right'
  className?: string
}

export function Dropdown<T extends string>({
  items,
  value,
  onChange,
  trigger,
  width = 320,
  align = 'left',
  className = '',
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
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

  // Focus the selected (or first) option when the menu opens.
  useEffect(() => {
    if (!open) return
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('button')
    if (!items || items.length === 0) return
    const selectedIdx = Array.from(items).findIndex((b) => b.dataset.value === value)
    ;(items[selectedIdx >= 0 ? selectedIdx : 0] ?? items[0])?.focus()
  }, [open, value])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return
    const items = menuRef.current ? Array.from(menuRef.current.querySelectorAll<HTMLButtonElement>('button')) : []
    if (items.length === 0) return
    const current = document.activeElement
    const idx = items.indexOf(current as HTMLButtonElement)
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        items[idx === -1 ? 0 : (idx + 1) % items.length]?.focus()
        break
      case 'ArrowUp':
        e.preventDefault()
        items[idx === -1 ? items.length - 1 : (idx - 1 + items.length) % items.length]?.focus()
        break
      case 'Home':
        e.preventDefault()
        items[0]?.focus()
        break
      case 'End':
        e.preventDefault()
        items[items.length - 1]?.focus()
        break
      case 'Enter':
      case ' ':
        if (idx !== -1) {
          e.preventDefault()
          ;(current as HTMLButtonElement).click()
        }
        break
      case 'Escape':
        e.preventDefault()
        setOpen(false)
        break
    }
  }

  return (
    <div ref={ref} className={`relative ${className || 'inline-block'}`} onKeyDown={handleKeyDown}>
      <div onClick={() => setOpen(!open)} className="cursor-pointer" aria-haspopup="listbox" aria-expanded={open}>
        {trigger}
      </div>

      {open && (
        <div
          ref={menuRef}
          className={`
            absolute z-50 mt-1.5 overflow-hidden rounded-xl
            bg-[var(--color-background)] border border-[var(--color-border-separator)]
            shadow-[var(--shadow-dropdown)] animate-slide-down
            ${align === 'right' ? 'right-0' : 'left-0'}
          `}
          style={{ width }}
        >
          {items.map((item, i) => (
            <button
              key={item.value}
              data-value={item.value}
              onClick={() => { onChange(item.value); setOpen(false) }}
              className={`
                w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors
                hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:bg-[var(--color-surface-hover)]
                ${item.value === value ? 'bg-[var(--color-surface-selected)]' : ''}
                ${i > 0 ? 'border-t border-[var(--color-border-separator)]' : ''}
              `}
            >
              {item.icon && <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-[var(--color-text-tertiary)]">{item.icon}</span>}
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold tracking-[-0.01em] text-[var(--color-text-primary)]">{item.label}</div>
                {item.description && (
                  <div className="text-[11px] text-[var(--color-text-tertiary)] mt-0.5">{item.description}</div>
                )}
              </div>
              {item.value === value && (
                <Icon name="check" size={14} className="shrink-0 text-[var(--color-text-tertiary)]" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
