import { createHash, randomUUID } from 'node:crypto'
import type {
  MemoryItem,
  MemoryItemInput,
  MemoryListOptions,
  MemoryProjection,
} from './types.ts'

/** Minimal store seam used by projection writers. */
export interface MemoryProjectionStore {
  list(options?: MemoryListOptions): MemoryItem[]
  get(id: string): MemoryItem | undefined
  upsert(input: MemoryItemInput): MemoryItem
  delete(id: string): boolean
}

function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function isSameProjection(item: MemoryItem, input: MemoryItemInput): boolean {
  return item.kind === input.kind
    && item.content === input.content
    && item.version === (input.version ?? item.version)
    && item.visibility === (input.visibility ?? 'model')
    && item.source.id === input.source.id
    && item.source.uri === input.source.uri
    && JSON.stringify(item.metadata ?? {}) === JSON.stringify(input.metadata ?? {})
}

/** Replace one source's active projection without resurrecting tombstones. */
export function syncMemoryProjection(
  store: MemoryProjectionStore,
  input: MemoryItemInput,
): MemoryItem {
  const source = {
    ...input.source,
    contentHash: input.source.contentHash ?? contentHash(input.content),
  }
  const candidate = { ...input, source }
  const active = store.list({
    projection: input.projection,
    sourceId: input.source.id,
    status: 'active',
    limit: 1000,
  })
  const current = active.find(item => isSameProjection(item, candidate))
  if (current !== undefined) return current
  for (const item of active) store.delete(item.id)

  const baseId = input.id ?? input.projection + ':' + input.source.id
  const existing = store.get(baseId)
  const id = existing !== undefined && existing.status !== 'active'
    ? baseId + ':' + randomUUID()
    : baseId
  return store.upsert({ ...candidate, id })
}

/** Tombstone all active items emitted by one projection source. */
export function removeMemoryProjectionSource(
  store: MemoryProjectionStore,
  projection: MemoryProjection,
  sourceId: string,
): number {
  const active = store.list({ projection, sourceId, status: 'active', limit: 1000 })
  for (const item of active) store.delete(item.id)
  return active.length
}
