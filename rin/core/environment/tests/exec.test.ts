import { describe, expect, it } from 'vitest'
import type { InstallPlanStage, ResolvedEnvironmentPlan } from '@rin/repository'
import {
  approveInstallRun,
  createInstallRun,
  executeInstallRun,
  type InstallExecutor,
} from '../src/exec.ts'

function plan(stages: InstallPlanStage[], blocked = false): ResolvedEnvironmentPlan {
  return {
    profileId: 'scientific-base',
    profileVersion: '1.0.0',
    status: blocked ? 'blocked' : 'ready',
    packageCount: 1,
    preflight: [],
    stages,
  }
}

function stage(id: InstallPlanStage['id'], commands: string[]): InstallPlanStage {
  return { id, commands }
}

describe('createInstallRun', () => {
  it('creates a resolved run for a ready plan', () => {
    const run = createInstallRun({ sandboxProfileId: 'sbx', repositoryId: 'repo', environmentProfileId: 'p', plan: plan([stage('python', ['pip install x'])]) })
    expect(run.status).toBe('resolved')
    expect(run.logs).toEqual([])
    expect(run.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('creates a blocked run for a blocked plan', () => {
    const run = createInstallRun({ sandboxProfileId: 'sbx', repositoryId: 'repo', environmentProfileId: 'p', plan: plan([], true) })
    expect(run.status).toBe('blocked')
  })
})

describe('approveInstallRun', () => {
  it('approves only a resolved run', () => {
    const run = createInstallRun({ sandboxProfileId: 'sbx', repositoryId: 'repo', environmentProfileId: 'p', plan: plan([stage('python', ['pip install x'])]) })
    expect(approveInstallRun(run).status).toBe('approved')
    expect(() => approveInstallRun({ ...run, status: 'approved' })).toThrow(/only a resolved run/)
  })
})

describe('executeInstallRun', () => {
  it('runs stages in order and reaches ready', async () => {
    const run = createInstallRun({ sandboxProfileId: 'sbx', repositoryId: 'repo', environmentProfileId: 'p', plan: plan([stage('python', ['pip install x']), stage('verification', ['python -c 1'])]) })
    const approved = approveInstallRun(run)
    const executor: InstallExecutor = async () => ({ code: 0, stdout: 'ok', stderr: '' })
    const done = await executeInstallRun(approved, executor)
    expect(done.status).toBe('ready')
    expect(done.logs.map(log => [log.stageId, log.status])).toEqual([
      ['python', 'running'],
      ['python', 'succeeded'],
      ['verification', 'running'],
      ['verification', 'succeeded'],
    ])
    expect(done.logs[1].stdout).toBe('ok')
  })

  it('stops at the first failing stage as failed', async () => {
    const run = createInstallRun({ sandboxProfileId: 'sbx', repositoryId: 'repo', environmentProfileId: 'p', plan: plan([stage('system', ['apt install x']), stage('python', ['pip install y'])]) })
    const approved = approveInstallRun(run)
    const executor: InstallExecutor = async stageEntry =>
      stageEntry.id === 'system' ? { code: 2, stdout: '', stderr: 'no apt', retryable: true } : { code: 0, stdout: '', stderr: '' }
    const done = await executeInstallRun(approved, executor)
    expect(done.status).toBe('failed')
    expect(done.logs.length).toBe(2)
    expect(done.logs[1].status).toBe('failed')
    expect(done.logs[1].retryable).toBe(true)
  })

  it('records executor throws as a failed stage', async () => {
    const run = createInstallRun({ sandboxProfileId: 'sbx', repositoryId: 'repo', environmentProfileId: 'p', plan: plan([stage('node', ['npm i'])]) })
    const approved = approveInstallRun(run)
    const executor: InstallExecutor = async () => { throw new Error('boom') }
    const done = await executeInstallRun(approved, executor)
    expect(done.status).toBe('failed')
    expect(done.logs[1].stderr).toBe('boom')
  })

  it('leaves a blocked run untouched', async () => {
    const run = createInstallRun({ sandboxProfileId: 'sbx', repositoryId: 'repo', environmentProfileId: 'p', plan: plan([], true) })
    const executor: InstallExecutor = async () => ({ code: 0, stdout: '', stderr: '' })
    const done = await executeInstallRun(run, executor)
    expect(done).toBe(run)
    expect(done.status).toBe('blocked')
  })

  it('does not mutate the caller run', async () => {
    const run = createInstallRun({ sandboxProfileId: 'sbx', repositoryId: 'repo', environmentProfileId: 'p', plan: plan([stage('python', ['pip install x'])]) })
    const approved = approveInstallRun(run)
    const executor: InstallExecutor = async () => ({ code: 0, stdout: '', stderr: '' })
    await executeInstallRun(approved, executor)
    expect(approved.logs).toEqual([])
    expect(approved.status).toBe('approved')
  })
})
