/**
 * Validate the @rin declarative assembly (rin/bundle/rin/src/cordis.yml).
 *
 * The `rin` launcher patches @deepseek-ai/dsh-base and then mounts this file's
 * rows in order, so a working host assembly needs three facts to hold:
 *   1. every row `name` resolves to a workspace package — @rin/* rows live under
 *      rin/, @deepseek-ai/* rows under packages/ (or vendor/);
 *   2. the ordered @rin roster @rin/bundle exports (RIN_HOST_PLUGINS plus
 *      RIN_WEB_SERVER, i.e. RIN_PLUGINS) matches the @rin rows of cordis.yml
 *      exactly, in order;
 *   3. the `!!js` path helpers the config interpolates (rinHome,
 *      builtinRepositoryRoot, webUiDistRoot) are real exports of @rin/bundle.
 */

import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yaml from 'js-yaml'
import * as bundle from '../bundle/rin/src/index.ts'

/** A `!!js` scalar, captured by the custom YAML schema as its source text. */
interface JsExpr {
  __jsExpr: string
}

/** One plugin row's identifying fields. */
interface Row {
  id?: string
  name: string
}

/** The @rin/bundle exports cordis.yml may interpolate as `!!js` helpers. */
const JS_HELPERS = ['rinHome', 'builtinRepositoryRoot', 'webUiDistRoot'] as const

const rinRoot = resolve(import.meta.dirname, '..')
const repoRoot = resolve(import.meta.dirname, '../..')
const CONFIG_FILE = 'bundle/rin/src/cordis.yml'

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
  const document: unknown = yaml.load(readFileSync(resolve(rinRoot, CONFIG_FILE), 'utf8'), { schema })
  if (!Array.isArray(document)) {
    console.error(`verify-rin-cordis: ${CONFIG_FILE}: root must be a Loader entry array`)
    return 1
  }

  const rows = collectRows(document)
  const jsExprs = collectJsExprs(document)
  const rinPackages = workspacePackages('*/*/package.json', rinRoot)
  const dshPackages = workspacePackages(['packages/*/*/package.json', 'vendor/*/package.json'], repoRoot)

  failures.push(...validateRowResolution(rows, rinPackages, dshPackages))
  failures.push(...validateRoster(rows))
  failures.push(...validateJsHelpers(jsExprs))

  if (failures.length > 0) {
    console.error('verify-rin-cordis: invalid @rin assembly:')
    for (const failure of failures) console.error(`- ${failure}`)
    return 1
  }

  const rinRowCount = rows.filter(row => row.name.startsWith('@rin/')).length
  const dshRowCount = rows.length - rinRowCount
  const referenced = JS_HELPERS.filter(name => jsExprs.some(expr => new RegExp(`\\b${name}\\b`).test(expr)))
  console.log(
    `verify-rin-cordis: ${rows.length} rows (${rinRowCount} @rin, ${dshRowCount} dsh) resolve; `
    + `RIN_HOST_PLUGINS (${bundle.RIN_HOST_PLUGINS.length}) + RIN_WEB_SERVER match the ${rinRowCount} @rin rows; `
    + `!!js helpers defined in @rin/bundle: ${referenced.join(', ')}.`,
  )
  return 0
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
  dshPackages: ReadonlyMap<string, string>,
): string[] {
  const failures: string[] = []
  for (const row of rows) {
    if (row.name.startsWith('@rin/')) {
      if (!rinPackages.has(row.name)) {
        const hint = dshPackages.has(row.name) ? ' (found under packages/, but @rin packages must live under rin/)' : ''
        failures.push(`${CONFIG_FILE}: ${row.name} does not resolve to a rin/ package${hint}`)
      }
      continue
    }
    if (row.name.startsWith('@')) {
      if (!dshPackages.has(row.name)) {
        failures.push(`${CONFIG_FILE}: ${row.name} does not resolve to a packages/ (or vendor/) package`)
      }
      continue
    }
    failures.push(`${CONFIG_FILE}: ${row.name} is not a scoped package specifier`)
  }
  return failures
}

function validateRoster(rows: readonly Row[]): string[] {
  const failures: string[] = []
  const roster: string[] = [...bundle.RIN_HOST_PLUGINS, bundle.RIN_WEB_SERVER]
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
    rinHome: bundle.rinHome,
    builtinRepositoryRoot: bundle.builtinRepositoryRoot,
    webUiDistRoot: bundle.webUiDistRoot,
  }
  for (const name of JS_HELPERS) {
    const referenced = jsExprs.some(expr => new RegExp(`\\b${name}\\b`).test(expr))
    if (referenced && typeof bindings[name] !== 'function') {
      failures.push(`cordis.yml interpolates !!js ${name}(...) but @rin/bundle does not export ${name} as a function`)
    }
  }
  return failures
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}
