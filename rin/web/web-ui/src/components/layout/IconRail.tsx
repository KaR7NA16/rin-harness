import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from 'react'
import { useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'
import { useTranslation } from '../../i18n'
import { Icon, type IconName } from '../shared/Icon'

const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
const isWindows = typeof navigator !== 'undefined' && /Win/.test(navigator.platform)
const RAIL_BUTTON_SIZE = 46
const RAIL_BUTTON_GAP = 24
const RAIL_DRAG_SPACER_HEIGHT = 32

type RailActionItem = {
  key: string
  label: string
  icon: IconName
  active: boolean
  onClick: () => void
}

type IconRailProps = {
  /** jsdom does not do flex layout, so tests can pin the measured top area height. */
  __testTopRailHeight?: number | null
}

export function getVisibleRailItemCount(
  availableHeight: number | null,
  directItemCount: number,
  overflowItemCount: number,
  hasDragSpacer: boolean,
) {
  if (availableHeight === null || availableHeight <= 0) return directItemCount

  const requiresMoreButton = overflowItemCount > 0
  for (let visibleCount = directItemCount; visibleCount >= 0; visibleCount -= 1) {
    const hiddenDirectCount = directItemCount - visibleCount
    const hasMoreButton = requiresMoreButton || hiddenDirectCount > 0
    if (getRailStackHeight(visibleCount, hasMoreButton, hasDragSpacer) <= availableHeight) {
      return visibleCount
    }
  }

  return 0
}

function getRailStackHeight(visibleDirectCount: number, hasMoreButton: boolean, hasDragSpacer: boolean) {
  const childCount = visibleDirectCount + (hasMoreButton ? 1 : 0) + (hasDragSpacer ? 1 : 0)
  if (childCount <= 0) return 0

  return (
    visibleDirectCount * RAIL_BUTTON_SIZE
    + (hasMoreButton ? RAIL_BUTTON_SIZE : 0)
    + (hasDragSpacer ? RAIL_DRAG_SPACER_HEIGHT : 0)
    + (childCount - 1) * RAIL_BUTTON_GAP
  )
}

export function IconRail({ __testTopRailHeight }: IconRailProps = {}) {
  const settingsOpen = useUIStore((s) => s.settingsOpen)
  const openTerminalTab = useTabStore((s) => s.openTerminalTab)
  const workspaceView = useUIStore((s) => s.workspaceView)
  const openWorkspaceView = useUIStore((s) => s.openWorkspaceView)
  const openSettings = useUIStore((s) => s.openSettings)
  const closeSettings = useUIStore((s) => s.closeSettings)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const t = useTranslation()
  const [topRailRef, topRailHeight] = useMeasuredElementHeight<HTMLDivElement>()
  const hasDragSpacer = isTauri && !isWindows

  const handleGeneralSettings = useCallback(() => {
    if (settingsOpen) {
      closeSettings()
    } else {
      openSettings('settings')
    }
  }, [settingsOpen, openSettings, closeSettings])

  const directItems = useMemo<RailActionItem[]>(() => [
    {
      key: 'sidebar',
      active: sidebarOpen,
      label: sidebarOpen ? t('sidebar.collapse') : t('sidebar.expand'),
      onClick: toggleSidebar,
      icon: 'view_column',
    },
    {
      key: 'notes',
      active: workspaceView === 'notes' || workspaceView === 'codeGraph',
      label: t('sidebar.notes'),
      onClick: () => openWorkspaceView('notes'),
      icon: 'notes',
    },
    {
      key: 'files',
      active: workspaceView === 'files',
      label: t('files.title'),
      onClick: () => openWorkspaceView('files'),
      icon: 'folder',
    },
    {
      key: 'scheduled',
      active: workspaceView === 'scheduled',
      label: t('sidebar.scheduled'),
      onClick: () => openWorkspaceView('scheduled'),
      icon: 'schedule',
    },
    {
      key: 'sandbox',
      active: workspaceView === 'sandbox' || workspaceView === 'monitor',
      label: t('sandbox.title'),
      onClick: () => openWorkspaceView('sandbox'),
      icon: 'package',
    },
    {
      key: 'repository',
      active: workspaceView === 'repository' || workspaceView === 'agents',
      label: t('sidebar.repository'),
      onClick: () => openWorkspaceView('repository'),
      icon: 'folder_open',
    },
  ], [sidebarOpen, workspaceView, t, toggleSidebar, openWorkspaceView])

  const overflowItems = useMemo<RailActionItem[]>(() => [
    {
      key: 'terminal',
      active: false,
      label: t('sidebar.terminal'),
      onClick: () => openTerminalTab(),
      icon: 'terminal',
    },
    {
      key: 'codeGraph',
      active: workspaceView === 'codeGraph',
      label: t('knowledgeSpace.title'),
      onClick: () => openWorkspaceView('codeGraph'),
      icon: 'account_tree',
    },
    {
      key: 'agents',
      active: workspaceView === 'agents',
      label: t('sidebar.agentConfiguration'),
      onClick: () => openWorkspaceView('agents'),
      icon: 'smart_toy',
    },
    {
      key: 'monitor',
      active: workspaceView === 'monitor',
      label: t('monitor.title'),
      onClick: () => openWorkspaceView('monitor'),
      icon: 'analytics',
    },
  ], [workspaceView, t, openTerminalTab, openWorkspaceView])

  const visibleDirectCount = getVisibleRailItemCount(
    __testTopRailHeight === undefined ? topRailHeight : __testTopRailHeight,
    directItems.length,
    overflowItems.length,
    hasDragSpacer,
  )
  const visibleDirectItems = directItems.slice(0, visibleDirectCount)
  const overflowDirectItems = directItems.slice(visibleDirectCount)
  const moreItems = [...overflowDirectItems, ...overflowItems]

  return (
    <div
      className="icon-rail-glass relative z-[80] flex h-full shrink-0 select-none flex-col items-center overflow-visible border-l border-[var(--color-border-separator)] py-[20px] text-[var(--color-text-tertiary)]"
      style={{ width: 'var(--sidebar-rail-width)' }}
      data-tauri-drag-region
    >
      <div ref={topRailRef} className="flex min-h-0 w-full flex-1 flex-col items-center gap-[24px] overflow-visible">
        {hasDragSpacer && (
          <div className="h-[32px] w-full shrink-0" data-tauri-drag-region />
        )}

        {visibleDirectItems.map((item, index) => (
          <Fragment key={item.key}>
            {index === 1 && <div aria-hidden="true" className="h-px w-[26px] shrink-0 bg-[var(--color-border-separator)]" />}
            <RailButton active={item.active} label={item.label} onClick={item.onClick} icon={item.icon} />
          </Fragment>
        ))}

        {moreItems.length > 0 && (
          <MoreRailMenu
            active={moreItems.some((item) => item.active)}
            items={moreItems}
          />
        )}
      </div>

      <div className="mt-[24px] flex shrink-0 flex-col items-center gap-[24px]">
        <RailButton active={settingsOpen} label={t('sidebar.settings')} onClick={handleGeneralSettings} icon="settings" />
      </div>
    </div>
  )
}

function MoreRailMenu({
  active,
  items,
}: {
  active: boolean
  items: RailActionItem[]
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const t = useTranslation()

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={t('sidebar.more')}
        aria-expanded={open}
        aria-haspopup="menu"
        data-active={active ? 'true' : 'false'}
        className={`group relative flex h-[46px] w-[46px] items-center justify-center overflow-visible rounded-full transition-colors duration-100 ${
          active || open
            ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-selected)]'
            : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
        }`}
      >
        <Icon name="more_horiz" size={22} />
        {!open && <RailTooltip label={t('sidebar.more')} />}
      </button>

      {open && (
        <div
          className="absolute right-[calc(100%+10px)] top-1/2 z-[110] max-h-[calc(100vh-24px)] w-[168px] -translate-y-1/2 overflow-y-auto rounded-[12px] border border-[var(--color-border-separator)] bg-[var(--color-surface-container-lowest)] p-1 shadow-[var(--shadow-dropdown)]"
          role="menu"
        >
          {items.map((item) => {
            return (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  item.onClick()
                }}
                className={`flex h-[36px] w-full items-center gap-2.5 rounded-[9px] px-3 text-left text-[13px] font-medium transition-colors duration-100 ${
                  item.active
                    ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                <Icon name={item.icon} size={16} className="shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function useMeasuredElementHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [height, setHeight] = useState<number | null>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const measure = () => {
      const rect = element.getBoundingClientRect()
      const nextHeight = rect.height || element.clientHeight
      if (nextHeight <= 0) return

      setHeight((current) => {
        if (current !== null && Math.abs(current - nextHeight) < 0.5) return current
        return nextHeight
      })
    }

    measure()

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(measure)
      : null
    resizeObserver?.observe(element)
    window.addEventListener('resize', measure)

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  return [ref, height] as const
}

function RailButton({
  active,
  label,
  onClick,
  icon,
}: {
  active: boolean
  label: string
  onClick: () => void
  icon: IconName
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      data-active={active ? 'true' : 'false'}
      className={`group relative flex h-[46px] w-[46px] items-center justify-center overflow-visible transition-all duration-150 active:scale-[0.92] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] ${
        active
          ? 'rounded-[13px] bg-[var(--color-surface-selected)] text-[var(--color-text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.10),inset_0_0_0_1px_var(--color-border-separator)]'
          : 'rounded-full text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      {/* 左缘 accent 竖条 (对齐 rail 左缘) */}
      <span
        aria-hidden="true"
        className={`absolute right-[-13px] top-1/2 h-[20px] w-[3px] -translate-y-1/2 rounded-full bg-[var(--color-signal)] transition-all duration-150 ${
          active ? 'scale-y-100 opacity-100' : 'scale-y-0 opacity-0'
        }`}
      />
      <Icon name={icon} size={22} />
      <RailTooltip label={label} />
    </button>
  )
}

function RailTooltip({ label }: { label: string }) {
  return (
    <span className="pointer-events-none absolute right-[calc(100%+10px)] top-1/2 z-[100] min-w-max max-w-[calc(100vw-96px)] -translate-y-1/2 whitespace-nowrap rounded-[10px] bg-[var(--color-inverse-surface)] px-[10px] py-[6px] text-[12px] font-semibold leading-none text-[var(--color-inverse-on-surface)] opacity-0 shadow-[0_8px_20px_rgba(0,0,0,0.12)] transition-[opacity,transform] duration-100 group-hover:-translate-x-[2px] group-hover:opacity-100 group-focus-visible:-translate-x-[2px] group-focus-visible:opacity-100">
      {label}
    </span>
  )
}
