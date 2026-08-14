import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parse, stringify } from 'yaml'

type SeedState = {
  version: 1
  seedRoot: string
  updatedAt: string
  files: Record<string, string>
}

export type WorkingRepositoryResult = {
  status: 'development' | 'initialized' | 'upgraded'
  workingRoot: string
  copiedFiles: string[]
  updatedFiles: string[]
  preservedLocalFiles: string[]
  staleSeedFiles: string[]
}

type InitializeWorkingRepositoryOptions = {
  seedRoot: string
  workingRoot: string
  statePath: string
}

const EXCLUDED_DIRECTORIES = new Set(['.codegraph', '.git', 'node_modules'])

/** Seed a working repository from a seed root, preserving local edits via hash sync. */
export async function initializeWorkingRepository(
  options: InitializeWorkingRepositoryOptions,
): Promise<WorkingRepositoryResult> {
  const seedRoot = resolve(options.seedRoot)
  const workingRoot = resolve(options.workingRoot)
  const statePath = resolve(options.statePath)
  if (samePath(seedRoot, workingRoot)) return emptyResult('development', workingRoot)
  if (!existsSync(seedRoot)) throw new Error('Repository seed directory not found: ' + seedRoot)

  const previousState = await readState(statePath)
  const seedFiles = await scanFiles(seedRoot)
  const seedHashes = Object.fromEntries(await Promise.all(seedFiles.map(async path => [
    path,
    await hashFile(resolveChild(seedRoot, path)),
  ])))
  const result = emptyResult(previousState ? 'upgraded' : 'initialized', workingRoot)
  await mkdir(workingRoot, { recursive: true })

  for (const relativePath of seedFiles) {
    const source = resolveChild(seedRoot, relativePath)
    const destination = resolveChild(workingRoot, relativePath)
    const newSeedHash = seedHashes[relativePath]!
    if (!existsSync(destination)) {
      await copy(source, destination)
      result.copiedFiles.push(relativePath)
      continue
    }

    const currentHash = await hashFile(destination)
    const previousSeedHash = previousState?.files[relativePath]
    if (currentHash === newSeedHash) continue
    if (previousSeedHash && currentHash === previousSeedHash) {
      await copy(source, destination)
      result.updatedFiles.push(relativePath)
      continue
    }
    result.preservedLocalFiles.push(relativePath)
  }

  result.staleSeedFiles = previousState
    ? Object.keys(previousState.files).filter(path => !(path in seedHashes)).sort()
    : []
  const state: SeedState = {
    version: 1,
    seedRoot,
    updatedAt: new Date().toISOString(),
    files: seedHashes,
  }
  await mkdir(dirname(statePath), { recursive: true })
  await writeFile(statePath, stringify(state), 'utf8')
  return result
}

async function scanFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue
    const absolutePath = join(current, entry.name)
    if (entry.isDirectory()) files.push(...await scanFiles(root, absolutePath))
    if (entry.isFile()) files.push(relative(root, absolutePath).split(sep).join('/'))
  }
  return files
}

async function readState(path: string): Promise<SeedState | null> {
  if (!existsSync(path)) return null
  const raw = parse(await readFile(path, 'utf8')) as Partial<SeedState>
  if (raw.version !== 1 || !raw.files || typeof raw.files !== 'object') return null
  return raw as SeedState
}

async function hashFile(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function copy(source: string, destination: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true })
  await copyFile(source, destination)
}

function resolveChild(root: string, child: string): string {
  const path = resolve(root, child)
  const relation = relative(root, path)
  if (!relation || (!relation.startsWith('..') && !isAbsolute(relation))) return path
  throw new Error('Repository seed path escapes its root: ' + child)
}

function emptyResult(status: WorkingRepositoryResult['status'], workingRoot: string): WorkingRepositoryResult {
  return { status, workingRoot, copiedFiles: [], updatedFiles: [], preservedLocalFiles: [], staleSeedFiles: [] }
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}
