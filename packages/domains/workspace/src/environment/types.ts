/**
 * rin environment — resolved-environment model.
 *
 * The plan types (ResolvedEnvironmentPlan, InstallPlanStage, preflight) live in
 * @rin/assets; this module owns only the resolution result.
 *
 * @module @rin/workspace/environment
 */

import type { EnvironmentPackage, EnvironmentProfile } from '@rin/assets'

export type {
  InstallPlanStage,
  InstallPreflightCheck,
  ResolvedEnvironmentPlan,
  ResolverCapabilities,
} from '@rin/assets'

/** A profile resolved against the repository's package catalogs. */
export interface ResolvedEnvironment {
  profile: EnvironmentProfile
  packages: EnvironmentPackage[]
}
