/**
 * rin filesystem — path-contained directory browsing core.
 *
 * Lists a directory (directories first, then files when requested), filtering
 * dot-entries, with an optional filename search. Every resolved path must stay
 * under the host home or the system temp directory (and /private/tmp on macOS),
 * mirroring the legacy desktop filesystem containment. Cordis-free: node: builtins
 * only.
 *
 * @module @rin/workspace/filesystem
 */

import { readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'

export interface DirEntry {
  name: string
  path: string
  isDirectory: boolean
}

export interface BrowseResult {
  currentPath: string
  parentPath: string
  entries: DirEntry[]
  query?: string
}

export interface BrowseInput {
  path?: string
  includeFiles?: boolean
  search?: string
  maxResults?: number
}

function isWithinRoot(target: string, root: string): boolean {
  return target === root || target.startsWith(root + sep)
}

function isAllowedPath(target: string): boolean {
  const resolved = resolve(target)
  const home = resolve(homedir())
  if (isWithinRoot(resolved, home) || isWithinRoot(resolved, '/tmp')) return true
  if (process.platform === 'darwin' && isWithinRoot(resolved, '/private/tmp')) return true
  return false
}

/**
 * Resolve and validate one path, returning the absolute resolved path.
 * @param target - the path to validate.
 * @returns the resolved absolute path.
 */
export function assertAllowedPath(target: string): string {
  const resolved = resolve(target)
  if (!isAllowedPath(resolved)) throw new Error('Access denied: path outside allowed directory')
  return resolved
}

/** List one directory with containment, or throw on access/IO failure. */
export function browseDirectory(input: BrowseInput = {}): BrowseResult {
  const targetPath = input.path && input.path.trim() !== '' ? input.path : homedir()
  const resolved = assertAllowedPath(targetPath)

  const stat = statSync(resolved)
  if (!stat.isDirectory()) throw new Error('Not a directory')

  const entries = readdirSync(resolved, { withFileTypes: true })
  const search = input.search?.trim()
  const includeFiles = input.includeFiles === true
  const maxResults = Math.min(Math.max(Math.trunc(input.maxResults ?? 200), 1), 200)

  let filtered = entries.filter((entry) => {
    if (entry.name.startsWith('.')) return false
    if (entry.isDirectory()) return search ? entry.name.toLowerCase().includes(search.toLowerCase()) : true
    return includeFiles && (search ? entry.name.toLowerCase().includes(search.toLowerCase()) : true)
  })

  if (search) filtered = filtered.slice(0, maxResults)

  const mapped: DirEntry[] = filtered
    .map((entry) => ({ name: entry.name, path: join(resolved, entry.name), isDirectory: entry.isDirectory() }))
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })

  return {
    currentPath: resolved,
    parentPath: dirname(resolved),
    entries: mapped,
    ...(search ? { query: search } : {}),
  }
}
