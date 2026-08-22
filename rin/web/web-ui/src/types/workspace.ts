import type { AgentDefinition } from '../api/agents'
import type { RepositoryConnection } from '../api/repositories'
import type { SandboxProfile } from '../api/sandboxes'
import type { SessionListItem } from './session'

export type WorkspaceContextStatus =
  | 'declared'
  | 'available'
  | 'configured'
  | 'installed'
  | 'mounted'
  | 'active'
  | 'failed'
  | 'unavailable'
  | 'unknown'

export type WorkspaceResource = {
  id: string | null
  name: string | null
  status: WorkspaceContextStatus
  detail: string | null
}

export type WorkspaceContext = {
  name: string
  rootPath: string | null
  sessionId: string | null
  repository: WorkspaceResource
  backend: WorkspaceResource
  sandbox: WorkspaceResource
  agentProfile: WorkspaceResource
}

export type WorkspaceResourceLoadState = 'idle' | 'loading' | 'ready' | 'error'

export type WorkspaceContextInput = {
  activeTab: { sessionId: string; projectPath?: string; type: string } | undefined
  recentSessionIds: string[]
  selectedProjectPaths: string[]
  sessions: SessionListItem[]
  repositories: RepositoryConnection[]
  repositoriesState: WorkspaceResourceLoadState
  repositoriesError: string | null
  sandboxProfiles: SandboxProfile[]
  sandboxState: WorkspaceResourceLoadState
  sandboxError: string | null
  backendState: WorkspaceResourceLoadState
  backendStatus: string | null
  backendError: string | null
  selectedAgent: AgentDefinition | null
  activeAgents: AgentDefinition[]
  agentsState: WorkspaceResourceLoadState
}

const PATH_SEPARATOR = /[\\/]+/g

function pathKey(path: string): string {
  const normalized = path.replace(PATH_SEPARATOR, '/').replace(/\/$/, '')
  return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized
}

function pathName(path: string | null): string | null {
  if (!path) return null
  const parts = path.replace(PATH_SEPARATOR, '/').split('/').filter(Boolean)
  return parts.at(-1) ?? path
}

function matchesSession(session: SessionListItem, sessionId: string, projectPath?: string): boolean {
  return session.id === sessionId && (!projectPath || session.projectPath === projectPath)
}

function findCurrentSession(input: WorkspaceContextInput): SessionListItem | null {
  if (input.activeTab?.type === 'session') {
    return input.sessions.find((session) =>
      matchesSession(session, input.activeTab!.sessionId, input.activeTab!.projectPath),
    ) ?? null
  }

  for (const sessionId of input.recentSessionIds) {
    const session = input.sessions.find((candidate) => candidate.id === sessionId)
    if (session) return session
  }

  for (const projectPath of input.selectedProjectPaths) {
    const session = input.sessions.find((candidate) => candidate.projectPath === projectPath)
    if (session) return session
  }
  return null
}

function backendResource(input: WorkspaceContextInput): WorkspaceResource {
  if (input.backendState === 'error') {
    return { id: null, name: 'API', status: 'failed', detail: input.backendError }
  }
  if (input.backendState !== 'ready' || !input.backendStatus) {
    return { id: null, name: 'API', status: 'unknown', detail: null }
  }

  const normalized = input.backendStatus.toLowerCase()
  const status: WorkspaceContextStatus = ['ok', 'healthy', 'ready', 'running', 'up'].includes(normalized)
    ? 'active'
    : ['error', 'failed', 'unhealthy', 'down'].includes(normalized)
      ? 'failed'
      : 'available'
  return { id: null, name: 'API', status, detail: input.backendStatus }
}

function repositoryResource(
  input: WorkspaceContextInput,
  rootPath: string | null,
): { resource: WorkspaceResource; repository: RepositoryConnection | null } {
  if (input.repositoriesState !== 'ready' || !rootPath) {
    return {
      resource: {
        id: null,
        name: null,
        status: 'unknown',
        detail: input.repositoriesState === 'error' ? input.repositoriesError : rootPath,
      },
      repository: null,
    }
  }

  const repository = input.repositories.find((candidate) => pathKey(candidate.rootPath) === pathKey(rootPath)) ?? null
  return {
    resource: repository
      ? { id: repository.id, name: repository.name, status: 'active', detail: repository.rootPath }
      : { id: null, name: null, status: 'unavailable', detail: rootPath },
    repository,
  }
}

function sandboxResource(
  input: WorkspaceContextInput,
  repository: RepositoryConnection | null,
): WorkspaceResource {
  if (input.sandboxState !== 'ready') {
    return {
      id: null,
      name: null,
      status: 'unknown',
      detail: input.sandboxState === 'error' ? input.sandboxError : null,
    }
  }

  const sandbox = repository
    ? input.sandboxProfiles.find((profile) => profile.repositoryId === repository.id)
    : input.sandboxProfiles.find((profile) => profile.isDefault)
  return sandbox
    ? { id: sandbox.id, name: sandbox.name, status: 'configured', detail: sandbox.type }
    : { id: null, name: null, status: 'unavailable', detail: null }
}

function agentResource(input: WorkspaceContextInput, repository: RepositoryConnection | null): WorkspaceResource {
  const matchesRepository = (agent: AgentDefinition) =>
    !agent.repositoryId || Boolean(repository && agent.repositoryId === repository.id)
  const selected = (input.selectedAgent && matchesRepository(input.selectedAgent) ? input.selectedAgent : null)
    ?? input.activeAgents.find(matchesRepository)
    ?? null

  if (selected) {
    const isActive = input.activeAgents.some((agent) => agent.agentType === selected.agentType)
    return {
      id: selected.agentType,
      name: selected.agentType,
      status: isActive ? 'active' : 'configured',
      detail: selected.source,
    }
  }

  return {
    id: null,
    name: null,
    status: input.agentsState === 'ready' ? 'unavailable' : 'unknown',
    detail: null,
  }
}

/**
 * Derive the visible workspace context from existing session and resource snapshots.
 * Resource load states are kept separate from resource contents so an unavailable
 * API is never presented as an empty, healthy configuration.
 */
export function resolveWorkspaceContext(input: WorkspaceContextInput): WorkspaceContext {
  const session = findCurrentSession(input)
  const rootPath = session?.workDir ?? null
  const { resource: repository, repository: matchedRepository } = repositoryResource(input, rootPath)
  const name = matchedRepository?.name ?? pathName(rootPath) ?? 'Workspace'

  return {
    name,
    rootPath,
    sessionId: session?.id ?? null,
    repository,
    backend: backendResource(input),
    sandbox: sandboxResource(input, matchedRepository),
    agentProfile: agentResource(input, matchedRepository),
  }
}
