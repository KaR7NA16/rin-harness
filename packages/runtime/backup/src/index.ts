/**
 * rin session-backup — Cordis plugin entry.
 *
 * Exposes a ctx.sessionBackup service: session export/import, complete RIN
 * archive export/import, and rolling backups over an explicit RIN home. The
 * archive core lives in core.ts
 * (node: builtins only); this module owns the Cordis registration.
 *
 * @module @rin/backup
 */

import { Context, Service } from '@deepseek-ai/cordis'
import {
  buildRinArchiveOptions,
  defaultOptions,
  exportRinArchive,
  exportSessions,
  importRinArchive,
  importSessions,
  listBackups,
  readSettings,
  restoreBackup,
  runBackup,
  writeSettings,
} from './core.ts'
import type {
  BackupListEntry,
  ArchivePreparation,
  ImportSessionResult,
  RinArchiveImportResult,
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
  abstract exportArchive(): Promise<Buffer>
  abstract importArchive(buffer: Buffer): Promise<RinArchiveImportResult>
  abstract runBackup(): Promise<BackupListEntry>
  abstract listBackups(): Promise<BackupListEntry[]>
  abstract restoreBackup(name: string): Promise<RinArchiveImportResult>
  abstract getSettings(): Promise<SessionBackupSettings>
  abstract updateSettings(settings: SessionBackupSettings): Promise<SessionBackupSettings>
}

/** Optional paths and retention for the file-backed backup service. */
export interface SessionBackupPluginConfig {
  sessionsRoot?: string
  backupsRoot?: string
  settingsPath?: string
  archiveRoot?: string
  dshRoot?: string
  dshSettingsPath?: string
  beforeArchive?: ArchivePreparation
  credentialsPath?: string
  maxKeep?: number
}

/** File-backed implementation over the dsh session home and RIN archive root. */
export class FileSessionBackupService extends SessionBackupService {
  private readonly options: SessionBackupCoreOptions
  private archiveOperation: Promise<void> = Promise.resolve()
  private readonly maxKeep: number

  constructor(ctx: Context, config: SessionBackupPluginConfig = {}) {
    super(ctx)
    const defaults = defaultOptions()
    const archiveRoot = config.archiveRoot ?? defaults.archiveRoot
    const dshRoot = config.dshRoot ?? defaults.dshRoot
    const dshSettingsPath = config.dshSettingsPath ?? defaults.dshSettingsPath
    const credentialsPath = config.credentialsPath ?? defaults.credentialsPath
    if (archiveRoot === undefined) throw new Error('rin session-backup: archiveRoot is required')
    this.options = {
      sessionsRoot: config.sessionsRoot ?? defaults.sessionsRoot,
      backupsRoot: config.backupsRoot ?? defaults.backupsRoot,
      settingsPath: config.settingsPath ?? defaults.settingsPath,
      archiveRoot,
      ...(dshRoot === undefined ? {} : { dshRoot }),
      ...(dshSettingsPath === undefined ? {} : { dshSettingsPath }),
      ...(config.beforeArchive === undefined ? {} : { beforeArchive: config.beforeArchive }),
      ...(credentialsPath === undefined ? {} : { credentialsPath }),
    }
    this.maxKeep = config.maxKeep ?? 10
  }

  override exportSessions() {
    return this.serializeArchiveOperation(() => exportSessions(this.options))
  }

  override importSessions(buffer: Buffer) {
    return this.serializeArchiveOperation(() => importSessions(buffer, this.options))
  }

  override exportArchive() {
    return this.serializeArchiveOperation(() => exportRinArchive(buildRinArchiveOptions(this.options)))
  }

  override importArchive(buffer: Buffer) {
    return this.serializeArchiveOperation(() => importRinArchive(buffer, buildRinArchiveOptions(this.options)))
  }

  override runBackup() {
    return this.serializeArchiveOperation(() => runBackup(this.options, this.maxKeep))
  }

  override listBackups() {
    return listBackups(this.options)
  }

  override restoreBackup(name: string) {
    return this.serializeArchiveOperation(() => restoreBackup(name, this.options))
  }

  private serializeArchiveOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.archiveOperation.then(operation, operation)
    this.archiveOperation = result.then(() => undefined, () => undefined)
    return result
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
export function apply(ctx: Context, config?: SessionBackupPluginConfig): void {
  ctx.plugin(FileSessionBackupService, config)
}
