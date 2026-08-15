/**
 * Verify rin package dependency completeness: every `@rin/*` or
 * `@deepseek-ai/dsh-*` import in a rin package's `src/` must be declared in
 * that package's own manifest. Type-only imports still count as imports — they
 * only need to appear in *some* declaration bucket, and `devDependencies` is
 * a valid home for imports the compiler erases. This gate surfaces the
 * "runtime import but undeclared" gap (e.g. evolution importing
 * `@rin/prompt-memory` without listing it) without touching dsh upstream.
 *
 * Run: node --import tsx/esm rin/scripts/verify-rin-deps.ts
 */
import { globSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'

interface PackageManifest {
  name?: string
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

interface Failure {
  /** Owning workspace package name (e.g. @rin/web-server). */
  packageName: string
  /** Repo-relative source path that imports the missing dependency. */
  file: string
  /** 1-based line of the import. */
  line: number
  /** Full import specifier as written (e.g. @rin/repository). */
  specifier: string
  /** Bare package name the manifest must declare. */
  missing: string
}

const root = resolve(import.meta.dirname, '../..')

// Static `from '…'`, side-effect `import '…'`, and dynamic `import('…')`.
// Rin keeps imports single-line, so scanning line by line preserves file:line.
const IMPORT_RE = /\b(?:from\s*|import\s*\(\s*|import\s+)(['"])([^'"]+)\1/g

const failures: Failure[] = []
let packagesChecked = 0
let sourceFiles = 0

for (const manifestPath of globSync('rin/*/*/package.json', { cwd: root }).sort()) {
  const manifest = await loadManifest(manifestPath)
  const packageName = manifest.name
  if (packageName === undefined) continue
  packagesChecked += 1

  const declared = new Set<string>([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ])

  const packageDir = dirname(resolve(root, manifestPath))
  const sourcePaths = [
    ...globSync('src/**/*.ts', { cwd: packageDir }),
    ...globSync('src/**/*.tsx', { cwd: packageDir }),
  ]
    .filter(path => !path.endsWith('.d.ts'))
    .sort()

  for (const sourcePath of sourcePaths) {
    sourceFiles += 1
    const absolute = resolve(packageDir, sourcePath)
    const content = stripComments(await readFile(absolute, 'utf8'))
    const lines = content.split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      for (const match of lines[index]!.matchAll(IMPORT_RE)) {
        const specifier = match[2]
        if (specifier === undefined) continue
        const bare = barePackageName(specifier)
        if (bare === undefined || bare === packageName) continue
        if (declared.has(bare)) continue
        failures.push({
          packageName,
          file: relative(root, absolute),
          line: index + 1,
          specifier,
          missing: bare,
        })
      }
    }
  }
}

if (failures.length > 0) {
  console.error(
    'verify-rin-deps: source files import @rin/* / @deepseek-ai/dsh-* packages their manifest does not declare:',
  )
  for (const failure of failures) {
    console.error(
      `  ${failure.file}:${failure.line}: imports ${failure.specifier} — ${failure.missing} missing from ${failure.packageName} dependencies/peerDependencies/optionalDependencies/devDependencies`,
    )
  }
  process.exit(1)
}

console.log(
  `verify-rin-deps: ${packagesChecked} rin package(s), ${sourceFiles} source file(s) checked; every @rin/* and @deepseek-ai/dsh-* import is declared.`,
)

async function loadManifest(manifestPath: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(resolve(root, manifestPath), 'utf8')) as PackageManifest
}

/**
 * Map an import specifier to the bare workspace package name to declare, or
 * undefined for specifiers outside this gate's scope (relative, node:, and
 * non-@rin / non-dsh third-party imports).
 */
function barePackageName(specifier: string): string | undefined {
  if (specifier.startsWith('@rin/') || specifier.startsWith('@deepseek-ai/dsh-')) {
    return specifier.split('/').slice(0, 2).join('/')
  }
  return undefined
}

/**
 * Drop comments so commented-out imports do not read as real declarations,
 * while keeping every newline so reported line numbers match the source file.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' '))
    .replace(/\/\/.*$/gm, '')
}
