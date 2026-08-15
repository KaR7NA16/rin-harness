/**
 * rin computer use — store strip-types smoke test.
 *
 * Exercises the file-backed state/apps/approval store without importing
 * Cordis: default status, the enabled switch, allowlist CRUD, grant flags, and
 * the approval-queue lifecycle (enqueue, pending, resolve, supersede, clear).
 * Run from the package directory with:
 *
 *   node --experimental-strip-types tests/computer-use.smoke.ts
 */

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  authorizeApp,
  clearResolvedApprovals,
  createComputerUseStore,
  enqueueApproval,
  getApprovalQueue,
  getComputerUseStatus,
  getGrantFlags,
  getPendingApprovals,
  isAppAuthorized,
  listAuthorizedApps,
  replaceAuthorizedApps,
  resolveApproval,
  revokeApp,
  setComputerUseEnabled,
  supersedeApproval,
  updateGrantFlags,
} from '../src/store.ts'
import { DEFAULT_GRANT_FLAGS, type ComputerUseRoots } from '../src/types.ts'

async function main() {
  const root = await mkdtemp(join(tmpdir(), 'rin-computer-use-'))
  const roots: ComputerUseRoots = { configRoot: root }

  try {
    // Default status: disabled, nothing authorized or queued.
    assert.deepEqual(await getComputerUseStatus(roots), {
      enabled: false,
      pendingApproval: false,
      authorizedAppCount: 0,
      queuedApprovalCount: 0,
    })

    // The enabled switch persists across reads.
    assert.equal((await setComputerUseEnabled(roots, true)).enabled, true)
    assert.equal((await getComputerUseStatus(roots)).enabled, true)

    // Allowlist CRUD.
    assert.deepEqual(await listAuthorizedApps(roots), [])
    let apps = await authorizeApp(roots, { bundleId: 'com.example.Slack', displayName: 'Slack' })
    assert.equal(apps.length, 1)
    assert.equal(apps[0].bundleId, 'com.example.Slack')
    assert.equal(apps[0].displayName, 'Slack')
    assert.equal(await isAppAuthorized(roots, 'com.example.Slack'), true)
    assert.equal(await isAppAuthorized(roots, 'com.example.Missing'), false)

    // authorizeApp is an idempotent upsert: refresh display name, keep authorizedAt.
    const slackBefore = (await listAuthorizedApps(roots))[0]
    await authorizeApp(roots, { bundleId: 'com.example.Slack', displayName: 'Slack (workspace)' })
    const slackAfter = (await listAuthorizedApps(roots))[0]
    assert.equal(slackAfter.displayName, 'Slack (workspace)')
    assert.equal(slackAfter.authorizedAt, slackBefore.authorizedAt)

    apps = await replaceAuthorizedApps(roots, [
      { bundleId: 'a', displayName: 'A' },
      { bundleId: 'b', displayName: 'B' },
    ])
    assert.equal(apps.length, 2)
    apps = await revokeApp(roots, 'a')
    assert.equal(apps.length, 1)
    assert.equal(apps[0].bundleId, 'b')

    // Grant flags.
    assert.deepEqual(await getGrantFlags(roots), DEFAULT_GRANT_FLAGS)
    assert.equal((await updateGrantFlags(roots, { clipboardRead: true })).clipboardRead, true)
    assert.equal((await getGrantFlags(roots)).clipboardWrite, false)

    // Approval flow.
    const request = {
      requestId: 'req-1',
      sessionId: 'session-a',
      appBundleId: 'com.example.Slack',
      permission: 'screenRecording',
      reason: 'Read the message list',
    }
    const queued = await enqueueApproval(roots, request)
    assert.equal(queued.status, 'pending')
    assert.ok(queued.requestedAt)
    assert.equal((await getComputerUseStatus(roots)).pendingApproval, true)
    assert.equal((await getPendingApprovals(roots)).length, 1)
    assert.equal((await getApprovalQueue(roots)).length, 1)

    // Resolving an unknown request is a null no-op.
    assert.equal(await resolveApproval(roots, 'missing', { allowed: true }), null)

    const approved = await resolveApproval(roots, 'req-1', { allowed: true })
    assert.equal(approved.status, 'approved')
    assert.equal(approved.resolution.allowed, true)
    assert.ok(approved.resolvedAt)
    assert.equal((await getComputerUseStatus(roots)).pendingApproval, false)
    assert.equal((await getPendingApprovals(roots)).length, 0)

    // Deny and supersede paths.
    await enqueueApproval(roots, { ...request, requestId: 'req-2' })
    const denied = await resolveApproval(roots, 'req-2', { allowed: false, reason: 'user_denied' })
    assert.equal(denied.status, 'denied')
    assert.equal(denied.resolution.reason, 'user_denied')

    await enqueueApproval(roots, { ...request, requestId: 'req-3' })
    const superseded = await supersedeApproval(roots, 'req-3')
    assert.equal(superseded.status, 'superseded')

    // Re-enqueueing the same pending id supersedes the earlier entry.
    await enqueueApproval(roots, { ...request, requestId: 'req-4' })
    await enqueueApproval(roots, { ...request, requestId: 'req-4', reason: 'again' })
    const req4 = (await getApprovalQueue(roots)).filter(item => item.requestId === 'req-4')
    assert.equal(req4.length, 2)
    assert.equal(req4[0].status, 'pending')
    assert.equal(req4[1].status, 'superseded')

    // clearResolvedApprovals keeps only pending entries.
    await clearResolvedApprovals(roots)
    const afterClear = await getApprovalQueue(roots)
    assert.equal(afterClear.length, 1)
    assert.equal(afterClear[0].requestId, 'req-4')
    assert.equal(afterClear[0].status, 'pending')

    // A fresh store re-reads the persisted file.
    const store = createComputerUseStore(roots)
    assert.equal((await store.getStatus()).enabled, true)
    assert.equal((await store.listAuthorizedApps()).length, 1)
    assert.equal((await store.getPendingApprovals()).length, 1)

    console.log('COMPUTER-USE-SMOKE-OK')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
