/**
 * rin Asset Repository — Cordis plugin entry.
 *
 * Exposes a ctx.repository service (the file-backed single source of truth)
 * plus the domain model: reader, validation, writer, migration, and seed. The
 * plugin also registers the model-visible `repository_search` and
 * `repository_read` tools on the dsh tools seam so agents can browse the
 * repository's assets.
 *
 * @module @rin/repository
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { readAssetRepository } from './reader.ts'
import { registerRepositorySeam } from './seam.ts'
import type { RepositoryConfig } from './types.ts'

export type * from './types.ts'
export { readAssetRepository, readAssetRepositoryManifest, resolveAssetRepositoryRoot } from './reader.ts'
export {
  assertSafePackageName,
  assertSafePackageVersion,
  assertSafePythonImport,
  assertSafeRPackage,
  assertSafeReviewableCommand,
} from './validation.ts'
export { createAssetRepository, writeEnvironmentPackages, applyRepositoryMigration } from './writer.ts'
export { planLegacyRepositoryMigration } from './migration.ts'
export { initializeWorkingRepository } from './seed.ts'
export type { WorkingRepositoryResult } from './seed.ts'
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
}

/** File-backed implementation reading the repository from disk on demand. */
export class FileRepositoryStore extends RepositoryStore {
  override read(rootPath: string) {
    return readAssetRepository(rootPath)
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
