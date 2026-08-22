import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom'

import { useSettingsStore } from '../../stores/settingsStore'
import type { WorkspaceContextStoreSnapshot } from '../../stores/workspaceContextStore'
import type { WorkspaceContext } from '../../types/workspace'
import { WorkspaceContextDialog } from './WorkspaceContextDialog'

const context: WorkspaceContext = {
  name: 'Research',
  rootPath: '/workspace/research',
  sessionId: 'session-1',
  repository: { id: 'repo-1', name: 'Research', status: 'active', detail: '/workspace/research' },
  backend: { id: null, name: 'API', status: 'active', detail: 'ok' },
  sandbox: { id: 'sandbox-1', name: 'research-local', status: 'configured', detail: 'local-sandbox' },
  agentProfile: { id: 'rin-base', name: 'rin-base', status: 'active', detail: 'built-in' },
}

const resources: WorkspaceContextStoreSnapshot = {
  backend: { state: 'ready', health: { status: 'ok', version: '0.1.0', uptime: 10 }, error: null, lastCheckedAt: 1000 },
  repositories: { state: 'ready', items: [], error: null, lastCheckedAt: 1000 },
  sandboxes: { state: 'ready', items: [], error: null, lastCheckedAt: 1000 },
}

describe('WorkspaceContextDialog', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
  })

  it('selects a workspace and retries an individual resource', () => {
    const onSelectProject = vi.fn()
    const onRetryResource = vi.fn()
    const onRetryAgents = vi.fn()

    render(
      <WorkspaceContextDialog
        open
        onClose={vi.fn()}
        context={context}
        projectOptions={[{
          path: '/workspace/research',
          name: 'Research',
          sessionCount: 2,
        }, {
          path: '/workspace/other',
          name: 'Other',
          sessionCount: 1,
        }]}
        currentProjectPath="/workspace/research"
        onSelectProject={onSelectProject}
        resources={resources}
        agentsLoading={false}
        agentsError={null}
        agentsLastCheckedAt={1000}
        onRetryResource={onRetryResource}
        onRetryAgents={onRetryAgents}
      />,
    )

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: /Other/ }))
    expect(onSelectProject).toHaveBeenCalledWith('/workspace/other')

    fireEvent.click(within(screen.getByTestId('workspace-diagnostic-repository')).getByRole('button', { name: 'Retry' }))
    expect(onRetryResource).toHaveBeenCalledWith('repositories')

    fireEvent.click(within(screen.getByTestId('workspace-diagnostic-agent-profile')).getByRole('button', { name: 'Retry' }))
    expect(onRetryAgents).toHaveBeenCalledOnce()
  })
})
