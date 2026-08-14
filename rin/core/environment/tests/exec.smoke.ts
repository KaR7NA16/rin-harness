import { createInstallRun, approveInstallRun, executeInstallRun } from '../src/exec.ts'

const plan = {
  profileId: 'scientific-base',
  profileVersion: '1.0.0',
  status: 'ready',
  packageCount: 1,
  preflight: [],
  stages: [
    { id: 'python', commands: ['pip install numpy'] },
    { id: 'verification', commands: ['python -c 1'] },
  ],
}

const run = createInstallRun({ sandboxProfileId: 'sbx', repositoryId: 'repo', environmentProfileId: 'p', plan })
if (run.status !== 'resolved') throw new Error('expected resolved, got ' + run.status)
const approved = approveInstallRun(run)
if (approved.status !== 'approved') throw new Error('expected approved')
const done = await executeInstallRun(approved, async () => ({ code: 0, stdout: 'ok', stderr: '' }))
if (done.status !== 'ready') throw new Error('expected ready, got ' + done.status)
if (done.logs.length !== 4) throw new Error('expected 4 log entries, got ' + done.logs.length)
const blocked = createInstallRun({ sandboxProfileId: 'sbx', repositoryId: 'repo', environmentProfileId: 'p', plan: { ...plan, status: 'blocked', stages: [] } })
if (blocked.status !== 'blocked') throw new Error('expected blocked')
const failed = await executeInstallRun(approveInstallRun(createInstallRun({ sandboxProfileId: 'sbx', repositoryId: 'repo', environmentProfileId: 'p', plan })), async (s) => s.id === 'python' ? { code: 7, stdout: '', stderr: 'nope', retryable: true } : { code: 0, stdout: '', stderr: '' })
if (failed.status !== 'failed') throw new Error('expected failed')
if (!failed.logs[1].retryable) throw new Error('expected retryable flag')
console.log('EXEC-SMOKE-OK', done.status, done.logs.length, failed.status)
