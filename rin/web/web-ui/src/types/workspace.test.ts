import { describe, expect, it } from 'vitest'
import { resolveWorkspaceContext, type WorkspaceContextInput } from './workspace'

const session = {
  id: 'session-1',
  title: 'Analysis',
  createdAt: '2026-08-21T00:00:00.000Z',
  modifiedAt: '2026-08-21T00:00:00.000Z',
  messageCount: 0,
  projectPath: 'c--work-research',
  workDir: 'C:\\Work\\Research',
  workDirExists: true,
  isTemporary: false,
}

const repository = {
  id: 'repo-1',
  name: 'research',
  rootPath: 'c:/work/research',
  environmentPackages: [],
  environmentProfiles: [],
  createdAt: '2026-08-21T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:00.000Z',
}

const sandbox = {
  id: 'sandbox-1',
  name: 'research-local',
  type: 'local-sandbox' as const,
  isDefault: true,
  repositoryId: 'repo-1',
  createdAt: '2026-08-21T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:00.000Z',
}

const agent = {
  agentType: 'research-analyst',
  source: 'repository' as const,
  repositoryId: 'repo-1',
  isActive: true,
}

const baseInput: WorkspaceContextInput = {
  activeTab: { sessionId: 'session-1', projectPath: 'c--work-research', type: 'session' },
  recentSessionIds: [],
  selectedProjectPaths: [],
  sessions: [session],
  repositories: [repository],
  repositoriesState: 'ready',
  repositoriesError: null,
  sandboxProfiles: [sandbox],
  sandboxState: 'ready',
  sandboxError: null,
  backendState: 'ready',
  backendStatus: 'ok',
  backendError: null,
  selectedAgent: agent,
  activeAgents: [agent],
  agentsState: 'ready',
}

describe('resolveWorkspaceContext', () => {
  it('matches repository paths across Windows separators and drive casing', () => {
    const context = resolveWorkspaceContext(baseInput)

    expect(context.name).toBe('research')
    expect(context.rootPath).toBe('C:\\Work\\Research')
    expect(context.repository).toMatchObject({ id: 'repo-1', status: 'active' })
    expect(context.backend.status).toBe('active')
    expect(context.sandbox).toMatchObject({ id: 'sandbox-1', status: 'configured' })
    expect(context.agentProfile).toMatchObject({ id: 'research-analyst', status: 'active' })
  })

  it('keeps unverified resources honest when their source request failed', () => {
    const context = resolveWorkspaceContext({
      ...baseInput,
      repositoriesState: 'error',
      sandboxState: 'error',
      backendState: 'error',
      selectedAgent: null,
      activeAgents: [],
      agentsState: 'error',
    })

    expect(context.repository.status).toBe('unknown')
    expect(context.sandbox.status).toBe('unknown')
    expect(context.backend.status).toBe('failed')
    expect(context.agentProfile.status).toBe('unknown')
  })

  it('uses the most recent session when a terminal tab is active', () => {
    const context = resolveWorkspaceContext({
      ...baseInput,
      activeTab: { sessionId: '__terminal__1', type: 'terminal' },
      recentSessionIds: ['session-1'],
    })

    expect(context.sessionId).toBe('session-1')
    expect(context.rootPath).toBe(session.workDir)
  })

  it('uses the selected project when no session tab is active', () => {
    const context = resolveWorkspaceContext({
      ...baseInput,
      activeTab: undefined,
      selectedProjectPaths: [session.projectPath],
    })

    expect(context.sessionId).toBe(session.id)
    expect(context.repository.id).toBe(repository.id)
  })

  it('does not carry a repository-scoped agent into another repository', () => {
    const context = resolveWorkspaceContext({
      ...baseInput,
      activeTab: { sessionId: 'session-2', projectPath: 'c--work-other', type: 'session' },
      sessions: [{ ...session, id: 'session-2', projectPath: 'c--work-other', workDir: '/workspace/other' }],
      selectedAgent: agent,
      activeAgents: [],
    })

    expect(context.agentProfile.status).toBe('unavailable')
    expect(context.agentProfile.id).toBeNull()
  })

})
