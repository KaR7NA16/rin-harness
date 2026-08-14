/**
 * rin environment — resolved-environment model.
 *
 * The plan types (ResolvedEnvironmentPlan, InstallPlanStage, preflight) live in
 * @rin/repository; this module owns only the resolution result.
 *
 * @module @rin/environment
 */

import type { EnvironmentPackage, EnvironmentProfile } from '@rin/repository'

export type {
  InstallPlanStage,
  InstallPreflightCheck,
  ResolvedEnvironmentPlan,
  ResolverCapabilities,
} from '@rin/repository'

/** A profile resolved against the repository's package catalogs. */
export interface ResolvedEnvironment {
  profile: EnvironmentProfile
  packages: EnvironmentPackage[]
}
