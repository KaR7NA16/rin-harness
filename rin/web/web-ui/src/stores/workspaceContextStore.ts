import { create } from 'zustand'
import { repositoriesApi, type RepositoryConnection } from '../api/repositories'
import { sandboxesApi, type SandboxProfile } from '../api/sandboxes'
import { statusApi, type StatusHealthResponse } from '../api/status'
import type { WorkspaceResourceLoadState } from '../types/workspace'

type WorkspaceContextStore = {
  backend: {
    state: WorkspaceResourceLoadState
    health: StatusHealthResponse | null
    error: string | null
    lastCheckedAt: number | null
  }
  repositories: {
    state: WorkspaceResourceLoadState
    items: RepositoryConnection[]
    error: string | null
    lastCheckedAt: number | null
  }
  sandboxes: {
    state: WorkspaceResourceLoadState
    items: SandboxProfile[]
    error: string | null
    lastCheckedAt: number | null
  }
  refreshResource: (resource: WorkspaceResourceKey) => Promise<void>
  refresh: () => Promise<void>
}

export type WorkspaceResourceKey = 'backend' | 'repositories' | 'sandboxes'

export type WorkspaceContextStoreSnapshot = Pick<
  WorkspaceContextStore,
  'backend' | 'repositories' | 'sandboxes'
>

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const useWorkspaceContextStore = create<WorkspaceContextStore>((set) => {
  const resourceRequests = new Map<WorkspaceResourceKey, Promise<void>>()

  const refreshResource = (resource: WorkspaceResourceKey): Promise<void> => {
    const existing = resourceRequests.get(resource)
    if (existing) return existing

    const request = (async () => {
      set((state) => {
        switch (resource) {
          case 'backend':
            return { backend: { ...state.backend, state: 'loading', error: null } }
          case 'repositories':
            return { repositories: { ...state.repositories, state: 'loading', error: null } }
          case 'sandboxes':
            return { sandboxes: { ...state.sandboxes, state: 'loading', error: null } }
        }
      })

      try {
        switch (resource) {
          case 'backend': {
            const health = await statusApi.health()
            set(() => ({
              backend: { state: 'ready', health, error: null, lastCheckedAt: Date.now() },
            }))
            return
          }
          case 'repositories': {
            const { repositories } = await repositoriesApi.list()
            set(() => ({
              repositories: {
                state: 'ready',
                items: repositories,
                error: null,
                lastCheckedAt: Date.now(),
              },
            }))
            return
          }
          case 'sandboxes': {
            const { profiles } = await sandboxesApi.list()
            set(() => ({
              sandboxes: {
                state: 'ready',
                items: profiles,
                error: null,
                lastCheckedAt: Date.now(),
              },
            }))
            return
          }
        }
      } catch (error) {
        const message = errorMessage(error)
        const lastCheckedAt = Date.now()
        set((state) => {
          switch (resource) {
            case 'backend':
              return { backend: { ...state.backend, state: 'error', error: message, lastCheckedAt } }
            case 'repositories':
              return { repositories: { ...state.repositories, state: 'error', error: message, lastCheckedAt } }
            case 'sandboxes':
              return { sandboxes: { ...state.sandboxes, state: 'error', error: message, lastCheckedAt } }
          }
        })
      }
    })()

    resourceRequests.set(resource, request)
    void request.finally(() => {
      if (resourceRequests.get(resource) === request) resourceRequests.delete(resource)
    })
    return request
  }

  return {
    backend: { state: 'idle', health: null, error: null, lastCheckedAt: null },
    repositories: { state: 'idle', items: [], error: null, lastCheckedAt: null },
    sandboxes: { state: 'idle', items: [], error: null, lastCheckedAt: null },
    refreshResource,
    refresh: () => Promise.all([
      refreshResource('backend'),
      refreshResource('repositories'),
      refreshResource('sandboxes'),
    ]).then(() => undefined),
  }
})
