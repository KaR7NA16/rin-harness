/**
 * rin session-backup — gzip session archive core.
 *
 * Archives the complete portable RIN_HOME tree into a versioned gzip envelope
 * (opaque bytes — sessions may be zstd-compressed), while retaining a
 * session-only export for the legacy API.
 * Cordis-free: node: builtins only (zlib gzip + base64, no zip dependency).
 *
 * @module @rin/session-backup
 */

import { gzipSync, gunzipSync } from 'node:zlib'
import { mkdir, readFile, readdir, stat, writeFile, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path'

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
  archiveRoot?: string
  dshRoot?: string
  dshSettingsPath?: string
  credentialsPath?: string
  beforeArchive?: ArchivePreparation
}

/** Flush mutable stores immediately before a portable archive is read. */
export type ArchivePreparation = () => void | Promise<void>

/** A separately rooted data source included under a portable archive prefix. */
export interface RinArchiveSource {
  root: string
  prefix: string
  include?: string[]
  targetRoot?: string
  targetPrefix?: string
}

/** Options for exporting or importing a portable RIN archive. */
export interface RinArchiveOptions {
  root: string
  include?: string[]
  beforeExport?: ArchivePreparation
  exclude?: string[]
  sources?: readonly RinArchiveSource[]
}

/** One relative file in a portable RIN archive. */
export interface RinArchiveFile {
  path: string
  content: string
}

/** The versioned envelope for a complete RIN archive. */
export interface RinArchiveEnvelope {
  kind: 'rin-archive'
  version: 2
  root: '.'
  createdAt: string
  files: RinArchiveFile[]
}

/** Result of importing a complete RIN archive. */
export interface RinArchiveImportResult extends ImportSessionResult {
  files: string[]
}

const SESSION_ARCHIVE_VERSION = 1
const RIN_ARCHIVE_VERSION = 2
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
const DEFAULT_ARCHIVE_EXCLUDES = [
  'backups',
  '.credentials.yaml',
  'credentials.yaml',
  '.env',
  'secrets',
] as const

interface SessionArchiveFile { path: string; content: string }
interface SessionArchiveEnvelope { version: number; files: SessionArchiveFile[] }

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
    else if (entry.isFile()) out.push(rel.split(sep).join('/'))
  }
  return out
}

function safeRelativePath(value: string): string | undefined {
  const normalized = value.replaceAll('\\', '/')
  if (normalized === '' || posix.isAbsolute(normalized)) return undefined
  const parts = normalized.split('/')
  if (parts.some(part => part === '' || part === '.' || part === '..')) return undefined
  return parts.join('/')
}

function decodeArchiveContent(value: string): Buffer | undefined {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return undefined
  return Buffer.from(value, 'base64')
}

function isExcluded(path: string, extra: readonly string[] = []): boolean {
  const normalized = path.toLowerCase()
  const segments = normalized.split('/')
  return [...DEFAULT_ARCHIVE_EXCLUDES, ...extra].some(pattern => {
    const candidate = pattern.toLowerCase().replaceAll('\\', '/').replace(/\/$/, '')
    return normalized === candidate
      || normalized.startsWith(candidate + '/')
      || segments.includes(candidate)
  })
}

function normalizeArchivePrefix(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
  if (normalized === '') return ''
  const safe = safeRelativePath(normalized)
  if (safe === undefined) throw new Error('RIN archive source prefix must be relative')
  return safe
}

function archivePath(prefix: string, relativePath: string): string {
  return prefix === '' ? relativePath : `${prefix}/${relativePath}`
}

function isPathWithin(parent: string, child: string): boolean {
  const relation = relative(resolve(parent), resolve(child))
  return relation === '' || (!relation.startsWith('..' + sep) && !isAbsolute(relation))
}

interface ArchiveSourceFile {
  path: string
  absolutePath: string
}

async function listArchiveSourceFiles(source: RinArchiveSource): Promise<ArchiveSourceFile[]> {
  const prefix = normalizeArchivePrefix(source.prefix)
  const includes = source.include === undefined
    ? undefined
    : new Set(source.include.map(value => value.replaceAll('\\', '/')))
  const files = await listFiles(source.root)
  return files
    .filter(relativePath => includes === undefined || includes.has(relativePath))
    .map(relativePath => ({
      path: archivePath(prefix, relativePath),
      absolutePath: join(source.root, relativePath),
    }))
}

function archiveTargetPath(path: string, options: RinArchiveOptions): string {
  const sources = (options.sources ?? [])
    .map(source => ({ source, prefix: normalizeArchivePrefix(source.prefix) }))
    .filter(({ prefix }) => prefix !== '' && (path === prefix || path.startsWith(prefix + '/')))
    .sort((left, right) => right.prefix.length - left.prefix.length)
  const match = sources[0]
  if (match === undefined) return join(options.root, path)
  const relativePath = path.slice(match.prefix.length).replace(/^\/+/, '')
  const targetPrefix = match.source.targetPrefix?.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '') ?? ''
  const targetRoot = match.source.targetRoot ?? match.source.root
  return join(targetRoot, targetPrefix === '' ? relativePath : join(targetPrefix, relativePath))
}

function archiveRoot(options: SessionBackupCoreOptions): string {
  return options.archiveRoot?.trim() === '' || options.archiveRoot === undefined
    ? dirname(options.backupsRoot)
    : options.archiveRoot
}

/** Export every session file into a gzipped archive buffer. */
export async function exportSessions(options: SessionBackupCoreOptions): Promise<Buffer> {
  const files = (await listFiles(options.sessionsRoot)).sort()
  if (files.length === 0) {
    const error = new Error('No sessions to export') as Error & { code?: string }
    error.code = 'NO_SESSIONS'
    throw error
  }
  const archive: SessionArchiveFile[] = []
  for (const rel of files) {
    const content = await readFile(join(options.sessionsRoot, rel))
    archive.push({ path: rel, content: content.toString('base64') })
  }
  const envelope: SessionArchiveEnvelope = { version: SESSION_ARCHIVE_VERSION, files: archive }
  return gzipSync(Buffer.from(JSON.stringify(envelope), 'utf-8'))
}

/** Restore an exported archive buffer into the session home. */
export async function importSessions(buffer: Buffer, options: SessionBackupCoreOptions): Promise<ImportSessionResult> {
  if (buffer.length > MAX_ARCHIVE_BYTES) {
    const error = new Error('Backup file too large') as Error & { code?: string }
    error.code = 'TOO_LARGE'
    throw error
  }
  let envelope: SessionArchiveEnvelope
  try {
    envelope = JSON.parse(gunzipSync(buffer).toString('utf-8')) as SessionArchiveEnvelope
  } catch (err) {
    const error = new Error(`Invalid backup file: ${err instanceof Error ? err.message : String(err)}`) as Error & { code?: string }
    error.code = 'BAD_BACKUP'
    throw error
  }
  if (envelope.version !== SESSION_ARCHIVE_VERSION || !Array.isArray(envelope.files)) {
    const error = new Error('Invalid backup file: unsupported version') as Error & { code?: string }
    error.code = 'BAD_BACKUP'
    throw error
  }

  const result: ImportSessionResult = { imported: 0, skipped: 0, sessions: [] }
  for (const file of envelope.files) {
    const candidate = file as Partial<SessionArchiveFile> | null
    const rel = typeof candidate?.path === 'string' ? safeRelativePath(candidate.path) : undefined
    const content = typeof candidate?.content === 'string' ? decodeArchiveContent(candidate.content) : undefined
    if (rel === undefined || content === undefined) { result.skipped++; continue }
    const target = join(options.sessionsRoot, rel)
    try {
      await stat(target)
      // Existing session file: skip rather than overwrite (no id remapping in this port).
      result.skipped++
      continue
    } catch {
      // target does not exist — fall through to write
    }
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
    result.imported++
    result.sessions.push({ sessionId: rel.split('/')[0] ?? rel, originalId: rel.split('/')[0] ?? rel })
  }
  return result
}

function validateArchiveEnvelope(value: unknown): RinArchiveEnvelope {
  if (value === null || typeof value !== 'object') throw new Error('Invalid RIN archive')
  const candidate = value as Partial<RinArchiveEnvelope>
  if (candidate.kind !== 'rin-archive' || candidate.version !== RIN_ARCHIVE_VERSION || candidate.root !== '.' || !Array.isArray(candidate.files)) {
    throw new Error('Invalid RIN archive: unsupported version')
  }
  for (const [index, file] of candidate.files.entries()) {
    const candidateFile = file as Partial<RinArchiveFile> | null
    if (candidateFile === null || typeof candidateFile !== 'object'
      || typeof candidateFile.path !== 'string' || typeof candidateFile.content !== 'string') {
      throw new Error('Invalid RIN archive: file entry ' + index + ' is malformed')
    }
    if (decodeArchiveContent(candidateFile.content) === undefined) {
      throw new Error('Invalid RIN archive: file entry ' + index + ' is not valid base64')
    }
  }
  return candidate as RinArchiveEnvelope
}

/** Export all portable files under the configured RIN archive root. */
export async function exportRinArchive(options: RinArchiveOptions): Promise<Buffer> {
  if (options.root.trim() === '') throw new Error('RIN archive root is required')
  await options.beforeExport?.()
  const sources: RinArchiveSource[] = [
    {
      root: options.root,
      prefix: '',
      ...(options.include === undefined ? {} : { include: options.include }),
    },
    ...(options.sources ?? []),
  ]
  const files: RinArchiveFile[] = []
  const seen = new Set<string>()
  let totalBytes = 0
  for (const source of sources) {
    for (const file of await listArchiveSourceFiles(source)) {
      if (isExcluded(file.path, options.exclude)) continue
      if (seen.has(file.path)) throw new Error('RIN archive source path collision: ' + file.path)
      seen.add(file.path)
      const content = await readFile(file.absolutePath)
      totalBytes += content.byteLength
      if (totalBytes > MAX_ARCHIVE_BYTES) throw new Error('RIN archive is too large')
      files.push({ path: file.path, content: content.toString('base64') })
    }
  }
  files.sort((left, right) => left.path.localeCompare(right.path))
  const envelope: RinArchiveEnvelope = {
    kind: 'rin-archive',
    version: RIN_ARCHIVE_VERSION,
    root: '.',
    createdAt: new Date().toISOString(),
    files,
  }
  const buffer = gzipSync(Buffer.from(JSON.stringify(envelope), 'utf-8'))
  if (buffer.length > MAX_ARCHIVE_BYTES) throw new Error('RIN archive is too large')
  return buffer
}

/** Import portable files into a RIN archive root without overwriting existing files. */
export async function importRinArchive(
  buffer: Buffer,
  options: RinArchiveOptions,
): Promise<RinArchiveImportResult> {
  if (buffer.length > MAX_ARCHIVE_BYTES) {
    const error = new Error('RIN archive is too large') as Error & { code?: string }
    error.code = 'TOO_LARGE'
    throw error
  }
  let envelope: RinArchiveEnvelope
  try {
    envelope = validateArchiveEnvelope(JSON.parse(gunzipSync(buffer).toString('utf-8')))
  } catch (err) {
    const error = new Error(`Invalid RIN archive: ${err instanceof Error ? err.message : String(err)}`) as Error & { code?: string }
    error.code = 'BAD_ARCHIVE'
    throw error
  }

  const result: RinArchiveImportResult = { imported: 0, skipped: 0, sessions: [], files: [] }
  for (const file of envelope.files) {
    const content = decodeArchiveContent(file.content)
    const path = safeRelativePath(file.path)
    if (path === undefined || content === undefined || isExcluded(path, options.exclude)) {
      result.skipped++
      continue
    }
    const target = archiveTargetPath(path, options)
    try {
      await stat(target)
      result.skipped++
      continue
    } catch {
      // The import is additive: existing user-owned files are never replaced.
    }
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
    result.imported++
    result.files.push(path)
    if (path.startsWith('dsh/sessions/')) {
      const sessionId = path.slice('dsh/sessions/'.length).split('/')[0] ?? path
      result.sessions.push({ sessionId, originalId: sessionId })
    }
  }
  return result
}

/** Run a complete RIN archive into the backups directory, pruning to maxKeep. */
export async function runBackup(options: SessionBackupCoreOptions, maxKeep: number): Promise<BackupListEntry> {
  const buffer = await exportRinArchive(buildRinArchiveOptions(options))
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

export async function restoreBackup(name: string, options: SessionBackupCoreOptions): Promise<RinArchiveImportResult> {
  if (!name.endsWith('.rinbackup.gz') || name.includes('..') || name.includes('/')) {
    throw new Error('Invalid backup name')
  }
  const buffer = await readFile(join(options.backupsRoot, name))
  return importRinArchive(buffer, buildRinArchiveOptions(options))
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
  await mkdir(dirname(settingsPath), { recursive: true })
  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8')
  return settings
}

export function defaultOptions(home = homedir()): SessionBackupCoreOptions {
  const rinRoot = process.env.RIN_HOME?.trim() || join(home, '.rin')
  const dshRoot = process.env.DSH_HOME?.trim() || join(rinRoot, 'dsh')
  const sessionsRoot = process.env.RIN_SESSION_ROOT?.trim() || join(dshRoot, 'sessions')
  return {
    sessionsRoot,
    backupsRoot: join(rinRoot, 'backups'),
    settingsPath: join(rinRoot, 'backup-settings.json'),
    archiveRoot: rinRoot,
    dshRoot,
    dshSettingsPath: process.env.RIN_SETTINGS_PATH?.trim() || join(dshRoot, 'settings.yaml'),

    credentialsPath: process.env.RIN_CREDENTIALS_PATH?.trim() || join(dshRoot, '.credentials.yaml'),
  }
}

export function buildRinArchiveOptions(options: SessionBackupCoreOptions): RinArchiveOptions {
  const exclude: string[] = []
  const root = archiveRoot(options)
  const sources: RinArchiveSource[] = []
  const dshRoot = options.dshRoot?.trim()
  const sessionsRoot = options.sessionsRoot.trim()

  if (dshRoot && !isPathWithin(root, dshRoot)) {
    sources.push({ root: dshRoot, prefix: 'dsh', targetRoot: dshRoot })
  }
  if (
    !isPathWithin(root, sessionsRoot)
    && !(dshRoot && isPathWithin(dshRoot, sessionsRoot))
  ) {
    sources.push({ root: sessionsRoot, prefix: 'dsh/sessions', targetRoot: sessionsRoot })
  }

  const settingsPath = options.dshSettingsPath?.trim()
  if (
    settingsPath
    && !isPathWithin(root, settingsPath)
    && !(dshRoot && isPathWithin(dshRoot, settingsPath))
  ) {
    sources.push({
      root: dirname(settingsPath),
      prefix: 'external/settings',
      include: [basename(settingsPath)],
      targetRoot: dirname(settingsPath),
    })
  }

  const credentialsPath = options.credentialsPath?.trim()
  if (credentialsPath !== undefined && credentialsPath !== '') {
    const relativeCredentialPath = isPathWithin(root, credentialsPath)
      ? relative(root, credentialsPath)
      : dshRoot !== undefined && isPathWithin(dshRoot, credentialsPath)
        ? archivePath('dsh', relative(dshRoot, credentialsPath))
        : undefined
    if (relativeCredentialPath !== undefined && relativeCredentialPath !== '') {
      exclude.push(relativeCredentialPath.split(sep).join('/'))
    }
  }

  return {
    root,
    sources,
    ...(exclude.length === 0 ? {} : { exclude }),
    ...(options.beforeArchive === undefined ? {} : { beforeExport: options.beforeArchive }),
  }
}
