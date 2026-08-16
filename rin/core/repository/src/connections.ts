/**
 * rin repository — connection registry.
 *
 * File-backed registry of connected asset repositories (id/name/rootPath),
 * ported from the legacy desktop repositoryService connection management and
 * re-encoded as JSON (the legacy store was YAML). Hydration reads each root via
 * {@link readAssetRepository}; the write-side manifest helpers (updateManifest /
 * install-plan environment provisioning) are not ported here. Cordis-free.
 *
 * @module @rin/repository
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import { readAssetRepository } from './reader.ts'
import {
  ASSET_REPOSITORY_API_VERSION,
  ASSET_REPOSITORY_MANIFEST_FILENAME,
  type EnvironmentPackage,
  type EnvironmentProfile,
} from './types.ts'

/** One connected repository as returned to the web layer. */
export interface RepositoryConnection {
  id: string
  name: string
  rootPath: string
  createdAt: string
  updatedAt: string
  environmentPackages: EnvironmentPackage[]
  environmentProfiles: EnvironmentProfile[]
}

interface RegistryEntry {
  id: string
  name: string
  rootPath: string
  createdAt: string
  updatedAt: string
}

interface Registry {
  version: 1
  repositories: RegistryEntry[]
}

/** Resolve the connection registry path under a config home. */
export function connectionStorePath(home: string): string {
  return join(home, 'repositories.json')
}

async function loadRegistry(path: string): Promise<RegistryEntry[]> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf-8')) as Partial<Registry>
    return Array.isArray(parsed.repositories) ? parsed.repositories : []
  } catch {
    return []
  }
}

async function saveRegistry(path: string, entries: RegistryEntry[]): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, JSON.stringify({ version: 1, repositories: entries }, null, 2) + '\n', 'utf-8')
}

/** Read one entry's repository and attach its environment data. */
async function hydrate(entry: RegistryEntry): Promise<RepositoryConnection> {
  try {
    const repository = await readAssetRepository(entry.rootPath)
    return {
      ...entry,
      name: repository.manifest.metadata.name,
      environmentPackages: repository.environmentPackages,
      environmentProfiles: repository.environmentProfiles,
    }
  } catch {
    return { ...entry, environmentPackages: [], environmentProfiles: [] }
  }
}

/** List every connected repository, hydrated. */
export async function listConnections(path: string): Promise<RepositoryConnection[]> {
  const entries = await loadRegistry(path)
  return Promise.all(entries.map(hydrate))
}

/** Read one connected repository by id, or undefined when unknown. */
export async function getConnection(path: string, id: string): Promise<RepositoryConnection | undefined> {
  const entry = (await loadRegistry(path)).find(item => item.id === id)
  return entry === undefined ? undefined : hydrate(entry)
}

/** Connect an existing asset repository directory (it must already carry a manifest). */
export async function connectRepository(path: string, rootPath: string, name?: string): Promise<RepositoryConnection> {
  const root = resolve(rootPath.trim())
  const repository = await readAssetRepository(root)
  const entries = await loadRegistry(path)
  const existing = entries.find(item => item.rootPath === root)
  const now = new Date().toISOString()
  const entry: RegistryEntry = existing === undefined
    ? { id: randomUUID().slice(0, 12), name: name?.trim() || repository.manifest.metadata.name, rootPath: root, createdAt: now, updatedAt: now }
    : { ...existing, name: name?.trim() || existing.name, updatedAt: now }
  await saveRegistry(path, existing === undefined ? [...entries, entry] : entries.map(item => item.id === existing.id ? entry : item))
  return hydrate(entry)
}

/** Create a new repository directory with a minimal manifest, then connect it. */
export async function createRepository(path: string, parentDir: string, name: string): Promise<RepositoryConnection> {
  const trimmed = name.trim()
  if (trimmed === '' || trimmed === '.' || trimmed === '..' || trimmed.includes('/') || trimmed.includes('\\')) {
    throw new Error('Repository name must be a single directory name')
  }
  const root = join(resolve(parentDir.trim()), trimmed)
  await mkdir(root, { recursive: true })
  const manifest = {
    apiVersion: ASSET_REPOSITORY_API_VERSION,
    kind: 'AssetRepository',
    metadata: { id: randomUUID().slice(0, 12), name: trimmed, version: '1.0.0' },
    spec: { mutable: true, roots: {} },
  }
  await writeFile(join(root, ASSET_REPOSITORY_MANIFEST_FILENAME), stringifyYaml(manifest), 'utf-8')
  return connectRepository(path, root, trimmed)
}

/** Remove one repository from the registry; returns true when it was removed. */
export async function disconnectRepository(path: string, id: string): Promise<boolean> {
  const entries = await loadRegistry(path)
  const next = entries.filter(item => item.id !== id)
  if (next.length === entries.length) return false
  await saveRegistry(path, next)
  return true
}
