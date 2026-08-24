import { api } from './client'

export type AgentSource =
  | 'built-in'
  | 'plugin'
  | 'repository'
  | 'userSettings'
  | 'projectSettings'
  | 'localSettings'
  | 'flagSettings'
  | 'policySettings'

export type AgentDefinition = {
  agentType: string
  description?: string
  model?: string
  modelDisplay?: string
  tools?: string[]
  systemPrompt?: string
  color?: string
  source: AgentSource
  baseDir?: string
  repositoryId?: string
  repositoryRoot?: string
  overriddenBy?: AgentSource
  isActive: boolean
}

export type AgentListResponse = {
  activeAgents: AgentDefinition[]
  allAgents: AgentDefinition[]
}

export type AgentResourceReferences = {
  environmentProfileId?: string
  skillIds: string[]
  workflowIds: string[]
}

export type RepositoryAgentConfiguration = {
  version: 2
  kind: 'AgentConfiguration'
  repositoryId: string
  name: string
  description: string
  systemPrompt: string
  model?: string
  permissionMode?: 'read-only' | 'workspace-write' | 'danger-full-access'
  tools: string[]
  resources: AgentResourceReferences
}

export type RepositoryAgentInput = Omit<RepositoryAgentConfiguration, 'version' | 'kind' | 'repositoryId'>

export type AgentProposalStatus = 'proposed' | 'blocked' | 'stale' | 'approved' | 'rejected'

export type AgentProposal = {
  id: string
  repositoryId: string
  currentName?: string
  instructions: string
  current: RepositoryAgentConfiguration | null
  baseRevision: string | null
  candidate: RepositoryAgentInput
  diff: Array<{ path: string; before?: unknown; after?: unknown }>
  validationIssues: string[]
  status: AgentProposalStatus
  savedAgent?: RepositoryAgentConfiguration
  createdAt: string
  updatedAt: string
}

export const agentsApi = {
  list: (cwd?: string) => {
    const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
    return api.get<AgentListResponse>(`/api/agents${query}`)
  },
  listRepository: (repositoryId: string) =>
    api.get<{ agents: RepositoryAgentConfiguration[] }>(`/api/agents/repositories/${encodeURIComponent(repositoryId)}`),
  createRepository: (repositoryId: string, input: RepositoryAgentInput) =>
    api.post<RepositoryAgentConfiguration>(`/api/agents/repositories/${encodeURIComponent(repositoryId)}`, input),
  updateRepository: (repositoryId: string, name: string, input: RepositoryAgentInput) =>
    api.put<RepositoryAgentConfiguration>(`/api/agents/repositories/${encodeURIComponent(repositoryId)}/${encodeURIComponent(name)}`, input),
  deleteRepository: (repositoryId: string, name: string) =>
    api.delete<{ ok: boolean }>(`/api/agents/repositories/${encodeURIComponent(repositoryId)}/${encodeURIComponent(name)}`),
  prepareProposal: (repositoryId: string, request: { instructions: string; draft: RepositoryAgentInput; currentName?: string }) =>
    api.post<AgentProposal>(`/api/agents/repositories/${encodeURIComponent(repositoryId)}/proposals`, request),
  approveProposal: (repositoryId: string, proposalId: string, acknowledgeBypassRisk: boolean) =>
    api.post<AgentProposal>(`/api/agents/repositories/${encodeURIComponent(repositoryId)}/proposals/${encodeURIComponent(proposalId)}/approve`, { acknowledgeBypassRisk }),
  rejectProposal: (repositoryId: string, proposalId: string) =>
    api.post<AgentProposal>(`/api/agents/repositories/${encodeURIComponent(repositoryId)}/proposals/${encodeURIComponent(proposalId)}/reject`, {}),
  listProposals: (repositoryId: string) =>
    api.get<{ proposals: AgentProposal[] }>(`/api/agents/repositories/${encodeURIComponent(repositoryId)}/proposals`),
}
