import { api } from './client'

export type NoteLink = { raw: string; target: string; alias?: string }

export type NoteMeta = {
  path: string
  name: string
  folder: string
  title: string
  sizeBytes: number
  modifiedAt: string
  tags: string[]
  links: NoteLink[]
}

export type NoteDocument = NoteMeta & { content: string }

export type NoteSearchResult = {
  path: string
  name: string
  title: string
  snippet: string
  score: number
}

export type NoteGraphNode = { id: string; name: string; folder: string; tag: string | null }
export type NoteGraphEdge = { from: string; to: string }
export type NoteGraph = { nodes: NoteGraphNode[]; edges: NoteGraphEdge[] }

export type NoteTodo = {
  notePath: string
  noteName: string
  line: number
  text: string
  done: boolean
  due?: string
  start?: string
  scheduled?: string
  recurrence?: string
  priority: 'lowest' | 'low' | 'medium' | 'high' | 'highest'
}

export type NoteInlineField = { key: string; value: string }

export type NoteQueryNote = {
  path: string
  name: string
  folder: string
  title: string
  tags: string[]
  fields: NoteInlineField[]
  modifiedAt: string
}

export type NoteQueryTask = NoteTodo

export type NoteQueryResult =
  | { kind: 'notes'; notes: NoteQueryNote[] }
  | { kind: 'tasks'; tasks: NoteQueryTask[] }

export type NoteSnapshot = { id: string; createdAt: string; sizeBytes: number }
export type NoteTemplate = { name: string; path: string }

const noteUrl = (p: string) =>
  `/api/notes/note/${p.split('/').map(encodeURIComponent).join('/')}`

export const notesApi = {
  root: () => api.get<{ mounted: true; root: string }>('/api/notes/root'),

  list: () => api.get<{ notes: NoteMeta[] }>('/api/notes/list'),

  search: (q: string) =>
    api.get<{ results: NoteSearchResult[] }>(`/api/notes/search?q=${encodeURIComponent(q)}`),

  graph: () => api.get<NoteGraph>('/api/notes/graph'),

  query: (dsl: string) =>
    api.get<NoteQueryResult>(`/api/notes/query?q=${encodeURIComponent(dsl)}`),

  read: (path: string) => api.get<NoteDocument>(noteUrl(path)),

  properties: (path: string) =>
    api.get<{ mounted: true; properties: Record<string, unknown> | null }>(
      `/api/notes/properties?path=${encodeURIComponent(path)}`,
    ),

  updateProperties: (path: string, properties: Record<string, unknown>) =>
    api.post<{ mounted: true; note: NoteDocument }>('/api/notes/properties', { path, properties }),

  renameTag: (from: string, to: string) =>
    api.post<{ mounted: true; result: { renamed: number; paths: string[] } }>('/api/notes/tags/rename', { from, to }),

  write: (path: string, content: string) =>
    api.put<NoteDocument>(noteUrl(path), { content }),

  create: (path: string, content = '') =>
    api.post<NoteDocument>(noteUrl(path), { content }),

  remove: (path: string) => api.delete<{ removed: boolean }>(noteUrl(path)),

  move: (from: string, to: string) =>
    api.post<NoteDocument>('/api/notes/move', { from, to }),

  daily: () => api.post<NoteDocument>('/api/notes/daily', {}),

  templates: () => api.get<{ templates: NoteTemplate[] }>('/api/notes/templates'),

  createFromTemplate: (path: string, template: string) =>
    api.post<NoteDocument>('/api/notes/from-template', { path, template }),

  backlinks: (path: string) =>
    api.get<{ backlinks: NoteMeta[] }>(`/api/notes/backlinks?path=${encodeURIComponent(path)}`),

  todos: () => api.get<{ todos: NoteTodo[] }>('/api/notes/todos'),

  setTodo: (notePath: string, line: number, done: boolean) =>
    api.post<{ ok: boolean }>('/api/notes/todos', { notePath, line, done }),

  uploadAsset: (fileName: string, base64: string) =>
    api.post<{ path: string }>('/api/notes/assets', { fileName, base64 }),

  uploadAssetFile: (file: Blob, fileName = file instanceof File ? file.name : 'document') =>
    api.rawPostJson<{ path: string; url: string }>(
      `/api/notes/assets/raw?fileName=${encodeURIComponent(fileName)}`,
      file,
    ),

  assetUrl: (path: string) =>
    `/api/notes/assets/${path.split('/').map(encodeURIComponent).join('/')}`,

  snapshots: (path: string) =>
    api.get<{ snapshots: NoteSnapshot[] }>(`/api/notes/snapshots?path=${encodeURIComponent(path)}`),

  readSnapshot: (path: string, id: string) =>
    api.get<{ content: string }>(
      `/api/notes/snapshot?path=${encodeURIComponent(path)}&id=${encodeURIComponent(id)}`,
    ),

  exportHtml: (path: string) =>
    api.get<{ html: string; title: string }>(`/api/notes/export?path=${encodeURIComponent(path)}`),
}
