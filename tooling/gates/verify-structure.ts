/**
 * Verify the per-package structural invariants that make a workspace package
 * a first-class member of the repository solution:
 *   - package.json: `name` starts with @rin/, `type: module`, and `private`
 *     only on the non-published product layer (gui/web-ui);
 *   - package.json: `main`/`exports["."].default`/`bin` resolve under the
 *     tsconfig `outDir` and `files` ships that `outDir`;
 *   - tsconfig.json: `extends` the shared base, references stay inside a
 *     workspace root (`apps/` or `packages/`), and
 *     package.json declares @deepseek-ai/cordis for executable Cordis plugins;
 *   - src/: no compiled artifacts (.js/.mjs/.cjs/.js.map/.d.ts.map, or a .d.ts
 *     emitted beside its .ts source) — the leak that re-imports built output
 *     into the source plane.
 */

// This gate also owns workspace census and solution-reference completeness.
import { existsSync, globSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '../..')
const BASE_TSCONFIG = resolve(repoRoot, 'tsconfig.base.json')
const SOLUTION_TSCONFIG = resolve(repoRoot, 'tsconfig.json')
const WORKSPACE_ROOTS = ['apps', 'packages'] as const
const PACKAGE_MANIFEST_GLOBS = [
  'apps/*/package.json',
  'packages/*/*/package.json',
] as const

/** Product-layer packages with independent Vite/Tauri tsconfig, not host aggregate members. */
const PRODUCT_LAYER_GROUPS = new Set([
  'apps/desktop',
  'apps/web',
])

/** Packages that are applications or framework-neutral leaves, not Cordis plugins. */
const NON_CORDIS_PACKAGES = new Set(['apps/cli', 'packages/runtime/contracts'])

const LEGACY_REPOSITORY_ENTRIES = [
  'rin',
  'coverage',
  'MIGRATION.md',
  '.github/workflows/rin.yml',
] as const

if (import.meta.main) {
  process.exitCode = main()
}

function main(): number {
  const manifests = globSync([...PACKAGE_MANIFEST_GLOBS], { cwd: repoRoot }).sort()
  const failures = validateRepositoryEntrypoints()
  failures.push(...validateSolutionReferences(manifests))
  failures.push(...validatePathAliases(manifests))
  for (const manifestPath of manifests) {
    failures.push(...validatePackage(resolve(repoRoot, manifestPath)))
  }
  if (failures.length > 0) {
    console.error('verify-structure: violations found:')
    for (const failure of failures) console.error(`  ${failure}`)
    return 1
  }
  console.log(`verify-structure: ${manifests.length} workspace packages conform.`)
  return 0
}

/** Verify the root TypeScript solution includes every workspace package exactly once. */
function validateSolutionReferences(manifests: string[]): string[] {
  const failures: string[] = []
  if (!existsSync(SOLUTION_TSCONFIG)) return ['tsconfig.json: root solution is missing']

  const solution = readJson(SOLUTION_TSCONFIG) as { references?: unknown }
  const references = Array.isArray(solution.references) ? solution.references : []
  const slash = String.fromCharCode(92)
  const packages = new Set(manifests.map(path => dirname(path).replaceAll(slash, '/')))
  const referenced = new Set<string>()

  for (const reference of references) {
    if (!isRecord(reference) || typeof reference.path !== 'string') {
      failures.push('tsconfig.json: every reference must contain a string path')
      continue
    }
    const path = relative(repoRoot, resolve(repoRoot, reference.path)).replaceAll(slash, '/')
    if (referenced.has(path)) failures.push('tsconfig.json: duplicate reference ' + path)
    referenced.add(path)
    if (!packages.has(path)) failures.push('tsconfig.json: reference is not a workspace package: ' + path)
  }

  for (const path of packages) {
    if (!referenced.has(path)) failures.push('tsconfig.json: workspace package is missing from references: ' + path)
  }
  return failures
}

/** Verify every workspace package has exactly one canonical source alias. */
function validatePathAliases(manifests: string[]): string[] {
  const failures: string[] = []
  const base = readJson(BASE_TSCONFIG) as { compilerOptions?: unknown }
  const compilerOptions = isRecord(base.compilerOptions) ? base.compilerOptions : {}
  const paths = isRecord(compilerOptions.paths) ? compilerOptions.paths : {}
  const expected = new Map<string, string>()

  for (const manifestPath of manifests) {
    const manifest = readJson(resolve(repoRoot, manifestPath)) as { name?: unknown }
    if (typeof manifest.name !== 'string') continue
    const packagePath = dirname(manifestPath).replaceAll('\\', '/')
    expected.set(manifest.name, `./${packagePath}/src`)
    if (isRecord(manifest.exports)) {
      for (const [key, value] of Object.entries(manifest.exports)) {
        if (key === '.' || !key.startsWith('./') || !isRecord(value)) continue
        const entry = typeof value.types === 'string' ? value.types : value.default
        if (typeof entry !== 'string' || !entry.startsWith('./lib/types/')) continue
        const relativeEntry = entry
          .slice('./lib/types/'.length)
          .replace(/(?:\.d\.ts|\.js)$/u, '')
          .replace(/\/index$/u, '')
        expected.set(
          manifest.name + '/' + key.slice(2),
          `./${packagePath}/src/${relativeEntry}`,
        )
      }
    }
  }

  for (const [name, sourcePath] of expected) {
    const actual = paths[name]
    if (!Array.isArray(actual) || actual.length !== 1 || actual[0] !== sourcePath) {
      failures.push(`tsconfig.base.json: paths.${name} must equal [${JSON.stringify(sourcePath)}]`)
    }
  }
  for (const name of Object.keys(paths)) {
    if (!expected.has(name)) failures.push(`tsconfig.base.json: stale path alias ${name}`)
  }
  return failures
}

/** Verify the repository-level agent entry points remain portable and resolvable. */
function validateRepositoryEntrypoints(): string[] {
  const failures: string[] = []
  for (const legacyPath of LEGACY_REPOSITORY_ENTRIES) {
    if (existsSync(resolve(repoRoot, legacyPath))) {
      failures.push(`${legacyPath}: legacy repository entry must be absent after the root migration`)
    }
  }

  const claudeInstructionsPath = resolve(repoRoot, 'CLAUDE.md')
  if (!existsSync(claudeInstructionsPath)) {
    failures.push('CLAUDE.md: compatibility entry point is missing')
  } else if (!readFileSync(claudeInstructionsPath, 'utf8').includes('[AGENTS.md](AGENTS.md)')) {
    failures.push('CLAUDE.md: must direct readers to [AGENTS.md](AGENTS.md)')
  }

  const skillsPath = resolve(repoRoot, '.claude', 'skills')
  if (existsSync(skillsPath) && !lstatSync(skillsPath).isDirectory()) {
    failures.push('.claude/skills: must be a directory when project-local Claude skills are present')
  }
  return failures
}

function validatePackage(manifestPath: string): string[] {
  const dir = dirname(manifestPath)
  const rel = relative(repoRoot, dir).replaceAll('\\', '/')
  const failures: string[] = []

  const manifest = readJson(manifestPath) as {
    name?: unknown
    private?: unknown
    type?: unknown
    dependencies?: unknown
    peerDependencies?: unknown
  }
  if (typeof manifest.name !== 'string' || !manifest.name.startsWith('@rin/')) {
    failures.push(`${rel}/package.json: name must start with @rin/ (got ${JSON.stringify(manifest.name)})`)
  }
  if (!PRODUCT_LAYER_GROUPS.has(rel) && manifest.private === true) {
    failures.push(`${rel}/package.json: private must be false or omitted (host packages publish to npm)`)
  }
  if (manifest.type !== 'module') {
    failures.push(`${rel}/package.json: type must be "module"`)
  }
  if (!PRODUCT_LAYER_GROUPS.has(rel) && !NON_CORDIS_PACKAGES.has(rel)) {
    const dependencies = isRecord(manifest.dependencies) ? manifest.dependencies : {}
    const peers = isRecord(manifest.peerDependencies) ? manifest.peerDependencies : {}
    if (typeof dependencies['@deepseek-ai/cordis'] !== 'string' && typeof peers['@deepseek-ai/cordis'] !== 'string') {
      failures.push(`${rel}/package.json: dependencies or peerDependencies must declare @deepseek-ai/cordis (executable packages are Cordis plugins)`)
    }
  }

  if (PRODUCT_LAYER_GROUPS.has(rel)) {
    // Product-layer packages carry their own Vite/Tauri tsconfig (not a host
    // aggregate member), so the host-package tsconfig rules do not apply.
    failures.push(...validateSrcArtifacts(rel, dir))
    return failures
  }
  failures.push(...validateTsconfig(rel, dir))
  failures.push(...validateManifestEntries(rel, dir))
  failures.push(...validateSrcArtifacts(rel, dir))
  return failures
}

function validateTsconfig(rel: string, dir: string): string[] {
  const tsconfigPath = join(dir, 'tsconfig.json')
  if (!existsSync(tsconfigPath)) return [`${rel}: missing tsconfig.json`]

  const tsconfig = readJson(tsconfigPath) as { extends?: unknown; references?: unknown }
  const failures: string[] = []
  if (typeof tsconfig.extends !== 'string' || resolve(dir, tsconfig.extends) !== BASE_TSCONFIG) {
    failures.push(`${rel}/tsconfig.json: must extend tsconfig.base.json (got ${JSON.stringify(tsconfig.extends ?? null)})`)
  }
  const references = Array.isArray(tsconfig.references) ? tsconfig.references : []
  for (const reference of references) {
    if (!isRecord(reference) || typeof reference.path !== 'string') continue
    const resolved = resolve(dir, reference.path).replaceAll('\\', '/')
    const relativePath = relative(repoRoot, resolved).replaceAll('\\', '/')
    const staysInsideWorkspace = WORKSPACE_ROOTS.some(root => (
      relativePath === root || relativePath.startsWith(`${root}/`)
    ))
    if (!staysInsideWorkspace) {
      failures.push(`${rel}/tsconfig.json: references must stay inside apps/ or packages/ (got ${reference.path})`)
    }
  }
  return failures
}

function validateManifestEntries(rel: string, dir: string): string[] {
  const tsconfigPath = join(dir, 'tsconfig.json')
  if (!existsSync(tsconfigPath)) return []
  const tsconfig = readJson(tsconfigPath) as { compilerOptions?: unknown }
  const outDir = readOutDir(tsconfig)
  if (outDir === undefined) {
    return [`${rel}/tsconfig.json: compilerOptions.outDir must be a non-empty string for manifest entries to resolve`]
  }

  const manifest = readJson(join(dir, 'package.json')) as {
    main?: unknown
    exports?: unknown
    bin?: unknown
    files?: unknown
  }
  const failures: string[] = []

  if (typeof manifest.main !== 'string' || !isBuildEntry(manifest.main, outDir, false)) {
    failures.push(`${rel}/package.json: main must point under ${outDir}/ and end in .js (got ${JSON.stringify(manifest.main)})`)
  }

  const dot = readExportsDot(manifest.exports)
  if (dot === undefined || typeof dot.default !== 'string' || !isBuildEntry(dot.default, outDir, true)) {
    failures.push(`${rel}/package.json: exports["."].default must point under ./${outDir}/ and end in .js (got ${JSON.stringify(dot?.default ?? null)})`)
  }
  if (dot === undefined || typeof dot.types !== 'string' || !isBuildEntry(dot.types, outDir, true, '.d.ts')) {
    failures.push(`${rel}/package.json: exports["."].types must point under ./${outDir}/ and end in .d.ts (got ${JSON.stringify(dot?.types ?? null)})`)
  }

  if (manifest.bin !== undefined) {
    if (typeof manifest.bin === 'string') {
      if (!isBuildEntry(manifest.bin, outDir, false)) {
        failures.push(`${rel}/package.json: bin must point under ${outDir}/ and end in .js (got ${JSON.stringify(manifest.bin)})`)
      }
    } else if (isRecord(manifest.bin)) {
      for (const [binName, binPath] of Object.entries(manifest.bin)) {
        if (typeof binPath !== 'string' || !isBuildEntry(binPath, outDir, false)) {
          failures.push(`${rel}/package.json: bin.${binName} must point under ${outDir}/ and end in .js (got ${JSON.stringify(binPath)})`)
        }
      }
    } else {
      failures.push(`${rel}/package.json: bin must be a string or an object of string paths (got ${JSON.stringify(manifest.bin)})`)
    }
  }

  if (!Array.isArray(manifest.files) || !manifest.files.includes(`${outDir}/**/*`)) {
    failures.push(`${rel}/package.json: files must include "${outDir}/**/*" to ship compiled .js and .d.ts (got ${JSON.stringify(manifest.files)})`)
  }

  return failures
}

/** Read the `"."` subpath object from an exports field, when present. */
function readExportsDot(exportsValue: unknown): Record<string, unknown> | undefined {
  if (!isRecord(exportsValue)) return undefined
  const dot = exportsValue['.']
  return isRecord(dot) ? dot : undefined
}

/** Read compilerOptions.outDir as a non-empty string, when present. */
function readOutDir(tsconfig: { compilerOptions?: unknown }): string | undefined {
  if (!isRecord(tsconfig.compilerOptions)) return undefined
  const outDir = tsconfig.compilerOptions.outDir
  return typeof outDir === 'string' && outDir.trim() !== '' ? outDir.trim() : undefined
}

/**
 * Whether a manifest entry path resolves under the package outDir and carries
 * the expected extension.
 * @param entryPath - the declared path (e.g. `lib/types/index.js`).
 * @param outDir - the tsconfig compilerOptions.outDir (e.g. `lib/types`).
 * @param dotPrefixed - whether the path is `./`-prefixed (exports entries are).
 * @param extension - the required file extension (default `.js`).
 */
function isBuildEntry(entryPath: string, outDir: string, dotPrefixed: boolean, extension = '.js'): boolean {
  const prefix = dotPrefixed ? `./${outDir}/` : `${outDir}/`
  return entryPath.startsWith(prefix) && entryPath.endsWith(extension)
}

function validateSrcArtifacts(rel: string, dir: string): string[] {
  const srcDir = join(dir, 'src')
  if (!existsSync(srcDir)) return []

  const failures: string[] = []
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (isCompiledArtifact(current, entry.name)) {
        failures.push(`${rel}/src/${relative(srcDir, full).replaceAll('\\', '/')}: compiled artifact must not live under src/`)
      }
    }
  }
  walk(srcDir)
  return failures
}

/** Compile-emitted files, or a .d.ts that pairs with a same-basename source. */
function isCompiledArtifact(dir: string, fileName: string): boolean {
  if (/\.(?:js|mjs|cjs|js\.map|d\.ts\.map)$/.test(fileName)) return true
  if (!fileName.endsWith('.d.ts')) return false
  const stem = fileName.slice(0, -'.d.ts'.length)
  return ['.ts', '.tsx', '.mts', '.cts'].some(extension => existsSync(join(dir, `${stem}${extension}`)))
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}
