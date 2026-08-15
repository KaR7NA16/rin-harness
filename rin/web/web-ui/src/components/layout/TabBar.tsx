import { useTranslation } from '../../i18n'
import { useTabStore, type Tab } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'
import { WindowControls } from './WindowControls'
import { Icon } from '../shared/Icon'

const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)

function TabStatusDot({ status }: { status: Tab['status'] }) {
  if (status === 'running') {
    return <span className="h-[6px] w-[6px] shrink-0 animate-pulse rounded-full bg-[var(--color-info)]" />
  }
  if (status === 'error') {
    return <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-[var(--color-error)]" />
  }
  return null
}

export function TabBar() {
  const t = useTranslation()
  const tabs = useTabStore((s) => s.tabs)
  const workspaceView = useUIStore((s) => s.workspaceView)
  const workObjectTabs = tabs.filter((tab) => tab.type === 'session' || tab.type === 'terminal')
  const activeTabId = useTabStore((s) => s.activeTabId)
  const setActiveTab = useTabStore((s) => s.setActiveTab)
  const closeTab = useTabStore((s) => s.closeTab)
  const goBack = useTabStore((s) => s.goBack)
  const goForward = useTabStore((s) => s.goForward)
  const canGoBack = useTabStore((s) => s.navIndex >= 1)
  const canGoForward = useTabStore((s) => s.navIndex >= 0 && s.navIndex < s.navHistory.length - 1)

  const navButtonClass = 'flex h-[28px] w-[28px] items-center justify-center rounded-[8px] text-[var(--color-text-tertiary)] transition-colors duration-100 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]'

  return (
    <div
      data-testid="tab-bar"
      className="native-ui-text flex relative h-[76px] w-full shrink-0 select-none items-center border-b border-[var(--color-border-separator)] bg-[var(--color-background)] px-[24px] md:px-[32px]"
    >
      {/* Back/forward navigation */}
      <div className="flex shrink-0 items-center gap-[4px]" onMouseDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          aria-label={t('tabBar.goBack')}
          title={t('tabBar.goBack')}
          disabled={!canGoBack}
          onClick={goBack}
          className={navButtonClass}
        >
          <Icon name="chevron_left" size={18} />
        </button>
        <button
          type="button"
          aria-label={t('tabBar.goForward')}
          title={t('tabBar.goForward')}
          disabled={!canGoForward}
          onClick={goForward}
          className={navButtonClass}
        >
          <Icon name="chevron_right" size={18} />
        </button>
      </div>

      {/* Tab strip + drag area */}
      <div className="flex h-full min-w-0 flex-1 items-center gap-[4px]">
        {workObjectTabs.map((tab) => {
          const isActive = workspaceView === null && tab.sessionId === activeTabId
          const closeLabel = `${t('tabs.close')} ${tab.title}`
          return (
            <div
              key={tab.sessionId}
              data-testid={`tab-item-${tab.sessionId}`}
              className="group flex h-full shrink-0 items-center"
            >
              <div
                className={`flex h-[40px] max-w-[220px] items-center rounded-[10px] border transition-colors duration-100 ${
                  isActive
                    ? 'border-[var(--color-border-separator)] bg-[var(--color-surface-container)]'
                    : 'border-transparent hover:bg-[var(--color-surface-hover)]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setActiveTab(tab.sessionId)}
                  title={tab.title}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex h-full min-w-0 items-center gap-[8px] pl-[12px] pr-[4px] text-[13px] ${
                    isActive
                      ? 'font-semibold text-[var(--color-text-primary)]'
                      : 'font-medium text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]'
                  }`}
                >
                  <TabStatusDot status={tab.status} />
                  <span className="truncate">{tab.title}</span>
                </button>
                <button
                  type="button"
                  onClick={() => closeTab(tab.sessionId, tab.projectPath)}
                  aria-label={closeLabel}
                  title={closeLabel}
                  className={`mr-[6px] flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full transition-colors duration-100 hover:bg-[var(--color-surface-container-highest)] hover:text-[var(--color-text-primary)] ${
                    isActive
                      ? 'text-[var(--color-text-tertiary)] opacity-100'
                      : 'text-[var(--color-text-tertiary)] opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                  }`}
                >
                  <Icon name="close_one" size={13} />
                </button>
              </div>
            </div>
          )
        })}
        {/* Remaining space doubles as the window drag gutter */}
        <div
          data-testid="tab-bar-drag-gutter"
          className="h-full min-w-[24px] flex-1 self-stretch"
          {...(isTauri ? { 'data-tauri-drag-region': true } : {})}
        />
      </div>

      {/* Right: Window controls */}
      <div className="flex shrink-0 items-center gap-[12px]" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-[12px] text-[13px] font-medium text-[var(--color-text-tertiary)]">
          <WindowControls />
        </div>
      </div>
    </div>
  )
}
