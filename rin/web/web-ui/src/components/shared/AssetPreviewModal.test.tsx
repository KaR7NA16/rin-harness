import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '../../stores/settingsStore'
import { filesystemApi, type FileStat } from '../../api/filesystem'
import { AssetPreviewModal } from './AssetPreviewModal'

vi.mock('../../api/filesystem', () => ({
  filesystemApi: {
    stat: vi.fn(),
    text: vi.fn(),
    fileUrl: (path: string, download = false) => `/api/filesystem/file?path=${encodeURIComponent(path)}${download ? '&download=1' : ''}`,
  },
}))

const text = vi.mocked(filesystemApi.text)

beforeEach(() => {
  useSettingsStore.setState({ locale: 'en' })
  vi.clearAllMocks()
})

const pdf: FileStat = {
  path: '/tmp/a.pdf',
  name: 'a.pdf',
  isDirectory: false,
  sizeBytes: 1,
  modifiedAt: 0,
  mimeType: 'application/pdf',
}

describe('AssetPreviewModal', () => {
  it('renders PDFs through the native iframe viewer', () => {
    render(<AssetPreviewModal open file={pdf} onClose={() => {}} />)
    expect(screen.getByTitle('a.pdf')).toBeInTheDocument()
    expect(document.body.querySelector('iframe')).toHaveAttribute(
      'src',
      '/api/filesystem/file?path=%2Ftmp%2Fa.pdf',
    )
  })

  it('renders bounded text previews with truncation notice', async () => {
    text.mockResolvedValue({
      path: '/tmp/a.md',
      content: '# hello',
      truncated: true,
      sizeBytes: 7,
      mimeType: 'text/markdown',
    })
    const file: FileStat = { ...pdf, path: '/tmp/a.md', name: 'a.md', mimeType: 'text/markdown' }
    render(<AssetPreviewModal open file={file} onClose={() => {}} />)

    expect(await screen.findByText('# hello')).toBeInTheDocument()
    expect(screen.getByText(/Text preview truncated/)).toBeInTheDocument()
  })
})
