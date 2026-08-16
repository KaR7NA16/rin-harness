/**
 * rin session-backup — Cordis plugin entry.
 *
 * Exposes a ctx.sessionBackup service: gzip session export/import and rolling
 * backups over the dsh session home. The archive core lives in core.ts
 * (node: builtins only); this module owns the Cordis registration.
 *
 * @module @rin/session-backup
 */

import { Context, Service } from '@deepseek-ai/cordis'
import {
  defaultOptions,
  exportSessions,
  importSessions,
  listBackups,
  readSettings,
  restoreBackup,
  runBackup,
  writeSettings,
} from './core.ts'
import type {
  BackupListEntry,
  ImportSessionResult,
  SessionBackupCoreOptions,
  SessionBackupSettings,
} from './core.ts'

export type * from './core.ts'
export { defaultOptions } from './core.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionBackup: SessionBackupService
  }
}

/** The session-backup service exposed on the shared context. */
export abstract class SessionBackupService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'sessionBackup')
  }

  abstract exportSessions(): Promise<Buffer>
  abstract importSessions(buffer: Buffer): Promise<ImportSessionResult>
  abstract runBackup(): Promise<BackupListEntry>
  abstract listBackups(): Promise<BackupListEntry[]>
  abstract restoreBackup(name: string): Promise<ImportSessionResult>
  abstract getSettings(): Promise<SessionBackupSettings>
  abstract updateSettings(settings: SessionBackupSettings): Promise<SessionBackupSettings>
}

/** File-backed implementation over the dsh session home + ~/.rin/backups. */
export class FileSessionBackupService extends SessionBackupService {
  private readonly options: SessionBackupCoreOptions

  constructor(ctx: Context) {
    super(ctx)
    this.options = defaultOptions()
  }

  override exportSessions() {
    return exportSessions(this.options)
  }

  override importSessions(buffer: Buffer) {
    return importSessions(buffer, this.options)
  }

  override runBackup() {
    return runBackup(this.options, 10)
  }

  override listBackups() {
    return listBackups(this.options)
  }

  override restoreBackup(name: string) {
    return restoreBackup(name, this.options)
  }

  override getSettings() {
    return readSettings(this.options.settingsPath)
  }

  override async updateSettings(settings: SessionBackupSettings) {
    const current = await readSettings(this.options.settingsPath)
    return writeSettings(this.options.settingsPath, { ...current, ...settings })
  }
}

export const name = 'session-backup'
export const inject: string[] = []

/** Install the file-backed session-backup service into the shared context. */
export function apply(ctx: Context): void {
  ctx.plugin(FileSessionBackupService)
}
