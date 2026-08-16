import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { agentsApi } from '../api/agents'
import { repositoriesApi, type RepositoryConnection } from '../api/repositories'
import { useSettingsStore } from '../stores/settingsStore'
import { AgentWorkspace } from './AgentWorkspace'

vi.mock('../api/agents', () => ({
  agentsApi: {
    list: vi.fn(), listRepository: vi.fn(), createRepository: vi.fn(), updateRepository: vi.fn(), deleteRepository: vi.fn(),
    prepareProposal: vi.fn(), approveProposal: vi.fn(), rejectProposal: vi.fn(), listProposals: vi.fn(),
  },
}))

vi.mock('../api/repositories', () => ({
  repositoriesApi: { list: vi.fn(), environmentProfiles: vi.fn() },
}))

const repository: RepositoryConnection = {
  id: 'repo-1', name: 'Research repo', rootPath: 'E:/research-repo',
  createdAt: '', updatedAt: '',
  environmentPackages: [{ id: 'numpy', name: 'numpy', ecosystem: 'python' }],
  environmentProfiles: [],
}

const candidate = {
  name: 'research-analyst', description: 'AI refined responsibility', systemPrompt: 'Use reproducible methods.',
  model: 'inherit', permissionMode: 'plan' as const, tools: ['Read'],
  resources: { environmentProfileId: 'scientific-base', skillIds: [], workflowIds: [] },
}

const proposal = {
  id: 'proposal-1', repositoryId: repository.id, instructions: 'Create a scientific analyst.', current: null,
  baseRevision: null,
  candidate, status: 'proposed' as const, validationIssues: [], createdAt: '', updatedAt: '',
  diff: [{ path: 'description', before: 'Initial responsibility', after: 'AI refined responsibility' }],
}

describe('AgentWorkspace proposal review', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    useSettingsStore.setState({ locale: 'en' })
    vi.mocked(repositoriesApi.list).mockResolvedValue({ repositories: [repository] })
    vi.mocked(repositoriesApi.environmentProfiles).mockResolvedValue({
      repositoryId: repository.id,
      profiles: [
        { apiVersion: 'rin.dev/v1', kind: 'EnvironmentProfile', metadata: { id: 'scientific-base', name: 'Scientific base', version: '1.0.0' }, spec: { packages: ['python-numpy'] } },
        { apiVersion: 'rin.dev/v1', kind: 'EnvironmentProfile', metadata: { id: 'mathematical-modeling', name: 'Mathematical modeling', version: '1.0.0' }, spec: { packages: [] } },
        { apiVersion: 'rin.dev/v1', kind: 'EnvironmentProfile', metadata: { id: 'bioinformatics-base', name: 'Bioinformatics base', version: '1.0.0' }, spec: { packages: [] } },
      ],
    })
    vi.mocked(agentsApi.listRepository).mockResolvedValue({ agents: [] })
    vi.mocked(agentsApi.list).mockResolvedValue({ activeAgents: [], allAgents: [] })
    vi.mocked(agentsApi.prepareProposal).mockResolvedValue(proposal)
    vi.mocked(agentsApi.approveProposal).mockResolvedValue({ ...proposal, status: 'approved', savedAgent: { version: 2, kind: 'AgentConfiguration', repositoryId: repository.id, ...candidate } })
  })

  it('selects one environment profile instead of flattening repository packages', async () => {
    render(<AgentWorkspace />)

    await waitFor(() => expect(screen.getByRole('option', { name: 'Scientific base · 1.0.0' })).toBeInTheDocument())
    expect(screen.queryByText('numpy')).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Mathematical modeling · 1.0.0' })).toBeInTheDocument()
  })

  it('keeps AI output in a diff proposal until the user explicitly approves it', async () => {
    render(<AgentWorkspace />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Configure with AI' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Configure with AI' }))
    fireEvent.change(screen.getByLabelText('AI instructions'), { target: { value: 'Create a scientific analyst.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate proposal' }))

    await waitFor(() => expect(screen.getByText('AI refined responsibility')).toBeInTheDocument())
    expect(agentsApi.createRepository).not.toHaveBeenCalled()
    expect(agentsApi.updateRepository).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Approve changes' }))
    await waitFor(() => expect(agentsApi.approveProposal).toHaveBeenCalledWith(repository.id, proposal.id, false))
  })

  it('shows parsed and runtime-dispatch-list status as separate facts', async () => {
    const savedAgent = { version: 2 as const, kind: 'AgentConfiguration' as const, repositoryId: repository.id, ...candidate }
    vi.mocked(agentsApi.listRepository).mockResolvedValue({ agents: [savedAgent] })
    vi.mocked(agentsApi.list).mockResolvedValue({
      activeAgents: [{
        agentType: candidate.name, source: 'repository', repositoryId: repository.id,
        repositoryRoot: repository.rootPath, isActive: true,
      }],
      allAgents: [],
    })

    render(<AgentWorkspace />)
    await waitFor(() => expect(screen.getByRole('button', { name: /research-analyst/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /research-analyst/i }))

    expect(screen.getByText('Static definition: parsed')).toBeInTheDocument()
    expect(screen.getByText('Runtime: in dispatch list')).toBeInTheDocument()
    expect(screen.getByText('No execution probe has been run')).toBeInTheDocument()
  })
})
