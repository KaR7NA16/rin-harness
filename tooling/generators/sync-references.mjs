/**
 * Synchronize package project references and the root TypeScript solution from
 * workspace manifests. Product projects keep their independent compiler face.
 */
import { existsSync, globSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import ts from 'typescript'

const root = new URL('../..', import.meta.url).pathname
const manifestPaths = globSync([
  'apps/*/package.json',
  'packages/*/*/package.json',
], { cwd: root }).sort()
const packages = new Map()

for (const manifestPath of manifestPaths) {
  const manifest = readJson(join(root, manifestPath))
  packages.set(manifest.name, dirname(manifestPath).replaceAll('\\', '/'))
}

const independentProducts = new Set(['apps/web', 'apps/desktop'])
for (const manifestPath of manifestPaths) {
  const packagePath = dirname(manifestPath).replaceAll('\\', '/')
  if (independentProducts.has(packagePath)) continue
  const tsconfigPath = join(root, packagePath, 'tsconfig.json')
  if (!existsSync(tsconfigPath)) continue

  const manifest = readJson(join(root, manifestPath))
  const dependencies = new Set()
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (name !== manifest.name && packages.has(name)) dependencies.add(name)
    }
  }
  const references = [...dependencies].sort().map(name => {
    let path = relative(packagePath, packages.get(name)).replaceAll('\\', '/')
    if (!path.startsWith('.')) path = './' + path
    return { path }
  })

  const tsconfig = readJson(tsconfigPath)
  if (references.length === 0) delete tsconfig.references
  else tsconfig.references = references
  writeJson(tsconfigPath, tsconfig)
}

const solutionPath = join(root, 'tsconfig.json')
const solution = readJson(solutionPath)
solution.references = [...packages.values()].sort().map(path => ({ path: './' + path }))
writeJson(solutionPath, solution)

const basePath = join(root, 'tsconfig.base.json')
const base = readJsonc(basePath)
base.compilerOptions.paths = Object.fromEntries(
  manifestPaths.flatMap(manifestPath => {
    const packagePath = dirname(manifestPath).replaceAll('\\', '/')
    const manifest = readJson(join(root, manifestPath))
    return sourceAliases(manifest, packagePath)
  }).sort(([left], [right]) => left.localeCompare(right)),
)
writeJson(basePath, base)

console.log('sync-references: synchronized ' + packages.size + ' workspace package(s).')

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function readJsonc(path) {
  const parsed = ts.parseConfigFileTextToJson(path, readFileSync(path, 'utf8'))
  if (parsed.error !== undefined) throw new Error('Invalid TypeScript config: ' + path)
  return parsed.config
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
}

/**
 * Derive TypeScript source aliases from a package's public exports. This keeps
 * merged package subpaths (for example @rin/workspace/environment) resolvable
 * without preserving one-package-per-plugin directories.
 */
function sourceAliases(manifest, packagePath) {
  const aliases = [[manifest.name, ['./' + packagePath + '/src']]]
  const exports = manifest.exports
  if (exports === null || typeof exports !== 'object' || Array.isArray(exports)) return aliases

  for (const [key, value] of Object.entries(exports)) {
    if (key === '.' || !key.startsWith('./') || value === null
      || typeof value !== 'object' || Array.isArray(value)) continue
    const entry = typeof value.types === 'string' ? value.types : value.default
    if (typeof entry !== 'string' || !entry.startsWith('./lib/types/')) continue
    const relativeEntry = entry
      .slice('./lib/types/'.length)
      .replace(/(?:\.d\.ts|\.js)$/u, '')
      .replace(/\/index$/u, '')
    aliases.push([
      manifest.name + '/' + key.slice(2),
      ['./' + packagePath + '/src/' + relativeEntry],
    ])
  }
  return aliases
}
