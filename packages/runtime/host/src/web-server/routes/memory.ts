/**
 * rin web-server — memory cognition and owner intent routes.
 *
 * The cognition surfaces expose the current field, manifest, scenes,
 * representations, recall cycles, the portable cognition journal, and the
 * owner intent commands (corrections, influence control, authorized erasure).
 * Each intent route maps to one owner-only cognitive command on the memory
 * store; the former generic catalog CRUD routes were removed in M8-01.
 *
 * @module @rin/host/web-server
 */

import type { MemoryRepresentationFormDto } from '@rin/contracts'
import {
  MEMORY_INFLUENCE_SURFACES,
  createEvidenceId,
  createMemoryAuthorizationId,
  createMemoryId,
  type MemoryInfluenceSurface,
  type RinMemory,
} from '@rin/memory'
import type { Config, JsonResponse } from '../types.ts'
import {
  error,
  mounted,
  mountedValue,
  notMounted,
  parsePositiveInt,
} from '../http.ts'
import type { RinServiceRefs } from '../routes.ts'

const MEMORY_REPRESENTATION_RE = /^\/api\/memory\/representations\/([^/]+)$/
const MEMORY_RECALL_RE = /^\/api\/memory\/recall\/([^/]+)$/

/** Dispatch the unified memory cognition endpoints. */
export async function handle(
  pathname: string,
  search: string,
  method: string,
  body: unknown,
  services: RinServiceRefs,
  _config: Config,
): Promise<JsonResponse | null> {
  if (pathname === '/api/memory/field') return fieldRoute(method, services)
  if (pathname === '/api/memory/manifest') return manifestRoute(method, services)
  if (pathname === '/api/memory/journal') return journalRoute(method, services)
  if (pathname === '/api/memory/journal/restore') return journalRestoreRoute(method, body, services)
  if (pathname === '/api/memory/scenes') return scenesRoute(method, services)
  if (pathname === '/api/memory/recall') return recallListRoute(method, search, services)
  if (pathname === '/api/memory/corrections') {
    return correctionsRoute(method, body, services)
  }
  if (pathname === '/api/memory/influence/restrict') {
    return influenceRestrictRoute(method, body, services)
  }
  if (pathname === '/api/memory/influence/revoke') {
    return influenceRevokeRoute(method, body, services)
  }
  if (pathname === '/api/memory/erase/preview') {
    return erasePreviewRoute(method, body, services)
  }
  if (pathname === '/api/memory/erase/authorize') {
    return eraseAuthorizeRoute(method, body, services)
  }
  if (pathname === '/api/memory/erase/commit') {
    return eraseCommitRoute(method, body, services)
  }

  const recallMatch = MEMORY_RECALL_RE.exec(pathname)
  if (recallMatch !== null && recallMatch[1] !== undefined) {
    return recallRoute(decodeURIComponent(recallMatch[1]), method, services)
  }
  const representationMatch = MEMORY_REPRESENTATION_RE.exec(pathname)
  if (representationMatch !== null && representationMatch[1] !== undefined) {
    return representationRoute(decodeURIComponent(representationMatch[1]), method, services)
  }
  return null
}

function fieldRoute(method: string, services: RinServiceRefs): JsonResponse {
  if (method !== 'GET') return error(405, 'method not allowed')
  const memory = services.memory()
  if (memory === undefined) return notMounted()
  return mountedValue('field', memory.getCurrentField())
}

function manifestRoute(method: string, services: RinServiceRefs): JsonResponse {
  if (method !== 'GET') return error(405, 'method not allowed')
  const memory = services.memory()
  if (memory === undefined) return notMounted()
  return mounted(memory.getManifest())
}

/** Exports the cognition journal in committed order for portable replay. */
function journalRoute(method: string, services: RinServiceRefs): JsonResponse {
  if (method !== 'GET') return error(405, 'method not allowed')
  const memory = services.memory()
  if (memory === undefined) return notMounted()
  return mountedValue('transactions', memory.exportCognitionJournal())
}

function journalRestoreRoute(method: string, body: unknown, services: RinServiceRefs): JsonResponse {
  if (method !== 'POST') return error(405, 'method not allowed')
  const request = asObject(body)
  const transactions = request === undefined ? undefined : request.transactions
  if (!Array.isArray(transactions) || transactions.length === 0) {
    return error(400, 'journal restore requires a non-empty transactions array')
  }
  const memory = services.memory()
  if (memory === undefined) return notMounted()
  try {
    const restored = memory.restoreCognitionJournal(transactions as Parameters<typeof memory.restoreCognitionJournal>[0])
    return mountedValue('restored', restored)
  } catch (error_) {
    return intentError(error_)
  }
}

const REPRESENTATION_FORMS: readonly MemoryRepresentationFormDto[] = [
  'scene',
  'structure',
  'self-model',
  'person-model',
  'relationship-model',
  'disposition',
  'open-loop',
  'prospect',
]

function toRepresentationDto(memory: RinMemory): Record<string, unknown> {
  return {
    id: String(memory.id),
    form: memory.form,
    data: memory.data,
    state: { ...memory.state },
    dynamics: memory.dynamics,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
  }
}

function toSceneSummary(scene: Extract<RinMemory, { form: 'scene' }>): Record<string, unknown> {
  return {
    id: String(scene.id),
    version: scene.updatedAt,
    status: scene.data.lifecycle?.status ?? 'open',
    participants: scene.data.participants.map(String),
    environment: scene.data.environment,
    goals: scene.data.goals.map(String),
    observationCount: scene.data.observations.length,
    startedAt: scene.data.lifecycle?.startedAt ?? scene.createdAt,
    updatedAt: scene.updatedAt,
  }
}

function scenesRoute(method: string, services: RinServiceRefs): JsonResponse {
  if (method !== 'GET') return error(405, 'method not allowed')
  const memory = services.memory()
  if (memory === undefined) return notMounted()
  const scenes = memory.readCognitionState().memories
    .filter((item): item is Extract<RinMemory, { form: 'scene' }> => item.form === 'scene')
  return mountedValue('scenes', scenes.map(toSceneSummary))
}

function representationRoute(id: string, method: string, services: RinServiceRefs): JsonResponse {
  if (method !== 'GET') return error(405, 'method not allowed')
  const memory = services.memory()
  if (memory === undefined) return notMounted()
  const representation = memory.readCognitionState().memories.find(item => String(item.id) === id)
  return representation === undefined
    ? error(404, 'memory representation not found')
    : mountedValue('representation', toRepresentationDto(representation))
}

function recallListRoute(method: string, search: string, services: RinServiceRefs): JsonResponse {
  if (method !== 'GET') return error(405, 'method not allowed')
  const memory = services.memory()
  if (memory === undefined) return notMounted()
  const records = memory.listRecallRecords(parsePositiveInt(search, 'limit') ?? 100)
  return mountedValue('cycles', records.map(record => ({
    cycleId: record.cycleId,
    createdAt: record.createdAt,
    materializedVersion: record.workspace.materializedVersion,
    itemCount: record.workspace.items.length,
  })))
}

function recallRoute(cycleId: string, method: string, services: RinServiceRefs): JsonResponse {
  if (method !== 'GET') return error(405, 'method not allowed')
  const memory = services.memory()
  if (memory === undefined) return notMounted()
  const record = memory.getRecallRecord(cycleId)
  if (record === undefined) return error(404, 'recall cycle not found')
  return mountedValue('cycle', {
    cycleId: record.cycleId,
    createdAt: record.createdAt,
    materializedVersion: record.workspace.materializedVersion,
    itemCount: record.workspace.items.length,
    workspace: record.workspace,
    trace: record.trace,
  })
}

function asObject(body: unknown): Record<string, unknown> | undefined {
  return body !== null && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : undefined
}

function readString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key]
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function readStringArray(body: Record<string, unknown>, key: string): string[] | undefined {
  const value = body[key]
  return Array.isArray(value) && value.every(item => typeof item === 'string')
    ? value as string[]
    : undefined
}

/**
 * Maps store rejection reasons onto HTTP semantics: unknown referents are 404,
 * expired/consumed/drifted authorizations are 409, and every other rejection
 * is a request problem.
 */
function intentError(error_: unknown): JsonResponse {
  const message = error_ instanceof Error ? error_.message : 'intent rejected'
  if (message.includes('unknown memory') || message.includes('unknown authorization')) {
    return error(404, message)
  }
  if (message.includes('expired') || message.includes('already consumed') || message.includes('drifted')) {
    return error(409, message)
  }
  return error(400, message)
}

function correctionsRoute(method: string, body: unknown, services: RinServiceRefs): JsonResponse {
  if (method !== 'POST') return error(405, 'method not allowed')
  const request = asObject(body)
  if (request === undefined) return error(400, 'correction request must be an object')
  const memoryId = readString(request, 'memoryId')
  const explanation = readString(request, 'explanation')
  const ownerId = readString(request, 'ownerId')
  const replacement = asObject(request.replacement)
  const form = replacement === undefined ? undefined : readString(replacement, 'form')
  const data = replacement === undefined ? undefined : replacement.data
  if (memoryId === undefined || explanation === undefined || ownerId === undefined
    || replacement === undefined || form === undefined
    || !REPRESENTATION_FORMS.includes(form as MemoryRepresentationFormDto)
    || data === null || typeof data !== 'object' || Array.isArray(data)) {
    return error(400, 'correction requires memoryId, replacement.form, replacement.data, explanation, and ownerId')
  }
  const evidenceIds = readStringArray(request, 'evidenceIds') ?? []
  const memory = services.memory()
  if (memory === undefined) return notMounted()
  try {
    const transaction = memory.correctUnderstanding({
      memoryId: createMemoryId(memoryId),
      replacement: { form: form as MemoryRepresentationFormDto, data: data as Record<string, unknown> },
      evidenceIds: evidenceIds.map(createEvidenceId),
      explanation,
      ownerId,
    })
    return mountedValue('transaction', transaction)
  } catch (error_) {
    return intentError(error_)
  }
}

function influenceRestrictRoute(method: string, body: unknown, services: RinServiceRefs): JsonResponse {
  if (method !== 'POST') return error(405, 'method not allowed')
  const request = asObject(body)
  if (request === undefined) return error(400, 'influence restriction request must be an object')
  const memoryId = readString(request, 'memoryId')
  const surfaces = readStringArray(request, 'surfaces')
  const reason = readString(request, 'reason')
  const ownerId = readString(request, 'ownerId')
  if (memoryId === undefined || surfaces === undefined || surfaces.length === 0
    || reason === undefined || ownerId === undefined) {
    return error(400, 'influence restriction requires memoryId, surfaces, reason, and ownerId')
  }
  if (surfaces.some(surface => !MEMORY_INFLUENCE_SURFACES.includes(surface as MemoryInfluenceSurface))) {
    return error(400, 'influence restriction surfaces must be known influence surfaces')
  }
  const memory = services.memory()
  if (memory === undefined) return notMounted()
  try {
    const transaction = memory.restrictInfluence({
      memoryId: createMemoryId(memoryId),
      surfaces: surfaces.map(surface => surface as MemoryInfluenceSurface),
      reason,
      ownerId,
    })
    return mountedValue('transaction', transaction)
  } catch (error_) {
    return intentError(error_)
  }
}

function influenceRevokeRoute(method: string, body: unknown, services: RinServiceRefs): JsonResponse {
  if (method !== 'POST') return error(405, 'method not allowed')
  const request = asObject(body)
  if (request === undefined) return error(400, 'influence revocation request must be an object')
  const memoryId = readString(request, 'memoryId')
  const reason = readString(request, 'reason')
  const ownerId = readString(request, 'ownerId')
  if (memoryId === undefined || reason === undefined || ownerId === undefined) {
    return error(400, 'influence revocation requires memoryId, reason, and ownerId')
  }
  const memory = services.memory()
  if (memory === undefined) return notMounted()
  try {
    const transaction = memory.revokeInfluence({
      memoryId: createMemoryId(memoryId),
      reason,
      ownerId,
    })
    return mountedValue('transaction', transaction)
  } catch (error_) {
    return intentError(error_)
  }
}

function erasePreviewRoute(method: string, body: unknown, services: RinServiceRefs): JsonResponse {
  if (method !== 'POST') return error(405, 'method not allowed')
  const request = asObject(body)
  if (request === undefined) return error(400, 'erase preview request must be an object')
  const rootMemoryIds = readStringArray(request, 'rootMemoryIds')
  if (rootMemoryIds === undefined || rootMemoryIds.length === 0) {
    return error(400, 'erase preview requires rootMemoryIds')
  }
  const memory = services.memory()
  if (memory === undefined) return notMounted()
  try {
    const preview = memory.requestErasePreview(rootMemoryIds.map(createMemoryId))
    return mountedValue('preview', preview)
  } catch (error_) {
    return intentError(error_)
  }
}

function eraseAuthorizeRoute(method: string, body: unknown, services: RinServiceRefs): JsonResponse {
  if (method !== 'POST') return error(405, 'method not allowed')
  const request = asObject(body)
  if (request === undefined) return error(400, 'erase authorization request must be an object')
  const rootMemoryIds = readStringArray(request, 'rootMemoryIds')
  const ownerId = readString(request, 'ownerId')
  const ttlMinutes = typeof request.ttlMinutes === 'number' ? request.ttlMinutes : undefined
  if (rootMemoryIds === undefined || rootMemoryIds.length === 0 || ownerId === undefined) {
    return error(400, 'erase authorization requires rootMemoryIds and ownerId')
  }
  const memory = services.memory()
  if (memory === undefined) return notMounted()
  try {
    const result = memory.authorizeErase({
      rootMemoryIds: rootMemoryIds.map(createMemoryId),
      ownerId,
      ...(ttlMinutes === undefined ? {} : { ttlMinutes }),
    })
    return mountedValue('authorization', {
      authorization: result.authorization,
      preview: result.preview,
    })
  } catch (error_) {
    return intentError(error_)
  }
}

function eraseCommitRoute(method: string, body: unknown, services: RinServiceRefs): JsonResponse {
  if (method !== 'POST') return error(405, 'method not allowed')
  const request = asObject(body)
  if (request === undefined) return error(400, 'erase commit request must be an object')
  const authorizationId = readString(request, 'authorizationId')
  const ownerId = readString(request, 'ownerId')
  if (authorizationId === undefined || ownerId === undefined) {
    return error(400, 'erase commit requires authorizationId and ownerId')
  }
  const memory = services.memory()
  if (memory === undefined) return notMounted()
  try {
    const result = memory.commitAuthorizedErase({
      authorizationId: createMemoryAuthorizationId(authorizationId),
      ownerId,
    })
    return mountedValue('commit', {
      erasedMemoryIds: result.erasedMemoryIds,
      transaction: result.transaction,
    })
  } catch (error_) {
    return intentError(error_)
  }
}
