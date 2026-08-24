/**
 * rin environment — install-run orchestration.
 *
 * Turns a ResolvedEnvironmentPlan into an executable InstallRun: creation,
 * approval, per-stage execution against an injected executor, and the run
 * status machine (blocked → resolved → approved → provisioning/verifying →
 * ready | failed). The executor is provided by the sandbox seam
 * (@rin/workspace/sandboxes); this module owns orchestration and the audit log only.
 *
 * @module @rin/workspace/environment
 */

import { randomUUID } from 'node:crypto'
import type { InstallPlanStage, ResolvedEnvironmentPlan } from '@rin/assets'

/** One recorded stage outcome in the run's audit log. */
export type InstallStageStatus = 'running' | 'succeeded' | 'failed'

/** One audit-log entry: the stage id, the command text, and its outcome. */
export interface InstallStageLog {
  stageId: InstallPlanStage['id']
  command: string
  status: InstallStageStatus
  code?: number
  stdout?: string
  stderr?: string
  retryable?: boolean
  startedAt: string
  finishedAt?: string
}

/** The run status machine, aligned with the sandbox install flow. */
export type InstallRunStatus =
  | 'blocked'
  | 'resolved'
  | 'approved'
  | 'provisioning'
  | 'verifying'
  | 'ready'
  | 'failed'
  | 'rollback-needed'

/** One install run over a resolved plan. */
export interface InstallRun {
  id: string
  sandboxProfileId: string
  repositoryId: string
  environmentProfileId: string
  status: InstallRunStatus
  plan: ResolvedEnvironmentPlan
  logs: InstallStageLog[]
  createdAt: string
  updatedAt: string
}

/** The executor's outcome for one stage. */
export interface StageExecutionResult {
  code: number
  stdout: string
  stderr: string
  /** Whether the failure is retryable (a transient infrastructure error). */
  retryable?: boolean
}

/** Runs one install-plan stage inside the target sandbox. */
export type InstallExecutor = (stage: InstallPlanStage, run: InstallRun) => Promise<StageExecutionResult>

/** Inputs identifying the run target and its plan. */
export interface InstallRunInput {
  sandboxProfileId: string
  repositoryId: string
  environmentProfileId: string
  plan: ResolvedEnvironmentPlan
}

/**
 * Create a run from a resolved plan. A blocked plan yields a blocked run with
 * no stages to execute; a ready plan starts resolved, awaiting approval.
 * @param input - the run target and plan.
 * @returns the new run.
 */
export function createInstallRun(input: InstallRunInput): InstallRun {
  const now = new Date().toISOString()
  return {
    id: randomUUID(),
    sandboxProfileId: input.sandboxProfileId,
    repositoryId: input.repositoryId,
    environmentProfileId: input.environmentProfileId,
    status: input.plan.status === 'blocked' ? 'blocked' : 'resolved',
    plan: input.plan,
    logs: [],
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Approve a resolved run for execution. Only a resolved run may be approved.
 * @param run - the run to approve.
 * @returns the approved run.
 */
export function approveInstallRun(run: InstallRun): InstallRun {
  if (run.status !== 'resolved') {
    throw new Error('rin environment: only a resolved run may be approved (got "' + run.status + '")')
  }
  return { ...run, status: 'approved', updatedAt: new Date().toISOString() }
}

/**
 * Execute a run's plan stages in order against the executor, recording one
 * audit-log entry per stage. The first failing stage stops the run as failed;
 * the verification stage (id 'verification') runs under the 'verifying'
 * status, every other stage under 'provisioning'.
 *
 * @param run - the approved (or blocked/resolved) run; a blocked run has no stages.
 * @param executor - the sandbox-side stage runner.
 * @returns the terminal run (ready or failed) with its complete log.
 */
export async function executeInstallRun(run: InstallRun, executor: InstallExecutor): Promise<InstallRun> {
  if (run.status === 'blocked' || run.plan.stages.length === 0) return run
  let current: InstallRun = { ...run, updatedAt: new Date().toISOString() }
  for (const stage of run.plan.stages) {
    const startedAt = new Date().toISOString()
    const running = appendLog(current, stage, { status: 'running', startedAt })
    let result: StageExecutionResult
    try {
      result = await executor(stage, running)
    } catch (error) {
      result = { code: 1, stdout: '', stderr: error instanceof Error ? error.message : String(error) }
    }
    const finishedAt = new Date().toISOString()
    if (result.code === 0) {
      current = appendLog(running, stage, { status: 'succeeded', code: 0, stdout: result.stdout, stderr: result.stderr, startedAt, finishedAt })
      current = { ...current, status: stage.id === 'verification' ? 'verifying' : 'provisioning' }
    } else {
      current = appendLog(running, stage, {
        status: 'failed',
        code: result.code,
        stdout: result.stdout,
        stderr: result.stderr,
        ...(result.retryable !== undefined ? { retryable: result.retryable } : {}),
        startedAt,
        finishedAt,
      })
      return { ...current, status: 'failed' }
    }
  }
  return { ...current, status: 'ready' }
}

function appendLog(run: InstallRun, stage: InstallPlanStage, entry: Omit<InstallStageLog, 'stageId' | 'command'>): InstallRun {
  return {
    ...run,
    updatedAt: new Date().toISOString(),
    logs: [...run.logs, { ...entry, stageId: stage.id, command: stage.commands.join(' && ') }],
  }
}
