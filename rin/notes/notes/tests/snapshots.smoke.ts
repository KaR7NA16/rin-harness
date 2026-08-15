/**
 * rin notes — snapshot listing/reading smoke test.
 *
 * Run from the package directory:
 *   node --experimental-strip-types tests/snapshots.smoke.ts
 *
 * Exercises \`listSnapshots\` and \`readSnapshot\` without the Cordis runtime:
 * overwriting a note snapshots its previous content, which is then listed with
 * its metadata, read back, rejected on an invalid id, and kept readable after
 * the live note is removed.
 *
 * @module @rin/notes
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NotesVault } from '../src/vault.ts'

/** Throw a clear error when a smoke expectation fails. */
function check(condition: boolean, message: string): void {
  if (!condition) throw new Error('smoke assertion failed: ' + message)
}

const root = await mkdtemp(join(tmpdir(), 'rin-notes-snapshots-'))
try {
  const vault = new NotesVault(root)

  await vault.write('note.md', '# Version one\n')
  await vault.write('note.md', '# Version two\n')

  const snapshots = await vault.listSnapshots('note.md')
  check(snapshots.length === 1, 'overwrite snapshots the previous content once')
  const snapshot = snapshots[0]!
  check(snapshot.id.includes('-'), 'snapshot id carries the epoch and sequence')
  check(snapshot.createdAt.length > 0, 'createdAt is set')
  check(snapshot.sizeBytes > 0, 'sizeBytes is positive')

  const doc = await vault.readSnapshot('note.md', snapshot.id)
  check(doc.content === '# Version one\n', 'readSnapshot returns the previous content')
  check(doc.path === 'note.md', 'readSnapshot reports the note path')
  check(doc.title === 'Version one', 'readSnapshot parses the title from the snapshot')

  let invalidRejected = false
  try {
    await vault.readSnapshot('note.md', '../etc/passwd.md')
  } catch {
    invalidRejected = true
  }
  check(invalidRejected, 'invalid snapshot id is rejected')

  // Remove the live note; the history snapshot stays readable on its own.
  await rm(join(root, 'note.md'), { force: true })
  const afterDelete = await vault.listSnapshots('note.md')
  check(afterDelete.length === 1, 'snapshot survives the live note removal')
  const again = await vault.readSnapshot('note.md', snapshot.id)
  check(again.content === '# Version one\n', 'snapshot stays readable after removal')

  console.log('SNAPSHOTS-SMOKE-OK', snapshots.length, 'snapshot', snapshot.id)
} finally {
  await rm(root, { recursive: true, force: true })
}
