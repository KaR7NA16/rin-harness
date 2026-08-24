/**
 * Run every workspace strip-types smoke script serially.
 *
 * Each smoke script under a workspace package's `tests/` directory (the
 * SMOKE_GLOB pattern) is a Cordis-free script executed from its package
 * directory through `tsx/esm`, matching the repository's source-launch
 * contract. Relative `.ts` imports resolve against the script file; cwd is
 * the package directory so cwd-dependent fixtures work.
 * Exit code is non-zero when any smoke fails.
 */
import { spawn } from 'node:child_process'
import { globSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'

const root = resolve(import.meta.dirname, '..', '..')

const SMOKE_GLOB = [
  'apps/*/tests/**/*.smoke.ts',
  'packages/*/*/tests/**/*.smoke.ts',
]

const smokeFiles = globSync(SMOKE_GLOB, { cwd: root }).sort().map(path => resolve(root, path))

if (smokeFiles.length === 0) {
  console.error(`run-smokes: no smoke scripts matched ${SMOKE_GLOB}.`)
  process.exit(1)
}

console.log(`run-smokes: ${smokeFiles.length} smoke script(s) matched ${SMOKE_GLOB}.`)

// node:sqlite is intentionally exercised by several smoke scripts. Keep its
// known experimental warning out of the gate transcript without changing the
// warning behavior of the application or other Node processes.
const smokeNodeWarningArgs = process.allowedNodeEnvironmentFlags.has('--disable-warning')
  ? ['--disable-warning=ExperimentalWarning']
  : []

const startedAt = performance.now()
const failures = []
for (const file of smokeFiles) {
  const packageDir = packageRootFor(file)
  const script = relative(packageDir, file)
  const label = relative(root, file)
  const result = await runSmoke(packageDir, script, label)
  printResult(result)
  if (result.status !== 'passed') failures.push(label)
}

/** Resolve the workspace package containing a smoke file, including nested tests/unit paths. */
function packageRootFor(file) {
  const packageRelative = relative(root, file).split('\\').join('/')
  const marker = '/tests/'
  const markerIndex = packageRelative.indexOf(marker)
  if (markerIndex < 0) throw new Error(`run-smokes: smoke is outside a package tests directory: ${packageRelative}`)
  return resolve(root, packageRelative.slice(0, markerIndex))
}

printSummary(failures, smokeFiles.length, performance.now() - startedAt)
process.exitCode = failures.length === 0 ? 0 : 1

/**
 * Run one smoke script from its package directory.
 * @param packageDir - absolute package directory to run from.
 * @param script - script path relative to the package directory.
 * @param label - repo-relative path shown in results.
 * @returns the observed outcome.
 */
function runSmoke(packageDir, script, label) {
  const started = performance.now()
  return new Promise((resolveExit) => {
    // tsx (not strip-types) so smokes may import @rin package names, which
    // resolve through tsconfig paths to src (strip-types only walks node_modules).
    const child = spawn(process.execPath, [...smokeNodeWarningArgs, '--import', 'tsx/esm', script], {
      cwd: packageDir,
      env: process.env,
      stdio: 'inherit',
    })
    let spawnError
    child.on('error', (error) => {
      spawnError = `failed to start: ${error.message}`
    })
    child.on('close', (exitCode, signalCode) => {
      const status = exitCode === 0 && signalCode === null && spawnError === undefined ? 'passed' : 'failed'
      resolveExit({ label, status, durationMs: performance.now() - started, exitCode, signalCode, error: spawnError })
    })
  })
}

function printResult(result) {
  const seconds = (result.durationMs / 1000).toFixed(2)
  if (result.status === 'passed') {
    console.log(`run-smokes: PASS ${result.label} (${seconds}s)`)
    return
  }
  console.error(`run-smokes: FAIL ${result.label} (${seconds}s)`)
  console.error(`  ${formatReason(result)}`)
}

/**
 * Format every failure fact for one smoke.
 * @param result - failed smoke result.
 * @returns error, exit, and signal facts joined without one hiding another.
 */
function formatReason(result) {
  const facts = []
  if (result.error !== undefined) facts.push(result.error)
  if (result.exitCode !== null) facts.push(`exit ${result.exitCode}`)
  if (result.signalCode !== null) facts.push(`signal ${result.signalCode}`)
  return facts.length === 0 ? 'no exit code or signal' : facts.join(', ')
}

function printSummary(failures, total, durationMs) {
  const passed = total - failures.length
  const seconds = (durationMs / 1000).toFixed(2)
  console.log(`\nrun-smokes: ${passed} passed, ${failures.length} failed in ${seconds}s.`)
  if (failures.length === 0) return
  console.error('run-smokes: failed smoke scripts:')
  for (const label of failures) console.error(`  - ${label}`)
}
