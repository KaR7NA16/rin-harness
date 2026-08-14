/**
 * rin sandboxes — exec module tests.
 *
 * State-machine wiring: adapting a provider into an InstallExecutor
 * (buildStageExecutor) and the create → approve → execute orchestration
 * (executeEnvironmentPlan) with a recording fake provider.
 */

import { describe, expect, it } from 'vitest'
import type { InstallPlanStage, ResolvedEnvironmentPlan } from '@rin/repository'
import { buildStageExecutor, executeEnvironmentPlan } from '../src/exec.ts'
import type { SandboxProfile, SandboxProvider, StageExecutionResult } from '../src/types.ts'

const PROFILE: SandboxProfile = {
  id: 'sbx-1',
  name: 'Local',
  type: 'local-sandbox',
  isDefault: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function plan(stages: InstallPlanStage[], status: 'ready' | 'blocked' = 'ready'): ResolvedEnvironmentPlan {
  return {
    profileId: 'scientific-base',
    profileVersion: '1.0.0',
    status,
    packageCount: 1,
    preflight: [],
    stages,
  }
}

function recordingProvider(results: StageExecutionResult[]): SandboxProvider & { commands: string[] } {
  const commands: string[] = []
  return {
    type: 'local-sandbox',
    probeCapabilities: async () => ({
      platform: 'linux',
      runtimes: { apt: true, python: true, pip: true, r: true, npm: true, tlmgr: true },
    }),
    runCommand: async (_profile, command) => {
      commands.push(command)
      return results[commands.length - 1] ?? { code: 0, stdout: '', stderr: '' }
    },
    commands,
  }
}

describe('buildStageExecutor', () => {
  it('runs every command in a stage and returns combined output', async () => {
    const provider = recordingProvider([
      { code: 0, stdout: 'one', stderr: '' },
      { code: 0, stdout: 'two', stderr: '' },
    ])
    const executor = buildStageExecutor(provider, PROFILE)
    const result = await executor({ id: 'python', commands: ['pip install x', 'pip install y'] })
    expect(result.code).toBe(0)
    expect(result.stdout).toBe('one\ntwo')
    expect(provider.commands).toEqual(['pip install x', 'pip install y'])
  })

  it('stops at the first failing command and forwards retryable', async () => {
    const provider = recordingProvider([
      { code: 0, stdout: '', stderr: '' },
      { code: 7, stdout: '', stderr: 'nope', retryable: true },
    ])
    const executor = buildStageExecutor(provider, PROFILE)
    const result = await executor({ id: 'python', commands: ['a', 'b', 'c'] })
    expect(result.code).toBe(7)
    expect(result.retryable).toBe(true)
    expect(provider.commands).toEqual(['a', 'b'])
  })
})

describe('executeEnvironmentPlan', () => {
  it('wires create → approve → execute to a ready run', async () => {
    const provider = recordingProvider([{ code: 0, stdout: 'ok', stderr: '' }])
    const run = await executeEnvironmentPlan(PROFILE, 'repo', 'env', plan([{ id: 'python', commands: ['pip install x'] }]), provider)
    expect(run.status).toBe('ready')
    expect(run.logs.map(log => log.status)).toEqual(['running', 'succeeded'])
    expect(run.logs.every(log => log.stageId === 'python')).toBe(true)
  })

  it('reaches failed when a stage command fails', async () => {
    const provider = recordingProvider([{ code: 2, stdout: '', stderr: 'boom' }])
    const run = await executeEnvironmentPlan(PROFILE, 'repo', 'env', plan([{ id: 'python', commands: ['pip install x'] }]), provider)
    expect(run.status).toBe('failed')
    expect(run.logs[1]?.stderr).toBe('boom')
  })

  it('short-circuits a blocked plan without invoking the provider', async () => {
    const provider = recordingProvider([])
    const run = await executeEnvironmentPlan(PROFILE, 'repo', 'env', plan([], 'blocked'), provider)
    expect(run.status).toBe('blocked')
    expect(run.logs).toEqual([])
    expect(provider.commands).toEqual([])
  })
})
