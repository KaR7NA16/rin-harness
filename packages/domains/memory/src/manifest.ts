import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { MemoryManifest, MemoryProjectionDescriptor, MemoryStorageManifest } from './types.ts'
import { MEMORY_SCHEMA_VERSION } from './types.ts'

const PROJECTIONS: MemoryProjectionDescriptor[] = [
  {
    id: 'canonical',
    owner: '@rin/memory',
    role: 'canonical',
    path: 'memory/memory.db',
    rebuildable: false,
    modelVisible: false,
  },
  {
    id: 'prompt-memory',
    owner: '@rin/memory/prompt',
    role: 'projection',
    path: 'prompt-memory',
    rebuildable: true,
    modelVisible: true,
  },
  {
    id: 'notes',
    owner: '@rin/notes',
    role: 'source',
    path: 'notes',
    rebuildable: false,
    modelVisible: true,
  },
  {
    id: 'knowledge',
    owner: '@rin/knowledge',
    role: 'derived',
    path: 'knowledge/knowledge.db',
    rebuildable: true,
    modelVisible: true,
  },
  {
    id: 'session-search',
    owner: '@rin/memory/session-search',
    role: 'derived',
    path: 'session-search',
    rebuildable: true,
    modelVisible: true,
  },
  {
    id: 'session',
    owner: '@deepseek-ai/dsh-session-persistence-jsonl',
    role: 'source',
    path: 'dsh/sessions',
    rebuildable: false,
    modelVisible: true,
  },
]

const DEFAULT_STORAGE: MemoryStorageManifest = {
  sessionRoot: 'dsh/sessions',
  settingsPath: 'dsh/settings.yaml',
  credentialsPath: 'dsh/.credentials.yaml',
  archiveRoot: '.',
  credentialsExcludedByDefault: true,
}

function toPortablePath(
  value: string | undefined,
  homeRoot: string,
  fallback: string,
  externalPath: string,
): string {
  if (value === undefined || value.trim() === '') return fallback
  const trimmed = value.trim()
  if (!isAbsolute(trimmed)) return trimmed.replaceAll('\\', '/')
  const relativePath = relative(resolve(homeRoot), resolve(trimmed))
  if (relativePath === '') return '.'
  if (relativePath === '..' || relativePath.startsWith('..' + sep) || isAbsolute(relativePath)) {
    return externalPath
  }
  return relativePath.split(sep).join('/')
}

export interface MemoryStorageConfig {
  sessionRoot?: string | undefined
  settingsPath?: string | undefined
  credentialsPath?: string | undefined
  archiveRoot?: string | undefined
}

export function normalizeMemoryStorage(
  homeRoot: string,
  storage: MemoryStorageConfig = {},
): MemoryStorageManifest {
  if (homeRoot.trim() === '') throw new Error('rin memory: homeRoot must not be empty')
  const settingsPath = storage.settingsPath?.trim() || undefined
  const credentialsPath = storage.credentialsPath?.trim() || undefined
  return {
    sessionRoot: toPortablePath(storage.sessionRoot, homeRoot, 'dsh/sessions', 'dsh/sessions'),
    settingsPath: toPortablePath(
      settingsPath,
      homeRoot,
      'dsh/settings.yaml',
      'external/settings/' + basename(settingsPath ?? 'settings.yaml'),
    ),
    credentialsPath: toPortablePath(
      credentialsPath,
      homeRoot,
      'dsh/.credentials.yaml',
      'external/credentials/' + basename(credentialsPath ?? '.credentials.yaml'),
    ),
    archiveRoot: toPortablePath(storage.archiveRoot, homeRoot, '.', 'external/archive'),
    credentialsExcludedByDefault: true,
  }
}

export function buildMemoryManifest(
  now = new Date().toISOString(),
  storage: MemoryStorageManifest = DEFAULT_STORAGE,
): MemoryManifest {
  return {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    generatedAt: now,
    root: '.',
    canonical: {
      database: 'memory/memory.db',
      manifest: 'memory/manifest.json',
    },
    storage: { ...storage },
    projections: PROJECTIONS.map(projection => projection.id === 'session'
      ? { ...projection, path: storage.sessionRoot }
      : { ...projection }),
    archive: {
      format: 'rin-archive',
      version: 2,
      secretsExcludedByDefault: true,
      externalSourcesCopied: true,
    },
  }
}

export function writeMemoryManifestSync(path: string, manifest = buildMemoryManifest()): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
}

export function readMemoryManifest(path: string): MemoryManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as MemoryManifest
}
