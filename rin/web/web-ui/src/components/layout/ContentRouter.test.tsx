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
    useUIStore.setState({ settingsOpen: false, settingsPanelView: 'settings', pendingSettingsTab: null })
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

  it('redirects a legacy backup tab into the settings backup page', () => {
    useTabStore.setState({
      tabs: [{ sessionId: '__backup__', title: 'Session backup', type: 'backup', status: 'idle' }],
      activeTabId: '__backup__',
      recentSessionIds: [],
    })

    render(<ContentRouter />)

    expect(useUIStore.getState().settingsOpen).toBe(true)
    expect(useUIStore.getState().settingsPanelView).toBe('settings')
    expect(useUIStore.getState().pendingSettingsTab).toBe('sessionBackup')
  })
})
