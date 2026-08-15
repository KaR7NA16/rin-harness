import { useState } from 'react'
import { useTranslation } from '../i18n'
import { terminalApi } from '../api/terminal'
import { SplitTerminal } from '../components/terminal/SplitTerminal'
import { TerminalPane, type PaneStatus } from '../components/terminal/TerminalPane'
import { Icon } from '../components/shared/Icon'

type TerminalSettingsProps = {
  active?: boolean
  onNewTerminal?: () => void
  testId?: string
  workspace?: boolean
  /** 自定义启动命令 (如容器 exec); 缺省为本机默认 shell */
  spawnCommand?: string[]
}

export function TerminalSettings({
  active = true,
  onNewTerminal,
  testId = 'settings-terminal-host',
  workspace = false,
  spawnCommand,
}: TerminalSettingsProps = {}) {
  const t = useTranslation()
  const [available] = useState(() => terminalApi.isAvailable())
  const [paneStatus, setPaneStatus] = useState<PaneStatus>('idle')
  const [restartNonce, setRestartNonce] = useState(0)

  return (
    <div className={`flex h-full flex-col overflow-hidden ${workspace ? 'min-h-0 bg-[var(--color-background)] px-6 py-5' : 'min-h-[620px]'}`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold text-[var(--color-text-primary)]">
            {t('settings.terminal.title')}
          </h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-5 text-[var(--color-text-tertiary)]">
            {t('settings.terminal.description')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onNewTerminal && (
            <button
              type="button"
              onClick={onNewTerminal}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-2.5 text-[12px] font-bold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
            >
              <Icon name="add" size={16} />
              {t('terminal.newTab')}
            </button>
          )}
          {!workspace && available && (
            <button
              type="button"
              onClick={() => setRestartNonce((nonce) => nonce + 1)}
              disabled={paneStatus === 'starting'}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-2.5 text-[12px] font-bold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Icon name="restart_alt" size={16} />
              {t('settings.terminal.restart')}
            </button>
          )}
        </div>
      </div>

      {!available ? (
        <div className="flex flex-1 items-center justify-center rounded-[12px] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-8 text-center">
          <div>
            <Icon name="desktop_windows" size={18} className="mb-3 block text-[32px] text-[var(--color-text-tertiary)]" />
            <p className="text-[14px] font-medium text-[var(--color-text-primary)]">
              {t('settings.terminal.unavailableTitle')}
            </p>
            <p className="mt-1 text-[14px] text-[var(--color-text-tertiary)]">
              {t('settings.terminal.unavailableBody')}
            </p>
          </div>
        </div>
      ) : workspace ? (
        <div className="min-h-0 flex-1">
          <SplitTerminal active={active} spawnCommand={spawnCommand} firstPaneTestId={testId} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden rounded-[10px] border border-[var(--color-terminal-border)] bg-[var(--color-terminal-bg)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04),inset_0_0_0_1px_rgba(255,255,255,0.02)]">
          <TerminalPane
            key={restartNonce}
            active={active}
            focused
            spawnCommand={spawnCommand}
            onFocus={() => {}}
            showClose={false}
            testId={testId}
            onStatusChange={setPaneStatus}
          />
        </div>
      )}
    </div>
  )
}
