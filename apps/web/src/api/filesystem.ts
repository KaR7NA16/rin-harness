import { api } from './client'

export type DirEntry = {
  name: string
  path: string
  isDirectory: boolean
}

export type BrowseResult = {
  currentPath: string
  parentPath: string
  entries: DirEntry[]
  query?: string
}

export type FileStat = {
  path: string
  name: string
  isDirectory: boolean
  sizeBytes: number
  modifiedAt: number
  mimeType: string
}

export type TextFileRead = {
  path: string
  content: string
  truncated: boolean
  sizeBytes: number
  mimeType: string
}

export const filesystemApi = {
  fileUrl(path: string, download = false) {
    return `/api/filesystem/file?path=${encodeURIComponent(path)}${download ? '&download=1' : ''}`
  },

  stat(path: string) {
    return api.get<FileStat>(`/api/filesystem/stat?path=${encodeURIComponent(path)}`)
  },

  text(path: string, maxBytes?: number) {
    const q = new URLSearchParams({ path })
    if (maxBytes !== undefined) q.set('maxBytes', String(maxBytes))
    return api.get<TextFileRead>(`/api/filesystem/text?${q}`)
  },


  browse(path?: string, options?: { includeFiles?: boolean }) {
    const q = new URLSearchParams()
    if (path) q.set('path', path)
    if (options?.includeFiles) q.set('includeFiles', 'true')
    const qs = q.toString()
    return api.get<BrowseResult>(`/api/filesystem/browse${qs ? `?${qs}` : ''}`)
  },

  search(query: string, cwd?: string) {
    const q = new URLSearchParams({ search: query, maxResults: '200' })
    if (cwd) q.set('path', cwd)
    return api.get<BrowseResult>(`/api/filesystem/browse?${q}`)
  },
}
