/**
 * rin computer use — persistence, serialized approval mutations, and atomic writes.
 *
 * All computer-use state lives in one state.json file under the injected
 * configuration root. Reads merge the file with the default state; writes are
 * atomic (temp file + rename) and every read-modify-write mutation runs under
 * a file lock so concurrent callers cannot interleave.
 *
 * @module @rin/computer-use
 */

import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { getComputerUseStatePath, type ComputerUseRoots } from './paths.ts'
import {
  DEFAULT_GRANT_FLAGS,
  type ApprovalResolution,
  type AuthorizedApp,
  type AuthorizedAppInput,
  type ComputerUseState,
  type ComputerUseStatus,
  type GrantFlags,
  type PendingApproval,
  type PermissionRequestInput,
} from './types.ts'

const LOCK_STALE_MS = 30_000
const LOCK_RETRY_COUNT = 50
const LOCK_RETRY_DELAY_MS = 20

/** Error raised by computer-use persistence operations, carrying an API status. */
export class ComputerUseError extends Error {
  public readonly code: string
  public readonly status: number

  constructor(message: string, code: string, status = 400) {
    super(message)
    this.code = code
    this.status = status
    this.name = 'ComputerUseError'
  }
}

/** Build a fresh default state with no shared array or object references. */
function cloneDefaultState(): ComputerUseState {
  return {
    version: 1,
    enabled: false,
    grantFlags: { ...DEFAULT_GRANT_FLAGS },
    authorizedApps: [],
    approvalQueue: [],
  }
}

/** The default state returned when no state file has been written yet. */
export const DEFAULT_STATE: ComputerUseState = cloneDefaultState()

function getErrnoCode(error: unknown): string | undefined {
  if (
    error !== null
    && typeof error === 'object'
    && 'code' in error
    && typeof error.code === 'string'
  ) {
    return error.code
  }
  return undefined
}

function isFsInaccessible(error: unknown): boolean {
  return ['ENOENT', 'EACCES', 'EPERM', 'ENOTDIR', 'ELOOP'].includes(
    getErrnoCode(error) ?? '',
  )
}

function nowIso(): string {
  return new Date().toISOString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isAuthorizedApp(value: unknown): value is AuthorizedApp {
  return isRecord(value)
    && typeof value.bundleId === 'string'
    && typeof value.displayName === 'string'
    && typeof value.authorizedAt === 'string'
}

function isPendingApproval(value: unknown): value is PendingApproval {
  if (!isRecord(value)) return false
  if (typeof value.requestId !== 'string') return false
  if (typeof value.sessionId !== 'string') return false
  if (typeof value.appBundleId !== 'string') return false
  if (typeof value.permission !== 'string') return false
  if (typeof value.reason !== 'string') return false
  if (typeof value.requestedAt !== 'string') return false
  if (
    value.status !== 'pending'
    && value.status !== 'approved'
    && value.status !== 'denied'
    && value.status !== 'superseded'
  ) {
    return false
  }
  return true
}

function normalizeGrantFlags(value: unknown): GrantFlags {
  if (!isRecord(value)) return { ...DEFAULT_GRANT_FLAGS }
  const flags = { ...DEFAULT_GRANT_FLAGS }
  if (typeof value.clipboardRead === 'boolean') flags.clipboardRead = value.clipboardRead
  if (typeof value.clipboardWrite === 'boolean') flags.clipboardWrite = value.clipboardWrite
  if (typeof value.systemKeyCombos === 'boolean') flags.systemKeyCombos = value.systemKeyCombos
  return flags
}

/**
 * Normalize raw parsed JSON into a well-formed state, dropping malformed
 * entries and filling missing fields from the default state.
 * @param raw - the parsed state file contents.
 * @returns the normalized state.
 */
function normalizeState(raw: unknown): ComputerUseState {
  if (!isRecord(raw)) return cloneDefaultState()
  const updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined
  const state: ComputerUseState = {
    version: 1,
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_STATE.enabled,
    grantFlags: normalizeGrantFlags(raw.grantFlags),
    authorizedApps: Array.isArray(raw.authorizedApps)
      ? raw.authorizedApps.filter(isAuthorizedApp)
      : [],
    approvalQueue: Array.isArray(raw.approvalQueue)
      ? raw.approvalQueue.filter(isPendingApproval)
      : [],
  }
  if (updatedAt !== undefined) state.updatedAt = updatedAt
  return state
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 })
  const tmpPath = filePath + '.tmp.' + process.pid + '.' + Date.now() + '.' + randomBytes(4).toString('hex')
  await writeFile(tmpPath, content, { encoding: 'utf-8', mode: 0o600 })
  try {
    await rename(tmpPath, filePath)
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => {})
    throw error
  }
}

async function acquireLock(lockPath: string): Promise<void> {
  await mkdir(dirname(lockPath), { recursive: true })

  for (let attempt = 0; attempt < LOCK_RETRY_COUNT; attempt++) {
    try {
      await writeFile(lockPath, String(process.pid), { encoding: 'utf-8', flag: 'wx' })
      return
    } catch (error) {
      if (getErrnoCode(error) !== 'EEXIST') throw error
      try {
        const info = await stat(lockPath)
        if (Date.now() - info.mtimeMs > LOCK_STALE_MS) {
          await rm(lockPath, { force: true })
          continue
        }
      } catch (statError) {
        if (!isFsInaccessible(statError)) throw statError
      }
      await delay(LOCK_RETRY_DELAY_MS)
    }
  }

  throw new ComputerUseError(
    'rin computer-use: could not acquire state lock: ' + lockPath,
    'LOCK_TIMEOUT',
    409,
  )
}

async function withStateLock<T>(roots: ComputerUseRoots, fn: () => Promise<T>): Promise<T> {
  const lockPath = getComputerUseStatePath(roots) + '.lock'
  await acquireLock(lockPath)
  try {
    return await fn()
  } finally {
    await rm(lockPath, { force: true }).catch(() => {})
  }
}

/**
 * Read the persisted state, falling back to defaults when the file is missing
 * or malformed.
 * @param roots - the configuration root.
 * @returns the normalized persisted state.
 */
export async function readComputerUseState(roots: ComputerUseRoots): Promise<ComputerUseState> {
  let raw: string
  try {
    raw = await readFile(getComputerUseStatePath(roots), 'utf-8')
  } catch (error) {
    if (isFsInaccessible(error)) return cloneDefaultState()
    throw error
  }
  try {
    return normalizeState(JSON.parse(raw) as unknown)
  } catch {
    // Swallow a malformed state file (JSON parse error) and fall back to defaults.
    return cloneDefaultState()
  }
}

/**
 * Atomically persist the state file.
 * @param roots - the configuration root.
 * @param state - the full state to persist.
 */
export async function writeComputerUseState(
  roots: ComputerUseRoots,
  state: ComputerUseState,
): Promise<void> {
  await atomicWrite(getComputerUseStatePath(roots), JSON.stringify(state, null, 2))
}

function toStatus(state: ComputerUseState): ComputerUseStatus {
  return {
    enabled: state.enabled,
    pendingApproval: state.approvalQueue.some(item => item.status === 'pending'),
    authorizedAppCount: state.authorizedApps.length,
    queuedApprovalCount: state.approvalQueue.length,
  }
}

/**
 * Read the derived service status.
 * @param roots - the configuration root.
 * @returns the enabled state plus queue-derived aggregates.
 */
export async function getComputerUseStatus(roots: ComputerUseRoots): Promise<ComputerUseStatus> {
  return toStatus(await readComputerUseState(roots))
}

/**
 * Set the computer-use master switch.
 * @param roots - the configuration root.
 * @param enabled - the new enabled state.
 * @returns the resulting status.
 */
export async function setComputerUseEnabled(
  roots: ComputerUseRoots,
  enabled: boolean,
): Promise<ComputerUseStatus> {
  return withStateLock(roots, async () => {
    const state = await readComputerUseState(roots)
    await writeComputerUseState(roots, { ...state, enabled, updatedAt: nowIso() })
    return toStatus({ ...state, enabled })
  })
}

/**
 * List every authorized app.
 * @param roots - the configuration root.
 * @returns the authorized-app allowlist.
 */
export async function listAuthorizedApps(roots: ComputerUseRoots): Promise<AuthorizedApp[]> {
  const state = await readComputerUseState(roots)
  return [...state.authorizedApps]
}

/**
 * Whether a bundle id is currently authorized.
 * @param roots - the configuration root.
 * @param bundleId - the bundle id to check.
 * @returns true when the app is in the allowlist.
 */
export async function isAppAuthorized(roots: ComputerUseRoots, bundleId: string): Promise<boolean> {
  const state = await readComputerUseState(roots)
  return state.authorizedApps.some(app => app.bundleId === bundleId)
}

/**
 * Authorize an app (upsert): adds it or refreshes its display name.
 * @param roots - the configuration root.
 * @param app - the app to authorize.
 * @returns the updated allowlist.
 */
export async function authorizeApp(
  roots: ComputerUseRoots,
  app: AuthorizedAppInput,
): Promise<AuthorizedApp[]> {
  const bundleId = app.bundleId.trim()
  const displayName = app.displayName.trim()
  if (!bundleId) {
    throw new ComputerUseError('rin computer-use: bundleId cannot be empty.', 'EMPTY_BUNDLE_ID')
  }

  return withStateLock(roots, async () => {
    const state = await readComputerUseState(roots)
    const ts = nowIso()
    const existing = state.authorizedApps.find(item => item.bundleId === bundleId)
    const entry: AuthorizedApp = {
      bundleId,
      displayName,
      authorizedAt: existing?.authorizedAt ?? ts,
    }
    const authorizedApps = existing
      ? state.authorizedApps.map(item => (item.bundleId === bundleId ? entry : item))
      : [...state.authorizedApps, entry]
    await writeComputerUseState(roots, { ...state, authorizedApps, updatedAt: ts })
    return authorizedApps
  })
}

/**
 * Remove an app from the allowlist.
 * @param roots - the configuration root.
 * @param bundleId - the bundle id to revoke.
 * @returns the updated allowlist.
 */
export async function revokeApp(roots: ComputerUseRoots, bundleId: string): Promise<AuthorizedApp[]> {
  const normalized = bundleId.trim()
  if (!normalized) {
    throw new ComputerUseError('rin computer-use: bundleId cannot be empty.', 'EMPTY_BUNDLE_ID')
  }
  return withStateLock(roots, async () => {
    const state = await readComputerUseState(roots)
    const authorizedApps = state.authorizedApps.filter(item => item.bundleId !== normalized)
    await writeComputerUseState(roots, { ...state, authorizedApps, updatedAt: nowIso() })
    return authorizedApps
  })
}

/**
 * Replace the entire allowlist with a fresh, timestamped snapshot.
 * @param roots - the configuration root.
 * @param apps - the apps that make up the new allowlist.
 * @returns the new allowlist.
 */
export async function replaceAuthorizedApps(
  roots: ComputerUseRoots,
  apps: readonly AuthorizedAppInput[],
): Promise<AuthorizedApp[]> {
  return withStateLock(roots, async () => {
    const ts = nowIso()
    const authorizedApps: AuthorizedApp[] = apps.map(app => ({
      bundleId: app.bundleId.trim(),
      displayName: app.displayName.trim(),
      authorizedAt: ts,
    }))
    const state = await readComputerUseState(roots)
    await writeComputerUseState(roots, { ...state, authorizedApps, updatedAt: ts })
    return authorizedApps
  })
}

/**
 * Read the current grant flags.
 * @param roots - the configuration root.
 * @returns the grant flags.
 */
export async function getGrantFlags(roots: ComputerUseRoots): Promise<GrantFlags> {
  const state = await readComputerUseState(roots)
  return { ...state.grantFlags }
}

/**
 * Merge the provided flags over the current grant flags.
 * @param roots - the configuration root.
 * @param flags - the flag fields to update.
 * @returns the updated grant flags.
 */
export async function updateGrantFlags(
  roots: ComputerUseRoots,
  flags: Partial<GrantFlags>,
): Promise<GrantFlags> {
  return withStateLock(roots, async () => {
    const state = await readComputerUseState(roots)
    const grantFlags: GrantFlags = {
      clipboardRead: typeof flags.clipboardRead === 'boolean'
        ? flags.clipboardRead
        : state.grantFlags.clipboardRead,
      clipboardWrite: typeof flags.clipboardWrite === 'boolean'
        ? flags.clipboardWrite
        : state.grantFlags.clipboardWrite,
      systemKeyCombos: typeof flags.systemKeyCombos === 'boolean'
        ? flags.systemKeyCombos
        : state.grantFlags.systemKeyCombos,
    }
    await writeComputerUseState(roots, { ...state, grantFlags, updatedAt: nowIso() })
    return grantFlags
  })
}

/**
 * Queue a new approval request. Any pending request with the same request id
 * is superseded first.
 * @param roots - the configuration root.
 * @param request - the permission request to queue.
 * @returns the queued (pending) approval entry.
 */
export async function enqueueApproval(
  roots: ComputerUseRoots,
  request: PermissionRequestInput,
): Promise<PendingApproval> {
  const requestId = request.requestId.trim()
  const sessionId = request.sessionId.trim()
  const appBundleId = request.appBundleId.trim()
  const permission = request.permission.trim()
  if (!requestId) {
    throw new ComputerUseError('rin computer-use: requestId cannot be empty.', 'EMPTY_REQUEST_ID')
  }
  if (!sessionId) {
    throw new ComputerUseError('rin computer-use: sessionId cannot be empty.', 'EMPTY_SESSION_ID')
  }
  if (!permission) {
    throw new ComputerUseError('rin computer-use: permission cannot be empty.', 'EMPTY_PERMISSION')
  }

  return withStateLock(roots, async () => {
    const state = await readComputerUseState(roots)
    const ts = nowIso()
    const queue: PendingApproval[] = state.approvalQueue.map(item =>
      item.requestId === requestId && item.status === 'pending'
        ? { ...item, status: 'superseded', resolvedAt: ts }
        : item,
    )
    const entry: PendingApproval = {
      requestId,
      sessionId,
      appBundleId,
      permission,
      reason: request.reason,
      requestedAt: ts,
      status: 'pending',
    }
    await writeComputerUseState(roots, { ...state, approvalQueue: [...queue, entry], updatedAt: ts })
    return entry
  })
}

/**
 * Read the full approval queue, newest first.
 * @param roots - the configuration root.
 * @returns the queue entries.
 */
export async function getApprovalQueue(roots: ComputerUseRoots): Promise<PendingApproval[]> {
  const state = await readComputerUseState(roots)
  return [...state.approvalQueue].reverse()
}

/**
 * Read only the still-pending approval requests, newest first.
 * @param roots - the configuration root.
 * @returns the pending entries.
 */
export async function getPendingApprovals(roots: ComputerUseRoots): Promise<PendingApproval[]> {
  const state = await readComputerUseState(roots)
  return state.approvalQueue.filter(item => item.status === 'pending').reverse()
}

/**
 * Record the user's decision on a pending approval request.
 * @param roots - the configuration root.
 * @param requestId - the request to resolve.
 * @param resolution - the decision.
 * @returns the resolved entry, or null when no pending request matches.
 */
export async function resolveApproval(
  roots: ComputerUseRoots,
  requestId: string,
  resolution: ApprovalResolution,
): Promise<PendingApproval | null> {
  const normalized = requestId.trim()
  if (!normalized) {
    throw new ComputerUseError('rin computer-use: requestId cannot be empty.', 'EMPTY_REQUEST_ID')
  }

  return withStateLock(roots, async () => {
    const state = await readComputerUseState(roots)
    const at = state.approvalQueue.findIndex(
      item => item.requestId === normalized && item.status === 'pending',
    )
    if (at < 0) return null
    const current = state.approvalQueue[at]
    if (current === undefined) return null
    const ts = nowIso()
    const nextResolution: ApprovalResolution = { allowed: resolution.allowed }
    if (!resolution.allowed && resolution.reason !== undefined) {
      nextResolution.reason = resolution.reason
    }
    const resolved: PendingApproval = {
      ...current,
      status: resolution.allowed ? 'approved' : 'denied',
      resolvedAt: ts,
      resolution: nextResolution,
    }
    const queue = [...state.approvalQueue]
    queue[at] = resolved
    await writeComputerUseState(roots, { ...state, approvalQueue: queue, updatedAt: ts })
    return resolved
  })
}

/**
 * Mark a pending approval request superseded (for example, its session
 * disconnected).
 * @param roots - the configuration root.
 * @param requestId - the request to supersede.
 * @returns the superseded entry, or null when no pending request matches.
 */
export async function supersedeApproval(
  roots: ComputerUseRoots,
  requestId: string,
): Promise<PendingApproval | null> {
  const normalized = requestId.trim()
  if (!normalized) {
    throw new ComputerUseError('rin computer-use: requestId cannot be empty.', 'EMPTY_REQUEST_ID')
  }
  return withStateLock(roots, async () => {
    const state = await readComputerUseState(roots)
    const at = state.approvalQueue.findIndex(
      item => item.requestId === normalized && item.status === 'pending',
    )
    if (at < 0) return null
    const current = state.approvalQueue[at]
    if (current === undefined) return null
    const ts = nowIso()
    const superseded: PendingApproval = { ...current, status: 'superseded', resolvedAt: ts }
    const queue = [...state.approvalQueue]
    queue[at] = superseded
    await writeComputerUseState(roots, { ...state, approvalQueue: queue, updatedAt: ts })
    return superseded
  })
}

/**
 * Drop resolved (non-pending) entries from the approval queue.
 * @param roots - the configuration root.
 */
export async function clearResolvedApprovals(roots: ComputerUseRoots): Promise<void> {
  await withStateLock(roots, async () => {
    const state = await readComputerUseState(roots)
    const approvalQueue = state.approvalQueue.filter(item => item.status === 'pending')
    await writeComputerUseState(roots, { ...state, approvalQueue, updatedAt: nowIso() })
  })
}

/**
 * Bind the persistence operations to one configuration root.
 * @param roots - the configuration root every operation targets.
 * @returns the bound store methods.
 */
export function createComputerUseStore(roots: ComputerUseRoots) {
  return {
    authorizeApp: (app: AuthorizedAppInput) => authorizeApp(roots, app),
    clearResolvedApprovals: () => clearResolvedApprovals(roots),
    enqueueApproval: (request: PermissionRequestInput) => enqueueApproval(roots, request),
    getApprovalQueue: () => getApprovalQueue(roots),
    getGrantFlags: () => getGrantFlags(roots),
    getPendingApprovals: () => getPendingApprovals(roots),
    getStatus: () => getComputerUseStatus(roots),
    isAppAuthorized: (bundleId: string) => isAppAuthorized(roots, bundleId),
    listAuthorizedApps: () => listAuthorizedApps(roots),
    replaceAuthorizedApps: (apps: readonly AuthorizedAppInput[]) => replaceAuthorizedApps(roots, apps),
    resolveApproval: (requestId: string, resolution: ApprovalResolution) =>
      resolveApproval(roots, requestId, resolution),
    revokeApp: (bundleId: string) => revokeApp(roots, bundleId),
    setEnabled: (enabled: boolean) => setComputerUseEnabled(roots, enabled),
    supersedeApproval: (requestId: string) => supersedeApproval(roots, requestId),
    updateGrantFlags: (flags: Partial<GrantFlags>) => updateGrantFlags(roots, flags),
  }
}
