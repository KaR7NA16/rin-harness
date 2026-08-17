import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { filesystemApi } from '../api/filesystem'
import { Files } from './Files'
import { useTabStore } from '../stores/tabStore'
import { useSettingsStore } from '../stores/settingsStore'

vi.mock('../api/status', () => ({
  statusApi: { user: vi.fn().mockResolvedValue({ homeDir: '/home/rin' }) },
}))
vi.mock('../api/notes', () => ({
  notesApi: { root: vi.fn().mockResolvedValue({ mounted: true, root: '/home/rin/.rin/notes' }) },
}))
vi.mock('../api/knowledge', () => ({
  knowledgeApi: {
    sources: vi.fn().mockResolvedValue([{ id: 'k1', name: 'papers', path: '/home/rin/papers', kind: 'folder' }]),
  },
}))
vi.mock('../api/repositories', () => ({
  repositoriesApi: {
    list: vi.fn().mockResolvedValue({ repositories: [{ id: 'r1', name: 'builtin', rootPath: '/home/rin/repo' }] }),
  },
}))
vi.mock('../api/filesystem', () => ({
  filesystemApi: {
    browse: vi.fn().mockResolvedValue({ currentPath: '/home/rin', parentPath: '/home', entries: [] }),
    stat: vi.fn(),
    text: vi.fn(),
    fileUrl: (path: string) => `/api/filesystem/file?path=${encodeURIComponent(path)}`,
  },
}))

const browse = vi.mocked(filesystemApi.browse)

beforeEach(() => {
  useSettingsStore.setState({ locale: 'en' })
  vi.clearAllMocks()
  browse.mockResolvedValue({ currentPath: '/home/rin', parentPath: '/home', entries: [] })
  useTabStore.setState({ tabs: [], activeTabId: null })
})

describe('Files', () => {
  it('shows home, notes, knowledge, and repository roots', async () => {
    render(<Files />)

    expect(await screen.findByRole('button', { name: 'Home' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Notes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Knowledge/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Repository/ })).toBeInTheDocument()
    await waitFor(() => expect(browse).toHaveBeenCalledWith('/home/rin', { includeFiles: true }))
  })

  it('puts the active workspace first and browses it by default', async () => {
    useTabStore.setState({
      tabs: [{ sessionId: 's1', title: 'S', type: 'session', status: 'idle', projectPath: '/home/rin/work' }],
      activeTabId: 's1',
    })
    render(<Files />)

    expect(await screen.findByRole('button', { name: 'Workspace' })).toBeInTheDocument()
    await waitFor(() => expect(browse).toHaveBeenCalledWith('/home/rin/work', { includeFiles: true }))
  })
})
