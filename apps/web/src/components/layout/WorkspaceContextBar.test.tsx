import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

import type { AgentDefinition } from '../../api/agents'
import { useAgentStore } from '../../stores/agentStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTabStore } from '../../stores/tabStore'
import { useUIStore } from '../../stores/uiStore'
import { useWorkspaceContextStore } from '../../stores/workspaceContextStore'
import { WorkspaceContextBar } from './WorkspaceContextBar'

const session = {
  id: 'session-1',
  title: 'Research',
  createdAt: '2026-08-22T00:00:00.000Z',
  modifiedAt: '2026-08-22T00:00:00.000Z',
  messageCount: 1,
  projectPath: '-workspace-research',
  workDir: '/workspace/research',
  workDirExists: true,
  isTemporary: false,
}

const otherSession = {
  ...session,
  id: 'session-2',
  title: 'Other',
  projectPath: '-workspace-other',
  workDir: '/workspace/other',
}

const agent: AgentDefinition = {
  agentType: 'rin-base',
  source: 'built-in',
  isActive: true,
}

const repository = {
  id: 'repo-1',
  name: 'Research',
  rootPath: '/workspace/research',
  environmentPackages: [],
  environmentProfiles: [],
  createdAt: '2026-08-22T00:00:00.000Z',
  updatedAt: '2026-08-22T00:00:00.000Z',
}

const initialAgentState = useAgentStore.getState()
const initialSessionState = useSessionStore.getState()
const initialSettingsState = useSettingsStore.getState()
const initialTabState = useTabStore.getState()
const initialUIState = useUIStore.getState()
const initialWorkspaceState = useWorkspaceContextStore.getState()

describe('WorkspaceContextBar', () => {
  beforeEach(() => {
    useSettingsStore.setState({ ...initialSettingsState, locale: 'en' })
    useSessionStore.setState({
      ...initialSessionState,
      sessions: [session, otherSession],
      selectedProjects: ['-workspace-research'],
      selectedSessionScope: 'project',
      availableProjects: ['-workspace-other', '-workspace-research'],
      projectDisplayNames: {},
    })
    useTabStore.setState({
      ...initialTabState,
      tabs: [{
        sessionId: session.id,
        projectPath: session.projectPath,
        title: session.title,
        type: 'session',
        status: 'idle',
      }],
      activeTabId: session.id,
      recentSessionIds: [session.id],
      switchToSession: vi.fn(),
    })
    useAgentStore.setState({
      ...initialAgentState,
      activeAgents: [agent],
      allAgents: [agent],
      selectedAgent: agent,
      isLoading: false,
      error: null,
      lastCheckedAt: 1000,
      fetchAgents: vi.fn(async () => {}),
    })
    useUIStore.setState({
      ...initialUIState,
      openWorkspaceView: vi.fn(),
    })
    useWorkspaceContextStore.setState({
      ...initialWorkspaceState,
      backend: { state: 'ready', health: { status: 'ok', version: '0.1.0', uptime: 1 }, error: null, lastCheckedAt: 1000 },
      repositories: { state: 'ready', items: [repository], error: null, lastCheckedAt: 1000 },
      sandboxes: { state: 'ready', items: [], error: null, lastCheckedAt: 1000 },
      refresh: vi.fn(async () => {}),
      refreshResource: vi.fn(async () => {}),
    })
  })

  afterEach(() => {
    useAgentStore.setState(initialAgentState)
    useSessionStore.setState(initialSessionState)
    useSettingsStore.setState(initialSettingsState)
    useTabStore.setState(initialTabState)
    useUIStore.setState(initialUIState)
    useWorkspaceContextStore.setState(initialWorkspaceState)
  })

  it('opens the workspace chooser and navigates through the existing session store', () => {
    render(<WorkspaceContextBar />)

    fireEvent.click(screen.getByTestId('workspace-context-identity'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('workspace-option--workspace-other'))

    expect(useSessionStore.getState().selectedProjects).toEqual(['-workspace-other'])
    expect(useTabStore.getState().switchToSession).toHaveBeenCalledWith(
      'session-2',
      'Other',
      '-workspace-other',
    )
  })

  it('keeps resource chips connected to the existing workspace views', () => {
    render(<WorkspaceContextBar />)

    fireEvent.click(screen.getByTestId('workspace-context-repository'))

    expect(useUIStore.getState().openWorkspaceView).toHaveBeenCalledWith('repository')
  })
})
