/**
 * rin sandboxes — environment-plan execution.
 *
 * Wires the @rin/environment install-run state machine (create → approve →
 * execute) to a per-type sandbox executor. The environment functions are
 * loaded lazily so the pure modules stay importable by the strip-types smoke
 * script without resolving the workspace graph.
 *
 * @module @rin/sandboxes
 */

import type { InstallPlanStage, ResolvedEnvironmentPlan } from '@rin/repository'
import type { InstallExecutor, InstallRun } from '@rin/environment'
import type { SandboxProfile, StageCommandRunner } from './types.ts'

/** Options controlling environment-plan execution. */
export interface ExecuteEnvironmentPlanOptions {
  /**
   * Explicitly approve a resolved plan before execution. A ready plan is
   * rejected without it, so no caller can auto-approve a plan it resolved.
   */
  approve?: boolean
}

/**
 * Execute a resolved environment plan inside a profile's sandbox.
 *
 * The run goes through create → approve → execute (with per-stage audit
 * logging); a blocked plan short-circuits to a blocked run, and a ready plan
 * requires explicit approval. The environment orchestration functions are
 * imported dynamically because they are a value dependency on
 * @rin/environment, which the strip-types smoke script must not resolve at
 * load time.
 *
 * @param profile - the target sandbox profile.
 * @param repositoryId - the repository the plan resolves from.
 * @param environmentProfileId - the environment profile the plan resolves.
 * @param plan - the resolved plan (see ctx.environment.plan).
 * @param runner - the stage-command runner selected for the profile's type.
 * @param options - execution options; `approve: true` is required for ready plans.
 * @returns the terminal install run with its audit log.
 */
export async function executeEnvironmentPlan(
  profile: SandboxProfile,
  repositoryId: string,
  environmentProfileId: string,
  plan: ResolvedEnvironmentPlan,
  runner: StageCommandRunner,
  options: ExecuteEnvironmentPlanOptions = {},
): Promise<InstallRun> {
  const { approveInstallRun, createInstallRun, executeInstallRun } = await import('@rin/environment')
  const created = createInstallRun({
    sandboxProfileId: profile.id,
    repositoryId,
    environmentProfileId,
    plan,
  })
  if (created.status === 'resolved' && options.approve !== true) {
    throw new Error('rin sandboxes: environment-plan execution requires explicit approval (pass approve: true)')
  }
  const approved = created.status === 'resolved' ? approveInstallRun(created) : created
  return executeInstallRun(approved, buildStageExecutor(runner, profile))
}

/**
 * Adapt a stage-command runner into an InstallExecutor: run every command in a
 * stage in order, combining stdout/stderr and stopping at the first non-zero
 * exit.
 *
 * @param runner - the runner that executes each command.
 * @param profile - the target profile.
 * @returns the executor handed to @rin/environment's executeInstallRun.
 */
export function buildStageExecutor(runner: StageCommandRunner, profile: SandboxProfile): InstallExecutor {
  return async (stage: InstallPlanStage) => {
    let stdout = ''
    let stderr = ''
    for (const command of stage.commands) {
      const result = await runner.runCommand(profile, command)
      stdout = appendOutput(stdout, result.stdout)
      stderr = appendOutput(stderr, result.stderr)
      if (result.code !== 0) {
        return {
          code: result.code,
          stdout,
          stderr,
          ...(result.retryable !== undefined ? { retryable: result.retryable } : {}),
        }
      }
    }
    return { code: 0, stdout, stderr }
  }
}

function appendOutput(accumulated: string, next: string): string {
  const value = next.trim()
  if (!value) return accumulated
  return accumulated ? accumulated + '\n' + value : value
}
