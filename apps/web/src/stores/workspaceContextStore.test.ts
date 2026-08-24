import { beforeEach, describe, expect, it, vi } from 'vitest'

const { healthMock, repositoriesMock, sandboxesMock } = vi.hoisted(() => ({
  healthMock: vi.fn(),
  repositoriesMock: vi.fn(),
  sandboxesMock: vi.fn(),
}))

vi.mock('../api/status', () => ({
  statusApi: { health: healthMock },
}))

vi.mock('../api/repositories', () => ({
  repositoriesApi: { list: repositoriesMock },
}))

vi.mock('../api/sandboxes', () => ({
  sandboxesApi: { list: sandboxesMock },
}))

import { useWorkspaceContextStore } from './workspaceContextStore'

const initialState = useWorkspaceContextStore.getState()

const repository = {
  id: 'repo-1',
  name: 'Research',
  rootPath: '/workspace/research',
  environmentPackages: [],
  environmentProfiles: [],
  createdAt: '2026-08-22T00:00:00.000Z',
  updatedAt: '2026-08-22T00:00:00.000Z',
}

describe('workspaceContextStore', () => {
  beforeEach(() => {
    healthMock.mockReset()
    repositoriesMock.mockReset()
    sandboxesMock.mockReset()
    useWorkspaceContextStore.setState({
      ...initialState,
      backend: { state: 'idle', health: null, error: null, lastCheckedAt: null },
      repositories: { state: 'idle', items: [], error: null, lastCheckedAt: null },
      sandboxes: { state: 'idle', items: [], error: null, lastCheckedAt: null },
    })
  })

  it('keeps the previous repository snapshot visible when a refresh fails', async () => {
    repositoriesMock.mockRejectedValueOnce(new Error('repository API unavailable'))
    useWorkspaceContextStore.setState({
      repositories: {
        state: 'ready',
        items: [repository],
        error: null,
        lastCheckedAt: 123,
      },
    })

    await useWorkspaceContextStore.getState().refreshResource('repositories')

    expect(useWorkspaceContextStore.getState().repositories).toMatchObject({
      state: 'error',
      items: [repository],
      error: 'repository API unavailable',
      lastCheckedAt: expect.any(Number),
    })
  })

  it('retries only the requested resource and returns it to ready', async () => {
    repositoriesMock
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({ repositories: [repository] })

    await useWorkspaceContextStore.getState().refreshResource('repositories')
    await useWorkspaceContextStore.getState().refreshResource('repositories')

    expect(repositoriesMock).toHaveBeenCalledTimes(2)
    expect(healthMock).not.toHaveBeenCalled()
    expect(sandboxesMock).not.toHaveBeenCalled()
    expect(useWorkspaceContextStore.getState().repositories).toMatchObject({
      state: 'ready',
      items: [repository],
      error: null,
      lastCheckedAt: expect.any(Number),
    })
  })
})
