import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsPanel } from './SettingsPanel'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUIStore } from '../../stores/uiStore'

vi.mock('../../pages/Settings', () => ({
  Settings: () => <div data-testid="settings-home" />,
  ProviderSettings: () => <div data-testid="providers-panel" />,
  PermissionSettings: () => <div data-testid="permissions-panel" />,
  GeneralSettings: () => <div data-testid="general-panel" />,
  MemorySettings: () => <div data-testid="memory-panel" />,
  SkillSettings: () => <div data-testid="skills-panel" />,
  PluginSettings: () => <div data-testid="plugins-panel" />,
  AgentsSettings: () => <div data-testid="agents-panel" />,
  AboutSettings: () => <div data-testid="about-panel" />,
}))

vi.mock('../../pages/AdapterSettings', () => ({
  AdapterSettings: () => <div data-testid="adapters-panel" />,
}))

vi.mock('../../pages/ComputerUseSettings', () => ({
  ComputerUseSettings: () => <div data-testid="computer-use-panel" />,
}))

vi.mock('../../pages/McpSettings', () => ({
  McpSettings: () => <div data-testid="mcp-panel" />,
}))

vi.mock('../../features/scheduledTasks', () => ({
  ScheduledTasks: () => <div data-testid="scheduled-panel" />,
}))

vi.mock('../../pages/TerminalSettings', () => ({
  TerminalSettings: ({ active, workspace }: { active: boolean; workspace: boolean }) => (
    <div data-active={String(active)} data-workspace={String(workspace)} data-testid="terminal-panel" />
  ),
}))

vi.mock('../../pages/TokenOptimization', () => ({
  TokenOptimization: ({ initialView = 'overview' }: { initialView?: string }) => (
    <div data-initial-view={initialView} data-testid="token-optimization-panel" />
  ),
}))

vi.mock('../../pages/KnowledgeSpace', () => ({
  KnowledgeSpace: () => <div data-testid="knowledge-space-panel" />,
}))

describe('SettingsPanel content routing', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'zh' })
    useUIStore.setState({
      settingsOpen: true,
      settingsPanelView: 'settings',
      pendingSettingsTab: null,
      railSettingsView: null,
    })
  })

  it('renders the normal settings home for the settings button', () => {
    render(<SettingsPanel visible />)

    expect(screen.getByTestId('settings-home')).toBeInTheDocument()
    expect(screen.getByTestId('settings-panel')).toHaveAttribute('role', 'dialog')
    expect(screen.getByTestId('settings-panel')).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByTestId('settings-panel')).toHaveClass('z-[90]')
    expect(screen.getByTestId('settings-panel')).toHaveClass('right-0')
  })

  it('keeps the chat-side rail clickable when opened from a project session', () => {
    render(<SettingsPanel visible reserveRightRail />)

    expect(screen.getByTestId('settings-panel')).toHaveClass('right-[var(--sidebar-rail-width)]')
    expect(screen.getByTestId('settings-panel')).not.toHaveClass('right-0')
  })

  it('does not duplicate scheduled tasks inside the settings shell', () => {
    useUIStore.setState({ settingsPanelView: 'scheduled' })

    render(<SettingsPanel visible />)

    expect(screen.getByTestId('settings-home')).toBeInTheDocument()
    expect(screen.queryByTestId('scheduled-panel')).not.toBeInTheDocument()
  })

  it('routes terminal into the settings home (terminal lives in main-area tabs)', () => {
    useUIStore.setState({ settingsPanelView: 'terminal' })

    render(<SettingsPanel visible />)

    expect(screen.getByTestId('settings-home')).toBeInTheDocument()
  })

  it('closes the settings shell when Escape is pressed and no child modal is open', () => {
    render(<SettingsPanel visible />)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(useUIStore.getState().settingsOpen).toBe(false)
  })

  it('moves focus into the settings dialog when it opens', () => {
    const { getByTestId } = render(<SettingsPanel visible />)

    expect(document.activeElement).toBe(getByTestId('settings-panel'))
  })

  it('renders prompt memory via the settings home nav', () => {
    useUIStore.setState({ settingsPanelView: 'memory', pendingSettingsTab: 'memory' })

    render(<SettingsPanel visible />)

    expect(screen.getByTestId('settings-home')).toBeInTheDocument()
  })

  it('renders token optimization via the settings home nav', () => {
    useUIStore.setState({ settingsPanelView: 'tokenOptimization', pendingSettingsTab: 'tokenOptimization' })

    render(<SettingsPanel visible />)

    expect(screen.getByTestId('settings-home')).toBeInTheDocument()
  })

  it('does not duplicate Code Graph inside the settings shell', () => {
    useUIStore.setState({ settingsPanelView: 'codeGraph' })

    render(<SettingsPanel visible />)

    expect(screen.getByTestId('settings-home')).toBeInTheDocument()
    expect(screen.queryByTestId('knowledge-space-panel')).not.toBeInTheDocument()
  })
})
