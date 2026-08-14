/**
 * rin environment — install-plan model.
 *
 * The environment projector resolves an EnvironmentProfile against the asset
 * repository's package catalogs and emits a dependency-ordered install plan.
 * The plan is the declarative output of the projection; the sandbox executor
 * (a later milestone) consumes it. This module owns the plan schema only.
 *
 * @module @rin/environment
 */

import type { EnvironmentPackage, EnvironmentProfile, RepositoryPackageEcosystem } from '@rin/repository'

/** One install step: packages sharing an ecosystem, in dependency order. */
export interface EnvironmentInstallStep {
  ecosystem: RepositoryPackageEcosystem
  packageIds: string[]
}

/** The complete install plan for one environment profile. */
export interface EnvironmentInstallPlan {
  profileId: string
  steps: EnvironmentInstallStep[]
  verify?: EnvironmentProfile['spec']['verify']
}

/** A profile resolved against the repository's package catalogs. */
export interface ResolvedEnvironment {
  profile: EnvironmentProfile
  packages: EnvironmentPackage[]
}
