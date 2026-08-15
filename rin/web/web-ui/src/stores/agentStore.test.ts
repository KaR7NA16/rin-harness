import { beforeEach, describe, expect, it, vi } from 'vitest'

import { agentsApi, type AgentDefinition } from '../api/agents'
import { useAgentStore } from './agentStore'

vi.mock('../api/agents', () => ({
  agentsApi: {
    list: vi.fn(),
  },
}))

function makeAgent(agentType: string, isActive = true): AgentDefinition {
  return {
    agentType,
    description: 'desc',
    source: 'built-in',
    isActive,
  }
}

describe('agentStore', () => {
  beforeEach(() => {
    useAgentStore.setState({
      activeAgents: [],
      allAgents: [],
      isLoading: false,
      error: null,
      selectedAgent: null,
      selectedAgentReturnTab: 'agents',
    })
    vi.clearAllMocks()
  })

  it('loads active and all agents from the api', async () => {
    vi.mocked(agentsApi.list).mockResolvedValue({
      activeAgents: [makeAgent('active')],
      allAgents: [makeAgent('active'), makeAgent('hidden', false)],
    })

    await useAgentStore.getState().fetchAgents('/repo')

    expect(agentsApi.list).toHaveBeenCalledWith('/repo')
    expect(useAgentStore.getState()).toMatchObject({
      activeAgents: [makeAgent('active')],
      allAgents: [makeAgent('active'), makeAgent('hidden', false)],
      isLoading: false,
    })
  })

  it('records an error message when loading fails', async () => {
    vi.mocked(agentsApi.list).mockRejectedValue(new Error('boom'))

    await useAgentStore.getState().fetchAgents()

    expect(useAgentStore.getState()).toMatchObject({ isLoading: false, error: 'boom' })
  })

  it('selects an agent and remembers the return tab', () => {
    const agent = makeAgent('active')

    useAgentStore.getState().selectAgent(agent, 'plugins')

    expect(useAgentStore.getState()).toMatchObject({
      selectedAgent: agent,
      selectedAgentReturnTab: 'plugins',
    })
  })

  it('resets the return tab when clearing the selection', () => {
    useAgentStore.setState({ selectedAgent: makeAgent('active'), selectedAgentReturnTab: 'plugins' })

    useAgentStore.getState().selectAgent(null)

    expect(useAgentStore.getState()).toMatchObject({
      selectedAgent: null,
      selectedAgentReturnTab: 'agents',
    })
  })
})
