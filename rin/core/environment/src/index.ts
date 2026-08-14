/**
 * rin environment — Cordis plugin entry.
 *
 * Exposes a ctx.environment service that reads the asset repository and builds
 * the install plan (preflight + stages + verification) for one profile.
 * Execution of the plan in a sandbox is the NEXT milestone.
 *
 * @module @rin/environment
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { readAssetRepository } from '@rin/repository'
import type { ResolvedEnvironmentPlan, ResolverCapabilities } from '@rin/repository'
import { buildInstallPlan } from './plan.ts'

export type * from './types.ts'
export { buildInstallPlan, resolveEnvironment } from './plan.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    environment: EnvironmentStore
  }
}

/** The environment service exposed on the shared context. */
export abstract class EnvironmentStore extends Service {
  constructor(ctx: Context) {
    super(ctx, 'environment')
  }

  /** Read the repository and build the install plan for one profile. */
  abstract plan(
    rootPath: string,
    profileId: string,
    capabilities: ResolverCapabilities,
  ): Promise<ResolvedEnvironmentPlan>
}

/** File-backed implementation reading the repository from disk on demand. */
export class FileEnvironmentStore extends EnvironmentStore {
  constructor(ctx: Context) {
    super(ctx)
  }

  override async plan(
    rootPath: string,
    profileId: string,
    capabilities: ResolverCapabilities,
  ): Promise<ResolvedEnvironmentPlan> {
    const repo = await readAssetRepository(rootPath)
    return buildInstallPlan(repo, profileId, capabilities)
  }
}

export const name = 'environment'
export const inject = []

/** Install the file-backed environment service into the shared context. */
export function apply(ctx: Context): void {
  ctx.plugin(FileEnvironmentStore)
}
