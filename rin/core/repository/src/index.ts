/**
 * rin Asset Repository — Cordis plugin entry.
 *
 * Exposes a ctx.repository service (the file-backed single source of truth)
 * plus the domain model: reader, validation, writer, migration, and seed.
 * Projection into dsh seams is the NEXT milestone.
 *
 * @module @rin/repository
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { readAssetRepository } from './reader.ts'

export type * from './types.ts'
export { readAssetRepository } from './reader.ts'
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
  constructor(ctx: Context) {
    super(ctx)
  }

  override read(rootPath: string) {
    return readAssetRepository(rootPath)
  }
}

export const name = 'repository'
export const inject = []

/** Install the file-backed repository service into the shared context. */
export function apply(ctx: Context): void {
  ctx.plugin(FileRepositoryStore)
}
