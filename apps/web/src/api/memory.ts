import type {
  MemoryManifest,
  MemoryCurrentField,
  MemoryRepresentationDto,
  MemorySceneSummaryDto,
  MemoryRecallCycleSummaryDto,
  MemoryRecallCycleDto,
  MemoryErasePreviewDto,
  MemoryEraseAuthorizeResponseDto,
} from '@rin/contracts'
import { api } from './client'

type Mounted = { mounted: boolean }
type FieldResponse = Mounted & { field?: MemoryCurrentField }
type ScenesResponse = Mounted & { scenes?: MemorySceneSummaryDto[] }
type RepresentationResponse = Mounted & { representation?: MemoryRepresentationDto }
type RecallListResponse = Mounted & { cycles?: MemoryRecallCycleSummaryDto[] }
type RecallResponse = Mounted & { cycle?: MemoryRecallCycleDto }
type PreviewResponse = Mounted & { preview?: MemoryErasePreviewDto }

function unwrap<T extends object>({ mounted, ...value }: Mounted & T): T | null {
  return mounted ? value as T : null
}

/** Cognition queries and owner intent dispatch for the Memory Center. */

export const memoryApi = {
  manifest: async (): Promise<MemoryManifest | null> => {
    const response = await api.get<Mounted & MemoryManifest>('/api/memory/manifest')
    return unwrap<MemoryManifest>(response)
  },

  field: async (): Promise<MemoryCurrentField | null> => {
    const response = await api.get<FieldResponse>('/api/memory/field')
    return response.mounted ? response.field ?? null : null
  },

  scenes: async (): Promise<MemorySceneSummaryDto[]> => {
    const response = await api.get<ScenesResponse>('/api/memory/scenes')
    return response.mounted ? response.scenes ?? [] : []
  },

  representation: async (id: string): Promise<MemoryRepresentationDto | null> => {
    const response = await api.get<RepresentationResponse>(`/api/memory/representations/${encodeURIComponent(id)}`)
    return response.mounted ? response.representation ?? null : null
  },

  recallCycles: async (limit = 100): Promise<MemoryRecallCycleSummaryDto[]> => {
    const response = await api.get<RecallListResponse>(`/api/memory/recall?limit=${limit}`)
    return response.mounted ? response.cycles ?? [] : []
  },

  recallCycle: async (cycleId: string): Promise<MemoryRecallCycleDto | null> => {
    const response = await api.get<RecallResponse>(`/api/memory/recall/${encodeURIComponent(cycleId)}`)
    return response.mounted ? response.cycle ?? null : null
  },

  correct: async (request: {
    memoryId: string
    replacement: { form: string; data: Record<string, unknown> }
    evidenceIds?: string[]
    explanation: string
    ownerId: string
  }): Promise<unknown> => {
    const response = await api.post<Mounted & { transaction?: unknown }>('/api/memory/corrections', request)
    return response.mounted ? response.transaction ?? null : null
  },

  restrictInfluence: async (request: {
    memoryId: string
    surfaces: string[]
    reason: string
    ownerId: string
  }): Promise<unknown> => {
    const response = await api.post<Mounted & { transaction?: unknown }>('/api/memory/influence/restrict', request)
    return response.mounted ? response.transaction ?? null : null
  },

  revokeInfluence: async (request: {
    memoryId: string
    reason: string
    ownerId: string
  }): Promise<unknown> => {
    const response = await api.post<Mounted & { transaction?: unknown }>('/api/memory/influence/revoke', request)
    return response.mounted ? response.transaction ?? null : null
  },

  erasePreview: async (rootMemoryIds: string[]): Promise<MemoryErasePreviewDto | null> => {
    const response = await api.post<PreviewResponse>('/api/memory/erase/preview', { rootMemoryIds })
    return response.mounted ? response.preview ?? null : null
  },

  eraseAuthorize: async (request: {
    rootMemoryIds: string[]
    ownerId: string
    ttlMinutes?: number
  }): Promise<MemoryEraseAuthorizeResponseDto | null> => {
    const response = await api.post<Mounted & MemoryEraseAuthorizeResponseDto>('/api/memory/erase/authorize', request)
    return response.mounted
      ? {
          authorization: response.authorization,
          preview: response.preview,
        }
      : null
  },

  eraseCommit: async (request: {
    authorizationId: string
    ownerId: string
  }): Promise<{ erasedMemoryIds: string[] } | null> => {
    const response = await api.post<Mounted & { commit?: { erasedMemoryIds: string[] } }>('/api/memory/erase/commit', request)
    return response.mounted ? response.commit ?? null : null
  },
}
