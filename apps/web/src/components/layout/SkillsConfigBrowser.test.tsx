import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { skillsApi } from '../../api/skills'
import { filesystemApi } from '../../api/filesystem'
import { useSettingsStore } from '../../stores/settingsStore'
import { SkillsConfigBrowser } from './SkillsConfigBrowser'

vi.mock('../../api/skills', () => ({
  skillsApi: {
    config: vi.fn(),
  },
}))

vi.mock('../../api/filesystem', () => ({
  filesystemApi: {
    browse: vi.fn(),
  },
}))

const mockConfig = vi.mocked(skillsApi.config)
const mockBrowse = vi.mocked(filesystemApi.browse)

describe('SkillsConfigBrowser', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    vi.clearAllMocks()
    mockConfig.mockResolvedValue({
      config: { userSkillsDir: '/home/rin/.rin/skill-memory', displayPath: '~/.rin/skill-memory' },
    })
    mockBrowse.mockResolvedValue({
      currentPath: '/home/rin/.rin/skill-memory',
      parentPath: '/home/rin/.rin',
      entries: [
        { name: 'alpha', path: '/home/rin/.rin/skill-memory/alpha', isDirectory: true },
        { name: 'beta', path: '/home/rin/.rin/skill-memory/beta', isDirectory: true },
        { name: 'SKILL.md', path: '/home/rin/.rin/skill-memory/SKILL.md', isDirectory: false },
      ],
    })
  })

  it('browses the configured skills directory when opened', async () => {
    render(<SkillsConfigBrowser open onClose={() => {}} />)

    expect(await screen.findByText('alpha')).toBeInTheDocument()
    expect(screen.getByText('beta')).toBeInTheDocument()
    expect(screen.getByText('SKILL.md')).toBeInTheDocument()
    expect(mockBrowse).toHaveBeenCalledWith('/home/rin/.rin/skill-memory', { includeFiles: true })
  })

  it('navigates into a subdirectory and back to the parent', async () => {
    render(<SkillsConfigBrowser open onClose={() => {}} />)
    await screen.findByText('alpha')

    mockBrowse.mockResolvedValueOnce({
      currentPath: '/home/rin/.rin/skill-memory/alpha',
      parentPath: '/home/rin/.rin/skill-memory',
      entries: [{ name: 'SKILL.md', path: '/home/rin/.rin/skill-memory/alpha/SKILL.md', isDirectory: false }],
    })
    fireEvent.click(screen.getByText('alpha'))

    expect(await screen.findByText('SKILL.md')).toBeInTheDocument()
    expect(mockBrowse).toHaveBeenLastCalledWith('/home/rin/.rin/skill-memory/alpha', { includeFiles: true })

    mockBrowse.mockResolvedValueOnce({
      currentPath: '/home/rin/.rin/skill-memory',
      parentPath: '/home/rin/.rin',
      entries: [
        { name: 'alpha', path: '/home/rin/.rin/skill-memory/alpha', isDirectory: true },
        { name: 'beta', path: '/home/rin/.rin/skill-memory/beta', isDirectory: true },
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Up' }))

    expect(await screen.findByText('beta')).toBeInTheDocument()
    expect(mockBrowse).toHaveBeenLastCalledWith('/home/rin/.rin/skill-memory', { includeFiles: true })
  })

  it('shows an error with a retry action when the directory cannot be loaded', async () => {
    mockBrowse.mockRejectedValueOnce(new Error('denied'))

    render(<SkillsConfigBrowser open onClose={() => {}} />)

    expect(await screen.findByText('Failed to load the skills directory.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(screen.getByText('alpha')).toBeInTheDocument())
  })

  it('stays closed without fetching when not opened', () => {
    render(<SkillsConfigBrowser open={false} onClose={() => {}} />)

    expect(mockConfig).not.toHaveBeenCalled()
    expect(mockBrowse).not.toHaveBeenCalled()
  })
})
