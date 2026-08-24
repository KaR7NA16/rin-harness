import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, File, Folder, RefreshCw } from 'lucide-react'
import { filesystemApi, type BrowseResult, type DirEntry, type FileStat } from '../../api/filesystem'
import { useTranslation } from '../../i18n'
import { AssetPreviewModal } from './AssetPreviewModal'

type Props = {
  initialPath?: string
  className?: string
}

/** Windows absolute paths (C:\ or C:/) get drive-relative breadcrumbs; everything else is POSIX. */
function isWindowsDrivePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path)
}

/**
 * Path-contained file explorer.
 *
 * Lists directories first, then files; clicking a directory navigates into
 * it and clicking a file opens the native AssetPreviewModal. The component
 * owns no writes and only reads through /api/filesystem/*.
 */
export function FileExplorer({ initialPath, className = '' }: Props) {
  const t = useTranslation()
  const [currentPath, setCurrentPath] = useState<string | undefined>(initialPath)
  const [result, setResult] = useState<BrowseResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewFile, setPreviewFile] = useState<FileStat | null>(null)

  const load = useCallback(async (path?: string) => {
    setLoading(true)
    setError(null)
    try {
      const next = await filesystemApi.browse(path, { includeFiles: true })
      setResult(next)
      setCurrentPath(next.currentPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(initialPath)
  }, [initialPath, load])

  const openEntry = useCallback(async (entry: DirEntry) => {
    if (entry.isDirectory) {
      await load(entry.path)
      return
    }
    try {
      setPreviewFile(await filesystemApi.stat(entry.path))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [load])

  const segments = useMemo(() => {
    const path = currentPath ?? ''
    const parts = path.split(/[\\/]/).filter(Boolean)
    return parts.map((part, index) => ({
      label: part,
      path: (isWindowsDrivePath(path) ? '' : '/') + parts.slice(0, index + 1).join('/'),
    }))
  }, [currentPath])

  return (
    <div className={`flex h-full min-h-0 flex-col ${className}`}>
      <div className="flex h-[36px] shrink-0 items-center gap-[8px] border-b border-[var(--color-border-separator)] px-[12px]">
        <button
          type="button"
          disabled={!result?.parentPath || loading}
          onClick={() => void load(result?.parentPath)}
          title={t('files.parent')}
          aria-label={t('files.parent')}
          className="rounded-[6px] p-[5px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-35"
        >
          <ArrowLeft size={14} />
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => void load(currentPath)}
          title={t('common.refresh')}
          aria-label={t('common.refresh')}
          className="rounded-[6px] p-[5px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-35"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
        <div className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[12px] text-[var(--color-text-tertiary)]">
          {segments.map((segment, index) => (
            <span key={segment.path}>
              {index > 0 && <span className="mx-1">/</span>}
              <button
                type="button"
                onClick={() => void load(segment.path)}
                className="hover:text-[var(--color-text-primary)]"
              >
                {segment.label}
              </button>
            </span>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-[6px]">
        {loading && (
          <div className="py-[20px] text-center text-[12px] text-[var(--color-text-tertiary)]">{t('common.loading')}</div>
        )}
        {!loading && error && (
          <div className="py-[20px] text-center text-[12px] text-[var(--color-error)]">{error}</div>
        )}
        {!loading && !error && result?.entries.length === 0 && (
          <div className="py-[20px] text-center text-[12px] text-[var(--color-text-tertiary)]">{t('files.empty')}</div>
        )}
        {!loading && !error && (result?.entries ?? []).map((entry) => (
          <button
            key={entry.path}
            type="button"
            onClick={() => void openEntry(entry)}
            className="flex w-full items-center gap-[9px] rounded-[8px] px-[10px] py-[7px] text-left transition-colors hover:bg-[var(--color-surface-hover)]"
          >
            {entry.isDirectory
              ? <Folder size={15} className="shrink-0 text-[var(--color-warning)]" />
              : <File size={15} className="shrink-0 text-[var(--color-text-tertiary)]" />}
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--color-text-primary)]">{entry.name}</span>
          </button>
        ))}
      </div>

      <AssetPreviewModal open={previewFile !== null} file={previewFile} onClose={() => setPreviewFile(null)} />
    </div>
  )
}
