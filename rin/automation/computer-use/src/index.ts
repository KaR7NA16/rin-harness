/**
 * rin computer use — Cordis plugin entry.
 *
 * Exposes a ctx.computerUse service: file-backed computer-use state (the
 * enabled master switch, the authorized-app allowlist, grant flags, and the
 * serialized approval queue). The store module (store.ts) owns persistence and
 * domain logic; this module owns the Cordis registration only.
 *
 * @module @rin/computer-use
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { getDefaultComputerUseRoot } from './paths.ts'
import { createComputerUseStore } from './store.ts'
import type {
  ApprovalResolution,
  AuthorizedApp,
  AuthorizedAppInput,
  ComputerUseStatus,
  GrantFlags,
  PendingApproval,
  PermissionRequestInput,
} from './types.ts'

export type {
  ApprovalResolution,
  ApprovalStatus,
  AuthorizedApp,
  AuthorizedAppInput,
  ComputerUseRoots,
  ComputerUseState,
  ComputerUseStatus,
  GrantFlags,
  PendingApproval,
  PermissionRequestInput,
} from './types.ts'
export {
  COMPUTER_USE_API_VERSION,
  COMPUTER_USE_DIRNAME,
  COMPUTER_USE_STATE_FILENAME,
  DEFAULT_GRANT_FLAGS,
} from './types.ts'
export { getComputerUseStatePath, getDefaultComputerUseRoot } from './paths.ts'
export {
  authorizeApp,
  clearResolvedApprovals,
  ComputerUseError,
  createComputerUseStore,
  DEFAULT_STATE,
  enqueueApproval,
  getApprovalQueue,
  getComputerUseStatus,
  getGrantFlags,
  getPendingApprovals,
  isAppAuthorized,
  listAuthorizedApps,
  readComputerUseState,
  replaceAuthorizedApps,
  resolveApproval,
  revokeApp,
  setComputerUseEnabled,
  supersedeApproval,
  updateGrantFlags,
  writeComputerUseState,
} from './store.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    computerUse: ComputerUseService
  }
}

/** Configuration required to install the computer-use service. */
export interface ComputerUsePluginConfig {
  /** The directory computer-use state is rooted under. Defaults to ~/.rin/computer-use. */
  configRoot?: string
}

/** The computer-use service exposed on the shared context. */
export abstract class ComputerUseService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'computerUse')
  }

  abstract getStatus(): Promise<ComputerUseStatus>

  abstract setEnabled(enabled: boolean): Promise<ComputerUseStatus>

  abstract listAuthorizedApps(): Promise<AuthorizedApp[]>

  abstract isAppAuthorized(bundleId: string): Promise<boolean>

  abstract authorizeApp(app: AuthorizedAppInput): Promise<AuthorizedApp[]>

  abstract revokeApp(bundleId: string): Promise<AuthorizedApp[]>

  abstract replaceAuthorizedApps(apps: readonly AuthorizedAppInput[]): Promise<AuthorizedApp[]>

  abstract getGrantFlags(): Promise<GrantFlags>

  abstract updateGrantFlags(flags: Partial<GrantFlags>): Promise<GrantFlags>

  abstract enqueueApproval(request: PermissionRequestInput): Promise<PendingApproval>

  abstract getApprovalQueue(): Promise<PendingApproval[]>

  abstract getPendingApprovals(): Promise<PendingApproval[]>

  abstract resolveApproval(
    requestId: string,
    resolution: ApprovalResolution,
  ): Promise<PendingApproval | null>

  abstract supersedeApproval(requestId: string): Promise<PendingApproval | null>

  abstract clearResolvedApprovals(): Promise<void>
}

/** File-backed implementation binding every operation to one configuration root. */
export class FileComputerUseService extends ComputerUseService {
  private readonly store: ReturnType<typeof createComputerUseStore>

  constructor(ctx: Context, config: ComputerUsePluginConfig = {}) {
    super(ctx)
    this.store = createComputerUseStore({ configRoot: resolveConfigRoot(config) })
  }

  override getStatus() {
    return this.store.getStatus()
  }

  override setEnabled(enabled: boolean) {
    return this.store.setEnabled(enabled)
  }

  override listAuthorizedApps() {
    return this.store.listAuthorizedApps()
  }

  override isAppAuthorized(bundleId: string) {
    return this.store.isAppAuthorized(bundleId)
  }

  override authorizeApp(app: AuthorizedAppInput) {
    return this.store.authorizeApp(app)
  }

  override revokeApp(bundleId: string) {
    return this.store.revokeApp(bundleId)
  }

  override replaceAuthorizedApps(apps: readonly AuthorizedAppInput[]) {
    return this.store.replaceAuthorizedApps(apps)
  }

  override getGrantFlags() {
    return this.store.getGrantFlags()
  }

  override updateGrantFlags(flags: Partial<GrantFlags>) {
    return this.store.updateGrantFlags(flags)
  }

  override enqueueApproval(request: PermissionRequestInput) {
    return this.store.enqueueApproval(request)
  }

  override getApprovalQueue() {
    return this.store.getApprovalQueue()
  }

  override getPendingApprovals() {
    return this.store.getPendingApprovals()
  }

  override resolveApproval(requestId: string, resolution: ApprovalResolution) {
    return this.store.resolveApproval(requestId, resolution)
  }

  override supersedeApproval(requestId: string) {
    return this.store.supersedeApproval(requestId)
  }

  override clearResolvedApprovals() {
    return this.store.clearResolvedApprovals()
  }
}

export const name = 'computer-use'
export const inject: string[] = []

/**
 * Install the file-backed computer-use service.
 * @param ctx - the plugin context.
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: ComputerUsePluginConfig = {}): void {
  ctx.plugin(FileComputerUseService, config)
}

/**
 * Validate the plugin config and resolve the configuration root.
 * @param config - the plugin configuration.
 * @returns the resolved configuration root.
 */
function resolveConfigRoot(config: ComputerUsePluginConfig): string {
  if (config.configRoot === undefined) return getDefaultComputerUseRoot()
  if (config.configRoot.trim() === '') {
    throw new Error('rin computer-use: config.configRoot must be a non-empty string')
  }
  return config.configRoot
}
