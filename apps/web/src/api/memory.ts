import type {
  MemoryExport,
  MemoryInjectionRecord,
  MemoryItem,
  MemoryItemInput,
  MemoryListOptions,
  MemoryManifest,
} from '@rin/contracts'
import { api } from './client'

type Mounted = { mounted: boolean }
type ItemResponse = Mounted & { item?: MemoryItem }
type ListResponse = Mounted & { items?: MemoryItem[] }
type InjectionsResponse = Mounted & { injections?: MemoryInjectionRecord[] }

function unwrap<T extends object>({ mounted, ...value }: Mounted & T): T | null {
  return mounted ? value as T : null
}

function listPath(options: MemoryListOptions): string {
  const params = new URLSearchParams()
  if (options.projection !== undefined) params.set('projection', options.projection)
  if (options.status !== undefined) params.set('status', options.status)
  if (options.sourceId !== undefined) params.set('sourceId', options.sourceId)
  if (options.limit !== undefined) params.set('limit', String(options.limit))
  const query = params.toString()
  return query.length > 0 ? `/api/memory?${query}` : '/api/memory'
}

/** Canonical memory catalog API; prompt-memory file editing stays in promptMemoryApi. */

export const memoryApi = {
  manifest: async (): Promise<MemoryManifest | null> => {
    const response = await api.get<Mounted & MemoryManifest>('/api/memory/manifest')
    return unwrap<MemoryManifest>(response)
  },

  list: async (options: MemoryListOptions = {}): Promise<MemoryItem[]> => {
    const response = await api.get<ListResponse>(listPath(options))
    return response.mounted ? response.items ?? [] : []
  },

  get: async (id: string): Promise<MemoryItem | null> => {
    const response = await api.get<ItemResponse>(`/api/memory/${encodeURIComponent(id)}`)
    return response.mounted ? response.item ?? null : null
  },

  upsert: async (input: MemoryItemInput): Promise<MemoryItem | null> => {
    const response = await api.post<ItemResponse>('/api/memory', input)
    return response.mounted ? response.item ?? null : null
  },

  revoke: async (id: string, reason?: string): Promise<MemoryItem | null> => {
    const response = await api.post<ItemResponse>(
      `/api/memory/${encodeURIComponent(id)}/revoke`,
      reason === undefined ? undefined : { reason },
    )
    return response.mounted ? response.item ?? null : null
  },

  remove: async (id: string): Promise<boolean> => {
    const response = await api.delete<Mounted & { deleted?: boolean }>(
      `/api/memory/${encodeURIComponent(id)}`,
    )
    return response.mounted ? response.deleted === true : false
  },

  injections: async (limit = 100): Promise<MemoryInjectionRecord[]> => {
    const response = await api.get<InjectionsResponse>(`/api/memory/injections?limit=${limit}`)
    return response.mounted ? response.injections ?? [] : []
  },

  exportData: async (): Promise<MemoryExport | null> => {
    const response = await api.get<Mounted & MemoryExport>('/api/memory/export')
    return unwrap<MemoryExport>(response)
  },
}
