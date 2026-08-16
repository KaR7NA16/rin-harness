/**
 * rin computer use — runtime setup: python detection, venv creation, dependency
 * installation with a sha256 stamp, and macOS/Windows permission preflight.
 *
 * This module is a node:child_process rewrite of the legacy cyberpsychosis
 * setup (server/api/computer-use-python.ts plus the setup half of
 * computer-use.ts). It keeps the same step flow — python check, runtime-file
 * extraction, venv creation, pip bootstrap, requirements install, permission
 * preflight — but runs on plain node (execFile), never Bun, and derives every
 * path from the injected configuration root (plus optional overrides for
 * tests). The python helper scripts and requirements files ship as package
 * assets under the package's runtime/ directory.
 *
 * Platform honesty: permission preflight is only implemented for macOS and
 * Windows (it shells out to the migrated helper script). On every other
 * platform getRuntimeStatus reports preflight as unsupported and installRuntime
 * never blocks on it.
 *
 * @module @rin/computer-use
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ComputerUseRoots } from './types.ts'

const RUNTIME_DIRNAME = 'runtime'
const VENV_DIRNAME = 'venv'
const REQUIREMENTS_FILENAME = 'requirements.txt'
const REQUIREMENTS_WIN_FILENAME = 'requirements-win.txt'
const INSTALL_STAMP_FILENAME = 'requirements.sha256'
const MAC_HELPER_FILENAME = 'mac_helper.py'
const WIN_HELPER_FILENAME = 'win_helper.py'

/** Default timeout for long install/venv commands (pip can be slow). */
const INSTALL_TIMEOUT_MS = 600_000
/** Timeout for cheap probes (version detection, preflight). */
const DETECTION_TIMEOUT_MS = 20_000
const MAX_BUFFER_BYTES = 8 * 1024 * 1024

/** Result of running one external command. */
export type RuntimeCommandResult = {
  ok: boolean
  stdout: string
  stderr: string
  code: number
}

/** Injected command executor; defaults to a node execFile runner. */
export type RuntimeCommandRunner = (
  command: string,
  args: readonly string[],
) => Promise<RuntimeCommandResult>

/** A python interpreter found on the system or inside the venv. */
export type PythonRuntimeResolution = {
  installed: boolean
  version: string | null
  path: string | null
  command: string | null
  prefixArgs: string[]
  source: 'system' | 'venv' | null
}

/** macOS/Windows permission preflight outcome. */
export type RuntimePreflightResult = {
  status: 'ok' | 'skipped' | 'unsupported' | 'failed'
  accessibility: boolean | null
  screenRecording: boolean | null
  /** Human-readable explanation; null when the preflight succeeded. */
  detail: string | null
}

/** Read-only view of the installed runtime. */
export type RuntimeStatus = {
  platform: NodeJS.Platform
  /** True on macOS/Windows, where the helper runtime is defined. */
  supported: boolean
  python: PythonRuntimeResolution
  venv: {
    created: boolean
    path: string
  }
  dependencies: {
    installed: boolean
    requirementsFound: boolean
    /** sha256 of the requirements the venv was installed from. */
    sha256: string | null
  }
  preflight: RuntimePreflightResult
}

/** One setup step returned by installRuntime. */
export type RuntimeInstallStep = {
  name: string
  ok: boolean
  message: string
}

/** The installRuntime outcome. */
export type RuntimeInstallResult = {
  success: boolean
  steps: RuntimeInstallStep[]
  status: RuntimeStatus
}

/** Overrides for runtime discovery and execution (used by tests). */
export type RuntimeSetupOptions = {
  /** Where venv/stamp/requirements live; defaults to <configRoot>/runtime. */
  runtimeRoot?: string
  /** Platform to plan for; defaults to process.platform. */
  platform?: NodeJS.Platform
  /** Preferred python command; skips candidate detection when set. */
  pythonCommand?: string
  /** Args placed before -m switches for pythonCommand (e.g. ['-3'] for py). */
  pythonPrefixArgs?: readonly string[]
  /** Command executor override (tests inject a fake python). */
  runCommand?: RuntimeCommandRunner
  /** PyPI index mirror; unset means the default index. */
  pipIndexUrl?: string
  /** Trusted host for the mirror; only used together with pipIndexUrl. */
  pipTrustedHost?: string
  /** Timeout for venv/pip commands. */
  installTimeoutMs?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

/**
 * Locate the package root so the runtime/ assets resolve both when the module
 * runs from src (strip-types/tsx) and from the built lib/types output.
 * @returns the absolute package root directory.
 */
function getPackageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let depth = 0; depth < 4; depth++) {
    if (existsSync(join(dir, 'package.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(
    'rin computer-use: could not locate the @rin/computer-use package root above '
      + fileURLToPath(import.meta.url),
  )
}

/** The absolute path of the package's runtime asset directory. */
function getAssetsDir(): string {
  return join(getPackageRoot(), RUNTIME_DIRNAME)
}

function getRuntimeRoot(roots: ComputerUseRoots, options: RuntimeSetupOptions): string {
  return options.runtimeRoot ?? join(roots.configRoot, RUNTIME_DIRNAME)
}

function getVenvRoot(roots: ComputerUseRoots, options: RuntimeSetupOptions): string {
  return join(getRuntimeRoot(roots, options), VENV_DIRNAME)
}

function getVenvPythonPath(roots: ComputerUseRoots, options: RuntimeSetupOptions): string {
  const platform = options.platform ?? process.platform
  return platform === 'win32'
    ? join(getVenvRoot(roots, options), 'Scripts', 'python.exe')
    : join(getVenvRoot(roots, options), 'bin', 'python3')
}

function getVenvPipPath(roots: ComputerUseRoots, options: RuntimeSetupOptions): string {
  const platform = options.platform ?? process.platform
  return platform === 'win32'
    ? join(getVenvRoot(roots, options), 'Scripts', 'pip.exe')
    : join(getVenvRoot(roots, options), 'bin', 'pip')
}

function getRequirementsPath(roots: ComputerUseRoots, options: RuntimeSetupOptions): string {
  return join(getRuntimeRoot(roots, options), REQUIREMENTS_FILENAME)
}

function getInstallStampPath(roots: ComputerUseRoots, options: RuntimeSetupOptions): string {
  return join(getRuntimeRoot(roots, options), INSTALL_STAMP_FILENAME)
}

function getHelperFilename(platform: NodeJS.Platform): string | null {
  if (platform === 'darwin') return MAC_HELPER_FILENAME
  if (platform === 'win32') return WIN_HELPER_FILENAME
  return null
}

function getRequirementsAssetFilename(platform: NodeJS.Platform): string {
  return platform === 'win32' ? REQUIREMENTS_WIN_FILENAME : REQUIREMENTS_FILENAME
}

/** Build the child-process env, forcing UTF-8 for python on Windows. */
function pythonEnv(): NodeJS.ProcessEnv {
  if (process.platform !== 'win32') return { ...process.env }
  return { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
}

/**
 * Default command runner built on node:child_process execFile.
 * @param options - timeout override for the created runner.
 * @returns a runner resolving every command (never rejects).
 */
export function createNodeCommandRunner(options: { timeoutMs?: number } = {}): RuntimeCommandRunner {
  const timeoutMs = options.timeoutMs ?? INSTALL_TIMEOUT_MS
  return (command, args) => new Promise((resolve) => {
    execFile(
      command,
      [...args],
      {
        encoding: 'utf-8',
        timeout: timeoutMs,
        maxBuffer: MAX_BUFFER_BYTES,
        windowsHide: true,
        env: pythonEnv(),
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ ok: true, stdout: stdout.trim(), stderr: stderr.trim(), code: 0 })
          return
        }
        const code = typeof error.code === 'number' ? error.code : -1
        resolve({
          ok: false,
          stdout: stdout.trim(),
          stderr: (stderr.trim() || error.message).trim(),
          code,
        })
      },
    )
  })
}

type PythonCandidate = {
  command: string
  prefixArgs: string[]
  locator: { command: string; args: string[] } | null
}

function getPythonCandidates(platform: NodeJS.Platform): PythonCandidate[] {
  if (platform === 'win32') {
    return [
      { command: 'python3', prefixArgs: [], locator: { command: 'where', args: ['python3'] } },
      { command: 'python', prefixArgs: [], locator: { command: 'where', args: ['python'] } },
      { command: 'py', prefixArgs: ['-3'], locator: { command: 'where', args: ['py'] } },
      { command: 'py', prefixArgs: [], locator: { command: 'where', args: ['py'] } },
    ]
  }
  return [
    { command: 'python3', prefixArgs: [], locator: { command: 'which', args: ['python3'] } },
  ]
}

function extractPythonVersion(output: string): string | null {
  const match = output.match(/Python\s+([0-9][^\s]*)/i)
  return match?.[1] ?? null
}

function firstOutputLine(output: string): string | null {
  const line = output
    .split(/\r?\n/)
    .map(value => value.trim())
    .find(Boolean)
  return line ?? null
}

async function locateCandidatePath(
  candidate: PythonCandidate,
  runCommand: RuntimeCommandRunner,
): Promise<string | null> {
  if (candidate.locator === null) return null
  const locateResult = await runCommand(candidate.locator.command, candidate.locator.args)
  if (!locateResult.ok) return null
  return firstOutputLine(locateResult.stdout)
}

/**
 * Detect a python interpreter: system candidates first, then the venv python.
 * @param platform - the platform to plan for.
 * @param runCommand - the command executor.
 * @param venvPythonPath - the venv interpreter to probe when no system python answers.
 * @returns the resolved interpreter, or installed:false when none answers.
 */
export async function detectPythonRuntime(
  platform: NodeJS.Platform,
  runCommand: RuntimeCommandRunner,
  venvPythonPath?: string,
): Promise<PythonRuntimeResolution> {
  for (const candidate of getPythonCandidates(platform)) {
    const versionResult = await runCommand(candidate.command, [...candidate.prefixArgs, '--version'])
    if (!versionResult.ok) continue
    return {
      installed: true,
      version: extractPythonVersion(`${versionResult.stdout}\n${versionResult.stderr}`),
      path: await locateCandidatePath(candidate, runCommand),
      command: candidate.command,
      prefixArgs: candidate.prefixArgs,
      source: 'system',
    }
  }

  if (venvPythonPath !== undefined) {
    const venvResult = await runCommand(venvPythonPath, ['--version'])
    if (venvResult.ok) {
      return {
        installed: true,
        version: extractPythonVersion(`${venvResult.stdout}\n${venvResult.stderr}`),
        path: venvPythonPath,
        command: venvPythonPath,
        prefixArgs: [],
        source: 'venv',
      }
    }
  }

  return {
    installed: false,
    version: null,
    path: null,
    command: null,
    prefixArgs: [],
    source: null,
  }
}

/**
 * Resolve the python interpreter honoring a pythonCommand override, which skips
 * candidate detection entirely (used by tests and explicit configs).
 * @param platform - the platform to plan for.
 * @param runCommand - the command executor.
 * @param options - runtime setup options.
 * @param venvPythonPath - the venv interpreter to probe when no override and no
 *   system python answers.
 * @returns the resolved interpreter.
 */
async function resolvePython(
  platform: NodeJS.Platform,
  runCommand: RuntimeCommandRunner,
  options: RuntimeSetupOptions,
  venvPythonPath?: string,
): Promise<PythonRuntimeResolution> {
  if (options.pythonCommand !== undefined) {
    const prefixArgs = [...(options.pythonPrefixArgs ?? [])]
    const versionResult = await runCommand(options.pythonCommand, [...prefixArgs, '--version'])
    if (versionResult.ok) {
      return {
        installed: true,
        version: extractPythonVersion(`${versionResult.stdout}\n${versionResult.stderr}`),
        path: null,
        command: options.pythonCommand,
        prefixArgs,
        source: 'system',
      }
    }
    return {
      installed: false,
      version: null,
      path: null,
      command: options.pythonCommand,
      prefixArgs,
      source: null,
    }
  }
  return detectPythonRuntime(platform, runCommand, venvPythonPath)
}

function sha256Of(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex')
}

async function readRequirementsDigest(
  roots: ComputerUseRoots,
  options: RuntimeSetupOptions,
): Promise<string | null> {
  const requirementsPath = getRequirementsPath(roots, options)
  if (!(await pathExists(requirementsPath))) return null
  const content = await readFile(requirementsPath, 'utf-8')
  return sha256Of(content)
}

async function readInstallStamp(
  roots: ComputerUseRoots,
  options: RuntimeSetupOptions,
): Promise<string | null> {
  const stampPath = getInstallStampPath(roots, options)
  if (!(await pathExists(stampPath))) return null
  try {
    return (await readFile(stampPath, 'utf-8')).trim()
  } catch {
    return null
  }
}

/**
 * Copy the requirements file and the platform helper script (when one exists)
 * from the package's runtime/ assets into the runtime root.
 * @param roots - the configuration root.
 * @param options - runtime setup options.
 */
async function writeRuntimeFiles(
  roots: ComputerUseRoots,
  options: RuntimeSetupOptions,
): Promise<void> {
  const platform = options.platform ?? process.platform
  const runtimeRoot = getRuntimeRoot(roots, options)
  await mkdir(runtimeRoot, { recursive: true })

  const assetsDir = getAssetsDir()
  const requirementsAsset = getRequirementsAssetFilename(platform)
  const requirements = await readFile(join(assetsDir, requirementsAsset), 'utf-8')
  await writeFile(getRequirementsPath(roots, options), requirements, 'utf-8')

  const helperName = getHelperFilename(platform)
  if (helperName !== null) {
    const helper = await readFile(join(assetsDir, helperName), 'utf-8')
    await writeFile(join(runtimeRoot, helperName), helper, 'utf-8')
  }
}

async function createVenv(
  roots: ComputerUseRoots,
  options: RuntimeSetupOptions,
  python: PythonRuntimeResolution,
  runCommand: RuntimeCommandRunner,
): Promise<void> {
  if (python.command === null) {
    throw new Error('no python command is available to create the virtual environment')
  }
  const result = await runCommand(python.command, [...python.prefixArgs, '-m', 'venv', getVenvRoot(roots, options)])
  if (!result.ok) {
    throw new Error(result.stderr.slice(0, 300) || `venv creation failed with exit code ${result.code}`)
  }
}

/**
 * Probe macOS/Windows permissions through the migrated helper script. The
 * helper prints {"ok":true,"result":{"accessibility":bool,"screenRecording":bool}}.
 * @param roots - the configuration root.
 * @param options - runtime setup options.
 * @param runCommand - the command executor.
 * @returns the preflight outcome; never throws.
 */
async function runPreflight(
  roots: ComputerUseRoots,
  options: RuntimeSetupOptions,
  runCommand: RuntimeCommandRunner,
): Promise<RuntimePreflightResult> {
  const platform = options.platform ?? process.platform
  const helperName = getHelperFilename(platform)
  if (helperName === null) {
    return {
      status: 'unsupported',
      accessibility: null,
      screenRecording: null,
      detail: `permission preflight is only defined for macOS/Windows, not ${platform}`,
    }
  }

  const helperPath = join(getRuntimeRoot(roots, options), helperName)
  if (!(await pathExists(helperPath))) {
    return {
      status: 'skipped',
      accessibility: null,
      screenRecording: null,
      detail: 'helper script is not present yet; run installRuntime to extract it',
    }
  }

  const venvPythonPath = getVenvPythonPath(roots, options)
  const result = await runCommand(venvPythonPath, [helperPath, 'check_permissions'])
  if (!result.ok) {
    return {
      status: 'failed',
      accessibility: null,
      screenRecording: null,
      detail: result.stderr.slice(0, 300) || `preflight exited with code ${result.code}`,
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(result.stdout) as unknown
  } catch {
    return {
      status: 'failed',
      accessibility: null,
      screenRecording: null,
      detail: 'preflight output was not valid JSON: ' + result.stdout.slice(0, 200),
    }
  }
  if (isRecord(parsed) && parsed.ok === true && isRecord(parsed.result)) {
    return {
      status: 'ok',
      accessibility: typeof parsed.result.accessibility === 'boolean' ? parsed.result.accessibility : null,
      screenRecording: typeof parsed.result.screenRecording === 'boolean' ? parsed.result.screenRecording : null,
      detail: null,
    }
  }
  return {
    status: 'failed',
    accessibility: null,
    screenRecording: null,
    detail: 'unexpected preflight payload: ' + result.stdout.slice(0, 200),
  }
}

/**
 * Read-only snapshot of the runtime environment: python resolution, venv
 * state, dependency stamp, and (on macOS/Windows with a ready venv) permission
 * preflight. Never installs anything.
 * @param roots - the configuration root.
 * @param options - runtime setup options.
 * @returns the runtime status.
 */
export async function getRuntimeStatus(
  roots: ComputerUseRoots,
  options: RuntimeSetupOptions = {},
): Promise<RuntimeStatus> {
  const platform = options.platform ?? process.platform
  const supported = platform === 'darwin' || platform === 'win32'
  const runCommand = options.runCommand ?? createNodeCommandRunner({ timeoutMs: DETECTION_TIMEOUT_MS })

  const venvPythonPath = getVenvPythonPath(roots, options)
  const venvCreated = await pathExists(venvPythonPath)
  const python = await resolvePython(platform, runCommand, options, venvCreated ? venvPythonPath : undefined)

  const requirementsFound = await pathExists(getRequirementsPath(roots, options))
  const digest = requirementsFound ? await readRequirementsDigest(roots, options) : null
  const stamp = requirementsFound ? await readInstallStamp(roots, options) : null
  const installed = requirementsFound && digest !== null && stamp === digest

  let preflight: RuntimePreflightResult
  if (!supported) {
    preflight = {
      status: 'unsupported',
      accessibility: null,
      screenRecording: null,
      detail: `runtime preflight is only defined for macOS/Windows, not ${platform}`,
    }
  } else if (!venvCreated || !installed) {
    preflight = {
      status: 'skipped',
      accessibility: null,
      screenRecording: null,
      detail: venvCreated ? 'dependencies are not installed yet' : 'virtual environment is not created yet',
    }
  } else {
    preflight = await runPreflight(roots, options, runCommand)
  }

  return {
    platform,
    supported,
    python,
    venv: { created: venvCreated, path: getVenvRoot(roots, options) },
    dependencies: { installed, requirementsFound, sha256: digest },
    preflight,
  }
}

/**
 * Install the computer-use runtime: detect python, extract the requirements
 * and helper assets, create the venv, bootstrap pip, install dependencies
 * (guarded by a sha256 stamp), and run the permission preflight. Steps mirror
 * the legacy cyberpsychosis flow; the preflight outcome is reported through
 * the returned status and never fails the install.
 * @param roots - the configuration root.
 * @param options - runtime setup options.
 * @returns the step list plus the resulting runtime status.
 */
export async function installRuntime(
  roots: ComputerUseRoots,
  options: RuntimeSetupOptions = {},
): Promise<RuntimeInstallResult> {
  const platform = options.platform ?? process.platform
  const runCommand = options.runCommand ?? createNodeCommandRunner({ timeoutMs: options.installTimeoutMs ?? INSTALL_TIMEOUT_MS })
  const steps: RuntimeInstallStep[] = []
  const venvPythonPath = getVenvPythonPath(roots, options)
  const venvExists = await pathExists(venvPythonPath)
  const fail = async (): Promise<RuntimeInstallResult> => ({
    success: false,
    steps,
    status: await getRuntimeStatus(roots, options),
  })

  // Step 1 — python environment.
  const python = await resolvePython(platform, runCommand, options, venvExists ? venvPythonPath : undefined)
  if (!python.installed) {
    const probes = options.pythonCommand !== undefined
      ? options.pythonCommand
      : getPythonCandidates(platform).map(candidate => [candidate.command, ...candidate.prefixArgs].join(' ')).join(', ')
    steps.push({
      name: 'python-environment',
      ok: false,
      message: `Python 3 was not found (probed: ${probes}); install Python 3 and retry.`,
    })
    return fail()
  }
  steps.push({
    name: 'python-environment',
    ok: true,
    message: python.source === 'venv'
      ? `Python ${python.version ?? 'unknown'} (existing virtual environment)`
      : `Python ${python.version ?? 'unknown'}`,
  })

  // Step 2 — runtime files (requirements + platform helper) from package assets.
  try {
    await writeRuntimeFiles(roots, options)
    steps.push({ name: 'runtime-files', ok: true, message: 'runtime files extracted from package assets' })
  } catch (error) {
    steps.push({ name: 'runtime-files', ok: false, message: `extracting runtime files failed: ${errorMessage(error)}` })
    return fail()
  }

  // Step 3 — virtual environment.
  if (!venvExists) {
    try {
      await createVenv(roots, options, python, runCommand)
      if (!(await pathExists(venvPythonPath))) {
        throw new Error(`venv creation reported success but no interpreter appeared at ${venvPythonPath}`)
      }
      steps.push({ name: 'venv', ok: true, message: 'virtual environment created' })
    } catch (error) {
      steps.push({ name: 'venv', ok: false, message: `creating the virtual environment failed: ${errorMessage(error)}` })
      return fail()
    }
  } else {
    steps.push({ name: 'venv', ok: true, message: 'virtual environment already exists' })
  }

  // Step 4 — pip bootstrap inside the venv.
  const pipPath = getVenvPipPath(roots, options)
  if (!(await pathExists(pipPath))) {
    const pipResult = await runCommand(venvPythonPath, ['-m', 'ensurepip', '--upgrade'])
    if (!pipResult.ok) {
      steps.push({ name: 'pip', ok: false, message: `installing pip failed: ${pipResult.stderr.slice(0, 300)}` })
      return fail()
    }
    steps.push({ name: 'pip', ok: true, message: 'pip bootstrapped' })
  } else {
    steps.push({ name: 'pip', ok: true, message: 'pip already present' })
  }

  // Step 5 — dependencies, guarded by the requirements sha256 stamp.
  const requirementsPath = getRequirementsPath(roots, options)
  const digest = await readRequirementsDigest(roots, options)
  const stamp = await readInstallStamp(roots, options)
  if (digest !== null && stamp === digest) {
    steps.push({ name: 'dependencies', ok: true, message: 'dependencies already installed' })
  } else {
    const mirrorArgs: string[] = []
    if (options.pipIndexUrl !== undefined) mirrorArgs.push('-i', options.pipIndexUrl)
    if (options.pipTrustedHost !== undefined) mirrorArgs.push('--trusted-host', options.pipTrustedHost)
    // Upgrade pip first; a failed upgrade is not fatal — the requirements
    // install below is the real gate.
    await runCommand(venvPythonPath, ['-m', 'pip', 'install', '--upgrade', 'pip', ...mirrorArgs])
    const install = await runCommand(venvPythonPath, ['-m', 'pip', 'install', '-r', requirementsPath, ...mirrorArgs])
    if (!install.ok) {
      steps.push({ name: 'dependencies', ok: false, message: `installing dependencies failed: ${install.stderr.slice(0, 500)}` })
      return fail()
    }
    if (digest !== null) {
      await writeFile(getInstallStampPath(roots, options), `${digest}\n`, 'utf-8')
    }
    steps.push({ name: 'dependencies', ok: true, message: 'dependencies installed' })
  }

  return { success: true, steps, status: await getRuntimeStatus(roots, options) }
}

/** The bound runtime API mirroring the store binding pattern. */
export type RuntimeModule = {
  getStatus(): Promise<RuntimeStatus>
  install(): Promise<RuntimeInstallResult>
}

/**
 * Bind the runtime operations to one configuration root.
 * @param roots - the configuration root every operation targets.
 * @param options - runtime setup options (tests inject a fake runner here).
 * @returns the bound runtime methods.
 */
export function createRuntimeModule(
  roots: ComputerUseRoots,
  options: RuntimeSetupOptions = {},
): RuntimeModule {
  return {
    getStatus: () => getRuntimeStatus(roots, options),
    install: () => installRuntime(roots, options),
  }
}
