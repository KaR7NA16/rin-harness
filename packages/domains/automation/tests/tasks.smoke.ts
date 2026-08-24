/**
 * rin tasks — strip-types smoke test.
 *
 * Run from the package directory:
 *   node --experimental-strip-types tests/automation.smoke.ts
 *
 * Exercises the pure file engine (create/read/update/delete + status flow and
 * reload persistence) against a temp directory, plus the sanitize/parse
 * helpers, without loading the Cordis runtime.
 *
 * @module @rin/automation
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileTaskStore, parseTaskRecord, resolveTasksRoot, sanitizeId } from '../src/storage.ts'

/** Throw a clear error when a smoke expectation fails. */
function check(condition: boolean, message: string): void {
  if (!condition) throw new Error('smoke assertion failed: ' + message)
}

const root = await mkdtemp(join(tmpdir(), 'rin-tasks-smoke-'))
try {
  const store = new FileTaskStore(root)

  // Empty store.
  check((await store.listTaskLists()).length === 0, 'no lists on an empty store')
  check((await store.listTasks()).length === 0, 'no tasks on an empty store')

  // Create: numeric ids from 1, list directory created.
  const first = await store.createTask('default', { subject: 'ship v1' })
  check(first.id === '1', 'first task gets id "1": ' + first.id)
  check(first.taskListId === 'default', 'taskListId derived from the list')
  check(first.status === 'pending', 'new task defaults to pending')

  const second = await store.createTask('default', { subject: 'add tests', status: 'in_progress' })
  check(second.id === '2', 'second task gets id "2": ' + second.id)

  // Status flow.
  const done = await store.status('default', '2', 'completed')
  check(done !== null && done.status === 'completed', 'status transition to completed')

  // Per-list + cross-list reads, sorted by numeric id.
  const listTasks = await store.getTasksForList('default')
  check(listTasks.length === 2, 'two tasks in the default list')
  check(listTasks[0]?.id === '1' && listTasks[1]?.id === '2', 'tasks sorted by numeric id')
  check((await store.listTasks()).length === 2, 'listTasks spans lists')

  // Status rollups.
  const lists = await store.listTaskLists()
  check(lists.length === 1 && lists[0]?.id === 'default', 'one task list rolled up')
  check(
    lists[0]?.pendingCount === 1 && lists[0]?.completedCount === 1 && lists[0]?.inProgressCount === 0,
    'status counts correct',
  )

  // Update merges fields without disturbing others.
  const updated = await store.updateTask('default', '1', { subject: 'ship v1.4.9', description: 'release' })
  check(updated !== null && updated.subject === 'ship v1.4.9', 'update merges subject')
  check(updated?.description === 'release', 'update sets description')

  // getTask hit + miss.
  const got = await store.getTask('default', '1')
  check(got !== null && got.subject === 'ship v1.4.9', 'getTask reads back')
  check((await store.getTask('default', 'nope')) === null, 'getTask returns null for unknown id')

  // On-disk layout: taskListId is not persisted (derived from the directory).
  const onDisk = await readFile(join(root, 'default', '1.json'), 'utf-8')
  check(!onDisk.includes('taskListId'), 'taskListId is not persisted')
  check(JSON.parse(onDisk).status === 'pending', 'on-disk task JSON round-trips')

  // Reload persistence.
  const reloaded = new FileTaskStore(root)
  check((await reloaded.listTasks()).length === 2, 'tasks persist across store instances')

  // Delete + missing delete.
  check((await store.deleteTask('default', '2')) === true, 'deleteTask removes a task')
  check((await store.deleteTask('default', '2')) === false, 'deleteTask returns false for a missing task')
  check((await store.getTasksForList('default')).length === 1, 'one task remains after delete')

  // Empty lists are skipped.
  await store.createTask('scratch', { subject: 'temp' })
  check((await store.listTaskLists()).some((l) => l.id === 'scratch'), 'scratch list appears once it has a task')
  await store.deleteTask('scratch', '1')
  check(!(await store.listTaskLists()).some((l) => l.id === 'scratch'), 'empty lists are skipped')

  // Legacy-format read: files without taskListId; internal tasks skipped.
  const legacyDir = join(root, 'legacy')
  await mkdir(legacyDir, { recursive: true })
  await writeFile(join(legacyDir, '5.json'), JSON.stringify({
    id: '5',
    subject: 'legacy task',
    description: '',
    status: 'completed',
    blocks: ['6'],
    blockedBy: [],
    metadata: { tags: ['a'] },
  }))
  await writeFile(join(legacyDir, 'internal.json'), JSON.stringify({
    id: '9',
    subject: 'internal',
    description: '',
    status: 'pending',
    blocks: [],
    blockedBy: [],
    metadata: { _internal: true },
  }))
  const legacyTasks = await store.getTasksForList('legacy')
  check(legacyTasks.length === 1, 'legacy list reads one task, internal skipped')
  check(legacyTasks[0]?.taskListId === 'legacy', 'legacy taskListId derived from directory')
  check(legacyTasks[0]?.blocks[0] === '6', 'legacy blocks parsed')

  // Pure helpers.
  check(sanitizeId('../a/b') === '---a-b', 'sanitizeId blocks traversal: ' + sanitizeId('../a/b'))
  check(sanitizeId('my team') === 'my-team', 'sanitizeId replaces spaces')
  const parsed = parseTaskRecord({ id: 7, subject: 'x', description: '', status: 'bogus', blocks: 'nope', blockedBy: null })
  check(parsed !== null && parsed.status === 'pending' && parsed.blocks.length === 0, 'parseTaskRecord normalizes status/blocks')
  check(parseTaskRecord({ id: 'x' }) === null, 'parseTaskRecord rejects records without subject')
  check(parseTaskRecord(null) === null, 'parseTaskRecord rejects non-objects')
  check(resolveTasksRoot('foo').endsWith('foo'), 'resolveTasksRoot resolves relative roots')

  console.log('TASKS-SMOKE-OK', { lists: lists.length, tasks: listTasks.length, legacy: legacyTasks.length })
} finally {
  await rm(root, { recursive: true, force: true })
}
