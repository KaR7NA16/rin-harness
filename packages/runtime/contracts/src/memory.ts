/**
 * Stable API DTOs shared by application surfaces and runtime/domain packages.
 *
 * This package contains no storage, Cordis, HTTP, React, or platform behavior.
 *
 * @module @rin/contracts
 */

export const MEMORY_SCHEMA_VERSION = 1 as const

export const MEMORY_PROJECTIONS = [
  'prompt-memory',
  'notes',
  'knowledge',
  'session-search',
  'session',
  'canonical',
] as const

export type MemoryProjection = typeof MEMORY_PROJECTIONS[number]
export type MemoryRole = 'canonical' | 'source' | 'projection' | 'derived' | 'secret'
export type MemoryKind =
  | 'episodic'
  | 'semantic'
  | 'preference'
  | 'relationship'
  | 'self'
  | 'procedural'
  | 'prompt'
  | 'document'
  | 'transcript'
  | 'other'
export type MemoryStatus = 'active' | 'revoked' | 'deleted'
export type MemoryVisibility = 'private' | 'model'
export type MemorySourceKind =
  | 'user'
  | 'file'
  | 'session'
  | 'message'
  | 'projection'
  | 'import'
  | 'external'

export interface MemorySource {
  id: string
  kind: MemorySourceKind
  uri: string
  label?: string
  contentHash?: string
  sessionId?: string
  messageId?: string
  metadata?: Record<string, unknown>
}

export interface MemoryItem {
  id: string
  projection: MemoryProjection
  kind: MemoryKind
  content: string
  version: string
  status: MemoryStatus
  visibility: MemoryVisibility
  confidence?: number
  source: MemorySource
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
  revokedAt?: string
  deletedAt?: string
}

export interface MemoryItemInput {
  id?: string
  projection: MemoryProjection
  kind: MemoryKind
  content: string
  version?: string
  visibility?: MemoryVisibility
  confidence?: number
  source: MemorySource
  metadata?: Record<string, unknown>
}

export interface MemoryListOptions {
  projection?: MemoryProjection
  status?: MemoryStatus
  sourceId?: string
  limit?: number
}

export interface MemoryInjectionRecord {
  id?: string
  surface: string
  memoryIds: string[]
  memoryVersions: Record<string, string>
  sessionId?: string
  metadata?: Record<string, unknown>
  createdAt?: string
}

export interface MemoryProjectionDescriptor {
  id: MemoryProjection
  owner: string
  role: MemoryRole
  path: string
  rebuildable: boolean
  modelVisible: boolean
}

export interface MemoryStorageManifest {
  sessionRoot: string
  settingsPath: string
  credentialsPath: string
  archiveRoot: string
  credentialsExcludedByDefault: true
}

export interface MemoryManifest {
  schemaVersion: typeof MEMORY_SCHEMA_VERSION
  generatedAt: string
  root: '.'
  canonical: {
    database: string
    manifest: string
  }
  storage: MemoryStorageManifest
  projections: MemoryProjectionDescriptor[]
  archive: {
    format: 'rin-archive'
    version: 2
    secretsExcludedByDefault: true
    externalSourcesCopied: boolean
  }
}

export interface MemoryExport {
  schemaVersion: typeof MEMORY_SCHEMA_VERSION
  exportedAt: string
  items: MemoryItem[]
  injections: MemoryInjectionRecord[]
}
