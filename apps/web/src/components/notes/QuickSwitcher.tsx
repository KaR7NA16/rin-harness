import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { notesApi, type NoteMeta, type NoteSearchResult } from '../../api/notes'
import { useTranslation } from '../../i18n'

export function QuickSwitcher({
  notes,
  onOpen,
  onClose,
}: {
  notes: NoteMeta[]
  onOpen: (path: string) => void
  onClose: () => void
}) {
  const t = useTranslation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<NoteSearchResult[]>([])
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const requestSeq = useRef(0)

  useEffect(() => {
    inputRef.current?.focus()
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

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      setIndex(0)
      return
    }
    const seq = ++requestSeq.current
    const timer = setTimeout(() => {
      void notesApi.search(query).then(r => {
        if (requestSeq.current !== seq) return
        setResults(r.results)
        setIndex(0)
      }).catch(() => {})
    }, 150)
    return () => clearTimeout(timer)
  }, [query])

  const items = useMemo(() => {
    if (query.trim()) return results.map(r => ({ path: r.path, title: r.title, folder: '', snippet: r.snippet }))
    return notes.slice(0, 20).map(n => ({ path: n.path, title: n.title, folder: n.folder, snippet: '' }))
  }, [query, results, notes])

  useEffect(() => {
    setIndex(i => Math.min(i, Math.max(items.length - 1, 0)))
  }, [items.length])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (items.length === 0) return
      setIndex(i => Math.min(i + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && items[index]) {
      onOpen(items[index]!.path)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[12vh]" onClick={onClose}>
      <div
        className="w-[560px] overflow-hidden rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] shadow-[var(--shadow-window)]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--color-border-separator)] px-[14px] py-[11px]">
          <Search size={15} className="text-[var(--color-text-tertiary)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder={t('notes.switcherPlaceholder')}
            className="w-full bg-transparent text-[13.5px] outline-none"
          />
        </div>
        <div className="max-h-[46vh] overflow-y-auto p-[6px]">
          {items.length === 0 && (
            <div className="py-[24px] text-center text-[12px] text-[var(--color-text-tertiary)]">{t('notes.switcherEmpty')}</div>
          )}
          {items.map((item, i) => (
            <button
              key={item.path}
              onClick={() => onOpen(item.path)}
              onMouseEnter={() => setIndex(i)}
              className={`block w-full rounded-[8px] px-[12px] py-[8px] text-left transition-colors ${
                i === index ? 'bg-[var(--color-surface-container-low)]' : ''
              }`}
            >
              <span className="block truncate text-[13px] text-[var(--color-text-primary)]">{item.title}</span>
              <span className="block truncate text-[11px] text-[var(--color-text-tertiary)]">
                {item.folder || item.snippet || item.path}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
