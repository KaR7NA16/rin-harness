import { useEffect, useState } from 'react'
import { statusApi, type StatusUserResponse } from '../../api/status'
import { sessionsApi } from '../../api/sessions'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'
import { useTranslation } from '../../i18n'
import { Avatar } from '../shared/Avatar'
import { Icon } from '../shared/Icon'
import type { ConnectionMode } from '../../types/settings'

function initialsFor(username: string): string {
  const parts = username.trim().split(/[\s._-]+/).filter(Boolean)
  if (parts.length === 0) return 'U'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
}

type GitInfo = {
  branch: string | null
  repoName: string | null
  changedFiles: number
}

export function StatusBar() {
  const t = useTranslation()
  const activeTabId = useTabStore((s) => s.activeTabId)
  const tabs = useTabStore((s) => s.tabs)
  const activeTab = tabs.find((tab) => tab.sessionId === activeTabId)
  const worktreeEnabled = useSettingsStore((s) => s.worktreeEnabled)
  const connectionMode = useSettingsStore((s) => s.connectionMode)
  const setWorktreeEnabled = useSettingsStore((s) => s.setWorktreeEnabled)
  const setConnectionMode = useSettingsStore((s) => s.setConnectionMode)

  const [user, setUser] = useState<StatusUserResponse | null>(null)
  const [git, setGit] = useState<GitInfo | null>(null)

  useEffect(() => {
    let cancelled = false
    statusApi.user().then((data) => {
      if (!cancelled) setUser(data)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    if (activeTab?.type !== 'session' || !activeTab.sessionId) {
      setGit(null)
      return
    }
    sessionsApi
      .getGitInfo(activeTab.sessionId, activeTab.projectPath ? { projectPath: activeTab.projectPath } : undefined)
      .then((info) => {
        if (!cancelled) setGit(info)
      })
      .catch(() => {
        if (!cancelled) setGit(null)
      })
    return () => { cancelled = true }
  }, [activeTabId, activeTab?.sessionId, activeTab?.projectPath])

  const username = user?.displayName || user?.username || ''
  const hostLabel = user?.hostname ? `${user.username}@${user.hostname}` : ''
  const initials = username ? initialsFor(username) : 'U'

  const toggleWorktree = () => {
    void setWorktreeEnabled(!worktreeEnabled)
  }

  const toggleMode = () => {
    const next: ConnectionMode = connectionMode === 'local' ? 'remote' : 'local'
    void setConnectionMode(next)
  }

  return (
    <div className="flex h-[28px] shrink-0 items-center gap-[10px] border-t border-[var(--color-border-separator)] bg-[var(--color-surface-footer)] px-[10px] text-[11px] text-[var(--color-text-secondary)]">
      <span className="flex min-w-0 items-center gap-[7px]">
        <Icon name="code" size={12} className="text-[var(--color-text-tertiary)]" />
        <span className="max-w-[190px] truncate font-medium text-[var(--color-text-primary)]">
          {git?.repoName || t('statusbar.noRepository')}
        </span>
        {git?.branch && (
          <span className="font-mono text-[var(--color-text-tertiary)]">{git.branch}</span>
        )}
        {git && git.changedFiles > 0 && (
          <span className="ml-[2px] text-[var(--color-warning)]">{git.changedFiles}</span>
        )}
      </span>

      <div className="flex flex-1 items-center justify-end gap-[6px]">
        <button
          type="button"
          data-testid="statusbar-worktree"
          className="flex items-center gap-[4px] rounded-[6px] px-[4px] py-[2px] hover:bg-[var(--color-surface-hover)]"
          onClick={toggleWorktree}
          title={t('statusbar.worktree')}
        >
          <span
            data-testid="statusbar-worktree-check"
            className="flex h-[13px] w-[13px] items-center justify-center rounded-[3px] border border-[var(--color-border)]"
            style={{ backgroundColor: worktreeEnabled ? 'var(--color-brand)' : 'transparent' }}
          >
            {worktreeEnabled && <Icon name="check" size={10} className="text-[var(--color-text-on-accent)]" />}
          </span>
          <span>{t('statusbar.worktree')}</span>
        </button>

        <button
          type="button"
          data-testid="statusbar-mode"
          className="flex items-center gap-[4px] rounded-[6px] px-[4px] py-[2px] hover:bg-[var(--color-surface-hover)]"
          onClick={toggleMode}
          title={t('statusbar.connectionMode')}
        >
          <Icon name={connectionMode === 'remote' ? 'cloud' : 'terminal'} size={13} className="text-[var(--color-text-tertiary)]" />
          <span>{t(connectionMode === 'local' ? 'statusbar.modeLocal' : 'statusbar.modeRemote')}</span>
        </button>

        <div className="flex items-center gap-[6px]" title={hostLabel || username}>
          <Avatar seed={username || 'local'} initials={initials} size={18} variant="circle" />
          <span className="max-w-[120px] truncate font-medium text-[var(--color-text-primary)]">
            {username || t('statusbar.user')}
          </span>
        </div>
      </div>
    </div>
  )
}