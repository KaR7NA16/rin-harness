/**
 * Run the rin quality gates: assemble the four rin verify leaves.
 *
 * The runner owns process spawning and diagnostics; each leaf owns its checks.
 * Mode argument is `check` (every leaf) or one leaf name. Leaves are TypeScript
 * scripts executed source-launch through tsx's ESM-only hook, mirroring the dsh
 * source-launch contract. Exit code is non-zero when any leaf fails.
 * @see ../GATES-PLAN.md
 */
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'

/** A rin verify leaf name, also the single-leaf mode argument. */
type LeafId = 'verify-rin-deps' | 'verify-rin-cordis' | 'verify-rin-structure' | 'verify-rin-readme'

/** One rin verify leaf, owned by a sibling gate agent. */
interface Leaf {
  id: LeafId
  /** Repo-relative path to the leaf script. */
  script: string
}

type Mode = 'check' | LeafId

interface LeafResult {
  leaf: Leaf
  status: 'passed' | 'failed'
  durationMs: number
  exitCode: number | null
  signalCode: NodeJS.Signals | null
  error?: string
}

const root = resolve(import.meta.dirname, '..', '..')

const LEAVES: readonly Leaf[] = [
  { id: 'verify-rin-deps', script: 'rin/scripts/verify-rin-deps.ts' },
  { id: 'verify-rin-cordis', script: 'rin/scripts/verify-rin-cordis.ts' },
  { id: 'verify-rin-structure', script: 'rin/scripts/verify-rin-structure.ts' },
  { id: 'verify-rin-readme', script: 'rin/scripts/verify-rin-readme.ts' },
]

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2))
}

/**
 * Parse the mode argument and run its leaves.
 * @param args - process arguments after the script path.
 * @returns exit code 1 when any leaf failed, otherwise 0.
 */
async function main(args: string[]): Promise<number> {
  const mode = parseMode(args[0])
  const leaves = mode === 'check' ? [...LEAVES] : [leafById(mode)]
  console.log(`rin-gates: running ${leaves.length} leaf script(s) for mode ${mode}.`)

  const startedAt = performance.now()
  const results: LeafResult[] = []
  for (const leaf of leaves) {
    results.push(await runLeaf(leaf))
  }
  printSummary(results, performance.now() - startedAt)
  return results.some(result => result.status === 'failed') ? 1 : 0
}

/**
 * Resolve the mode argument.
 * @param raw - the first process argument.
 * @returns the validated mode.
 */
function parseMode(raw: string | undefined): Mode {
  if (raw === undefined || raw === '') {
    throw new Error('rin-gates: expected a mode argument: check | verify-rin-deps | verify-rin-cordis | verify-rin-structure | verify-rin-readme.')
  }
  if (raw === 'check' || LEAVES.some(leaf => leaf.id === raw)) return raw as Mode
  throw new Error(`rin-gates: unknown mode ${JSON.stringify(raw)}; expected check | verify-rin-deps | verify-rin-cordis | verify-rin-structure | verify-rin-readme.`)
}

/**
 * Find one leaf by id.
 * @param id - validated leaf id.
 * @returns the leaf registration.
 */
function leafById(id: LeafId): Leaf {
  const leaf = LEAVES.find(item => item.id === id)
  if (leaf === undefined) throw new Error(`rin-gates: no leaf registered for ${id}.`)
  return leaf
}

/**
 * Run one leaf and print its outcome.
 * @param leaf - leaf to run.
 * @returns the observed outcome.
 */
async function runLeaf(leaf: Leaf): Promise<LeafResult> {
  const started = performance.now()
  const scriptPath = resolve(root, leaf.script)
  const result: LeafResult = { leaf, status: 'failed', durationMs: 0, exitCode: null, signalCode: null }
  if (!existsSync(scriptPath)) {
    result.error = `leaf script does not exist: ${leaf.script} (written by a sibling gate agent; rerun once it lands)`
    printLeaf(result)
    return result
  }
  console.log(`rin-gates: start ${leaf.id}`)
  const outcome = await spawnLeaf(scriptPath)
  result.exitCode = outcome.exitCode
  result.signalCode = outcome.signalCode
  if (outcome.error !== undefined) result.error = outcome.error
  result.status = outcome.exitCode === 0 && outcome.signalCode === null && outcome.error === undefined ? 'passed' : 'failed'
  result.durationMs = performance.now() - started
  printLeaf(result)
  return result
}

/**
 * Execute one leaf source-launch through tsx's ESM-only hook.
 * @param scriptPath - absolute path to the leaf script.
 * @returns the child-process exit code, signal, and any spawn error.
 */
function spawnLeaf(scriptPath: string): Promise<{ exitCode: number | null; signalCode: NodeJS.Signals | null; error?: string }> {
  return new Promise((resolveExit) => {
    const child = spawn(process.execPath, ['--import', 'tsx/esm', scriptPath], {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
    })
    let spawnError: string | undefined
    child.on('error', (error) => {
      spawnError = `failed to start ${scriptPath}: ${error.message}`
    })
    child.on('close', (exitCode, signalCode) => {
      resolveExit({ exitCode, signalCode, ...(spawnError === undefined ? {} : { error: spawnError }) })
    })
  })
}

function printLeaf(result: LeafResult): void {
  const seconds = (result.durationMs / 1000).toFixed(2)
  if (result.status === 'passed') {
    console.log(`rin-gates: PASS ${result.leaf.id} (${seconds}s)`)
    return
  }
  console.error(`rin-gates: FAIL ${result.leaf.id} (${seconds}s)`)
  console.error(`  ${result.leaf.script} — ${formatLeafReason(result)}`)
}

/**
 * Format every failure fact for one leaf.
 * @param result - failed leaf result.
 * @returns error, exit, and signal facts joined without one hiding another.
 */
function formatLeafReason(result: LeafResult): string {
  const facts: string[] = []
  if (result.error !== undefined) facts.push(result.error)
  if (result.exitCode !== null) facts.push(`exit ${result.exitCode}`)
  if (result.signalCode !== null) facts.push(`signal ${result.signalCode}`)
  return facts.length === 0 ? 'no exit code or signal' : facts.join(', ')
}

function printSummary(results: LeafResult[], durationMs: number): void {
  const passed = results.filter(result => result.status === 'passed').length
  const failed = results.filter(result => result.status === 'failed').length
  const seconds = (durationMs / 1000).toFixed(2)
  console.log(`\nrin-gates: ${passed} passed, ${failed} failed in ${seconds}s.`)
  const unsuccessful = results.filter(result => result.status === 'failed')
  if (unsuccessful.length === 0) return
  console.error('rin-gates: unsuccessful leaves:')
  for (const result of unsuccessful) {
    const duration = (result.durationMs / 1000).toFixed(2)
    console.error(`  - FAIL ${result.leaf.id} (${duration}s, ${formatLeafReason(result)})`)
  }
}
