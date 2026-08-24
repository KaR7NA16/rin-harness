/**
 * rin computer use — domain model and contract.
 *
 * Computer use is rin's file-backed persistence for the desktop computer-use
 * surface: an enabled master switch, a per-app allowlist, optional grant
 * flags, and a serialized approval queue. This module owns the schema, the
 * file-layout constants, and the default grant flags; the store module owns
 * behavior and the Cordis plugin entry owns registration.
 *
 * Design rules: every path derives only from an injected configuration root;
 * the package never inspects product environment variables; the approval
 * queue is serialized and atomically written.
 *
 * @module @rin/computer-use
 */

export const COMPUTER_USE_DIRNAME = 'computer-use' as const
export const COMPUTER_USE_STATE_FILENAME = 'state.json' as const

/** The configuration root every computer-use path derives from. */
export type ComputerUseRoots = {
  configRoot: string
}

/** Optional-permission flags the user grants independently of the app allowlist. */
export type GrantFlags = {
  clipboardRead: boolean
  clipboardWrite: boolean
  systemKeyCombos: boolean
}

/** Default grant flags: every optional permission starts disabled. */
export const DEFAULT_GRANT_FLAGS: GrantFlags = {
  clipboardRead: false,
  clipboardWrite: false,
  systemKeyCombos: false,
}

/** One app the user has authorized for computer use. */
export type AuthorizedApp = {
  bundleId: string
  displayName: string
  /** ISO-8601 timestamp of when the app was authorized. */
  authorizedAt: string
}

/** The fields callers supply when authorizing an app (timestamp is derived). */
export type AuthorizedAppInput = {
  bundleId: string
  displayName: string
}

/** The fields callers supply to queue a permission request (timestamps derived). */
export type PermissionRequestInput = {
  requestId: string
  sessionId: string
  /** Bundle id the model asked to act on (empty for a system-permission request). */
  appBundleId: string
  /** Which capability is requested, e.g. accessibility, screenRecording, clipboardRead. */
  permission: string
  /** Model-provided reason, shown in the approval UI. */
  reason: string
}

/** Lifecycle of a queued approval request. */
export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'superseded'

/** The user's decision on a queued approval request. */
export type ApprovalResolution = {
  allowed: boolean
  /** Denial reason; only meaningful when allowed is false. */
  reason?: string
}

/** A queued approval request plus its resolution state. */
export type PendingApproval = PermissionRequestInput & {
  status: ApprovalStatus
  /** ISO-8601 timestamp of when the request was queued. */
  requestedAt: string
  /** ISO-8601 timestamp of when the request was resolved (absent while pending). */
  resolvedAt?: string
  /** The recorded decision (absent while pending). */
  resolution?: ApprovalResolution
}

/** The persisted computer-use state file contents. */
export type ComputerUseState = {
  version: 1
  enabled: boolean
  grantFlags: GrantFlags
  authorizedApps: AuthorizedApp[]
  approvalQueue: PendingApproval[]
  /** ISO-8601 timestamp of the last write. */
  updatedAt?: string
}

/** Derived service status: master switch plus queue-derived aggregates. */
export type ComputerUseStatus = {
  enabled: boolean
  /** True when at least one approval request is still pending. */
  pendingApproval: boolean
  authorizedAppCount: number
  queuedApprovalCount: number
}
