/**
 * rin ScheduledTasks — strip-types smoke script.
 *
 * Exercises the persisted task DTO, validation, update/delete, run lifecycle,
 * and run listing without loading Cordis or the web server.
 *
 * @module @rin/automation
 */

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileScheduledTaskStore } from '../src/scheduled.ts'

const root = await mkdtemp(join(tmpdir(), 'rin-scheduled-'))
try {
  const store = new FileScheduledTaskStore(root)
  assert.deepEqual(await store.list(), [])

  const task = await store.create({
    name: 'Smoke task',
    description: 'persisted',
    cron: '0 9 * * *',
    prompt: 'check the repository',
    enabled: true,
    recurring: true,
  })
  assert.equal(task.enabled, true)
  assert.equal((await store.list()).length, 1)

  const updated = await store.update(task.id, { enabled: false, name: 'Updated task' })
  assert.equal(updated?.name, 'Updated task')
  assert.equal(updated?.enabled, false)
  await assert.rejects(() => store.run(task.id, async () => ({})), /disabled/)

  await store.update(task.id, { enabled: true })
  const run = await store.run(task.id, async current => ({
    output: current.prompt.toUpperCase(),
    sessionId: 'session-smoke',
  }))
  assert.equal(run?.status, 'completed')
  assert.equal(run?.sessionId, 'session-smoke')
  assert.equal((await store.listRuns()).length, 1)
  assert.equal((await store.listTaskRuns(task.id)).length, 1)

  assert.equal(await store.delete(task.id), true)
  assert.equal(await store.delete(task.id), false)
  console.log('SCHEDULED-TASKS-SMOKE-OK')
} finally {
  await rm(root, { recursive: true, force: true })
}
