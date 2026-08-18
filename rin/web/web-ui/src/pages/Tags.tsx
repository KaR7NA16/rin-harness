import { FileText, Tag } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { notesApi, type NoteMeta } from '../api/notes'
import { useTranslation } from '../i18n'
import { useUIStore } from '../stores/uiStore'

export function Tags() {
  const t = useTranslation()
  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTag, setSelectedTag] = useState<string | null>(null)

  const loadNotes = useCallback(async () => {
    setLoading(true)
    try {
      setNotes((await notesApi.list()).notes)
    } catch (error) {
      useUIStore.getState().addToast({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadNotes()
  }, [loadNotes])

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const note of notes) {
      for (const tag of note.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [notes])

  const matchingNotes = useMemo(
    () => notes.filter(note => selectedTag !== null && note.tags.includes(selectedTag)).sort((a, b) => a.path.localeCompare(b.path)),
    [notes, selectedTag],
  )

  const openNote = useCallback((path: string) => {
    useUIStore.getState().setPendingNotePath(path)
    useUIStore.getState().openWorkspaceView('notes')
  }, [])

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden border-t border-[var(--color-border-separator)] bg-[var(--color-background)]">
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-[var(--color-border-separator)] bg-[var(--color-surface-sidebar)]">
        <div className="flex h-[52px] items-center px-[14px] text-[11px] font-semibold uppercase text-[var(--color-text-tertiary)]">
          {t('tags.title')}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-[8px] pb-[12px]">
          {loading && tagCounts.length === 0 ? (
            <div className="px-[9px] py-[14px] text-[11px] text-[var(--color-text-tertiary)]">{t('common.loading')}</div>
          ) : tagCounts.length === 0 ? (
            <div className="px-[9px] py-[14px] text-[11px] text-[var(--color-text-tertiary)]">{t('tags.empty')}</div>
          ) : tagCounts.map(([tag, count]) => (
            <button
              key={tag}
              type="button"
              onClick={() => setSelectedTag(tag)}
              className={`mb-[2px] flex h-[36px] w-full items-center gap-[8px] rounded-[6px] px-[9px] text-left transition-colors ${selectedTag === tag
                ? 'bg-[var(--color-surface-active)] text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'}`}
            >
              <Tag size={14} className="shrink-0 text-[var(--color-text-tertiary)]" />
              <span className="min-w-0 flex-1 truncate text-[12px]">#{tag}</span>
              <span className="shrink-0 text-[9px] text-[var(--color-text-tertiary)]">{count}</span>
            </button>
          ))}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[52px] shrink-0 items-center border-b border-[var(--color-border-separator)] px-[16px] md:px-[20px]">
          <h1 className="truncate text-[14px] font-semibold text-[var(--color-text-primary)]">
            {selectedTag ? `#${selectedTag}` : t('tags.select')}
          </h1>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-[16px] py-[12px] md:px-[20px]">
          {selectedTag === null ? (
            <div className="flex h-full min-h-[200px] items-center justify-center text-[12px] text-[var(--color-text-tertiary)]">
              {t('tags.select')}
            </div>
          ) : matchingNotes.length === 0 ? (
            <div className="flex h-full min-h-[200px] items-center justify-center text-[12px] text-[var(--color-text-tertiary)]">
              {t('tags.empty')}
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-border-separator)]">
              {matchingNotes.map(note => (
                <button
                  key={note.path}
                  type="button"
                  onClick={() => openNote(note.path)}
                  className="flex w-full items-center gap-[10px] px-[6px] py-[11px] text-left hover:bg-[var(--color-surface-hover)]"
                >
                  <FileText size={15} className="shrink-0 text-[var(--color-text-tertiary)]" />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--color-text-primary)]">{note.title}</span>
                  <span className="shrink-0 truncate text-[10px] text-[var(--color-text-tertiary)]">{note.path}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
