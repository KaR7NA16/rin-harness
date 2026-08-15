/**
 * rin sandboxes — domain model.
 *
 * Owns the values crossing the sandbox seam: sandbox profiles
 * (local / container / remote), the versioned file-store document, and the
 * per-type provider contract. The capability and install-run types owned by
 * @rin/repository and @rin/environment are re-exported so the whole seam
 * resolves from one module.
 *
 * @module @rin/sandboxes
 */

import type { ResolvedEnvironmentPlan, ResolverCapabilities } from '@rin/repository'
import type { InstallRun, StageExecutionResult } from '@rin/environment'

export type { ResolvedEnvironmentPlan, ResolverCapabilities }
export type { InstallRun, StageExecutionResult }

/** The on-disk sandbox-store document version. */
export const SANDBOX_STORE_SCHEMA_VERSION = 2 as const

/** The sandbox execution target kind. */
export type SandboxType = 'local-sandbox' | 'container' | 'remote'

/** The container CLI a container profile prefers, or 'auto' for detection. */
export type ContainerRuntime = 'docker' | 'podman' | 'auto'

/** One host→guest bind mount. */
export interface ContainerMount {
  host: string
  guest: string
  ro?: boolean
}

/** One published host→guest port pair. */
export interface ContainerPort {
  host: number
  guest: number
}

/** Container-profile execution configuration. */
export interface ContainerConfig {
  runtime?: ContainerRuntime
  image: string
  workdir?: string
  mounts?: ContainerMount[]
  env?: Record<string, string>
  ports?: ContainerPort[]
  shell?: string
}

/** Remote SSH profile configuration (deferred; see RemoteProvider). */
export interface RemoteConfig {
  host: string
  port?: number
  user: string
  identityFile?: string
  useDocker?: boolean
}

/** A named sandbox execution profile. */
export interface SandboxProfile {
  id: string
  name: string
  type: SandboxType
  isDefault: boolean
  repositoryId?: string
  repositoryPath?: string
  environmentProfileId?: string
  container?: ContainerConfig
  remote?: RemoteConfig
  createdAt: string
  updatedAt: string
}

/** The caller-supplied fields for a new profile. */
export interface SandboxProfileInput {
  name: string
  type: SandboxType
  isDefault?: boolean
  repositoryId?: string
  repositoryPath?: string
  environmentProfileId?: string
  container?: ContainerConfig
  remote?: RemoteConfig
}

/** The caller-mutable fields of an existing profile. */
export type SandboxProfilePatch = Partial<Omit<SandboxProfile, 'id' | 'createdAt' | 'updatedAt'>>

/** The versioned sandbox-store document serialized to disk. */
export interface SandboxStoreDocument {
  version: typeof SANDBOX_STORE_SCHEMA_VERSION
  profiles: SandboxProfile[]
}

/** A promise wrapper over execFile used for capability probing. */
export type ProbeExec = (file: string, args: string[]) => Promise<string>

/** Runs one stage command inside a sandbox; shared by providers and the shell seam. */
export interface StageCommandRunner {
  runCommand(profile: SandboxProfile, command: string): Promise<StageExecutionResult>
}

/** The sandbox executor contract implemented once per profile type. */
export interface SandboxProvider extends StageCommandRunner {
  readonly type: SandboxType
  probeCapabilities(profile: SandboxProfile): Promise<ResolverCapabilities>
}

/** The three providers, one per profile type. */
export interface SandboxProviders {
  local: SandboxProvider
  container: SandboxProvider
  remote: SandboxProvider
}
