/** Run publint over the exact manifest-declared publication view of every package. */

import {
  globSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs'
import { availableParallelism } from 'node:os'
import { dirname, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { publint, type Message, type PackFile } from 'publint'
import { formatMessage } from 'publint/utils'
import { isEntry } from './release/process.ts'

const CONCURRENCY_ENV = 'DSH_PUBLINT_CONCURRENCY'
const repositoryRoot = resolve(import.meta.dirname, '..')

/** Manifest globs the repository's npm publication view covers: dsh packages plus rin library packages. */
const WORKSPACE_GLOBS = ['packages/*/*/package.json', 'rin/*/*/package.json'] as const

/** rin product-layer packages (desktop shell and web UI) publish no npm entry points. */
const RIN_PRODUCT_LAYER = new Set(['rin/gui/gui', 'rin/web/web-ui'])

interface PackageTarget {
  path: string
  directory: string
  manifest: PackageManifest
}

interface PackageManifest {
  name?: string
  files?: unknown
}

type PublintResult =
  | { path: string; status: 'passed'; messages: Message[]; manifest: Record<string, unknown> }
  | { path: string; status: 'failed'; messages: Message[]; manifest: Record<string, unknown>; failure?: string }

/**
 * Discover publish targets matching the given manifest globs, skipping the rin
 * product layer.
 * @param packagesRoot - repository root the globs resolve against.
 * @param patterns - manifest globs, relative to the root.
 * @returns Targets sorted by manifest path.
 */
function discoverTargets(packagesRoot: string, patterns: readonly string[]): PackageTarget[] {
  return globSync([...patterns], { cwd: packagesRoot })
    .sort()
    .map((manifestPath) => {
      const normalized = manifestPath.split(sep).join('/')
      const absoluteManifestPath = resolve(packagesRoot, manifestPath)
      const manifest = JSON.parse(readFileSync(absoluteManifestPath, 'utf8')) as PackageManifest
      return { path: dirname(normalized), directory: dirname(absoluteManifestPath), manifest }
    })
    .filter(target => !RIN_PRODUCT_LAYER.has(target.path))
}

/** Every npm-publishable workspace package: dsh packages plus rin library packages. */
function workspacePackages(packagesRoot: string): PackageTarget[] {
  return discoverTargets(packagesRoot, WORKSPACE_GLOBS)
}

/** The @rin/* library packages only, for the rin publish gate. */
export function rinWorkspacePackages(repoRoot: string): PackageTarget[] {
  return discoverTargets(repoRoot, ['rin/*/*/package.json'])
}

function publintConcurrency(total: number): number {
  if (total === 0) return 0

  const raw = process.env[CONCURRENCY_ENV]
  if (raw !== undefined && raw !== '') {
    const parsed = Number.parseInt(raw, 10)
    if (!Number.isSafeInteger(parsed) || parsed < 1 || String(parsed) !== raw) {
      throw new Error(`publint-all: ${CONCURRENCY_ENV} must be a positive integer, got ${JSON.stringify(raw)}.`)
    }
    return Math.min(total, parsed)
  }

  return Math.min(total, availableParallelism())
}

function publicationFiles(target: PackageTarget): PackFile[] {
  const paths = new Set<string>()
  addPath(resolve(target.directory, 'package.json'), paths)
  const declared = Array.isArray(target.manifest.files)
    ? target.manifest.files.filter((value): value is string => typeof value === 'string')
    : []
  for (const pattern of [
    ...declared,
    'README*',
    'LICENSE*',
    'LICENCE*',
    'CHANGELOG*',
    'CHANGES*',
    'HISTORY*',
    'NOTICE*',
  ]) {
    for (const match of globSync(pattern, { cwd: target.directory })) {
      addPath(resolve(target.directory, match), paths)
    }
  }

  return [...paths]
    .sort()
    .map(path => ({
      name: `package/${relative(target.directory, path).split(sep).join('/')}`,
      data: readFileSync(path),
    }))
}

function addPath(path: string, paths: Set<string>): void {
  const stat = statSync(path)
  if (stat.isDirectory()) {
    // readdirSync, not globSync: `**/*` skips dot-prefixed segments, but npm
    // pack publishes dotfiles inside included directories, and this view must
    // match what npm publishes.
    for (const entry of readdirSync(path, { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) paths.add(resolve(entry.parentPath, entry.name))
    }
  } else if (stat.isFile()) {
    paths.add(path)
  }
}

async function runPublint(target: PackageTarget): Promise<PublintResult> {
  try {
    const result = await publint({
      pkgDir: 'package',
      pack: { files: publicationFiles(target) },
    })
    const manifest = result.pkg as Record<string, unknown>
    return result.messages.some(message => message.type === 'error')
      ? { path: target.path, status: 'failed', messages: result.messages, manifest }
      : { path: target.path, status: 'passed', messages: result.messages, manifest }
  } catch (error: unknown) {
    return {
      path: target.path,
      status: 'failed',
      messages: [],
      manifest: target.manifest as Record<string, unknown>,
      failure: error instanceof Error ? error.message : String(error),
    }
  }
}

async function runAll(targets: PackageTarget[], concurrency: number): Promise<PublintResult[]> {
  let next = 0
  const results: Array<PublintResult | undefined> = []
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (;;) {
      const index = next
      next += 1
      const target = targets[index]
      if (target === undefined) return
      results[index] = await runPublint(target)
    }
  }))

  return targets.map((target, index) => {
    const result = results[index]
    if (result === undefined) throw new Error(`publint-all: missing result for ${target.path}.`)
    return result
  })
}

/**
 * Run publint over the given targets, sized to the available parallelism.
 * @param targets - the packages to lint.
 * @returns One result per target, in input order.
 */
export async function publintTargets(targets: PackageTarget[]): Promise<PublintResult[]> {
  const concurrency = publintConcurrency(targets.length)
  console.log(`publint-all: linting ${targets.length} package(s) with ${concurrency} worker(s).`)
  return runAll(targets, concurrency)
}

export function printResult(result: PublintResult): void {
  console.log(`Running publint for ${result.path}...`)
  if ('failure' in result) console.error(result.failure)
  for (const message of result.messages) {
    console.log(formatMessage(message, result.manifest, { color: false }) ?? message.code)
  }
  if (result.status === 'passed' && result.messages.length === 0) console.log('All good!')
}

if (isEntry(import.meta.url)) {
  const { values: options } = parseArgs({
    args: process.argv.slice(2),
    options: { 'packages-root': { type: 'string' } },
  })
  const packagesRoot = resolve(options['packages-root'] ?? repositoryRoot)
  const results = await publintTargets(workspacePackages(packagesRoot))
  for (const result of results) printResult(result)
  if (results.some(result => result.status === 'failed')) process.exit(1)
}
