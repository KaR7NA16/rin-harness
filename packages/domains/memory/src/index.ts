/**
 * rin memory — canonical local memory catalog and injection audit.
 *
 * Notes, Knowledge, Session Search, and prompt-memory remain independent
 * projections. This service owns stable memory identity, lifecycle, provenance
 * references, and the record of model-visible memory versions.
 *
 * @module @rin/memory
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { buildMemoryManifest, normalizeMemoryStorage, writeMemoryManifestSync } from './manifest.ts'
import { MemoryDatabase } from './store.ts'
import type {
  MemoryExport,
  MemoryInjectionRecord,
  MemoryItem,
  MemoryItemInput,
  MemoryListOptions,
  MemoryManifest,
} from './types.ts'

export * from './types.ts'
export { removeMemoryProjectionSource, syncMemoryProjection } from './projection.ts'
export { buildMemoryManifest, normalizeMemoryStorage, readMemoryManifest, writeMemoryManifestSync } from './manifest.ts'
export { MemoryDatabase } from './store.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    memory: MemoryStore
  }
}

export interface MemoryPluginConfig {
  dbPath: string
  manifestPath: string
  homeRoot: string
  sessionRoot?: string
  settingsPath?: string
  credentialsPath?: string
  archiveRoot?: string
}

export abstract class MemoryStore extends Service {
  constructor(ctx: Context) {
    super(ctx, 'memory')
  }

  abstract getManifest(): MemoryManifest
  abstract list(options?: MemoryListOptions): MemoryItem[]
  abstract get(id: string): MemoryItem | undefined
  abstract upsert(input: MemoryItemInput): MemoryItem
  abstract revoke(id: string, reason?: string): MemoryItem | undefined
  abstract delete(id: string): boolean
  abstract recordInjection(input: MemoryInjectionRecord): MemoryInjectionRecord
  abstract prepareForArchive(): void
  abstract listInjections(limit?: number): MemoryInjectionRecord[]
  abstract exportData(): MemoryExport
}

export class FileMemoryStore extends MemoryStore {
  private readonly database: MemoryDatabase
  private readonly manifest: MemoryManifest

  constructor(ctx: Context, config: MemoryPluginConfig) {
    super(ctx)
    if (!config || config.dbPath.trim() === '' || config.manifestPath.trim() === '' || config.homeRoot.trim() === '') {
      throw new Error('rin memory: dbPath, manifestPath, and homeRoot are required')
    }
    this.database = new MemoryDatabase(config.dbPath)
    const storage = normalizeMemoryStorage(config.homeRoot, {
      sessionRoot: config.sessionRoot,
      settingsPath: config.settingsPath,
      credentialsPath: config.credentialsPath,
      archiveRoot: config.archiveRoot,
    })
    this.manifest = buildMemoryManifest(new Date().toISOString(), storage)
    writeMemoryManifestSync(config.manifestPath, this.manifest)
  }

  override getManifest(): MemoryManifest {
    return this.manifest
  }

  override list(options?: MemoryListOptions): MemoryItem[] {
    return this.database.list(options)
  }

  override get(id: string): MemoryItem | undefined {
    return this.database.get(id)
  }

  override upsert(input: MemoryItemInput): MemoryItem {
    return this.database.upsert(input)
  }

  override revoke(id: string, reason?: string): MemoryItem | undefined {
    return this.database.revoke(id, reason)
  }

  override delete(id: string): boolean {
    return this.database.delete(id)
  }

  override recordInjection(input: MemoryInjectionRecord): MemoryInjectionRecord {
    return this.database.recordInjection(input)
  }

  override listInjections(limit?: number): MemoryInjectionRecord[] {
    return this.database.listInjections(limit)
  }
  override prepareForArchive(): void {
    this.database.prepareForArchive()
  }

  override exportData(): MemoryExport {
    return this.database.exportData()
  }
}

export const name = 'memory'
export const inject: string[] = []

export function apply(ctx: Context, config: MemoryPluginConfig): void {
  ctx.plugin(FileMemoryStore, config)
}
