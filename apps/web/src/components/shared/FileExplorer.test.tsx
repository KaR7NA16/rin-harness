import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '../../stores/settingsStore'
import { filesystemApi } from '../../api/filesystem'
import { FileExplorer } from './FileExplorer'

vi.mock('../../api/filesystem', () => ({
  filesystemApi: {
    browse: vi.fn(),
    stat: vi.fn(),
    text: vi.fn(),
    fileUrl: (path: string, download = false) => `/api/filesystem/file?path=${encodeURIComponent(path)}${download ? '&download=1' : ''}`,
  },
}))

const browse = vi.mocked(filesystemApi.browse)
const stat = vi.mocked(filesystemApi.stat)

beforeEach(() => {
  useSettingsStore.setState({ locale: 'en' })
  vi.clearAllMocks()
  browse.mockResolvedValue({
    currentPath: '/tmp/root',
    parentPath: '/tmp',
    entries: [
      { name: 'docs', path: '/tmp/root/docs', isDirectory: true },
      { name: 'report.pdf', path: '/tmp/root/report.pdf', isDirectory: false },
    ],
  })
  stat.mockResolvedValue({
    path: '/tmp/root/report.pdf',
    name: 'report.pdf',
    isDirectory: false,
    sizeBytes: 10,
    modifiedAt: 0,
    mimeType: 'application/pdf',
  })
})

describe('FileExplorer', () => {
  it('lists directories first and opens a PDF preview', async () => {
    render(<FileExplorer initialPath="/tmp/root" />)

    expect(await screen.findByText('docs')).toBeInTheDocument()
    expect(screen.getByText('report.pdf')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'report.pdf' }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(document.body.querySelector('iframe')).toHaveAttribute(
      'src',
      '/api/filesystem/file?path=%2Ftmp%2Froot%2Freport.pdf',
    )
  })

  it('navigates into a directory using the parent breadcrumb', async () => {
    browse.mockResolvedValueOnce({
      currentPath: '/tmp/root',
      parentPath: '/tmp',
      entries: [{ name: 'docs', path: '/tmp/root/docs', isDirectory: true }],
    }).mockResolvedValueOnce({
      currentPath: '/tmp/root/docs',
      parentPath: '/tmp/root',
      entries: [],
    })

    render(<FileExplorer initialPath="/tmp/root" />)

    fireEvent.click(await screen.findByRole('button', { name: 'docs' }))
    await waitFor(() => {
      expect(browse).toHaveBeenLastCalledWith('/tmp/root/docs', { includeFiles: true })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Parent folder' }))
    await waitFor(() => {
      expect(browse).toHaveBeenLastCalledWith('/tmp/root', { includeFiles: true })
    })
  })
})
