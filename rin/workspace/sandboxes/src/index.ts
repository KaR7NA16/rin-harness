/**
 * rin sandboxes — Cordis plugin entry.
 *
 * Exposes a ctx.sandboxes service: sandbox-profile storage (local / container
 * / remote), repository mounting, capability probing, and environment-plan
 * execution. The file-backed implementation lives in store.ts; this module
 * owns the Cordis registration only.
 *
 * @module @rin/sandboxes
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ResolverCapabilities, ResolvedEnvironmentPlan } from '@rin/repository'
import type { InstallRun } from '@rin/environment'
import type {
  SandboxProfile,
  SandboxProfileInput,
  SandboxProfilePatch,
} from './types.ts'
import { FileSandboxStore, defaultSandboxProfilesPath } from './store.ts'

export type * from './types.ts'
export {
  FileSandboxStore,
  defaultSandboxProfilesPath,
  PROFILES_FILENAME,
  LEGACY_PROFILES_FILENAME,
} from './store.ts'
export type { SandboxStoreOptions } from './store.ts'
export {
  newSandboxProfile,
  applySandboxProfilePatch,
  attachRepositoryToContainer,
  migrateLegacySandboxes,
  parseSandboxProfile,
} from './profile.ts'
export { parseSandboxStoreDocument, stringifySandboxStoreDocument } from './yaml.ts'
export {
  containerCapabilityProbeScript,
  parseCapabilityProbe,
  resolveContainerRuntime,
  probeLocalRuntimes,
  PROBE_TIMEOUT_MS,
} from './probe.ts'
export {
  LocalProvider,
  ContainerProvider,
  RemoteProvider,
  defaultProviders,
  providerFor,
  buildContainerExecArgs,
  containerName,
  defaultProbeExec,
} from './providers.ts'
export { executeEnvironmentPlan, buildStageExecutor } from './exec.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sandboxes: SandboxStore
  }
}

/** The sandbox service exposed on the shared context. */
export class SandboxStore extends Service {
  private readonly store: FileSandboxStore

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'sandboxes')
    this.store = new FileSandboxStore({ profilesPath: config.profilesPath ?? defaultSandboxProfilesPath() })
  }

  /** @returns every sandbox profile. */
  list(): Promise<SandboxProfile[]> {
    return this.store.list()
  }

  /** @param id - the profile id. @returns the profile, or null when unknown. */
  get(id: string): Promise<SandboxProfile | null> {
    return this.store.get(id)
  }

  /** @param input - the profile fields. @returns the created profile. */
  create(input: SandboxProfileInput): Promise<SandboxProfile> {
    return this.store.create(input)
  }

  /** @param id - the profile id. @param patch - fields to merge. @returns the patched profile. */
  update(id: string, patch: SandboxProfilePatch): Promise<SandboxProfile> {
    return this.store.update(id, patch)
  }

  /** @param id - the profile id. @returns true when the profile was removed. */
  remove(id: string): Promise<boolean> {
    return this.store.remove(id)
  }

  /** @param id - the profile id. @returns the now-default profile. */
  setDefault(id: string): Promise<SandboxProfile> {
    return this.store.setDefault(id)
  }

  /** @param profile - the profile to probe. @returns its runtime capabilities. */
  probeCapabilities(profile: SandboxProfile): Promise<ResolverCapabilities> {
    return this.store.probeCapabilities(profile)
  }

  /**
   * Execute a resolved environment plan inside the profile's sandbox.
   *
   * @param profile - the target sandbox profile.
   * @param repositoryId - the repository the plan resolves from.
   * @param environmentProfileId - the environment profile the plan resolves.
   * @param plan - the resolved plan (see ctx.environment.plan).
   * @returns the terminal install run with its audit log.
   */
  executeEnvironmentPlan(
    profile: SandboxProfile,
    repositoryId: string,
    environmentProfileId: string,
    plan: ResolvedEnvironmentPlan,
  ): Promise<InstallRun> {
    return this.store.executeEnvironmentPlan(profile, repositoryId, environmentProfileId, plan)
  }
}

export const name = 'sandboxes'
export const inject = []

/** Plugin configuration: optional override of the profile-store path. */
export interface Config {
  profilesPath?: string
}

export const Config: z<Config> = z.object({
  profilesPath: z.string(),
})

/**
 * Install the file-backed sandbox service.
 *
 * @param ctx - the plugin context.
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.plugin(SandboxStore, config)
}
