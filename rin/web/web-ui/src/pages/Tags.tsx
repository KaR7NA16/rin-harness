import { Check, FileText, LoaderCircle, Pencil, RefreshCw, Tag, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { notesApi, type NoteMeta } from '../api/notes'
import { useTranslation } from '../i18n'
import { useUIStore } from '../stores/uiStore'

export function Tags() {
  const t = useTranslation()
  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [matchMode, setMatchMode] = useState<'and' | 'or'>('and')
  const [renameSource, setRenameSource] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState('')
  const [renaming, setRenaming] = useState(false)

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

  const matchingNotes = useMemo(() => {
    if (selectedTags.length === 0) return []
    return notes
      .filter(note => matchMode === 'and'
        ? selectedTags.every(tag => note.tags.includes(tag))
        : selectedTags.some(tag => note.tags.includes(tag)))
      .sort((a, b) => a.path.localeCompare(b.path))
  }, [matchMode, notes, selectedTags])

  const relatedTagCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const note of matchingNotes) {
      for (const tag of note.tags) {
        if (!selectedTags.includes(tag)) counts.set(tag, (counts.get(tag) ?? 0) + 1)
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [matchingNotes, selectedTags])

  const toggleTag = useCallback((tag: string) => {
    setSelectedTags(current => current.includes(tag) ? current.filter(item => item !== tag) : [...current, tag])
  }, [])

  const openNote = useCallback((path: string) => {
    useUIStore.getState().setPendingNotePath(path)
    useUIStore.getState().openWorkspaceView('notes')
  }, [])

  const renameTag = useCallback(async () => {
    const source = renameSource?.trim()
    const target = renameTarget.trim().replace(/^#/, '')
    if (!source || !target || source === target) return

    setRenaming(true)
    try {
      const { result } = await notesApi.renameTag(source, target)
      setSelectedTags(current => current.map(tag => tag === source ? target : tag))
      setRenameSource(null)
      setRenameTarget('')
      await loadNotes()
      useUIStore.getState().addToast({ type: 'success', message: t('tags.renamed', { count: result.renamed }) })
    } catch (error) {
      useUIStore.getState().addToast({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setRenaming(false)
    }
  }, [loadNotes, renameSource, renameTarget, t])

  const selectedLabel = selectedTags.map(tag => '#' + tag).join(matchMode === 'and' ? ' + ' : ' / ')

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
            <div key={tag} className="mb-[2px] flex h-[36px] items-center rounded-[6px] hover:bg-[var(--color-surface-hover)]">
              <button
                type="button"
                aria-pressed={selectedTags.includes(tag)}
                onClick={() => toggleTag(tag)}
                className={`flex h-full min-w-0 flex-1 items-center gap-[8px] rounded-l-[6px] px-[9px] text-left transition-colors ${selectedTags.includes(tag)
                  ? 'bg-[var(--color-surface-active)] text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}
              >
                <Tag size={14} className="shrink-0 text-[var(--color-text-tertiary)]" />
                <span className="min-w-0 flex-1 truncate text-[12px]">#{tag}</span>
                <span className="shrink-0 text-[9px] text-[var(--color-text-tertiary)]">{count}</span>
              </button>
              <button
                type="button"
                aria-label={t('tags.rename') + ' #' + tag}
                onClick={() => {
                  setRenameSource(tag)
                  setRenameTarget(tag)
                }}
                className="flex h-full w-[30px] items-center justify-center rounded-r-[6px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
              >
                <Pencil size={12} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-[52px] shrink-0 items-center justify-between gap-[12px] border-b border-[var(--color-border-separator)] px-[16px] md:px-[20px]">
          <h1 className="min-w-0 truncate text-[14px] font-semibold text-[var(--color-text-primary)]">
            {selectedLabel || t('tags.select')}
          </h1>
          <div className="flex shrink-0 items-center gap-[6px]">
            {selectedTags.length > 1 && (
              <div className="flex items-center gap-[3px] rounded-[6px] border border-[var(--color-border-separator)] p-[2px]">
                <span className="px-[5px] text-[10px] text-[var(--color-text-tertiary)]">{t('tags.mode')}</span>
                {(['and', 'or'] as const).map(mode => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={matchMode === mode}
                    onClick={() => setMatchMode(mode)}
                    className={`rounded-[4px] px-[7px] py-[3px] text-[10px] font-medium ${matchMode === mode
                      ? 'bg-[var(--color-surface-active)] text-[var(--color-text-primary)]'
                      : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]'}`}
                  >
                    {mode === 'and' ? t('tags.and') : t('tags.or')}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              aria-label={t('tags.refresh')}
              onClick={() => void loadNotes()}
              className="flex h-[28px] w-[28px] items-center justify-center rounded-[6px] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-[16px] py-[12px] md:px-[20px]">
          {selectedTags.length === 0 ? (
            <div className="flex h-full min-h-[200px] items-center justify-center text-[12px] text-[var(--color-text-tertiary)]">
              {t('tags.select')}
            </div>
          ) : (
            <>
              <section className="mb-[12px] rounded-[8px] border border-[var(--color-border-separator)] bg-[var(--color-surface-sidebar)] p-[12px]">
                <div className="flex flex-wrap items-center justify-between gap-[8px]">
                  <span className="text-[11px] text-[var(--color-text-secondary)]">
                    {t('tags.matches', { count: matchingNotes.length })}
                  </span>
                  {renameSource !== null && (
                    <form
                      className="flex items-center gap-[4px]"
                      onSubmit={event => {
                        event.preventDefault()
                        void renameTag()
                      }}
                    >
                      <input
                        autoFocus
                        value={renameTarget}
                        onChange={event => setRenameTarget(event.target.value)}
                        placeholder={t('tags.renamePlaceholder')}
                        className="h-[26px] w-[140px] rounded-[5px] border border-[var(--color-border-separator)] bg-[var(--color-background)] px-[7px] text-[11px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                      />
                      <button type="submit" disabled={renaming} aria-label={t('tags.renameApply')} className="flex h-[26px] w-[26px] items-center justify-center rounded-[5px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50">
                        {renaming ? <LoaderCircle size={13} className="animate-spin" /> : <Check size={13} />}
                      </button>
                      <button type="button" aria-label={t('tags.renameCancel')} onClick={() => setRenameSource(null)} className="flex h-[26px] w-[26px] items-center justify-center rounded-[5px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]">
                        <X size={13} />
                      </button>
                    </form>
                  )}
                </div>
                {relatedTagCounts.length > 0 && (
                  <div className="mt-[10px] flex flex-wrap items-center gap-[5px]">
                    <span className="mr-[2px] text-[10px] text-[var(--color-text-tertiary)]">{t('tags.related')}</span>
                    {relatedTagCounts.slice(0, 8).map(([tag, count]) => (
                      <button key={tag} type="button" onClick={() => toggleTag(tag)} className="rounded-[5px] border border-[var(--color-border-separator)] px-[6px] py-[3px] text-[10px] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-text-primary)]">
                        #{tag} <span className="text-[var(--color-text-tertiary)]">{count}</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              {matchingNotes.length === 0 ? (
                <div className="flex min-h-[200px] items-center justify-center text-[12px] text-[var(--color-text-tertiary)]">
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
            </>
          )}
        </div>
      </main>
    </div>
  )
}
