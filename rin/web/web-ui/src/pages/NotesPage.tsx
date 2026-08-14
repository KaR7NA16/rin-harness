/**
 * NotesPage — the Obsidian-style note vault surface.
 *
 * Lists notes, searches, reads/edits a note in a textarea, writes/deletes,
 * exports a session backup, and renders the wikilink graph plus the extracted
 * todo list. Backed by the /api/notes/* endpoints.
 */

import { useCallback, useEffect, useState } from 'react'
import type { Mounted } from '../api'
import { apiGet, apiPost } from '../api'
import type {
  NoteDocument,
  NoteGraph,
  NoteMeta,
  NotePayload,
  NoteSearchResult,
  NoteTodo,
  NotesPayload,
} from '../types'
import { ErrorBox } from '../components/ErrorBox'
import { Loading } from '../components/Loading'

function failMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export default function NotesPage() {
  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [listError, setListError] = useState<string | null>(null)
  const [listLoading, setListLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<NoteSearchResult[] | null>(null)

  const [selected, setSelected] = useState<NoteDocument | null>(null)
  const [draft, setDraft] = useState('')
  const [draftPath, setDraftPath] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)

  const [newPath, setNewPath] = useState('')
  const [backupTitle, setBackupTitle] = useState('')
  const [backupContent, setBackupContent] = useState('')
  const [graph, setGraph] = useState<NoteGraph | null>(null)
  const [todos, setTodos] = useState<NoteTodo[] | null>(null)

  const loadNotes = useCallback(async () => {
    setListLoading(true)
    setListError(null)
    try {
      const data = await apiGet<Mounted<NotesPayload>>('/api/notes')
      if (data.mounted === true) {
        setNotes(data.notes)
      } else {
        setListError('notes service not mounted')
        setNotes([])
      }
    } catch (cause) {
      setListError(failMessage(cause))
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadNotes()
  }, [loadNotes])

  const runSearch = async () => {
    const term = query.trim()
    if (term === '') {
      setSearchResults(null)
      return
    }
    setActionError(null)
    try {
      const data = await apiGet<Mounted<{ results: NoteSearchResult[] }>>('/api/notes/search?query=' + encodeURIComponent(term))
      setSearchResults(data.mounted === true ? data.results : [])
    } catch (cause) {
      setActionError(failMessage(cause))
    }
  }

  const openNote = async (path: string) => {
    setActionError(null)
    try {
      const data = await apiGet<Mounted<NotePayload>>('/api/notes/read?path=' + encodeURIComponent(path))
      if (data.mounted === true) {
        setSelected(data.note)
        setDraft(data.note.content)
        setDraftPath(data.note.path)
      }
    } catch (cause) {
      setActionError(failMessage(cause))
    }
  }

  const saveNote = async () => {
    if (draftPath === '' || selected === null) return
    setActionError(null)
    try {
      const data = await apiPost<Mounted<NotePayload>>('/api/notes/write', { path: draftPath, content: draft })
      if (data.mounted === true) setSelected(data.note)
      void loadNotes()
    } catch (cause) {
      setActionError(failMessage(cause))
    }
  }

  const deleteNote = async () => {
    if (draftPath === '') return
    setActionError(null)
    try {
      await apiPost<Mounted<{ deleted: boolean }>>('/api/notes/delete', { path: draftPath })
      setSelected(null)
      setDraft('')
      setDraftPath('')
      void loadNotes()
    } catch (cause) {
      setActionError(failMessage(cause))
    }
  }

  const createNote = async () => {
    const path = newPath.trim()
    if (path === '') return
    setActionError(null)
    try {
      const data = await apiPost<Mounted<NotePayload>>('/api/notes/write', { path, content: '' })
      if (data.mounted === true) {
        setSelected(data.note)
        setDraft('')
        setDraftPath(data.note.path)
      }
      setNewPath('')
      void loadNotes()
    } catch (cause) {
      setActionError(failMessage(cause))
    }
  }

  const backupSession = async () => {
    if (backupTitle.trim() === '' || backupContent === '') return
    setActionError(null)
    try {
      await apiPost<Mounted<NotePayload>>('/api/notes/backup', { title: backupTitle, content: backupContent })
      setBackupTitle('')
      setBackupContent('')
      void loadNotes()
    } catch (cause) {
      setActionError(failMessage(cause))
    }
  }

  const loadGraph = async () => {
    setActionError(null)
    try {
      const data = await apiGet<Mounted<{ graph: NoteGraph }>>('/api/notes/graph')
      setGraph(data.mounted === true ? data.graph : { nodes: [], edges: [] })
    } catch (cause) {
      setActionError(failMessage(cause))
    }
  }

  const loadTodos = async () => {
    setActionError(null)
    try {
      const data = await apiGet<Mounted<{ todos: NoteTodo[] }>>('/api/notes/todos')
      setTodos(data.mounted === true ? data.todos : [])
    } catch (cause) {
      setActionError(failMessage(cause))
    }
  }

  return (
    <div className="page">
      <h1 className="page-title">Notes</h1>
      {actionError !== null ? <ErrorBox message={actionError} /> : null}

      <div className="page-toolbar">
        <input
          type="text"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="search notes"
          onKeyDown={event => { if (event.key === 'Enter') void runSearch() }}
        />
        <button type="button" onClick={() => void runSearch()}>Search</button>
        <input
          type="text"
          value={newPath}
          onChange={event => setNewPath(event.target.value)}
          placeholder="new note path (e.g. ideas/foo.md)"
        />
        <button type="button" disabled={newPath.trim() === ''} onClick={() => void createNote()}>New</button>
      </div>

      <div className="two-pane">
        <div className="list-pane">
          {listLoading ? (
            <Loading />
          ) : listError !== null ? (
            <ErrorBox message={listError} />
          ) : (
            <NoteList
              notes={searchResults !== null ? [] : notes}
              searchResults={searchResults}
              onOpen={path => void openNote(path)}
            />
          )}
        </div>
        <div className="detail-pane">
          {selected === null ? (
            <div className="muted">Select a note to read and edit it.</div>
          ) : (
            <NoteEditor
              path={draftPath}
              content={draft}
              onChange={setDraft}
              onSave={() => void saveNote()}
              onDelete={() => void deleteNote()}
            />
          )}
        </div>
      </div>

      <div className="card">
        <h3 className="section-title">graph</h3>
        <button type="button" onClick={() => void loadGraph()}>Load graph</button>
        {graph !== null ? <GraphView graph={graph} /> : null}
      </div>

      <div className="card">
        <h3 className="section-title">todos</h3>
        <button type="button" onClick={() => void loadTodos()}>Load todos</button>
        {todos !== null ? <TodoList todos={todos} /> : null}
      </div>

      <div className="card">
        <h3 className="section-title">session backup</h3>
        <div className="form-grid">
          <label className="field-label" htmlFor="backup-title">title</label>
          <input id="backup-title" type="text" value={backupTitle} onChange={event => setBackupTitle(event.target.value)} />
          <label className="field-label" htmlFor="backup-content">content</label>
          <textarea
            id="backup-content"
            className="editor-textarea"
            value={backupContent}
            onChange={event => setBackupContent(event.target.value)}
          />
          <button
            type="button"
            disabled={backupTitle.trim() === '' || backupContent === ''}
            onClick={() => void backupSession()}
          >
            Backup session
          </button>
        </div>
      </div>
    </div>
  )
}

function NoteList(props: {
  notes: NoteMeta[]
  searchResults: NoteSearchResult[] | null
  onOpen: (path: string) => void
}) {
  const { notes, searchResults, onOpen } = props
  if (searchResults !== null) {
    if (searchResults.length === 0) return <div className="muted">no matches</div>
    return (
      <ul className="item-list">
        {searchResults.map((result, index) => (
          <li key={index}>
            <button type="button" className="item-button" onClick={() => onOpen(result.path)}>
              <span className="item-title">{result.path}</span>
              <span className="item-subtitle">{result.title || result.name}</span>
            </button>
          </li>
        ))}
      </ul>
    )
  }
  if (notes.length === 0) return <div className="muted">no notes yet — create one above</div>
  return (
    <ul className="item-list">
      {notes.map(note => (
        <li key={note.path}>
          <button type="button" className="item-button" onClick={() => onOpen(note.path)}>
            <span className="item-title">{note.path}</span>
            <span className="item-subtitle">
              {note.title !== note.name ? note.title + ' · ' : ''}{note.tags.join(' ')}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function NoteEditor(props: {
  path: string
  content: string
  onChange: (content: string) => void
  onSave: () => void
  onDelete: () => void
}) {
  const { path, content, onChange, onSave, onDelete } = props
  return (
    <>
      <div className="detail-header">{path}</div>
      <textarea
        className="editor-textarea"
        value={content}
        onChange={event => onChange(event.target.value)}
      />
      <div className="button-row">
        <button type="button" onClick={onSave}>Save</button>
        <button type="button" onClick={onDelete}>Delete</button>
      </div>
    </>
  )
}

function GraphView({ graph }: { graph: NoteGraph }) {
  const nodes = graph.nodes
  if (nodes.length === 0) return <div className="muted">no notes to graph</div>
  const radius = 150
  const centerX = 200
  const centerY = 200
  const positions = new Map<string, { x: number; y: number }>()
  nodes.forEach((node, index) => {
    const angle = (index / nodes.length) * Math.PI * 2
    positions.set(node.id, {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    })
  })
  return (
    <svg className="graph-svg" viewBox="0 0 400 400" role="img" aria-label="note graph">
      {graph.edges.map((edge, index) => {
        const from = positions.get(edge.from)
        const to = positions.get(edge.to)
        if (from === undefined || to === undefined) return null
        return <line key={index} x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="graph-edge" />
      })}
      {nodes.map(node => {
        const position = positions.get(node.id)
        if (position === undefined) return null
        return (
          <g key={node.id}>
            <circle cx={position.x} cy={position.y} r={6} className="graph-node" />
            <text x={position.x} y={position.y - 10} textAnchor="middle" className="graph-label">
              {node.name}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function TodoList({ todos }: { todos: NoteTodo[] }) {
  if (todos.length === 0) return <div className="muted">no todos</div>
  return (
    <ul className="item-list">
      {todos.map((todo, index) => (
        <li key={index} className="todo-item">
          <span className={todo.done ? 'muted' : ''}>{todo.done ? '[x]' : '[ ]'}</span>
          <span>{todo.text}</span>
          <span className="muted mono">{todo.noteName}:{todo.line}</span>
        </li>
      ))}
    </ul>
  )
}
