import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BookOpen,
  CalendarDays,
  FilePlus2,
  FolderPlus,
  LayoutList,
  ListTodo,
  LoaderCircle,
  Network,
  PanelRight,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { notesApi, type NoteMeta, type NoteTemplate } from '../api/notes'
import { useTranslation } from '../i18n'
import { NoteEditor } from '../components/notes/NoteEditor'
import { NoteGraphView } from '../components/notes/NoteGraphView'
import { TodoPanel } from '../components/notes/TodoPanel'
import { QuickSwitcher } from '../components/notes/QuickSwitcher'
import { OutlinePanel } from '../components/notes/OutlinePanel'
import { BacklinksPanel } from '../components/notes/BacklinksPanel'
import { SnapshotPanel } from '../components/notes/SnapshotPanel'
import { useUIStore } from '../stores/uiStore'
import { NoteNameDialog } from '../components/notes/NoteNameDialog'
import { ConfirmDialog } from '../components/shared/ConfirmDialog'

type WorkspaceMode = 'edit' | 'graph' | 'todos'
type SideTab = 'outline' | 'backlinks' | 'history'

function loadWidth(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(key))
    return Number.isFinite(v) && v > 0 ? v : fallback
  } catch {
    return fallback
  }
}

function useResizableWidth(key: string, initial: number, min: number, max: number, invert = false) {
  const [width, setWidth] = useState(() => {
    const v = loadWidth(key, initial)
    return Math.min(Math.max(v, min), max)
  })
  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width
    const onMove = (ev: MouseEvent) => {
      const delta = invert ? startX - ev.clientX : ev.clientX - startX
      setWidth(Math.min(Math.max(startWidth + delta, min), max))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [width, min, max, invert])
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const step = e.key === 'ArrowLeft' ? -16 : 16
    setWidth((current) => Math.min(Math.max(current + (invert ? -step : step), min), max))
  }, [min, max, invert])
  useEffect(() => {
    try { localStorage.setItem(key, String(width)) } catch { /* ignore */ }
  }, [key, width])
  return { width, startDrag, handleKeyDown, min, max }
}

const resizeHandleClass =
  'w-[5px] shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-[var(--color-text-accent)] active:bg-[var(--color-text-accent)]'

export function Notes() {
  const t = useTranslation()
  const showToast = useUIStore(s => s.addToast)

  const [mode, setMode] = useState<WorkspaceMode>('edit')
  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [activePath, setActivePath] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const listResize = useResizableWidth('notes.listWidth', 240, 160, 480)
  const sideResize = useResizableWidth('notes.sideWidth', 250, 180, 480, true)
  const [sideOpen, setSideOpen] = useState(true)
  const [headingJump, setHeadingJump] = useState<string | null>(null)
  const [sideTab, setSideTab] = useState<SideTab>('outline')
  const [editorReloadKey, setEditorReloadKey] = useState(0)
  const [templates, setTemplates] = useState<NoteTemplate[]>([])
  const [organizeCallback, setOrganizeCallback] = useState<(() => void) | null>(null)
  const [nameDialog, setNameDialog] = useState<{ mode: 'create' | 'rename'; folder?: string; templatePath?: string } | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const refresh = useCallback(async (keepActive = true) => {
    try {
      const { notes: list } = await notesApi.list()
      setNotes(list)
      if (!keepActive && list.length > 0) setActivePath(list[0]!.path)
    } catch (error) {
      showToast({ message: String(error), type: 'error' })
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    void refresh(false)
    void notesApi.templates().then(r => setTemplates(r.templates)).catch(() => {})
  }, [refresh])

  const openNote = useCallback((path: string) => {
    setMode('edit')
    setActivePath(path)
  }, [])

  const openOrCreate = useCallback(async (target: string) => {
    const existing = notes.find(n => n.path === target || n.name === target.replace(/\.md$/, ''))
    if (existing) {
      openNote(existing.path)
      return
    }
    const path = target.endsWith('.md') ? target : `${target}.md`
    try {
      await notesApi.create(path, `# ${target.replace(/\.md$/, '')}\n`)
      await refresh()
      openNote(path)
    } catch (error) {
      showToast({ message: String(error), type: 'error' })
    }
  }, [notes, openNote, refresh, showToast])

  const createNote = useCallback((folder?: string) => {
    setNameDialog({ mode: 'create', folder })
  }, [])

  const createFromTemplate = useCallback((templatePath: string) => {
    setNameDialog({ mode: 'create', templatePath })
  }, [])

  const handleNameSubmit = useCallback(async (path: string, templatePath?: string) => {
    try {
      if (nameDialog?.mode === 'rename' && activePath) {
        await notesApi.move(activePath, path)
        await refresh()
        openNote(path)
        return
      }
      const fullPath = nameDialog?.folder && !path.includes('/') ? `${nameDialog.folder}/${path}` : path
      if (templatePath) {
        await notesApi.createFromTemplate(fullPath, templatePath)
      } else {
        const title = fullPath.split('/').pop()!.replace(/\.md$/, '')
        await notesApi.create(fullPath, `# ${title}\n`)
      }
      await refresh()
      openNote(fullPath)
    } catch (error) {
      showToast({ message: String(error), type: 'error' })
    }
  }, [nameDialog, activePath, openNote, refresh, showToast])

  const openDaily = useCallback(async () => {
    try {
      const doc = await notesApi.daily()
      await refresh()
      openNote(doc.path)
    } catch (error) {
      showToast({ message: String(error), type: 'error' })
    }
  }, [openNote, refresh, showToast])

  const deleteActive = useCallback(() => {
    if (!activePath) return
    setDeleteOpen(true)
  }, [activePath])

  const confirmDelete = useCallback(async () => {
    if (!activePath) return
    setIsDeleting(true)
    try {
      await notesApi.remove(activePath)
      setActivePath(null)
      setDeleteOpen(false)
      await refresh()
    } catch (error) {
      showToast({ message: String(error), type: 'error' })
    } finally {
      setIsDeleting(false)
    }
  }, [activePath, refresh, showToast])

  const renameActive = useCallback(() => {
    if (!activePath) return
    setNameDialog({ mode: 'rename' })
  }, [activePath])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        setSwitcherOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const allTags = useMemo(() => {
    const tags = new Set<string>()
    for (const n of notes) for (const tag of n.tags) tags.add(tag)
    return [...tags].sort()
  }, [notes])

  const filtered = useMemo(() => {
    let list = notes
    if (tagFilter) list = list.filter(n => n.tags.includes(tagFilter))
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(n =>
        n.name.toLowerCase().includes(q) ||
        n.title.toLowerCase().includes(q) ||
        n.folder.toLowerCase().includes(q),
      )
    }
    return list
  }, [notes, search, tagFilter])

  const grouped = useMemo(() => {
    const map = new Map<string, NoteMeta[]>()
    for (const n of filtered) {
      const arr = map.get(n.folder) ?? []
      arr.push(n)
      map.set(n.folder, arr)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoaderCircle className="animate-spin text-[var(--color-text-tertiary)]" size={28} />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-[var(--color-background)]">
      {/* 顶栏: 模式切换 + 操作 */}
      <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-[var(--color-border-separator)] px-[16px]">
        <BookOpen size={17} className="text-[var(--color-text-tertiary)]" />
        <div className="flex rounded-[9px] bg-[var(--color-surface-container-low)] p-[3px]">
          {([
            ['edit', t('notes.mode.notes'), LayoutList],
            ['graph', t('notes.mode.graph'), Network],
            ['todos', t('notes.mode.todos'), ListTodo],
          ] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setMode(key)}
              className={`flex items-center gap-1.5 rounded-[7px] px-[12px] py-[5px] text-[13px] transition-colors ${
                mode === key
                  ? 'bg-[var(--color-surface)] text-[var(--color-text-primary)] shadow-sm'
                  : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {mode === 'edit' && (
          <>
            <button onClick={() => void openDaily()} title={t('notes.daily')} className="flex items-center gap-1.5 rounded-[8px] px-[10px] py-[6px] text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]">
              <CalendarDays size={15} />{t('notes.daily')}
            </button>
            <button onClick={() => void createNote()} title={t('notes.newNote')} className="flex items-center gap-1.5 rounded-[8px] px-[10px] py-[6px] text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]">
              <FilePlus2 size={15} />{t('notes.newNote')}
            </button>
            {templates.length > 0 && (
              <select
                value=""
                onChange={e => {
                  if (templates.some(x => x.path === e.target.value)) createFromTemplate(e.target.value)
                }}
                className="rounded-[8px] bg-transparent px-[6px] py-[6px] text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
              >
                <option value="">{t('notes.fromTemplate')}</option>
                {templates.map(tpl => (
                  <option key={tpl.path} value={tpl.path}>{tpl.name}</option>
                ))}
              </select>
            )}
            {organizeCallback && (
              <button onClick={organizeCallback} title={t('notes.organize')} className="flex items-center gap-1.5 rounded-[8px] px-[10px] py-[6px] text-[13px] text-[var(--color-text-accent)] hover:bg-[var(--color-surface-hover)]">
                <Sparkles size={15} />{t('notes.organize')}
              </button>
            )}
            {activePath && (
              <>
                <button onClick={() => void renameActive()} className="rounded-[8px] px-[10px] py-[6px] text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]">{t('notes.rename')}</button>
                <button onClick={() => void deleteActive()} title={t('notes.delete')} className="rounded-[8px] px-[8px] py-[6px] text-[var(--color-error)] hover:bg-[var(--color-surface-hover)]">
                  <Trash2 size={15} />
                </button>
              </>
            )}
            <button
              onClick={() => setSideOpen(v => !v)}
              title={t('notes.toggleSide')}
              className={`rounded-[8px] px-[8px] py-[6px] hover:bg-[var(--color-surface-hover)] ${sideOpen ? 'text-[var(--color-text-accent)]' : 'text-[var(--color-text-tertiary)]'}`}
            >
              <PanelRight size={16} />
            </button>
          </>
        )}
      </div>

      {mode === 'graph' && <NoteGraphView onOpenNote={openNote} />}
      {mode === 'todos' && <TodoPanel onOpenNote={openNote} />}
      {mode === 'edit' && (
        <div className="flex min-h-0 flex-1">
          {/* 左栏: 搜索 + 标签 + 列表 */}
          <div style={{ width: listResize.width }} className="flex shrink-0 flex-col">
            <div className="p-[10px]">
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('notes.searchPlaceholder')}
                className="w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-[10px] py-[7px] text-[13px] outline-none focus:border-[var(--color-text-accent)]"
              />
            </div>
            {allTags.length > 0 && (
              <div className="flex flex-wrap gap-1 px-[10px] pb-[8px]">
                {allTags.map(tag => (
                  <button
                    key={tag}
                    onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
                    className={`rounded-full px-[8px] py-[2px] text-[11px] transition-colors ${
                      tagFilter === tag
                        ? 'bg-[var(--color-text-accent)] text-white'
                        : 'bg-[var(--color-surface-container-low)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]'
                    }`}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto px-[6px] pb-[10px]">
              {grouped.length === 0 && (
                <div className="px-[10px] py-[30px] text-center text-[12px] text-[var(--color-text-tertiary)]">
                  {t('notes.empty')}
                </div>
              )}
              {grouped.map(([folder, items]) => (
                <div key={folder || '(root)'} className="mb-[6px]">
                  <div className="flex items-center justify-between px-[8px] py-[4px]">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-tertiary)]">
                      {folder || t('notes.rootFolder')}
                    </span>
                    <button onClick={() => void createNote(folder)} title={t('notes.newInFolder')} className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]">
                      <FolderPlus size={13} />
                    </button>
                  </div>
                  {items.map(n => (
                    <button
                      key={n.path}
                      onClick={() => openNote(n.path)}
                      className={`block w-full truncate rounded-[7px] px-[10px] py-[6px] text-left text-[13px] transition-colors ${
                        activePath === n.path
                          ? 'bg-[var(--color-surface-container-low)] text-[var(--color-text-primary)]'
                          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                      }`}
                    >
                      {n.title}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div
            onMouseDown={listResize.startDrag}
            onKeyDown={listResize.handleKeyDown}
            className={resizeHandleClass}
            role="separator"
            aria-orientation="vertical"
            tabIndex={0}
            aria-valuenow={Math.round(listResize.width)}
            aria-valuemin={listResize.min}
            aria-valuemax={listResize.max}
          />

          {/* 中栏: 编辑器 */}
          <div className="min-w-0 flex-1">
            {activePath ? (
              <NoteEditor
                key={`${activePath}:${editorReloadKey}`}
                path={activePath}
                onSaved={() => void refresh()}
                onOpenLink={target => void openOrCreate(target)}
                onOrganize={setOrganizeCallback}
                jumpToHeading={headingJump}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-[13px] text-[var(--color-text-tertiary)]">
                {t('notes.selectOrCreate')}
              </div>
            )}
          </div>

          {/* 右栏: 大纲/反链/历史 */}
          {sideOpen && activePath && (
            <div
              onMouseDown={sideResize.startDrag}
              onKeyDown={sideResize.handleKeyDown}
              className={resizeHandleClass}
              role="separator"
              aria-orientation="vertical"
              tabIndex={0}
              aria-valuenow={Math.round(sideResize.width)}
              aria-valuemin={sideResize.min}
              aria-valuemax={sideResize.max}
            />
          )}
          {sideOpen && activePath && (
            <div style={{ width: sideResize.width }} className="flex shrink-0 flex-col">
              <div className="flex border-b border-[var(--color-border-separator)]">
                {([
                  ['outline', t('notes.side.outline')],
                  ['backlinks', t('notes.side.backlinks')],
                  ['history', t('notes.side.history')],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setSideTab(key)}
                    className={`flex-1 px-[8px] py-[9px] text-[12px] transition-colors ${
                      sideTab === key
                        ? 'border-b-2 border-[var(--color-text-accent)] text-[var(--color-text-primary)]'
                        : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-[10px]">
                {sideTab === 'outline' && <OutlinePanel path={activePath} onJump={setHeadingJump} />}
                {sideTab === 'backlinks' && <BacklinksPanel path={activePath} onOpenNote={openNote} />}
                {sideTab === 'history' && (
                  <SnapshotPanel
                    path={activePath}
                    onRestore={() => setEditorReloadKey(k => k + 1)}
                    onChanged={() => void refresh()}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <NoteNameDialog
        open={nameDialog !== null}
        title={nameDialog?.mode === 'rename' ? t('notes.rename') : t('notes.newNote')}
        initialValue={nameDialog?.mode === 'rename' ? (activePath ?? '') : (nameDialog?.folder ? `${nameDialog.folder}/` : '')}
        templates={nameDialog?.mode === 'create' ? templates : []}
        initialTemplate={nameDialog?.templatePath ?? ''}
        onSubmit={(path, tpl) => void handleNameSubmit(path, tpl)}
        onClose={() => setNameDialog(null)}
      />
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={confirmDelete}
        title={t('notes.delete')}
        body={t('notes.deleteConfirm', { name: activePath ?? '' })}
        confirmLabel={t('notes.delete')}
        cancelLabel={t('common.cancel')}
        confirmVariant="danger"
        loading={isDeleting}
      />

      {switcherOpen && (
        <QuickSwitcher notes={notes} onOpen={path => { openNote(path); setSwitcherOpen(false) }} onClose={() => setSwitcherOpen(false)} />
      )}
    </div>
  )
}
