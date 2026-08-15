/**
 * Verify the per-package structural invariants that make a rin package a
 * first-class member of the rin host solution:
 *   - package.json: `name` starts with @rin/, `type: module`, and `private`
 *     only on the non-published product layer (gui/web-ui);
 *   - package.json: `main`/`exports["."].default`/`bin` resolve under the
 *     tsconfig `outDir` and `files` ships that `outDir`;
 *   - tsconfig.json: `extends` the shared base and `references` vendor/cordis;
 *   - src/: no compiled artifacts (.js/.mjs/.cjs/.js.map/.d.ts.map, or a .d.ts
 *     emitted beside its .ts source) — the leak that re-imports built output
 *     into the source plane.
 */

import { existsSync, globSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const rinRoot = resolve(import.meta.dirname, '..')
const repoRoot = resolve(import.meta.dirname, '../..')
const BASE_TSCONFIG = resolve(repoRoot, 'tsconfig.base.json')
const VENDOR_CORDIS = resolve(repoRoot, 'vendor/cordis')

/** Product-layer packages with independent Vite/Tauri tsconfig, not host aggregate members. */
const PRODUCT_LAYER_GROUPS = new Set(['rin/gui/gui', 'rin/web/web-ui'])

if (import.meta.main) {
  process.exitCode = main()
}

function main(): number {
  const manifests = globSync('*/*/package.json', { cwd: rinRoot }).sort()
  const failures: string[] = []
  for (const manifestPath of manifests) {
    failures.push(...validatePackage(resolve(rinRoot, manifestPath)))
  }
  if (failures.length > 0) {
    console.error('verify-rin-structure: violations found:')
    for (const failure of failures) console.error(`  ${failure}`)
    return 1
  }
  console.log(`verify-rin-structure: ${manifests.length} rin packages conform.`)
  return 0
}

function validatePackage(manifestPath: string): string[] {
  const dir = dirname(manifestPath)
  const rel = relative(repoRoot, dir).replaceAll('\\', '/')
  const failures: string[] = []

  const manifest = readJson(manifestPath) as { name?: unknown; private?: unknown; type?: unknown }
  if (typeof manifest.name !== 'string' || !manifest.name.startsWith('@rin/')) {
    failures.push(`${rel}/package.json: name must start with @rin/ (got ${JSON.stringify(manifest.name)})`)
  }
  if (!PRODUCT_LAYER_GROUPS.has(rel) && manifest.private === true) {
    failures.push(`${rel}/package.json: private must be false or omitted (host packages publish to npm)`)
  }
  if (manifest.type !== 'module') {
    failures.push(`${rel}/package.json: type must be "module"`)
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
  const referencesCordis = references.some(reference =>
    isRecord(reference) && typeof reference.path === 'string' && resolve(dir, reference.path) === VENDOR_CORDIS)
  if (!referencesCordis) {
    failures.push(`${rel}/tsconfig.json: references must include vendor/cordis`)
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
