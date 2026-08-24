import { act, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../pages/ActiveSession', () => ({
  ActiveSession: ({ sessionId, isActive }: { sessionId: string; isActive: boolean }) => (
    <div
      data-testid="active-session"
      data-session-id={sessionId}
      data-active={isActive ? 'true' : 'false'}
    />
  ),
}))

vi.mock('../../pages/EmptySession', () => ({
  EmptySession: () => <div data-testid="empty-session" />,
}))

vi.mock('../../features/scheduledTasks', () => ({
  ScheduledTasks: () => <div data-testid="scheduled-tasks" />,
}))

vi.mock('../../pages/Files', () => ({
  Files: () => <div data-testid="files-page" />,
}))

vi.mock('../../pages/Terminal', () => ({
  Terminal: ({ terminalId, spawnCommand, cwd }: { terminalId: string; spawnCommand?: string[]; cwd?: string }) => (
    <div
      data-testid="terminal-page"
      data-terminal-id={terminalId}
      data-spawn-command={spawnCommand?.join(' ')}
      data-cwd={cwd}
    />
  ),
}))

vi.mock('../../pages/Settings', () => ({
  Settings: () => <div data-testid="settings-page" />,
  ProviderSettings: () => <div data-testid="settings-page" />,
  PermissionSettings: () => <div data-testid="settings-page" />,
  GeneralSettings: () => <div data-testid="settings-page" />,
  SkillSettings: () => <div data-testid="settings-page" />,
  PluginSettings: () => <div data-testid="settings-page" />,
  AgentsSettings: () => <div data-testid="settings-page" />,
  AboutSettings: () => <div data-testid="settings-page" />,
}))

import { ContentRouter } from './ContentRouter'
import { useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'

describe('ContentRouter content routing', () => {
  afterEach(() => {
    useTabStore.setState({ tabs: [], activeTabId: null })
    useUIStore.setState({ settingsOpen: false, pendingSettingsTab: null })
  })

  it('renders the empty session page when no tab is active', () => {
    useTabStore.setState({ tabs: [], activeTabId: null, recentSessionIds: [] })

    render(<ContentRouter />)

    expect(screen.getByTestId('empty-session')).toBeInTheDocument()
  })

  it('keeps only the current and previous chat panels warm across switches', () => {
    useTabStore.setState({
      tabs: [
        { sessionId: 'session-1', title: 'One', type: 'session', status: 'idle' },
        { sessionId: 'session-2', title: 'Two', type: 'session', status: 'idle' },
        { sessionId: 'session-3', title: 'Three', type: 'session', status: 'idle' },
      ],
      activeTabId: 'session-1',
      recentSessionIds: ['session-1', 'session-2', 'session-3'],
    })

    render(<ContentRouter />)

    const sessionOne = document.querySelector('[data-session-panel="session-1"]')
    const sessionTwo = document.querySelector('[data-session-panel="session-2"]')
    expect(sessionOne).toBeInTheDocument()
    expect(sessionTwo).toBeInTheDocument()
    expect(document.querySelector('[data-session-panel="session-3"]')).toBeNull()
    expect(sessionOne).not.toHaveClass('invisible')
    expect(sessionOne).not.toHaveAttribute('aria-hidden', 'true')
    expect(sessionTwo).toHaveClass('invisible', 'pointer-events-none')
    expect(sessionTwo).toHaveAttribute('aria-hidden', 'true')

    act(() => {
      useTabStore.getState().switchToSession('session-2', 'Two')
    })

    expect(document.querySelector('[data-session-panel="session-1"]')).toBe(sessionOne)
    expect(document.querySelector('[data-session-panel="session-2"]')).toBe(sessionTwo)
    expect(sessionOne).toHaveClass('invisible', 'pointer-events-none')
    expect(sessionOne).toHaveAttribute('aria-hidden', 'true')
    expect(sessionTwo).not.toHaveClass('invisible')
    expect(sessionTwo).not.toHaveAttribute('aria-hidden', 'true')
  })

  it('renders the Files workspace from the icon rail view state', async () => {
    useUIStore.setState({ workspaceView: 'files' })

    render(<ContentRouter />)

    expect(await screen.findByTestId('files-page')).toBeInTheDocument()
  })

  it('renders the Terminal page for a terminal tab with its spawn command', async () => {
    useTabStore.setState({
      tabs: [{
        sessionId: '__terminal__1',
        title: 'Terminal 1',
        type: 'terminal',
        status: 'idle',
        cwd: '/workspace/research',
        spawnCommand: ['bash', '-l'],
      }],
      activeTabId: '__terminal__1',
      recentSessionIds: [],
    })

    render(<ContentRouter />)

    const terminal = await screen.findByTestId('terminal-page')
    expect(terminal).toBeInTheDocument()
    expect(terminal).toHaveAttribute('data-terminal-id', '__terminal__1')
    expect(terminal).toHaveAttribute('data-cwd', '/workspace/research')
    expect(terminal).toHaveAttribute('data-spawn-command', 'bash -l')
  })

  it('renders the Terminal page without a spawn command when the tab has none', async () => {
    useTabStore.setState({
      tabs: [{ sessionId: '__terminal__1', title: 'Terminal 1', type: 'terminal', status: 'idle' }],
      activeTabId: '__terminal__1',
      recentSessionIds: [],
    })

    render(<ContentRouter />)

    const terminal = screen.getByTestId('terminal-page')
    expect(terminal).toHaveAttribute('data-terminal-id', '__terminal__1')
    expect(terminal).not.toHaveAttribute('data-spawn-command')
  })

  it('treats a terminal tab as a tab rather than a workspace view', async () => {
    useTabStore.setState({
      tabs: [{ sessionId: '__terminal__1', title: 'Terminal 1', type: 'terminal', status: 'idle' }],
      activeTabId: '__terminal__1',
      recentSessionIds: [],
    })

    render(<ContentRouter />)

    expect(await screen.findByTestId('terminal-page')).toBeInTheDocument()
    expect(screen.queryByTestId('empty-session')).not.toBeInTheDocument()
    expect(screen.queryByTestId('scheduled-tasks')).not.toBeInTheDocument()
  })

  it('redirects a legacy backup tab into the settings backup page', () => {
    useTabStore.setState({
      tabs: [{ sessionId: '__backup__', title: 'Session backup', type: 'backup', status: 'idle' }],
      activeTabId: '__backup__',
      recentSessionIds: [],
    })

    render(<ContentRouter />)

    expect(useUIStore.getState().settingsOpen).toBe(true)
    expect(useUIStore.getState().pendingSettingsTab).toBe('sessionBackup')
  })
})
