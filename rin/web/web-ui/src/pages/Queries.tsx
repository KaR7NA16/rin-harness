import { FileText, LoaderCircle, Play } from 'lucide-react'
import { useCallback, useState } from 'react'
import { notesApi, type NoteQueryResult, type NoteQueryTask } from '../api/notes'
import { useTranslation } from '../i18n'
import { useUIStore } from '../stores/uiStore'

const DEFAULT_DSL = 'FROM #project WHERE status = active SORT due ASC'

export function Queries() {
  const t = useTranslation()
  const [dsl, setDsl] = useState(DEFAULT_DSL)
  const [result, setResult] = useState<NoteQueryResult | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const notifyError = useCallback((message: string) => {
    setError(message)
    useUIStore.getState().addToast({ type: 'error', message })
  }, [])

  const runQuery = useCallback(async () => {
    const query = dsl.trim()
    if (!query) return
    setRunning(true)
    setError(null)
    try {
      setResult(await notesApi.query(query))
    } catch (err) {
      setResult(null)
      notifyError(err instanceof Error ? err.message : t('queries.error'))
    } finally {
      setRunning(false)
    }
  }, [dsl, notifyError, t])

  const openNote = useCallback((path: string) => {
    useUIStore.getState().setPendingNotePath(path)
    useUIStore.getState().openWorkspaceView('notes')
  }, [])

  const count = result
    ? result.kind === 'notes' ? result.notes.length : result.tasks.length
    : 0

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden border-t border-[var(--color-border-separator)] bg-[var(--color-background)]">
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-[64px] shrink-0 flex-wrap items-center gap-[12px] border-b border-[var(--color-border-separator)] px-[16px] py-[10px] md:px-[20px]">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold text-[var(--color-text-primary)]">{t('queries.title')}</h1>
            <p className="mt-[2px] truncate text-[10px] text-[var(--color-text-tertiary)]">{t('queries.subtitle')}</p>
          </div>
          {result && (
            <span className="hidden text-[10px] text-[var(--color-text-tertiary)] sm:inline">
              {t('queries.matches', { count })}
            </span>
          )}
          <button
            type="button"
            onClick={() => void runQuery()}
            disabled={running || dsl.trim() === ''}
            className="flex h-[34px] items-center gap-[7px] rounded-[7px] bg-[var(--color-accent)] px-[13px] text-[11px] font-semibold text-white transition-opacity disabled:opacity-60"
          >
            {running ? <LoaderCircle className="animate-spin" size={14} /> : <Play size={14} />}
            {t('queries.run')}
          </button>
        </header>

        <div className="shrink-0 border-b border-[var(--color-border-separator)] px-[16px] py-[12px] md:px-[20px]">
          <textarea
            value={dsl}
            onChange={(event) => setDsl(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void runQuery()
            }}
            rows={3}
            spellCheck={false}
            placeholder={t('queries.placeholder')}
            aria-label={t('queries.placeholder')}
            className="w-full resize-y rounded-[8px] border border-[var(--color-border)] bg-[var(--color-background)] p-[10px] font-mono text-[12px] leading-[18px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-border-focus)] focus:shadow-[var(--shadow-focus-ring)]"
          />
          <p className="mt-[6px] text-[9px] text-[var(--color-text-tertiary)]">
            {t('queries.hint')}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-[16px] py-[12px] md:px-[20px]">
          {error && (
            <div className="rounded-[8px] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 px-[12px] py-[10px] text-[11px] text-[var(--color-danger)]">
              {error}
            </div>
          )}
          {!error && running && !result && (
            <div className="flex h-full min-h-[200px] items-center justify-center">
              <LoaderCircle className="animate-spin text-[var(--color-text-tertiary)]" size={22} />
            </div>
          )}
          {!error && !running && result && result.kind === 'tasks' && (
            <TaskResults tasks={result.tasks} onOpenNote={openNote} />
          )}
          {!error && !running && result && result.kind === 'notes' && (
            <NoteResults
              rows={result.notes}
              onOpenNote={openNote}
            />
          )}
          {!error && !running && !result && (
            <div className="flex h-full min-h-[200px] items-center justify-center text-[12px] text-[var(--color-text-tertiary)]">
              {t('queries.idle')}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

function NoteResults({ rows, onOpenNote }: {
  rows: Array<{ path: string; name: string; folder: string; title: string; tags: string[]; fields: Array<{ key: string; value: string }>; modifiedAt: string }>
  onOpenNote: (path: string) => void
}) {
  const t = useTranslation()
  if (rows.length === 0) {
    return <EmptyState label={t('queries.empty')} />
  }
  return (
    <div className="min-w-[560px]">
      <div className="grid h-[32px] grid-cols-[minmax(200px,1fr)_minmax(160px,1fr)_120px_160px] items-center border-b border-[var(--color-border-separator)] px-[10px] text-[9px] font-semibold uppercase text-[var(--color-text-tertiary)]">
        <span>{t('queries.column.note')}</span>
        <span>{t('queries.column.title')}</span>
        <span>{t('queries.column.tags')}</span>
        <span>{t('queries.column.fields')}</span>
      </div>
      {rows.map((row) => (
        <button
          key={row.path}
          type="button"
          onClick={() => onOpenNote(row.path)}
          className="grid min-h-[44px] w-full grid-cols-[minmax(200px,1fr)_minmax(160px,1fr)_120px_160px] items-center border-b border-[var(--color-border-separator)] px-[10px] text-left hover:bg-[var(--color-surface-hover)]"
        >
          <span className="flex min-w-0 items-center gap-[8px]">
            <FileText size={14} className="shrink-0 text-[var(--color-text-tertiary)]" />
            <span className="truncate text-[11px] text-[var(--color-text-primary)]">{row.path}</span>
          </span>
          <span className="truncate text-[11px] text-[var(--color-text-secondary)]">{row.title}</span>
          <span className="truncate text-[10px] text-[var(--color-text-tertiary)]">{row.tags.map(tag => `#${tag}`).join(' ')}</span>
          <span className="truncate font-mono text-[9px] text-[var(--color-text-tertiary)]">
            {row.fields.map(field => `${field.key}=${field.value}`).join('  ')}
          </span>
        </button>
      ))}
    </div>
  )
}

function TaskResults({ tasks, onOpenNote }: {
  tasks: NoteQueryTask[]
  onOpenNote: (path: string) => void
}) {
  const t = useTranslation()
  if (tasks.length === 0) {
    return <EmptyState label={t('queries.empty')} />
  }
  return (
    <div className="min-w-[560px]">
      <div className="grid h-[32px] grid-cols-[minmax(220px,1fr)_90px_90px_140px] items-center border-b border-[var(--color-border-separator)] px-[10px] text-[9px] font-semibold uppercase text-[var(--color-text-tertiary)]">
        <span>{t('queries.column.task')}</span>
        <span>{t('queries.column.due')}</span>
        <span>{t('queries.column.priority')}</span>
        <span>{t('queries.column.note')}</span>
      </div>
      {tasks.map((task) => (
        <button
          key={`${task.notePath}:${task.line}`}
          type="button"
          onClick={() => onOpenNote(task.notePath)}
          className="grid min-h-[44px] w-full grid-cols-[minmax(220px,1fr)_90px_90px_140px] items-center border-b border-[var(--color-border-separator)] px-[10px] text-left hover:bg-[var(--color-surface-hover)]"
        >
          <span className="flex min-w-0 items-center gap-[8px]">
            <span className={`flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[3px] border text-[9px] ${task.done ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white' : 'border-[var(--color-border)]'}`}>
              {task.done ? '✓' : ''}
            </span>
            <span className={`truncate text-[11px] ${task.done ? 'text-[var(--color-text-tertiary)] line-through' : 'text-[var(--color-text-primary)]'}`}>
              {task.text}
            </span>
          </span>
          <span className="text-[10px] text-[var(--color-text-tertiary)]">{task.due ?? ''}</span>
          <span className="text-[10px] text-[var(--color-text-tertiary)]">{t(`queries.priority.${task.priority}` as never)}</span>
          <span className="truncate text-[10px] text-[var(--color-text-tertiary)]">{task.notePath}</span>
        </button>
      ))}
    </div>
  )
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-[200px] items-center justify-center text-[12px] text-[var(--color-text-tertiary)]">
      {label}
    </div>
  )
}
