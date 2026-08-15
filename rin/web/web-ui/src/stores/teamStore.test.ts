import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { teamsApi } from '../api/teams'
import type { TeamDetail, TeamMember } from '../types/team'
import type { TeamMemberStatus } from '../types/chat'
import { useTeamStore } from './teamStore'

const h = vi.hoisted(() => {
  type ChatSession = { messages: unknown[]; chatState?: string }
  const chatStoreState: { sessions: Record<string, ChatSession> } = { sessions: {} }
  const tabStoreState: { activeTabId: string | null } = { activeTabId: null }

  const useChatStoreSetState = vi.fn((updater: (state: typeof chatStoreState) => { sessions?: Record<string, ChatSession> }) => {
    Object.assign(chatStoreState, updater(chatStoreState))
  })

  const openTabMock = vi.fn((sessionId: string) => {
    tabStoreState.activeTabId = sessionId
  })

  return {
    chatStoreState,
    tabStoreState,
    useChatStoreGetState: vi.fn(() => chatStoreState),
    useChatStoreSetState,
    mapHistoryMessagesToUiMessages: vi.fn(() => [] as unknown[]),
    openTabMock,
  }
})

vi.mock('../api/teams', () => ({
  teamsApi: {
    list: vi.fn(),
    get: vi.fn(),
    getMemberTranscript: vi.fn(),
    sendMemberMessage: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('./chatStore', () => ({
  useChatStore: {
    getState: h.useChatStoreGetState,
    setState: h.useChatStoreSetState,
  },
  mapHistoryMessagesToUiMessages: h.mapHistoryMessagesToUiMessages,
}))

vi.mock('./tabStore', () => ({
  useTabStore: {
    getState: () => ({
      activeTabId: h.tabStoreState.activeTabId,
      openTab: h.openTabMock,
    }),
  },
}))

function makeMember(overrides: Partial<TeamMember> = {}): TeamMember {
  return {
    agentId: 'agent-1',
    role: 'Lead',
    status: 'idle',
    ...overrides,
  }
}

function makeTeam(overrides: Partial<TeamDetail> = {}): TeamDetail {
  return {
    name: 'team-1',
    members: [makeMember()],
    ...overrides,
  }
}

describe('teamStore', () => {
  beforeEach(() => {
    useTeamStore.setState({
      teams: [],
      activeTeam: null,
      memberColors: new Map(),
      error: null,
    })
    h.chatStoreState.sessions = {}
    h.tabStoreState.activeTabId = null
    vi.clearAllMocks()
  })

  afterEach(() => {
    useTeamStore.getState().stopMemberPolling()
    vi.useRealTimers()
  })

  it('loads the team list', async () => {
    vi.mocked(teamsApi.list).mockResolvedValue({ teams: [{ name: 'team-1', memberCount: 2 }] })

    await useTeamStore.getState().fetchTeams()

    expect(useTeamStore.getState().teams).toEqual([{ name: 'team-1', memberCount: 2 }])
  })

  it('records an error when listing teams fails', async () => {
    vi.mocked(teamsApi.list).mockRejectedValue(new Error('boom'))

    await useTeamStore.getState().fetchTeams()

    expect(useTeamStore.getState().error).toBe('boom')
  })

  it('loads team detail and assigns colors to members', async () => {
    vi.mocked(teamsApi.get).mockResolvedValue({
      name: 'team-1',
      members: [{ agentId: 'a1', status: 'running' }, { agentId: 'a2', status: 'idle' }],
    } as unknown as TeamDetail)

    await useTeamStore.getState().fetchTeamDetail('team-1')

    expect(useTeamStore.getState().activeTeam?.name).toBe('team-1')
    expect(useTeamStore.getState().activeTeam?.members).toHaveLength(2)
    expect(useTeamStore.getState().memberColors.get('a1')).toBe('red')
    expect(useTeamStore.getState().memberColors.get('a2')).toBe('blue')
  })

  it('records an error when loading team detail fails', async () => {
    vi.mocked(teamsApi.get).mockRejectedValue(new Error('boom'))

    await useTeamStore.getState().fetchTeamDetail('team-1')

    expect(useTeamStore.getState().error).toBe('boom')
  })

  it('finds a member by session id or synthetic member id', () => {
    const member = makeMember({ agentId: 'a1', sessionId: 'real-session' })
    useTeamStore.setState({ activeTeam: makeTeam({ members: [member] }) })

    expect(useTeamStore.getState().getMemberBySessionId('real-session')).toBe(member)
    expect(useTeamStore.getState().getMemberBySessionId('team-member:a1')).toBe(member)
    expect(useTeamStore.getState().getMemberBySessionId('unknown')).toBeNull()
  })

  it('returns null when no team is active', () => {
    expect(useTeamStore.getState().getMemberBySessionId('anything')).toBeNull()
  })

  it('syncs member messages into the chat store on refresh', async () => {
    const member = makeMember({ agentId: 'a1', status: 'running' })
    useTeamStore.setState({ activeTeam: makeTeam({ members: [member] }) })
    vi.mocked(teamsApi.getMemberTranscript).mockResolvedValue({ messages: [] })
    h.mapHistoryMessagesToUiMessages.mockReturnValue([])

    await useTeamStore.getState().refreshMemberSession('team-member:a1')

    expect(teamsApi.getMemberTranscript).toHaveBeenCalledWith('team-1', 'a1')
    expect(h.useChatStoreSetState).toHaveBeenCalled()
    expect(h.chatStoreState.sessions['team-member:a1']?.chatState).toBe('thinking')
  })

  it('keeps the existing messages when the transcript request fails', async () => {
    const member = makeMember({ agentId: 'a1', status: 'idle' })
    useTeamStore.setState({ activeTeam: makeTeam({ members: [member] }) })
    vi.mocked(teamsApi.getMemberTranscript).mockRejectedValue(new Error('boom'))

    await useTeamStore.getState().refreshMemberSession('team-member:a1')

    expect(h.chatStoreState.sessions['team-member:a1']?.chatState).toBe('idle')
  })

  it('is a no-op when refreshing without an active team member', async () => {
    await useTeamStore.getState().refreshMemberSession('team-member:nobody')

    expect(teamsApi.getMemberTranscript).not.toHaveBeenCalled()
  })

  it('opens a member session, refreshes, and starts polling', () => {
    const member = makeMember({ agentId: 'a1', status: 'running' })
    useTeamStore.setState({ activeTeam: makeTeam({ members: [member] }) })
    vi.mocked(teamsApi.getMemberTranscript).mockResolvedValue({ messages: [] })

    useTeamStore.getState().openMemberSession(member)

    expect(h.openTabMock).toHaveBeenCalledWith('team-member:a1', 'Lead', 'session')
    expect(h.tabStoreState.activeTabId).toBe('team-member:a1')
  })

  it('is a no-op when opening a member session without an active team', () => {
    useTeamStore.getState().openMemberSession(makeMember())

    expect(h.openTabMock).not.toHaveBeenCalled()
  })

  it('sends a message to a member and refreshes the session', async () => {
    const member = makeMember({ agentId: 'a1', status: 'running' })
    useTeamStore.setState({ activeTeam: makeTeam({ members: [member] }) })
    vi.mocked(teamsApi.sendMemberMessage).mockResolvedValue({ ok: true })
    vi.mocked(teamsApi.getMemberTranscript).mockResolvedValue({ messages: [] })

    await useTeamStore.getState().sendMessageToMember('team-member:a1', 'hello')

    expect(teamsApi.sendMemberMessage).toHaveBeenCalledWith('team-1', 'a1', 'hello')
  })

  it('rejects sending when the member session is gone', async () => {
    await expect(useTeamStore.getState().sendMessageToMember('team-member:a1', 'hello')).rejects.toThrow(
      'Team member session is no longer available',
    )
  })

  it('starts polling only for running members', () => {
    vi.useFakeTimers()
    const member = makeMember({ agentId: 'a1', status: 'running' })
    useTeamStore.setState({ activeTeam: makeTeam({ members: [member] }) })
    h.tabStoreState.activeTabId = 'team-member:a1'
    vi.mocked(teamsApi.getMemberTranscript).mockResolvedValue({ messages: [] })

    useTeamStore.getState().startMemberPolling('team-member:a1')
    vi.advanceTimersByTime(1500)

    expect(teamsApi.getMemberTranscript).toHaveBeenCalledWith('team-1', 'a1')
  })

  it('does not poll an idle member without pending messages', () => {
    vi.useFakeTimers()
    const member = makeMember({ agentId: 'a1', status: 'idle' })
    useTeamStore.setState({ activeTeam: makeTeam({ members: [member] }) })

    useTeamStore.getState().startMemberPolling('team-member:a1')
    vi.advanceTimersByTime(3000)

    expect(teamsApi.getMemberTranscript).not.toHaveBeenCalled()
  })

  it('clears the active team and stops polling', () => {
    useTeamStore.setState({ activeTeam: makeTeam(), memberColors: new Map([['a1', 'red']]) })

    useTeamStore.getState().clearTeam()

    expect(useTeamStore.getState().activeTeam).toBeNull()
    expect(useTeamStore.getState().memberColors.size).toBe(0)
  })

  it('adds a team on the created websocket event', () => {
    vi.useFakeTimers()
    vi.mocked(teamsApi.get).mockResolvedValue(makeTeam() as unknown as TeamDetail)

    useTeamStore.getState().handleTeamCreated('team-new')

    expect(useTeamStore.getState().teams).toContainEqual({ name: 'team-new', memberCount: 0 })
    expect(teamsApi.get).toHaveBeenCalledWith('team-new')
    vi.runAllTimers()
  })

  it('updates the active team members from a websocket event', () => {
    const member = makeMember({ agentId: 'a1', status: 'running' })
    useTeamStore.setState({ activeTeam: makeTeam({ members: [member] }) })

    const update: TeamMemberStatus[] = [{ agentId: 'a1', role: 'Lead', status: 'completed' }]
    useTeamStore.getState().handleTeamUpdate('team-1', update)

    expect(useTeamStore.getState().activeTeam?.members[0]?.status).toBe('completed')
  })

  it('ignores updates for a different team', () => {
    const member = makeMember({ agentId: 'a1', status: 'running' })
    useTeamStore.setState({ activeTeam: makeTeam({ members: [member] }) })

    useTeamStore.getState().handleTeamUpdate('other-team', [{ agentId: 'a1', role: 'Lead', status: 'completed' }])

    expect(useTeamStore.getState().activeTeam?.members[0]?.status).toBe('running')
  })

  it('removes a team on the deleted websocket event', () => {
    useTeamStore.setState({
      teams: [{ name: 'team-1', memberCount: 1 }, { name: 'team-2', memberCount: 1 }],
      activeTeam: makeTeam({ name: 'team-1' }),
    })

    useTeamStore.getState().handleTeamDeleted('team-1')

    expect(useTeamStore.getState().teams).toEqual([{ name: 'team-2', memberCount: 1 }])
    expect(useTeamStore.getState().activeTeam).toBeNull()
  })
})
