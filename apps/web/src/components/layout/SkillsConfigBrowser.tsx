import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from '../../i18n'
import { skillsApi } from '../../api/skills'
import { filesystemApi } from '../../api/filesystem'
import { Modal } from '../shared/Modal'
import { Icon } from '../shared/Icon'

type DirEntry = {
  name: string
  path: string
  isDirectory: boolean
}

type Props = {
  open: boolean
  onClose: () => void
}

/**
 * In-page browser over the user skills directory.
 *
 * Replaces the desktop-only "open config folder" action (which invoked the OS
 * file manager / the 501 /api/skills/open-config route) with the web-ui
 * filesystem browse API rooted at the configured skills directory, so the
 * skills folder can be inspected from the browser without leaving the app.
 */
export function SkillsConfigBrowser({ open, onClose }: Props) {
  const t = useTranslation()
  // Keep the latest translator in a ref so the browse callback (and the open
  // effect) stay referentially stable even when `t` is recreated every render.
  const tRef = useRef(t)
  tRef.current = t
  const [currentPath, setCurrentPath] = useState('')
  const [parentPath, setParentPath] = useState('')
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const browse = useCallback(async (path?: string) => {
    setLoading(true)
    setLoadError(null)
    try {
      const result = await filesystemApi.browse(path, { includeFiles: true })
      setCurrentPath(result.currentPath)
      setParentPath(result.parentPath)
      setEntries(result.entries)
    } catch {
      setLoadError(tRef.current('skillsConfigBrowser.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setEntries([])
    setCurrentPath('')
    setParentPath('')
    setLoadError(null)
    setLoading(true)
    skillsApi.config()
      .then(({ config }) => {
        if (cancelled) return
        void browse(config.userSkillsDir)
      })
      .catch(() => {
        if (cancelled) return
        setLoading(false)
        setLoadError(tRef.current('skillsConfigBrowser.loadFailed'))
      })
    return () => {
      cancelled = true
    }
  }, [open, browse])

  return (
    <Modal open={open} onClose={onClose} title={t('skillsConfigBrowser.title')} width={560}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 rounded-[10px] border border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] px-3 py-2">
          <Icon name="folder_open" size={14} className="shrink-0 text-[var(--color-text-tertiary)]" />
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--color-text-secondary)]">{currentPath}</span>
          {parentPath && parentPath !== currentPath && (
            <button
              type="button"
              onClick={() => void browse(parentPath)}
              className="flex h-[24px] shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
            >
              <Icon name="arrow_upward" size={12} />
              {t('common.up')}
            </button>
          )}
        </div>

        {loadError ? (
          <div className="flex flex-col items-center gap-2 rounded-[12px] border border-dashed border-[var(--color-border)] px-4 py-8 text-center">
            <Icon name="warning" size={22} className="text-[var(--color-warning)]" />
            <p className="text-[12px] text-[var(--color-text-tertiary)]">{loadError}</p>
            <button type="button" onClick={() => void browse(currentPath || undefined)} className="text-[11px] font-bold uppercase text-[var(--color-brand)] hover:underline">
              {t('common.retry')}
            </button>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 rounded-[12px] border border-dashed border-[var(--color-border)] px-4 py-8 text-[12px] text-[var(--color-text-tertiary)]">
            <Icon name="loading" size={14} className="animate-spin" />
            {t('common.loading')}
          </div>
        ) : entries.length === 0 ? (
          <div className="rounded-[12px] border border-dashed border-[var(--color-border)] px-4 py-8 text-center text-[12px] text-[var(--color-text-tertiary)]">
            {t('skillsConfigBrowser.empty')}
          </div>
        ) : (
          <div className="max-h-[46vh] overflow-y-auto rounded-[12px] border border-[var(--color-border-separator)] bg-[var(--color-surface-container-low)] p-[6px]">
            {entries.map((entry) =>
              entry.isDirectory ? (
                <button
                  key={entry.path}
                  type="button"
                  onClick={() => void browse(entry.path)}
                  className="flex w-full items-center gap-2 rounded-[8px] px-2.5 py-2 text-left transition-colors hover:bg-[var(--color-surface-hover)]"
                >
                  <Icon name="folder" size={14} className="shrink-0 text-[var(--color-text-tertiary)]" />
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--color-text-secondary)]">{entry.name}</span>
                  <Icon name="chevron_right" size={12} className="shrink-0 text-[var(--color-text-tertiary)]" />
                </button>
              ) : (
                <div key={entry.path} className="flex w-full items-center gap-2 rounded-[8px] px-2.5 py-2">
                  <Icon name="description" size={14} className="shrink-0 text-[var(--color-text-tertiary)]" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--color-text-secondary)]">{entry.name}</span>
                </div>
              ),
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
