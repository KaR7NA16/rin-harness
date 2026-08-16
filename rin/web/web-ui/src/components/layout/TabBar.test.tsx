import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'

vi.mock('./WindowControls', () => ({
  WindowControls: () => null,
  showWindowControls: false,
}))

describe('TabBar', () => {
  beforeEach(async () => {
    Object.defineProperty(window, '__TAURI__', {
      configurable: true,
      value: {},
    })
    vi.resetModules()
    const { useSettingsStore } = await import('../../stores/settingsStore')
    useSettingsStore.setState({ locale: 'en' })
  })

  afterEach(async () => {
    const { useTabStore } = await import('../../stores/tabStore')
    const { useChatStore } = await import('../../stores/chatStore')

    useTabStore.setState({ tabs: [], activeTabId: null, recentSessionIds: [] })
    useChatStore.setState({
      sessions: {},
    } as Partial<ReturnType<typeof useChatStore.getState>>)

    delete (window as typeof window & { __TAURI__?: unknown }).__TAURI__
  })

  it('renders the active session title with a tab close control', async () => {
    const { TabBar } = await import('./TabBar')
    const { useTabStore } = await import('../../stores/tabStore')
    const { useChatStore } = await import('../../stores/chatStore')

    useTabStore.setState({
      tabs: [{ sessionId: 'tab-1', title: 'My Session', type: 'session', status: 'idle' }],
      activeTabId: 'tab-1',
    })
    useChatStore.setState({
      sessions: {},
    } as Partial<ReturnType<typeof useChatStore.getState>>)

    await act(async () => {
      render(<TabBar />)
    })

    expect(screen.getByText('My Session')).toBeInTheDocument()
    expect(screen.getByLabelText('Close My Session')).toBeInTheDocument()
    expect(screen.queryByTestId('window-controls')).not.toBeInTheDocument()
  })

  it('renders every open tab in the top bar and marks the active one', async () => {
    const { TabBar } = await import('./TabBar')
    const { useTabStore } = await import('../../stores/tabStore')
    const { useChatStore } = await import('../../stores/chatStore')

    useTabStore.setState({
      tabs: [
        { sessionId: 'tab-1', title: 'Inactive Session', type: 'session', status: 'idle' },
        { sessionId: 'tab-2', title: 'Active Session', type: 'session', status: 'idle' },
      ],
      activeTabId: 'tab-2',
    })
    useChatStore.setState({
      sessions: {},
    } as Partial<ReturnType<typeof useChatStore.getState>>)

    await act(async () => {
      render(<TabBar />)
    })

    expect(screen.getByText('Active Session')).toBeInTheDocument()
    expect(screen.getByText('Inactive Session')).toBeInTheDocument()
    expect(screen.getByText('Active Session').closest('button')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('Inactive Session').closest('button')).not.toHaveAttribute('aria-current')
  })

  it('marks drag gutters with data-tauri-drag-region', async () => {
    const { TabBar } = await import('./TabBar')
    const { useTabStore } = await import('../../stores/tabStore')
    const { useChatStore } = await import('../../stores/chatStore')

    useTabStore.setState({
      tabs: [{ sessionId: 'tab-1', title: 'My Session', type: 'session', status: 'idle' }],
      activeTabId: 'tab-1',
    })
    useChatStore.setState({
      sessions: {},
    } as Partial<ReturnType<typeof useChatStore.getState>>)

    await act(async () => {
      render(<TabBar />)
    })

    // Outer container should not have the attribute
    expect(screen.getByTestId('tab-bar')).not.toHaveAttribute('data-tauri-drag-region')
    // Gutter should have it
    expect(screen.getByTestId('tab-bar-drag-gutter')).toHaveAttribute('data-tauri-drag-region')
    expect(screen.getByTestId('tab-bar-drag-gutter')).toHaveClass('h-full')
  })

  it('renders terminal tabs with labels and close controls like other tabs', async () => {
    const { TabBar } = await import('./TabBar')
    const { useTabStore } = await import('../../stores/tabStore')
    const { useChatStore } = await import('../../stores/chatStore')

    useTabStore.setState({
      tabs: [{ sessionId: '__terminal__1', title: 'Terminal 1', type: 'terminal', status: 'idle' }],
      activeTabId: '__terminal__1',
    })
    useChatStore.setState({
      sessions: {},
    } as Partial<ReturnType<typeof useChatStore.getState>>)

    await act(async () => {
      render(<TabBar />)
    })

    expect(screen.getByText('Terminal 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Close Terminal 1')).toBeInTheDocument()
    expect(screen.queryByTestId('window-controls')).not.toBeInTheDocument()
  })

  it('does not render legacy tool pages in the top work-object strip', async () => {
    const { TabBar } = await import('./TabBar')
    const { useTabStore } = await import('../../stores/tabStore')
    useTabStore.setState({
      tabs: [
        { sessionId: '__repository__', title: 'Repository', type: 'repository', status: 'idle' },
        { sessionId: 'session-1', title: 'Session', type: 'session', status: 'idle' },
        { sessionId: '__terminal__1', title: 'Terminal 1', type: 'terminal', status: 'idle' },
      ],
      activeTabId: 'session-1',
    })

    await act(async () => { render(<TabBar />) })

    expect(screen.queryByText('Repository')).not.toBeInTheDocument()
    expect(screen.getByText('Session')).toBeInTheDocument()
    expect(screen.getByText('Terminal 1')).toBeInTheDocument()
  })

  it('renders back/forward navigation arrows without a centered title', async () => {
    const { TabBar } = await import('./TabBar')
    const { useTabStore } = await import('../../stores/tabStore')
    const { useChatStore } = await import('../../stores/chatStore')

    useTabStore.setState({
      tabs: [
        { sessionId: 'tab-1', title: 'First', type: 'session', status: 'idle' },
        { sessionId: 'tab-2', title: 'Second', type: 'session', status: 'idle' },
      ],
      activeTabId: 'tab-2',
      navHistory: ['tab-1', 'tab-2'],
      navIndex: 1,
    })
    useChatStore.setState({
      sessions: {},
    } as Partial<ReturnType<typeof useChatStore.getState>>)

    await act(async () => {
      render(<TabBar />)
    })

    expect(screen.getByLabelText('Back')).toBeInTheDocument()
    expect(screen.getByLabelText('Forward')).toBeInTheDocument()
    expect(screen.queryByText('Code')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Back')).not.toBeDisabled()
  })

  it('disables back/forward navigation arrows without history', async () => {
    const { TabBar } = await import('./TabBar')
    const { useTabStore } = await import('../../stores/tabStore')
    const { useChatStore } = await import('../../stores/chatStore')

    useTabStore.setState({
      tabs: [{ sessionId: 'tab-1', title: 'Solo', type: 'session', status: 'idle' }],
      activeTabId: 'tab-1',
      navHistory: ['tab-1'],
      navIndex: 0,
    })
    useChatStore.setState({
      sessions: {},
    } as Partial<ReturnType<typeof useChatStore.getState>>)

    await act(async () => {
      render(<TabBar />)
    })

    expect(screen.getByLabelText('Back')).toBeDisabled()
    expect(screen.getByLabelText('Forward')).toBeDisabled()
  })

  it('renders an empty drag surface when no tabs exist', async () => {
    const { TabBar } = await import('./TabBar')
    const { useTabStore } = await import('../../stores/tabStore')
    const { useChatStore } = await import('../../stores/chatStore')

    useTabStore.setState({
      tabs: [],
      activeTabId: null,
    })
    useChatStore.setState({
      sessions: {},
    } as Partial<ReturnType<typeof useChatStore.getState>>)

    await act(async () => {
      render(<TabBar />)
    })

    expect(screen.getByTestId('tab-bar')).toBeInTheDocument()
    expect(screen.queryByText('rin')).not.toBeInTheDocument()
    expect(screen.queryByTestId('window-controls')).not.toBeInTheDocument()
  })

  it('keeps the model selector out of the top bar', async () => {
    const { TabBar } = await import('./TabBar')
    const { useTabStore } = await import('../../stores/tabStore')
    const { useChatStore } = await import('../../stores/chatStore')

    useTabStore.setState({
      tabs: [{ sessionId: 'tab-1', title: 'My Session', type: 'session', status: 'idle' }],
      activeTabId: 'tab-1',
    })
    useChatStore.setState({
      sessions: {},
    } as Partial<ReturnType<typeof useChatStore.getState>>)

    const { unmount } = render(<TabBar />)

    await act(async () => {})

    expect(screen.queryByTestId('model-selector')).not.toBeInTheDocument()
    expect(screen.queryByTestId('window-controls')).not.toBeInTheDocument()

    unmount()

    useTabStore.setState({
      tabs: [{ sessionId: '__terminal__1', title: 'Terminal', type: 'terminal', status: 'idle' }],
      activeTabId: '__terminal__1',
    })

    await act(async () => {
      render(<TabBar />)
    })

    expect(screen.queryByTestId('model-selector')).not.toBeInTheDocument()
    expect(screen.queryByTestId('window-controls')).not.toBeInTheDocument()
  })
})
