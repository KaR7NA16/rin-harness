import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Search } from 'lucide-react'
import { notesApi, type NoteDocument, type NoteMeta } from '../../api/notes'
import { useTranslation } from '../../i18n'

export function NotePickerModal({
  onSelect,
  onClose,
}: {
  onSelect: (doc: NoteDocument) => void
  onClose: () => void
}) {
  const t = useTranslation()
  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    void notesApi.list()
      .then(r => setNotes(r.notes))
      .catch(() => {})
      .finally(() => setInitialLoading(false))
  }, [])

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [onClose])

  const filtered = useMemo(() => notes.filter(n =>
    !query.trim() ||
    n.title.toLowerCase().includes(query.toLowerCase()) ||
    n.name.toLowerCase().includes(query.toLowerCase()),
  ).slice(0, 30), [notes, query])

  const pick = async (meta: NoteMeta) => {
    setLoading(true)
    try {
      const doc = await notesApi.read(meta.path)
      onSelect(doc)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[14vh]" onClick={onClose}>
      <div
        className="w-[520px] overflow-hidden rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] shadow-[var(--shadow-window)]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--color-border-separator)] px-[14px] py-[11px]">
          <Search size={15} className="text-[var(--color-text-tertiary)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Escape' && onClose()}
            placeholder={t('notes.pickerPlaceholder')}
            className="w-full bg-transparent text-[13px] outline-none"
          />
        </div>
        <div className="max-h-[42vh] overflow-y-auto p-[6px]">
          {initialLoading ? (
            <div className="py-[24px] text-center text-[12px] text-[var(--color-text-tertiary)]">{t('common.loading')}</div>
          ) : filtered.length === 0 ? (
            <div className="py-[24px] text-center text-[12px] text-[var(--color-text-tertiary)]">{t('notes.pickerEmpty')}</div>
          ) : null}
          {filtered.map(n => (
            <button
              key={n.path}
              disabled={loading}
              onClick={() => void pick(n)}
              className="flex w-full items-center gap-2 rounded-[8px] px-[12px] py-[8px] text-left transition-colors hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
            >
              <BookOpen size={14} className="shrink-0 text-[var(--color-text-tertiary)]" />
              <span className="min-w-0">
                <span className="block truncate text-[13px] text-[var(--color-text-primary)]">{n.title}</span>
                {n.folder && <span className="block truncate text-[11px] text-[var(--color-text-tertiary)]">{n.folder}</span>}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
