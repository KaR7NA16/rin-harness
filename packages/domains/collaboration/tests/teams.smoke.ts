/**
 * rin teams — strip-types smoke test.
 *
 * Run from the package directory:
 *   node --experimental-strip-types tests/collaboration.smoke.ts
 *
 * Exercises the pure file engine (create/list/get/update/delete plus member
 * add/remove/list) without loading the Cordis runtime. All types enter the
 * engine through `import type`, so they are erased by type stripping and this
 * script stays free of dsh-* runtime imports.
 *
 * @module @rin/collaboration
 */

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CONFIG_FILENAME, TeamsStore } from '../src/storage.ts'

const root = await mkdtemp(join(tmpdir(), 'rin-teams-'))

try {
  const store = new TeamsStore(root)

  // create: lead defaults to the first member; counts derive from members
  const created = await store.create({
    name: 'frontend-crew',
    description: 'Build the desktop UI',
    members: [
      { agentId: 'lead-1', name: 'lead', cwd: '/work' },
      { agentId: 'reviewer', name: 'reviewer', role: 'member', status: 'running', cwd: '/work' },
    ],
  })
  assert.equal(created.name, 'frontend-crew')
  assert.equal(created.description, 'Build the desktop UI')
  assert.equal(created.leadAgentId, 'lead-1')
  assert.equal(created.memberCount, 2)
  assert.equal(created.activeMemberCount, 1)
  assert.equal(created.members[0]?.role, 'lead')
  assert.equal(created.members[1]?.role, 'member')
  assert.equal(created.members[1]?.status, 'running')

  // on-disk config.json mirrors the created detail
  const raw = JSON.parse(await readFile(join(root, 'frontend-crew', CONFIG_FILENAME), 'utf8')) as Record<string, unknown>
  assert.equal(raw.name, 'frontend-crew')
  assert.equal((raw.members as unknown[]).length, 2)

  // list: one summary with correct derived counts
  const listed = await store.list()
  assert.equal(listed.length, 1)
  assert.equal(listed[0]?.name, 'frontend-crew')
  assert.equal(listed[0]?.memberCount, 2)
  assert.equal(listed[0]?.activeMemberCount, 1)

  // get + listMembers
  const detail = await store.get('frontend-crew')
  assert.equal(detail.members.length, 2)
  assert.equal((await store.listMembers('frontend-crew')).length, 2)

  // update: description + lead re-point with role re-sync
  const updated = await store.update('frontend-crew', { description: 'Updated', leadAgentId: 'reviewer' })
  assert.equal(updated.description, 'Updated')
  assert.equal(updated.leadAgentId, 'reviewer')
  assert.equal(updated.members.find(member => member.agentId === 'reviewer')?.role, 'lead')
  assert.equal(updated.members.find(member => member.agentId === 'lead-1')?.role, 'member')

  // addMember then removeMember
  const withMember = await store.addMember('frontend-crew', { agentId: 'tester', name: 'tester', status: 'running' })
  assert.equal(withMember.memberCount, 3)
  assert.equal(withMember.members.find(member => member.agentId === 'tester')?.status, 'running')
  const afterRemove = await store.removeMember('frontend-crew', 'tester')
  assert.equal(afterRemove.memberCount, 2)

  // removeMember of the lead re-points and promotes the first remaining member
  const afterLeadRemoved = await store.removeMember('frontend-crew', 'reviewer')
  assert.equal(afterLeadRemoved.leadAgentId, 'lead-1')
  assert.equal(afterLeadRemoved.members[0]?.role, 'lead')

  // validation failures fail loud
  await assert.rejects(store.create({ name: '../evil' }), /invalid team name/)
  await assert.rejects(store.create({ name: 'frontend-crew' }), /already exists/)
  await assert.rejects(store.get('nope'), /not found/)
  await assert.rejects(store.removeMember('frontend-crew', 'ghost'), /member not found/)

  // delete is idempotent and removes the team
  await store.delete('frontend-crew')
  assert.equal((await store.list()).length, 0)
  await store.delete('frontend-crew') // no-op, no throw

  console.log('TEAMS-SMOKE-OK create/list/get/update/addMember/removeMember/delete')
} finally {
  await rm(root, { recursive: true, force: true })
}
