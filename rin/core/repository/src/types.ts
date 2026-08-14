/**
 * rin Asset Repository — domain model.
 *
 * The Asset Repository is rin's single source of truth for agent assets. It is
 * a declarative, file-backed catalog of versioned, reviewable assets that the
 * runtime projects into dsh seams (agent-presets, sandbox, skill, workflow,
 * storage, permission-presets, output). This module owns the schema only; the
 * runtime adapter owns discovery and projection.
 *
 * Design rules (inherited from the original asset-repository design): an object
 * is a repository asset only if it is (1) fully expressible as a file,
 * (2) version-controllable, reviewable and rollback-able, (3) credential-free,
 * (4) resolvable on another machine, (5) carrying a stable id/version/source,
 * and (6) projected by the runtime without the projection being written back.
 *
 * @module @rin/repository
 */

export const ASSET_REPOSITORY_API_VERSION = 'rin.dev/v1' as const
export const ASSET_REPOSITORY_MANIFEST_FILENAME = 'repository.yaml' as const

export interface AssetMetadata {
  id: string
  name: string
  version: string
  source?: string
}

export type RepositoryRoot =
  | 'environments'
  | 'agents'
  | 'skills'
  | 'workflows'
  | 'tools'
  | 'knowledge'
  | 'policies'
  | 'outputs'
  | 'bundles'

export type RepositoryRoots = Partial<Record<RepositoryRoot, string>>

export interface AssetRepositoryManifest {
  apiVersion: typeof ASSET_REPOSITORY_API_VERSION
  kind: 'AssetRepository'
  metadata: AssetMetadata
  spec: {
    mutable: boolean
    roots: RepositoryRoots
  }
}

export type RepositoryPackageEcosystem = 'python' | 'r' | 'node' | 'system' | 'latex' | 'other'

export interface EnvironmentPackage {
  id: string
  name: string
  ecosystem: RepositoryPackageEcosystem
  version?: string
  description?: string
  /** Package ids this package must be installed after (dependency edges). */
  dependencies?: string[]
}

export interface EnvironmentPackageCatalog {
  apiVersion: typeof ASSET_REPOSITORY_API_VERSION
  kind: 'EnvironmentPackageCatalog'
  metadata: AssetMetadata
  spec: {
    ecosystem: RepositoryPackageEcosystem
    packages: Array<Omit<EnvironmentPackage, 'ecosystem'>>
  }
}

export interface EnvironmentProfile {
  apiVersion: typeof ASSET_REPOSITORY_API_VERSION
  kind: 'EnvironmentProfile'
  metadata: AssetMetadata
  spec: {
    packages: string[]
    verify?: {
      pythonImports?: string[]
      rPackages?: string[]
      commands?: string[]
    }
  }
}

export type AgentPermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'

export interface AgentResourceReferences {
  environmentProfileId?: string
  skillIds: string[]
  workflowIds: string[]
}

export interface RepositoryAgentConfiguration {
  version: 2
  kind: 'AgentConfiguration'
  name: string
  description: string
  systemPrompt: string
  model?: string
  permissionMode?: AgentPermissionMode
  tools: string[]
  resources: AgentResourceReferences
}

export interface AssetRepository {
  rootPath: string
  manifestPath: string
  manifest: AssetRepositoryManifest
  environmentCatalogs: EnvironmentPackageCatalog[]
  environmentPackages: EnvironmentPackage[]
  environmentProfiles: EnvironmentProfile[]
  agents: RepositoryAgentConfiguration[]
}

/** Sandbox capabilities the resolver checks against a profile's ecosystems. */
export interface ResolverCapabilities {
  platform: 'linux' | 'darwin' | 'win32' | string
  runtimes: {
    apt: boolean
    python: boolean
    pip: boolean
    r: boolean
    npm: boolean
    tlmgr: boolean
  }
}

/** One preflight check: whether a required runtime is present. */
export interface InstallPreflightCheck {
  id: string
  status: 'ready' | 'missing' | 'unsupported'
  message: string
}

/** One install stage: a set of same-ecosystem commands. */
export interface InstallPlanStage {
  id: 'system' | 'python' | 'r' | 'node' | 'latex' | 'verification'
  commands: string[]
}

/** The resolved install plan for one environment profile. */
export interface ResolvedEnvironmentPlan {
  profileId: string
  profileVersion: string
  status: 'ready' | 'blocked'
  packageCount: number
  preflight: InstallPreflightCheck[]
  stages: InstallPlanStage[]
}

/** One file produced by a repository migration. */
export interface RepositoryMigrationFile {
  path: string
  document: AssetRepositoryManifest | EnvironmentPackageCatalog
}

/** A migration plan from a legacy repository format. */
export interface RepositoryMigrationPlan {
  sourceVersion: 1
  targetVersion: 1
  packageCount: number
  files: RepositoryMigrationFile[]
}
