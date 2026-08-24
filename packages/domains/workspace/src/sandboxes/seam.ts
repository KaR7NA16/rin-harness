/**
 * rin sandboxes — dsh shell seam projection.
 *
 * Projects the sandboxes execution channel onto the dsh `ctx.shell` capability
 * seam: environment-plan stage commands run through ctx.shell (resolve + run),
 * folding each ShellRunResult into the @rin/workspace/environment StageExecutionResult
 * the install-run state machine consumes. The seam is structural — this module
 * declares the minimal shell surface it needs and never imports the dsh source
 * graph, so the pure adapters stay strip-types smoke-testable.
 *
 * @module @rin/workspace/sandboxes
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SandboxProfile, StageCommandRunner, StageExecutionResult } from './types.ts'

/** A caller's execution request to the shell seam (structural subset). */
export interface ShellExecRequest {
  command: string
  /** Working directory override. */
  workdir?: string
  /** Timeout override in milliseconds. */
  timeoutMs?: number
  /** Extra environment entries for the command. */
  env?: Record<string, string>
}

/** A resolved execution spec (structural subset of the dsh shell spec). */
export interface ShellExecSpec {
  command: string
  workdir: string
  timeoutMs: number
}

/** One captured output stream (structural subset of the dsh collected output). */
export interface ShellOutput {
  text: string
}

/** The outcome of one foreground run (structural subset of the dsh run result). */
export interface ShellRunResult {
  exitCode: number | null
  stdout: ShellOutput
  stderr: ShellOutput
}

/** The minimal ctx.shell surface the executor consumes. */
export interface ShellExecutorLike {
  resolve(request: ShellExecRequest): ShellExecSpec
  run(spec: ShellExecSpec): Promise<ShellRunResult>
}

/** The structural shell seam, mirroring the dsh context surface it reads. */
export interface ShellSeam {
  shell: ShellExecutorLike
}

/** Shell-seam configuration for environment-plan execution. */
export interface ShellConfig {
  /** Skip real execution: record successful stages without calling the shell. */
  dryRun?: boolean
  /** Per-command timeout in milliseconds. */
  timeoutMs?: number
  /** Extra environment entries merged onto every executed command. */
  env?: Record<string, string>
}

/** The fail-loud message when the shell seam is required but unavailable. */
export const SHELL_UNAVAILABLE =
  'rin sandboxes: ctx.shell is unavailable; environment installation requires the dsh shell seam (set dryRun: true to plan without executing)'

/**
 * Read the structural shell seam from a Cordis context.
 * @param ctx - the plugin context.
 * @returns the shell executor surface, or undefined when no shell is mounted.
 */
export function shellFromContext(ctx: Context): ShellExecutorLike | undefined {
  return ctx.get('shell') as ShellExecutorLike | undefined
}

/**
 * Build a lazy resolver that re-reads ctx.shell at execution time, so a shell
 * provider mounted by any plugin in the composition is honored.
 * @param ctx - the plugin context.
 * @returns a resolver returning the current shell surface.
 */
export function shellResolverFor(ctx: Context): () => ShellExecutorLike | undefined {
  return () => shellFromContext(ctx)
}

/**
 * Adapt the shell seam into a stage-command runner. Each command becomes a
 * resolved shell spec run in the foreground; the exit code and captured
 * stdout/stderr are folded into the environment's StageExecutionResult.
 *
 * @param seam - the structural shell seam.
 * @param config - execution options (timeout, env).
 * @returns a runCommand(profile, command) adapter.
 */
export function buildShellRunCommand(seam: ShellSeam, config: ShellConfig = {}): StageCommandRunner['runCommand'] {
  return async (profile: SandboxProfile, command: string): Promise<StageExecutionResult> => {
    const env = mergedShellEnv(config, profile)
    const spec = seam.shell.resolve({
      command,
      ...(profile.repositoryPath !== undefined ? { workdir: profile.repositoryPath } : {}),
      ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
      ...(env !== undefined ? { env } : {}),
    })
    const result = await seam.shell.run(spec)
    return {
      code: result.exitCode ?? 1,
      stdout: result.stdout.text,
      stderr: result.stderr.text,
    }
  }
}

/** A stage-command runner that records success without executing anything. */
export function dryRunCommand(): StageCommandRunner['runCommand'] {
  return async (_profile, _command) => ({ code: 0, stdout: '', stderr: '' })
}

/**
 * Resolve the stage-command runner for one execution, honoring dryRun and
 * failing loud when the shell seam is unavailable.
 *
 * @param shell - the shell surface (undefined when unmounted).
 * @param config - execution options.
 * @returns the runner the state machine drives.
 * @throws when the shell is unavailable and dryRun is not set.
 */
export function resolveStageRunner(shell: ShellExecutorLike | undefined, config: ShellConfig = {}): StageCommandRunner {
  if (config.dryRun === true) return { runCommand: dryRunCommand() }
  if (shell === undefined) throw new Error(SHELL_UNAVAILABLE)
  return { runCommand: buildShellRunCommand({ shell }, config) }
}

/** Merge config env over the profile's container env; undefined when empty. */
function mergedShellEnv(config: ShellConfig, profile: SandboxProfile): Record<string, string> | undefined {
  const env: Record<string, string> = {}
  if (profile.container?.env) Object.assign(env, profile.container.env)
  if (config.env) Object.assign(env, config.env)
  return Object.keys(env).length > 0 ? env : undefined
}
