/**
 * rin session-backup — gzip session archive core.
 *
 * Archives the raw session files under the dsh session home (opaque bytes —
 * sessions may be zstd-compressed) into a gzip envelope, and restores them.
 * Cordis-free: node: builtins only (zlib gzip + base64, no zip dependency).
 *
 * @module @rin/session-backup
 */

import { gzipSync, gunzipSync } from 'node:zlib'
import { mkdir, readFile, readdir, stat, writeFile, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface SessionBackupSettings {
  enabled?: boolean
  intervalDays?: number
  maxKeep?: number
  location?: string
}

export interface BackupListEntry {
  name: string
  createdAt: string
  sizeBytes: number
}

export interface ImportSessionResult {
  imported: number
  skipped: number
  sessions: Array<{ sessionId: string; originalId: string; mappedId?: string }>
}

export interface SessionBackupCoreOptions {
  sessionsRoot: string
  backupsRoot: string
  settingsPath: string
}

const ARCHIVE_VERSION = 1
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024

interface ArchiveFile { path: string; content: string }
interface ArchiveEnvelope { version: number; files: ArchiveFile[] }

/** Recursively list files under a root, returning paths relative to the root. */
async function listFiles(root: string, current = '', out: string[] = []): Promise<string[]> {
  let entries
  try {
    entries = await readdir(join(root, current), { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const rel = current === '' ? entry.name : join(current, entry.name)
    if (entry.isDirectory()) await listFiles(root, rel, out)
    else if (entry.isFile()) out.push(rel)
  }
  return out
}

function safeName(name: string): string {
  const cleaned = String(name).replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
  return cleaned.replace(/^\.+$/, 'untitled')
}

/** Export every session file into a gzipped archive buffer. */
export async function exportSessions(options: SessionBackupCoreOptions): Promise<Buffer> {
  const files = await listFiles(options.sessionsRoot)
  if (files.length === 0) {
    const error = new Error('No sessions to export') as Error & { code?: string }
    error.code = 'NO_SESSIONS'
    throw error
  }
  const archive: ArchiveFile[] = []
  for (const rel of files) {
    const content = await readFile(join(options.sessionsRoot, rel))
    archive.push({ path: rel, content: content.toString('base64') })
  }
  const envelope: ArchiveEnvelope = { version: ARCHIVE_VERSION, files: archive }
  return gzipSync(Buffer.from(JSON.stringify(envelope), 'utf-8'))
}

/** Restore an exported archive buffer into the session home. */
export async function importSessions(buffer: Buffer, options: SessionBackupCoreOptions): Promise<ImportSessionResult> {
  if (buffer.length > MAX_ARCHIVE_BYTES) {
    const error = new Error('Backup file too large') as Error & { code?: string }
    error.code = 'TOO_LARGE'
    throw error
  }
  let envelope: ArchiveEnvelope
  try {
    envelope = JSON.parse(gunzipSync(buffer).toString('utf-8')) as ArchiveEnvelope
  } catch (err) {
    const error = new Error(`Invalid backup file: ${err instanceof Error ? err.message : String(err)}`) as Error & { code?: string }
    error.code = 'BAD_BACKUP'
    throw error
  }
  if (envelope.version !== ARCHIVE_VERSION || !Array.isArray(envelope.files)) {
    const error = new Error('Invalid backup file: unsupported version') as Error & { code?: string }
    error.code = 'BAD_BACKUP'
    throw error
  }

  const result: ImportSessionResult = { imported: 0, skipped: 0, sessions: [] }
  for (const file of envelope.files) {
    const rel = safeName(file.path).split('/').filter(Boolean).join('/')
    if (rel === '') { result.skipped++; continue }
    const target = join(options.sessionsRoot, rel)
    try {
      await stat(target)
      // Existing session file: skip rather than overwrite (no id remapping in this port).
      result.skipped++
      continue
    } catch {
      // target does not exist — fall through to write
    }
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, Buffer.from(file.content, 'base64'))
    result.imported++
    result.sessions.push({ sessionId: rel.split('/')[0] ?? rel, originalId: rel.split('/')[0] ?? rel })
  }
  return result
}

/** Run a full backup into the backups directory, pruning to maxKeep. */
export async function runBackup(options: SessionBackupCoreOptions, maxKeep: number): Promise<BackupListEntry> {
  const buffer = await exportSessions(options)
  await mkdir(options.backupsRoot, { recursive: true })
  const name = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.rinbackup.gz`
  await writeFile(join(options.backupsRoot, name), buffer)
  await pruneBackups(options.backupsRoot, Math.max(1, maxKeep))
  return statBackup(options.backupsRoot, name)
}

export async function listBackups(options: SessionBackupCoreOptions): Promise<BackupListEntry[]> {
  let names: string[]
  try {
    names = await readdir(options.backupsRoot)
  } catch {
    return []
  }
  const out: BackupListEntry[] = []
  for (const name of names) {
    if (!name.endsWith('.rinbackup.gz')) continue
    try {
      const s = await stat(join(options.backupsRoot, name))
      out.push({ name, createdAt: s.mtime.toISOString(), sizeBytes: s.size })
    } catch {
      continue
    }
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

export async function restoreBackup(name: string, options: SessionBackupCoreOptions): Promise<ImportSessionResult> {
  if (!name.endsWith('.rinbackup.gz') || name.includes('..') || name.includes('/')) {
    throw new Error('Invalid backup name')
  }
  const buffer = await readFile(join(options.backupsRoot, name))
  return importSessions(buffer, options)
}

async function statBackup(backupsRoot: string, name: string): Promise<BackupListEntry> {
  const s = await stat(join(backupsRoot, name))
  return { name, createdAt: s.mtime.toISOString(), sizeBytes: s.size }
}

async function pruneBackups(backupsRoot: string, maxKeep: number): Promise<void> {
  const all = await listBackups({ sessionsRoot: '', backupsRoot, settingsPath: '' })
  if (all.length <= maxKeep) return
  for (const entry of all.slice(maxKeep)) {
    await unlink(join(backupsRoot, entry.name)).catch(() => {})
  }
}

/** Read/write the backup settings JSON file. */
export async function readSettings(settingsPath: string): Promise<SessionBackupSettings> {
  try {
    return JSON.parse(await readFile(settingsPath, 'utf-8')) as SessionBackupSettings
  } catch {
    return {}
  }
}

export async function writeSettings(settingsPath: string, settings: SessionBackupSettings): Promise<SessionBackupSettings> {
  await mkdir(join(settingsPath, '..'), { recursive: true })
  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8')
  return settings
}

export function defaultOptions(home = homedir()): SessionBackupCoreOptions {
  return {
    sessionsRoot: join(home, '.dsh', 'sessions'),
    backupsRoot: join(home, '.rin', 'backups'),
    settingsPath: join(home, '.rin', 'backup-settings.json'),
  }
}
