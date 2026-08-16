/**
 * rin Asset Repository — Cordis plugin entry.
 *
 * Exposes a ctx.repository service (the file-backed single source of truth)
 * plus the domain model: reader and validation. The
 * plugin also registers the model-visible `repository_search` and
 * `repository_read` tools on the dsh tools seam so agents can browse the
 * repository's assets.
 *
 * @module @rin/repository
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  connectRepository as connectRepositoryOnDisk,
  connectionStorePath,
  createRepository as createRepositoryOnDisk,
  disconnectRepository as disconnectRepositoryOnDisk,
  getConnection as getConnectionOnDisk,
  listConnections as listConnectionsOnDisk,
  type RepositoryConnection,
} from './connections.ts'
import { readAssetRepository } from './reader.ts'
import { registerRepositorySeam } from './seam.ts'
import type { RepositoryConfig } from './types.ts'

export type * from './types.ts'
export { readAssetRepository, readAssetRepositoryManifest } from './reader.ts'
export {
  assertSafePackageName,
  assertSafePackageVersion,
  assertSafePythonImport,
  assertSafeRPackage,
  assertSafeReviewableCommand,
} from './validation.ts'
export { registerRepositorySeam, resolveRepositoryRoot } from './seam.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    repository: RepositoryStore
  }
}

/** The repository service exposed on the shared context. */
export abstract class RepositoryStore extends Service {
  constructor(ctx: Context) {
    super(ctx, 'repository')
  }

  /** Read and parse the repository at the configured root path. */
  abstract read(rootPath: string): ReturnType<typeof readAssetRepository>

  abstract listConnections(): Promise<RepositoryConnection[]>
  abstract getConnection(id: string): Promise<RepositoryConnection | undefined>
  abstract connectRepository(rootPath: string, name?: string): Promise<RepositoryConnection>
  abstract createRepository(parentDir: string, name: string): Promise<RepositoryConnection>
  abstract disconnectRepository(id: string): Promise<boolean>
}

/** File-backed implementation reading the repository and its connection registry from disk. */
export class FileRepositoryStore extends RepositoryStore {
  private readonly connectionsPath: string

  constructor(ctx: Context) {
    super(ctx)
    const home = process.env.RIN_HOME !== undefined && process.env.RIN_HOME.trim() !== ''
      ? process.env.RIN_HOME
      : join(homedir(), '.rin')
    this.connectionsPath = connectionStorePath(home)
  }

  override read(rootPath: string) {
    return readAssetRepository(rootPath)
  }

  override listConnections() {
    return listConnectionsOnDisk(this.connectionsPath)
  }

  override getConnection(id: string) {
    return getConnectionOnDisk(this.connectionsPath, id)
  }

  override connectRepository(rootPath: string, name?: string) {
    return connectRepositoryOnDisk(this.connectionsPath, rootPath, name)
  }

  override createRepository(parentDir: string, name: string) {
    return createRepositoryOnDisk(this.connectionsPath, parentDir, name)
  }

  override disconnectRepository(id: string) {
    return disconnectRepositoryOnDisk(this.connectionsPath, id)
  }
}

export const name = 'repository'
export const inject = ['tools']

/** Schemastery schema for the repository plugin configuration. */
export const Config: z<RepositoryConfig> = z.object({
  repositoryRoot: z.string().required(false),
})

/**
 * Install the file-backed repository service and register its model-visible tools.
 * @param ctx - the plugin context (must inject tools).
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: RepositoryConfig): void {
  ctx.plugin(FileRepositoryStore)
  registerRepositorySeam(ctx, config)
}
