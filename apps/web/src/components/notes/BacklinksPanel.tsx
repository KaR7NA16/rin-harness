import { useEffect, useState } from 'react'
import { Link2 } from 'lucide-react'
import { notesApi, type NoteMeta } from '../../api/notes'
import { useTranslation } from '../../i18n'

export function BacklinksPanel({ path, onOpenNote }: { path: string; onOpenNote: (path: string) => void }) {
  const t = useTranslation()
  const [backlinks, setBacklinks] = useState<NoteMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(false)
    void notesApi.backlinks(path)
      .then(r => setBacklinks(r.backlinks))
      .catch(() => setError(true))
      .finally(() => setLoading(false))

    const timer = setInterval(() => {
      void notesApi.backlinks(path).then(r => setBacklinks(r.backlinks)).catch(() => {})
    }, 5000)
    return () => clearInterval(timer)
  }, [path])

  if (loading) {
    return <div className="py-[20px] text-center text-[12px] text-[var(--color-text-tertiary)]">{t('common.loading')}</div>
  }
  if (error) {
    return <div className="py-[20px] text-center text-[12px] text-[var(--color-error)]">{t('notes.loadFailed')}</div>
  }
  if (backlinks.length === 0) {
    return <div className="py-[20px] text-center text-[12px] text-[var(--color-text-tertiary)]">{t('notes.noBacklinks')}</div>
  }

  return (
    <div className="flex flex-col gap-[2px]">
      {backlinks.map(n => (
        <button
          key={n.path}
          onClick={() => onOpenNote(n.path)}
          className="flex items-center gap-2 rounded-[7px] px-[8px] py-[7px] text-left transition-colors hover:bg-[var(--color-surface-hover)]"
        >
          <Link2 size={13} className="shrink-0 text-[var(--color-text-tertiary)]" />
          <span className="min-w-0">
            <span className="block truncate text-[12.5px] text-[var(--color-text-primary)]">{n.title}</span>
            {n.folder && <span className="block truncate text-[11px] text-[var(--color-text-tertiary)]">{n.folder}</span>}
          </span>
        </button>
      ))}
    </div>
  )
}
