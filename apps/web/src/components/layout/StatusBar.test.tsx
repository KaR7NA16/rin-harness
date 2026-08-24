import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

const { userMock, gitMock } = vi.hoisted(() => ({
  userMock: vi.fn(),
  gitMock: vi.fn(),
}))

vi.mock('../../api/status', () => ({
  statusApi: {
    user: userMock,
    health: vi.fn(),
    diagnostics: vi.fn(),
  },
}))

vi.mock('../../api/sessions', () => ({
  sessionsApi: {
    getGitInfo: gitMock,
  },
}))

import { StatusBar } from './StatusBar'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'

describe('StatusBar', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    useSettingsStore.setState({
      locale: 'en',
      worktreeEnabled: false,
      connectionMode: 'local',
      setWorktreeEnabled: vi.fn(async () => {}),
      setConnectionMode: vi.fn(async () => {}),
    })
    useTabStore.setState({
      activeTabId: 'tab-1',
      tabs: [{ sessionId: 'tab-1', title: 'Chat', type: 'session', projectPath: '/repo', status: 'idle' }],
    })
  })

  it('renders user name and default repository label', async () => {
    userMock.mockResolvedValue({ configDir: '/c', projects: [], username: 'alice', hostname: 'box', homeDir: '/h' })
    gitMock.mockResolvedValue({ branch: null, repoName: null, changedFiles: 0 })

    render(<StatusBar />)

    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument())
    expect(screen.getByText('No source repository')).toBeInTheDocument()
  })

  it('renders git repo name, branch and changed file count', async () => {
    userMock.mockResolvedValue({ configDir: '/c', projects: [], username: 'alice', hostname: 'box', homeDir: '/h' })
    gitMock.mockResolvedValue({ branch: 'main', repoName: 'myrepo', changedFiles: 3 })

    render(<StatusBar />)

    await waitFor(() => expect(screen.getByText('myrepo')).toBeInTheDocument())
    expect(screen.getByText('main')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('toggles worktree and persists through the settings store', async () => {
    userMock.mockResolvedValue({ configDir: '/c', projects: [], username: 'alice', hostname: 'box', homeDir: '/h' })
    gitMock.mockResolvedValue({ branch: null, repoName: null, changedFiles: 0 })

    render(<StatusBar />)

    const button = screen.getByTestId('statusbar-worktree')
    await fireEvent.click(button)
    expect(useSettingsStore.getState().setWorktreeEnabled).toHaveBeenCalledWith(true)
  })

  it('switches between local and remote mode', async () => {
    userMock.mockResolvedValue({ configDir: '/c', projects: [], username: 'alice', hostname: 'box', homeDir: '/h' })
    gitMock.mockResolvedValue({ branch: null, repoName: null, changedFiles: 0 })

    render(<StatusBar />)

    const mode = screen.getByTestId('statusbar-mode')
    await fireEvent.click(mode)
    expect(useSettingsStore.getState().setConnectionMode).toHaveBeenCalledWith('remote')
  })
})
