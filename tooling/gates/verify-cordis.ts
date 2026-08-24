/**
 * Validate the @rin declarative host assembly.
 *
 * The `rin` launcher patches @deepseek-ai/dsh-base and then mounts this file's
 * rows in order, so a working host assembly needs these facts to hold:
 *   1. every row `name` resolves — @rin/* roots live under apps/packages
 *      (merged plugins may use exported subpaths), while @deepseek-ai/* rows resolve
 *      from the registry through @rin/host dependencies;
 *   2. the ordered @rin roster @rin/host exports (RIN_HOST_PLUGINS plus
 *      RIN_WEB_SERVER, i.e. RIN_PLUGINS) matches the @rin rows of cordis.yml
 *      exactly, in order;
 *   3. every row `name` is a declared dependency of @rin/host, so app-boot
 *      can resolve it from the published bundle (not just via tsx paths);
 *   4. every configured `!!js` helper (rinHome, dshHome, sessionRoot,
 *      settingsPath, credentialsPath, builtinRepositoryRoot, webUiDistRoot)
 *      is a real export of @rin/host;
 *   5. the dsh harness patch keeps its insert and storage overrides in sync.
 */

import { createRequire } from 'node:module'
import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yaml from 'js-yaml'
import * as host from '../../packages/runtime/host/src/index.ts'

/** A `!!js` scalar, captured by the custom YAML schema as its source text. */
interface JsExpr {
  __jsExpr: string
}

/** One plugin row's identifying fields. */
interface Row {
  id?: string
  name: string
}

/** The @rin/host exports cordis.yml may interpolate as `!!js` helpers. */
const JS_HELPERS = ['rinHome', 'dshHome', 'sessionRoot', 'settingsPath', 'credentialsPath', 'builtinRepositoryRoot', 'webUiDistRoot'] as const

/** The dsh harness patch row that provides the `!!js` path helpers first. */
const PROVIDERS_ROW = { id: 'rin-providers', name: '@rin/host/providers' } as const

const repoRoot = resolve(import.meta.dirname, '../..')
const CONFIG_FILE = 'packages/runtime/host/src/cordis.yml'
const HOST_MANIFEST = 'packages/runtime/host/package.json'
const PATCH_FILE = 'packages/runtime/host/cordis.patch.yml'

const jsExprType = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (data: unknown): boolean => typeof data === 'string',
  construct: (data: unknown): JsExpr => {
    if (typeof data !== 'string') throw new TypeError('!!js requires a scalar string')
    return { __jsExpr: data }
  },
})
const schema = yaml.JSON_SCHEMA.extend(jsExprType)

if (import.meta.main) {
  process.exitCode = main()
}

function main(): number {
  const failures: string[] = []
  const document: unknown = yaml.load(readFileSync(resolve(repoRoot, CONFIG_FILE), 'utf8'), { schema })
  if (!Array.isArray(document)) {
    console.error(`verify-cordis: ${CONFIG_FILE}: root must be a Loader entry array`)
    return 1
  }

  const rows = collectRows(document)
  const patchDocument = readHarnessPatch()
  const jsExprs = [...collectJsExprs(document), ...collectJsExprs(patchDocument)]
  const rinPackages = workspacePackages([
    'apps/*/package.json',
    'packages/*/*/package.json',
  ], repoRoot)
  const hostDeps = hostManifestDependencies()

  failures.push(...validateRowResolution(rows, rinPackages))
  failures.push(...validateRowDependencyClosure(rows, hostDeps))
  failures.push(...validateRoster(rows))
  failures.push(...validateJsHelpers(jsExprs))
  failures.push(...validateHarnessPatch(document, patchDocument))
  failures.push(...validateSessionBackupRoot(document))

  if (failures.length > 0) {
    console.error('verify-cordis: invalid @rin assembly:')
    for (const failure of failures) console.error(`- ${failure}`)
    return 1
  }

  const rinRowCount = rows.filter(row => row.name.startsWith('@rin/')).length
  const dshRowCount = rows.length - rinRowCount
  const referenced = JS_HELPERS.filter(name => jsExprs.some(expr => new RegExp(`\\b${name}\\b`).test(expr)))
  console.log(
    `verify-cordis: ${rows.length} rows (${rinRowCount} @rin, ${dshRowCount} dsh) resolve and are declared; `
    + `RIN_HOST_PLUGINS (${host.RIN_HOST_PLUGINS.length}) + RIN_WEB_SERVER match the ${rinRowCount} @rin rows; `
    + `!!js helpers defined in @rin/host: ${referenced.join(', ')}; `
    + `dsh harness patch in sync with ${CONFIG_FILE}.`,
  )
  return 0
}

function readHarnessPatch(): unknown {
  return yaml.load(readFileSync(resolve(repoRoot, PATCH_FILE), 'utf8'), { schema })
}

/** Every object with a string `name`, in document order (including nested rows). */
function collectRows(value: unknown): Row[] {
  const rows: Row[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (!isRecord(node)) return
    if (typeof node.name === 'string') {
      rows.push({ id: typeof node.id === 'string' ? node.id : undefined, name: node.name })
    }
    for (const child of Object.values(node)) walk(child)
  }
  walk(value)
  return rows
}

/** Every `!!js` expression source, in document order. */
function collectJsExprs(value: unknown): string[] {
  const exprs: string[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (!isRecord(node)) return
    if (typeof node.__jsExpr === 'string') {
      exprs.push(node.__jsExpr)
      return
    }
    for (const child of Object.values(node)) walk(child)
  }
  walk(value)
  return exprs
}

/** Package name -> manifest path (relative to `base`), for one glob set. */
function workspacePackages(pattern: string | string[], base: string): Map<string, string> {
  const packages = new Map<string, string>()
  for (const manifestPath of globSync(pattern, { cwd: base })) {
    const manifest = JSON.parse(readFileSync(resolve(base, manifestPath), 'utf8')) as { name?: unknown }
    if (typeof manifest.name === 'string') packages.set(manifest.name, manifestPath)
  }
  return packages
}

function validateRowResolution(
  rows: readonly Row[],
  rinPackages: ReadonlyMap<string, string>,
): string[] {
  const failures: string[] = []
  const requireFromHost = createRequire(resolve(repoRoot, HOST_MANIFEST))
  for (const row of rows) {
    if (row.name.startsWith('@rin/')) {
      const packageName = workspacePackageName(row.name)
      if (!rinPackages.has(packageName)) {
        failures.push(`${CONFIG_FILE}: ${row.name} does not resolve to a workspace package`)
      }
      continue
    }
    if (row.name.startsWith('@')) {
      try {
        requireFromHost.resolve(row.name)
      } catch {
        failures.push(`${CONFIG_FILE}: ${row.name} does not resolve from the registry through @rin/host dependencies`)
      }
      continue
    }
    failures.push(`${CONFIG_FILE}: ${row.name} is not a scoped package specifier`)
  }
  return failures
}

/** Direct dependency names from the @rin/host package manifest. */
function hostManifestDependencies(): ReadonlySet<string> {
  const manifest = JSON.parse(readFileSync(resolve(repoRoot, HOST_MANIFEST), 'utf8')) as {
    dependencies?: unknown
  }
  const dependencies = manifest.dependencies
  if (!isRecord(dependencies)) {
    throw new Error(`${HOST_MANIFEST}: dependencies must be an object`)
  }
  return new Set(Object.keys(dependencies))
}

function validateRowDependencyClosure(
  rows: readonly Row[],
  hostDeps: ReadonlySet<string>,
): string[] {
  const failures: string[] = []
  for (const row of rows) {
    const dependencyName = workspacePackageName(row.name)
    if (dependencyName !== '@rin/host' && !hostDeps.has(dependencyName)) {
      failures.push(
        `${HOST_MANIFEST}: ${row.name} is mounted by cordis.yml but ${dependencyName} is not declared in @rin/host dependencies`
        + ' (source runs can hide this behind tsconfig paths, published bundles cannot)',
      )
    }
  }
  return failures
}

/** Return the workspace package root for a scoped package subpath. */
function workspacePackageName(specifier: string): string {
  return specifier.split('/').slice(0, 2).join('/')
}

function validateRoster(rows: readonly Row[]): string[] {
  const failures: string[] = []
  const roster: string[] = [...host.RIN_HOST_PLUGINS, host.RIN_WEB_SERVER]
  const cordisRin = rows.filter(row => row.name.startsWith('@rin/')).map(row => row.name)
  const rosterSet = new Set(roster)
  const cordisSet = new Set(cordisRin)
  for (const name of roster) {
    if (!cordisSet.has(name)) failures.push(`RIN_PLUGINS declares ${name} but cordis.yml mounts no @rin row for it`)
  }
  for (const name of cordisRin) {
    if (!rosterSet.has(name)) failures.push(`cordis.yml mounts ${name} but RIN_PLUGINS does not declare it`)
  }
  const setsMatch = failures.length === 0
  if (setsMatch && (roster.length !== cordisRin.length || roster.some((name, index) => name !== cordisRin[index]))) {
    failures.push('the @rin rows in cordis.yml are not in the same order as RIN_PLUGINS (assembly order matters)')
  }
  return failures
}

function validateJsHelpers(jsExprs: readonly string[]): string[] {
  const failures: string[] = []
  const bindings: Record<string, unknown> = {
    rinHome: host.rinHome,
    dshHome: host.dshHome,
    sessionRoot: host.sessionRoot,
    settingsPath: host.settingsPath,
    credentialsPath: host.credentialsPath,
    builtinRepositoryRoot: host.builtinRepositoryRoot,
    webUiDistRoot: host.webUiDistRoot,
  }
  for (const name of JS_HELPERS) {
    const referenced = jsExprs.some(expr => new RegExp(`\\b${name}\\b`).test(expr))
    if (referenced && typeof bindings[name] !== 'function') {
      failures.push(`cordis.yml interpolates !!js ${name}(...) but @rin/host does not export ${name} as a function`)
    }
  }
  return failures
}

/** Validate the dsh harness patch against the canonical entry list and the
 * explicit session/settings/credentials storage overrides. The patch is the
 * same assembly mounted through the dsh profile mechanism, so drift here would
 * boot a different tree from the plugin form.
 */
function validateHarnessPatch(document: unknown[], patchRaw: unknown): string[] {
  const failures: string[] = []
  if (!Array.isArray(patchRaw) || patchRaw.length !== 4 || !isRecord(patchRaw[0]) || !Array.isArray(patchRaw[0].insert)) {
    failures.push(`${PATCH_FILE}: must contain one insert row followed by the three storage overrides`)
    return failures
  }
  const insert = patchRaw[0].insert
  const expected = [PROVIDERS_ROW, ...document]
  if (insert.length === 0 || insert.length !== expected.length
    || insert.some((row, i) => JSON.stringify(row) !== JSON.stringify(expected[i]))) {
    failures.push(
      `${PATCH_FILE}: insert rows must match ${CONFIG_FILE} row-for-row with ${JSON.stringify(PROVIDERS_ROW)} first`
      + ' (regenerate the patch when the entry list changes)',
    )
  }
  const expectedOverrides = [
    {
      id: 'session-persistence-jsonl',
      config: { root: { __jsExpr: 'sessionRoot()' } },
    },
    {
      id: 'settings',
      config: {
        path: { __jsExpr: 'settingsPath()' },
        dshHome: { __jsExpr: 'dshHome()' },
      },
    },
    {
      id: 'credentials',
      config: {
        path: { __jsExpr: 'credentialsPath()' },
        dshHome: { __jsExpr: 'dshHome()' },
      },
    },
  ]
  const actualOverrides = patchRaw.slice(1)
  if (actualOverrides.length !== expectedOverrides.length
    || actualOverrides.some((row, index) => JSON.stringify(row) !== JSON.stringify(expectedOverrides[index]))) {
    failures.push(PATCH_FILE + ': storage overrides must match sessionRoot/settingsPath/credentialsPath exactly')
  }
  return failures
}

function validateSessionBackupRoot(document: unknown[]): string[] {
  const failures: string[] = []
  const row = document.find(value => isRecord(value) && value.id === 'session-backup')
  if (!isRecord(row)) return [CONFIG_FILE + ': session-backup row is missing']
  if (!Array.isArray(row.inject) || !row.inject.includes('sessionRoot')) {
    failures.push(CONFIG_FILE + ': session-backup must inject sessionRoot')
  }
  const config = isRecord(row.config) ? row.config : undefined
  const sessionsRoot = config?.sessionsRoot
  if (!isRecord(sessionsRoot) || sessionsRoot.__jsExpr !== 'sessionRoot()') {
    failures.push(CONFIG_FILE + ": session-backup.sessionsRoot must resolve through sessionRoot()")
  }
  return failures
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}
