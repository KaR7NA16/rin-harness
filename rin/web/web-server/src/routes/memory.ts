/**
 * rin web-server — unified memory catalog routes.
 *
 * The catalog is the single API surface for memory identity, provenance,
 * lifecycle, export, and model-injection audit. Notes, prompt-memory,
 * knowledge, and session-search continue to own their projections.
 *
 * @module @rin/web-server
 */

import type {
  MemoryItemInput,
  MemoryKind,
  MemoryProjection,
  MemorySource,
  MemoryStatus,
} from '@rin/memory'
import type { Config, JsonResponse } from '../types.ts'
import {
  asRecord,
  error,
  errorMessage,
  mounted,
  mountedValue,
  notMounted,
  parsePositiveInt,
  queryParam,
  stringField,
} from '../http.ts'
import type { RinServiceRefs } from '../routes.ts'

const PROJECTIONS: readonly MemoryProjection[] = [
  'prompt-memory',
  'notes',
  'knowledge',
  'session-search',
  'session',
  'canonical',
]

const KINDS: readonly MemoryKind[] = [
  'episodic',
  'semantic',
  'preference',
  'relationship',
  'self',
  'procedural',
  'prompt',
  'document',
  'transcript',
  'other',
]

const STATUSES: readonly MemoryStatus[] = ['active', 'revoked', 'deleted']
const SOURCE_KINDS: readonly MemorySource['kind'][] = [
  'user',
  'file',
  'session',
  'message',
  'projection',
  'import',
  'external',
]
const MEMORY_ID_RE = /^\/api\/memory\/([^/]+)$/
const MEMORY_REVOKE_RE = /^\/api\/memory\/([^/]+)\/revoke$/

/** Dispatch the unified memory catalog endpoints. */
export async function handle(
  pathname: string,
  search: string,
  method: string,
  body: unknown,
  services: RinServiceRefs,
  _config: Config,
): Promise<JsonResponse | null> {
  if (pathname === '/api/memory') return collectionRoute(method, search, body, services)
  if (pathname === '/api/memory/manifest') return manifestRoute(method, services)
  if (pathname === '/api/memory/injections') return injectionsRoute(method, search, services)
  if (pathname === '/api/memory/export') return exportRoute(method, services)

  const revokeMatch = MEMORY_REVOKE_RE.exec(pathname)
  if (revokeMatch !== null && revokeMatch[1] !== undefined) {
    return revokeRoute(decodeURIComponent(revokeMatch[1]), method, body, services)
  }
  const itemMatch = MEMORY_ID_RE.exec(pathname)
  if (itemMatch !== null && itemMatch[1] !== undefined) {
    return itemRoute(decodeURIComponent(itemMatch[1]), method, services)
  }
  return null
}

function manifestRoute(method: string, services: RinServiceRefs): JsonResponse {
  if (method !== 'GET') return error(405, 'method not allowed')
  const memory = services.memory()
  if (memory === undefined) return notMounted()
  return mounted(memory.getManifest())
}

function collectionRoute(
  method: string,
  search: string,
  body: unknown,
  services: RinServiceRefs,
): JsonResponse {
  const memory = services.memory()
  if (memory === undefined) return notMounted()
  if (method === 'GET') {
    const projection = parseProjection(search)
    if (projection === 'invalid') return error(400, 'projection is invalid')
    const status = parseStatus(search)
    if (status === 'invalid') return error(400, 'status is invalid')
    const sourceId = queryParam(search, 'sourceId')
    const limit = parsePositiveInt(search, 'limit')
    return mountedValue('items', memory.list({
      ...(projection === undefined ? {} : { projection }),
      ...(status === undefined ? {} : { status }),
      ...(sourceId === undefined ? {} : { sourceId }),
      ...(limit === undefined ? {} : { limit }),
    }))
  }
  if (method !== 'POST') return error(405, 'method not allowed')
  const input = parseMemoryInput(body)
  if ('error' in input) return error(400, input.error)
  try {
    return mountedValue('item', memory.upsert(input.value))
  } catch (err) {
    return error(400, errorMessage(err))
  }
}

function injectionsRoute(
  method: string,
  search: string,
  services: RinServiceRefs,
): JsonResponse {
  if (method !== 'GET') return error(405, 'method not allowed')
  const memory = services.memory()
  if (memory === undefined) return notMounted()
  return mountedValue('injections', memory.listInjections(parsePositiveInt(search, 'limit') ?? 100))
}

function exportRoute(method: string, services: RinServiceRefs): JsonResponse {
  if (method !== 'GET') return error(405, 'method not allowed')
  const memory = services.memory()
  if (memory === undefined) return notMounted()
  return mounted(memory.exportData())
}

function itemRoute(id: string, method: string, services: RinServiceRefs): JsonResponse {
  if (method === 'DELETE') return deleteRoute(id, method, services)
  if (method !== 'GET') return error(405, 'method not allowed')
  const memory = services.memory()
  if (memory === undefined) return notMounted()
  const item = memory.get(id)
  return item === undefined ? error(404, 'memory item not found') : mountedValue('item', item)
}

function revokeRoute(
  id: string,
  method: string,
  body: unknown,
  services: RinServiceRefs,
): JsonResponse {
  if (method !== 'POST') return error(405, 'method not allowed')
  const memory = services.memory()
  if (memory === undefined) return notMounted()
  const fields = asRecord(body)
  const reason = fields === undefined ? undefined : stringField(fields, 'reason')
  const item = memory.revoke(id, reason)
  return item === undefined ? error(404, 'memory item not found') : mountedValue('item', item)
}

function deleteRoute(id: string, method: string, services: RinServiceRefs): JsonResponse {
  if (method !== 'DELETE') return error(405, 'method not allowed')
  const memory = services.memory()
  if (memory === undefined) return notMounted()
  if (memory.get(id) === undefined) return error(404, 'memory item not found')
  return mountedValue('deleted', memory.delete(id))
}

function parseProjection(search: string): MemoryProjection | 'invalid' | undefined {
  const value = queryParam(search, 'projection')
  if (value === undefined) return undefined
  return PROJECTIONS.includes(value as MemoryProjection) ? value as MemoryProjection : 'invalid'
}

function parseStatus(search: string): MemoryStatus | 'invalid' | undefined {
  const value = queryParam(search, 'status')
  if (value === undefined) return undefined
  return STATUSES.includes(value as MemoryStatus) ? value as MemoryStatus : 'invalid'
}

function parseMemoryInput(body: unknown): { value: MemoryItemInput; error?: never } | { error: string } {
  const fields = asRecord(body)
  if (fields === undefined) return { error: 'request body must be a JSON object' }
  const projection = stringField(fields, 'projection')
  const kind = stringField(fields, 'kind')
  const content = stringField(fields, 'content')
  const sourceValue = asRecord(fields.source)
  const version = stringField(fields, 'version')
  if (fields.version !== undefined && (version === undefined || version.trim() === '')) {
    return { error: 'version must be a non-empty string' }
  }
  const confidenceValue = fields.confidence
  if (confidenceValue !== undefined && (typeof confidenceValue !== 'number' || !Number.isFinite(confidenceValue) || confidenceValue < 0 || confidenceValue > 1)) {
    return { error: 'confidence must be a number between 0 and 1' }
  }
  const confidence = typeof confidenceValue === 'number' ? confidenceValue : undefined
  const metadataValue = fields.metadata
  const metadata = metadataValue === undefined ? undefined : asRecord(metadataValue)
  if (metadataValue !== undefined && metadata === undefined) {
    return { error: 'metadata must be a JSON object' }
  }
  if (projection === undefined || !PROJECTIONS.includes(projection as MemoryProjection)) return { error: 'projection is invalid' }
  if (kind === undefined || !KINDS.includes(kind as MemoryKind)) return { error: 'kind is invalid' }
  if (content === undefined || content.trim() === '') return { error: 'content is required' }
  if (sourceValue === undefined) return { error: 'source is required' }
  const sourceId = stringField(sourceValue, 'id')
  const sourceKind = stringField(sourceValue, 'kind')
  const sourceUri = stringField(sourceValue, 'uri')
  if (sourceId === undefined || sourceKind === undefined || sourceUri === undefined) {
    return { error: 'source.id, source.kind, and source.uri are required' }
  }
  if (!SOURCE_KINDS.includes(sourceKind as MemorySource['kind'])) return { error: 'source.kind is invalid' }
  const source: MemorySource = {
    id: sourceId,
    kind: sourceKind as MemorySource['kind'],
    uri: sourceUri,
  }
  const sourceLabel = stringField(sourceValue, 'label')
  const contentHash = stringField(sourceValue, 'contentHash')
  const sessionId = stringField(sourceValue, 'sessionId')
  const messageId = stringField(sourceValue, 'messageId')
  const sourceMetadataValue = sourceValue.metadata
  const sourceMetadata = sourceMetadataValue === undefined ? undefined : asRecord(sourceMetadataValue)
  if (sourceValue.label !== undefined && sourceLabel === undefined) {
    return { error: 'source.label must be a string' }
  }
  if (sourceValue.contentHash !== undefined && contentHash === undefined) {
    return { error: 'source.contentHash must be a string' }
  }
  if (sourceValue.sessionId !== undefined && sessionId === undefined) {
    return { error: 'source.sessionId must be a string' }
  }
  if (sourceValue.messageId !== undefined && messageId === undefined) {
    return { error: 'source.messageId must be a string' }
  }
  if (sourceMetadataValue !== undefined && sourceMetadata === undefined) {
    return { error: 'source.metadata must be a JSON object' }
  }
  if (sourceLabel !== undefined) source.label = sourceLabel
  if (contentHash !== undefined) source.contentHash = contentHash
  if (sessionId !== undefined) source.sessionId = sessionId
  if (messageId !== undefined) source.messageId = messageId
  if (sourceMetadata !== undefined) source.metadata = sourceMetadata
  const id = stringField(fields, 'id')
  if (fields.id !== undefined && (id === undefined || id.trim() === '')) {
    return { error: 'id must be a non-empty string' }
  }
  const visibility = stringField(fields, 'visibility')
  if (visibility !== undefined && visibility !== 'private' && visibility !== 'model') {
    return { error: 'visibility must be private or model' }
  }
  return {
    value: {
      ...(id === undefined ? {} : { id }),
      projection: projection as MemoryProjection,
      kind: kind as MemoryKind,
      content,
      ...(version === undefined ? {} : { version }),
      ...(confidence === undefined ? {} : { confidence }),
      ...(metadata === undefined ? {} : { metadata }),
      ...(visibility === undefined ? {} : { visibility }),
      source,
    },
  }
}
