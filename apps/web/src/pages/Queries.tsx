import { FileText, LoaderCircle, Play } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { notesApi, type NoteQueryResult, type NoteQueryTask } from '../api/notes'
import { useTranslation } from '../i18n'
import { readStoredJson, writeStoredJson } from '../lib/storage'
import { useUIStore } from '../stores/uiStore'

const DEFAULT_DSL = 'FROM #project WHERE status = active SORT due ASC'

const QUERY_HISTORY_KEY = 'rin.queries.history.v1'
const QUERY_HISTORY_LIMIT = 12
const QUERY_EXAMPLES = [
  'FROM #project WHERE status = active SORT due ASC',
  'TASKS FROM #project SORT due ASC',
  'FROM "work" SORT modifiedAt DESC',
] as const
type NoteSortKey = 'path' | 'title' | 'modifiedAt' | 'tags'
type TaskSortKey = 'due' | 'priority' | 'text'
type GroupKey = 'none' | 'folder' | 'tag' | 'priority'
type SortDirection = 'asc' | 'desc'
type NoteRow = Extract<NoteQueryResult, { kind: 'notes' }>['notes'][number]
type GroupedRows<T> = Array<[string, T[]]>

export function Queries() {
  const t = useTranslation()
  const [dsl, setDsl] = useState(DEFAULT_DSL)
  const [result, setResult] = useState<NoteQueryResult | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<string[]>(() => {
    const stored = readStoredJson<unknown>(QUERY_HISTORY_KEY, [])
    return Array.isArray(stored)
      ? stored.filter((item): item is string => typeof item === 'string').slice(0, QUERY_HISTORY_LIMIT)
      : []
  })
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [noteSort, setNoteSort] = useState<NoteSortKey>('path')
  const [taskSort, setTaskSort] = useState<TaskSortKey>('due')
  const [groupBy, setGroupBy] = useState<GroupKey>('none')

  useEffect(() => { writeStoredJson(QUERY_HISTORY_KEY, history) }, [history])

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
      const nextResult = await notesApi.query(query)
      setResult(nextResult)
      setHistory((current) => [query, ...current.filter((item) => item !== query)].slice(0, QUERY_HISTORY_LIMIT))
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

  const noteRows = useMemo(() => {
    if (!result || result.kind !== 'notes') return []
    return [...result.notes].sort((a, b) => {
      const left = noteSortValue(a, noteSort)
      const right = noteSortValue(b, noteSort)
      return compareValues(left, right) * (sortDirection === 'asc' ? 1 : -1)
    })
  }, [noteSort, result, sortDirection])

  const taskRows = useMemo(() => {
    if (!result || result.kind !== 'tasks') return []
    return [...result.tasks].sort((a, b) => {
      const left = taskSortValue(a, taskSort)
      const right = taskSortValue(b, taskSort)
      return compareValues(left, right) * (sortDirection === 'asc' ? 1 : -1)
    })
  }, [result, sortDirection, taskSort])
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
          <QueryPresets dsl={dsl} history={history} onChange={setDsl} />

        <div className="min-h-0 flex-1 overflow-auto px-[16px] py-[12px] md:px-[20px]">
          {result && (
            <QueryResultControls
              kind={result.kind}
              noteSort={noteSort}
              taskSort={taskSort}
              groupBy={groupBy}
              direction={sortDirection}
              onNoteSort={setNoteSort}
              onTaskSort={setTaskSort}
              onGroupBy={setGroupBy}
              onDirection={() => setSortDirection((current) => current === 'asc' ? 'desc' : 'asc')}
            />
          )}
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
            <TaskResults tasks={taskRows} groupBy={groupBy} onOpenNote={openNote} />
          )}
          {!error && !running && result && result.kind === 'notes' && (
            <NoteResults
              rows={noteRows}
              groupBy={groupBy}
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

function NoteResults({ rows, groupBy, onOpenNote }: {
  rows: Array<{ path: string; name: string; folder: string; title: string; tags: string[]; fields: Array<{ key: string; value: string }>; modifiedAt: string }>
  groupBy: GroupKey
  onOpenNote: (path: string) => void
}) {
  const t = useTranslation()
  const groups = groupRows(rows, groupBy, noteGroupKey)
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
      {groups.map(([group, groupedRows]) => (
        <div key={group || 'all'}>
          {group && <div className="border-b border-[var(--color-border-separator)] bg-[var(--color-surface-sidebar)] px-[10px] py-[6px] text-[9px] font-semibold uppercase text-[var(--color-text-tertiary)]">{group}</div>}
          {groupedRows.map((row) => (
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
      ))}
    </div>
  )
}

function TaskResults({ tasks, groupBy, onOpenNote }: {
  tasks: NoteQueryTask[]
  groupBy: GroupKey
  onOpenNote: (path: string) => void
}) {
  const t = useTranslation()
  const groups = groupRows(tasks, groupBy, taskGroupKey)
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
      {groups.map(([group, groupedTasks]) => (
        <div key={group || 'all'}>
          {group && <div className="border-b border-[var(--color-border-separator)] bg-[var(--color-surface-sidebar)] px-[10px] py-[6px] text-[9px] font-semibold uppercase text-[var(--color-text-tertiary)]">{group}</div>}
          {groupedTasks.map((task) => (
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

function compareValues(left: string | number, right: string | number) {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function noteSortValue(note: NoteRow, key: NoteSortKey): string {
  if (key === 'path') return note.path
  if (key === 'title') return note.title
  if (key === 'modifiedAt') return note.modifiedAt
  return note.tags.join(' ')
}

function taskSortValue(task: NoteQueryTask, key: TaskSortKey): string | number {
  if (key === 'due') return task.due ?? ''
  if (key === 'priority') return ['lowest', 'low', 'medium', 'high', 'highest'].indexOf(task.priority)
  return task.text
}

function groupRows<T>(rows: T[], groupBy: GroupKey, keyFor: (row: T, groupBy: GroupKey) => string): GroupedRows<T> {
  if (groupBy === 'none') return [['', rows]]
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const key = keyFor(row, groupBy)
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))
}

function noteGroupKey(note: NoteRow, groupBy: GroupKey) {
  if (groupBy === 'folder') return note.folder || '/'
  if (groupBy === 'tag') return note.tags[0] ? '#' + note.tags[0] : '(untagged)'
  return ''
}

function taskGroupKey(task: NoteQueryTask, groupBy: GroupKey) {
  if (groupBy === 'priority') return task.priority
  if (groupBy === 'folder') return task.notePath.split('/').slice(0, -1).join('/') || '/'
  return task.due ?? '(no due date)'
}

function QueryPresets({ dsl, history, onChange }: {
  dsl: string
  history: string[]
  onChange: (value: string) => void
}) {
  const t = useTranslation()
  return (
    <div className="mt-[8px] flex flex-wrap items-center gap-[10px]">
      <div className="flex flex-wrap items-center gap-[5px]">
        <span className="text-[9px] font-semibold uppercase text-[var(--color-text-tertiary)]">{t('queries.examples')}</span>
        {QUERY_EXAMPLES.map((example, index) => (
          <button key={example} type="button" onClick={() => onChange(example)} className="rounded-[5px] border border-[var(--color-border)] px-[7px] py-[4px] text-[10px] text-[var(--color-text-secondary)] hover:border-[var(--color-border-focus)] hover:text-[var(--color-text-primary)]">
            {t('queries.example')} {index + 1}
          </button>
        ))}
      </div>
      {history.length > 0 && (
        <label className="flex min-w-[220px] flex-1 items-center gap-[6px]">
          <span className="shrink-0 text-[9px] font-semibold uppercase text-[var(--color-text-tertiary)]">{t('queries.history')}</span>
          <select value={dsl} onChange={(event) => onChange(event.target.value)} className="h-[26px] min-w-0 flex-1 rounded-[5px] border border-[var(--color-border)] bg-[var(--color-background)] px-[7px] text-[10px] text-[var(--color-text-secondary)] outline-none">
            <option value="">{t('queries.historyChoose')}</option>
            {history.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
      )}
    </div>
  )
}

function QueryResultControls({
  kind,
  noteSort,
  taskSort,
  groupBy,
  direction,
  onNoteSort,
  onTaskSort,
  onGroupBy,
  onDirection,
}: {
  kind: NoteQueryResult['kind']
  noteSort: NoteSortKey
  taskSort: TaskSortKey
  groupBy: GroupKey
  direction: SortDirection
  onNoteSort: (value: NoteSortKey) => void
  onTaskSort: (value: TaskSortKey) => void
  onGroupBy: (value: GroupKey) => void
  onDirection: () => void
}) {
  const t = useTranslation()
  const sortValue = kind === 'notes' ? noteSort : taskSort
  const sortOptions = kind === 'notes'
    ? [['path', t('queries.sort.path')], ['title', t('queries.sort.title')], ['modifiedAt', t('queries.sort.modifiedAt')], ['tags', t('queries.sort.tags')]]
    : [['due', t('queries.sort.due')], ['priority', t('queries.sort.priority')], ['text', t('queries.sort.text')]]
  const groupOptions = kind === 'notes'
    ? [['none', t('queries.group.none')], ['folder', t('queries.group.folder')], ['tag', t('queries.group.tag')]]
    : [['none', t('queries.group.none')], ['priority', t('queries.group.priority')], ['folder', t('queries.group.folder')]]
  return (
    <div className="mb-[10px] flex flex-wrap items-center gap-[8px] border-b border-[var(--color-border-separator)] pb-[10px]">
      <label className="flex items-center gap-[5px] text-[10px] text-[var(--color-text-tertiary)]">
        {t('queries.sort')}
        <select value={sortValue} onChange={(event) => kind === 'notes' ? onNoteSort(event.target.value as NoteSortKey) : onTaskSort(event.target.value as TaskSortKey)} className="h-[26px] rounded-[5px] border border-[var(--color-border)] bg-[var(--color-background)] px-[6px] text-[10px] text-[var(--color-text-secondary)] outline-none">
          {sortOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-[5px] text-[10px] text-[var(--color-text-tertiary)]">
        {t('queries.group')}
        <select value={groupBy} onChange={(event) => onGroupBy(event.target.value as GroupKey)} className="h-[26px] rounded-[5px] border border-[var(--color-border)] bg-[var(--color-background)] px-[6px] text-[10px] text-[var(--color-text-secondary)] outline-none">
          {groupOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <button type="button" onClick={onDirection} className="h-[26px] rounded-[5px] border border-[var(--color-border)] px-[8px] text-[10px] text-[var(--color-text-secondary)] hover:border-[var(--color-border-focus)]">
        {direction === 'asc' ? t('queries.ascending') : t('queries.descending')}
      </button>
    </div>
  )
}
