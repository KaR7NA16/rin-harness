/**
 * rin computer use — runtime setup smoke test (strip-types / tsx).
 *
 * Drives installRuntime() / getRuntimeStatus() against a fake venv directory
 * and a mocked python command runner, so no real python is needed. Covers the
 * full step flow (python detection, runtime-file extraction, venv creation, pip
 * bootstrap, dependency install with a sha256 stamp), the idempotent
 * re-install path, the stamp-mismatch reinstall path, the missing-python and
 * pip-failure paths, the ensurepip bootstrap, a failed venv creation, the
 * simulated macOS permission preflight, and the bound createRuntimeModule.
 *
 * Run from the package directory with:
 *
 *   node --experimental-strip-types tests/runtime.smoke.ts
 *   # or, matching the repo smoke runner: node --import tsx/esm tests/runtime.smoke.ts
 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createRuntimeModule,
  getRuntimeStatus,
  installRuntime,
  type RuntimeCommandResult,
  type RuntimeCommandRunner,
} from '../src/runtime.ts'
import type { ComputerUseRoots } from '../src/types.ts'

/** Mutable state observed and controlled by the fake python runner. */
type FakePythonState = {
  pythonVersion: string
  pipInstallCalls: string[][]
  ensurepipCalls: number
  failVersion: boolean
  failVenv: boolean
  failPipInstall: boolean
  venvWithoutPip: boolean
  preflightPayload: unknown
}

function freshState(overrides: Partial<FakePythonState> = {}): FakePythonState {
  return {
    pythonVersion: '3.12.4',
    pipInstallCalls: [],
    ensurepipCalls: 0,
    failVersion: false,
    failVenv: false,
    failPipInstall: false,
    venvWithoutPip: false,
    preflightPayload: { ok: true, result: { accessibility: true, screenRecording: true } },
    ...overrides,
  }
}

/**
 * A fake python interpreter as a RuntimeCommandRunner. The `-m venv` handler
 * materializes the venv layout on disk (bin/python3, optional bin/pip,
 * pyvenv.cfg) so the module's fs checks behave like a real install.
 */
function createFakePythonRunner(state: FakePythonState): RuntimeCommandRunner {
  return async (_command, args): Promise<RuntimeCommandResult> => {
    const first = args[0]
    if (first === '--version') {
      if (state.failVersion) {
        return { ok: false, stdout: '', stderr: 'python3: command not found', code: 1 }
      }
      return { ok: true, stdout: `Python ${state.pythonVersion}`, stderr: '', code: 0 }
    }
    if (first === '-m' && args[1] === 'venv' && args[2] !== undefined) {
      if (state.failVenv) {
        return { ok: false, stdout: '', stderr: 'Error: the venv module failed', code: 1 }
      }
      const venvRoot = args[2]
      await mkdir(join(venvRoot, 'bin'), { recursive: true })
      await writeFile(join(venvRoot, 'bin', 'python3'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
      if (!state.venvWithoutPip) {
        await writeFile(join(venvRoot, 'bin', 'pip'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
      }
      await writeFile(join(venvRoot, 'pyvenv.cfg'), 'home = fake\n', 'utf-8')
      return { ok: true, stdout: '', stderr: '', code: 0 }
    }
    if (first === '-m' && args[1] === 'ensurepip') {
      state.ensurepipCalls += 1
      return { ok: true, stdout: '', stderr: '', code: 0 }
    }
    if (first === '-m' && args[1] === 'pip' && args[2] === 'install') {
      state.pipInstallCalls.push([...args])
      if (state.failPipInstall && !args.includes('--upgrade')) {
        return { ok: false, stdout: '', stderr: 'ERROR: Could not install requirements', code: 1 }
      }
      return { ok: true, stdout: 'Successfully installed', stderr: '', code: 0 }
    }
    if (args[1] === 'check_permissions') {
      return { ok: true, stdout: JSON.stringify(state.preflightPayload), stderr: '', code: 0 }
    }
    return { ok: true, stdout: '', stderr: '', code: 0 }
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const assetRequirements = await readFile(join(packageRoot, 'runtime', 'requirements.txt'), 'utf-8')

async function main() {
  const roots: ComputerUseRoots[] = []
  const makeRoot = async (): Promise<ComputerUseRoots> => {
    const root = await mkdtemp(join(tmpdir(), 'rin-computer-use-runtime-'))
    roots.push({ configRoot: root })
    return { configRoot: root }
  }

  try {
    // 1. Empty root on this (linux) platform: python is detected through the
    //    candidate probes, nothing is installed, and preflight is honestly
    //    reported as unsupported outside macOS/Windows.
    const emptyState = freshState()
    const emptyRoot = await makeRoot()
    const empty = await getRuntimeStatus(emptyRoot, { runCommand: createFakePythonRunner(emptyState) })
    assert.equal(empty.platform, process.platform)
    assert.equal(empty.supported, false)
    assert.equal(empty.python.installed, true)
    assert.equal(empty.python.version, '3.12.4')
    assert.equal(empty.venv.created, false)
    assert.equal(empty.dependencies.installed, false)
    assert.equal(empty.dependencies.requirementsFound, false)
    assert.equal(empty.preflight.status, 'unsupported')
    assert.match(empty.preflight.detail ?? '', /macOS\/Windows/)

    // 2. Full install with a mocked python: all five steps succeed, the venv
    //    layout appears on disk, and the sha256 stamp matches the requirements.
    const installState = freshState()
    const installRoot = await makeRoot()
    const install = await installRuntime(installRoot, {
      runCommand: createFakePythonRunner(installState),
      pythonCommand: 'python3',
    })
    assert.equal(install.success, true)
    assert.deepEqual(
      install.steps.map(step => step.name),
      ['python-environment', 'runtime-files', 'venv', 'pip', 'dependencies'],
    )
    assert.ok(install.steps.every(step => step.ok))
    assert.equal(install.status.venv.created, true)
    assert.equal(install.status.dependencies.installed, true)
    assert.equal(install.status.preflight.status, 'unsupported')

    const runtimeRoot = join(installRoot.configRoot, 'runtime')
    const venvRoot = join(runtimeRoot, 'venv')
    assert.equal(install.status.venv.path, venvRoot)
    assert.equal(await pathExists(join(venvRoot, 'bin', 'python3')), true)
    const requirements = await readFile(join(runtimeRoot, 'requirements.txt'), 'utf-8')
    assert.equal(requirements, assetRequirements)
    const digest = createHash('sha256').update(requirements).digest('hex')
    assert.equal(install.status.dependencies.sha256, digest)
    assert.equal((await readFile(join(runtimeRoot, 'requirements.sha256'), 'utf-8')).trim(), digest)

    // 3. Re-install on the same root is a no-op: the venv already exists and
    //    the stamp matches, so pip is never invoked.
    const reinstallState = freshState()
    const reinstall = await installRuntime(installRoot, {
      runCommand: createFakePythonRunner(reinstallState),
      pythonCommand: 'python3',
    })
    assert.equal(reinstall.success, true)
    assert.equal(reinstall.steps.find(step => step.name === 'venv')?.message, 'virtual environment already exists')
    assert.equal(reinstall.steps.find(step => step.name === 'dependencies')?.message, 'dependencies already installed')
    assert.equal(reinstallState.pipInstallCalls.filter(call => call.includes('-r')).length, 0)

    // 4. A stale stamp (e.g. from an older requirements set, or a changed
    //    package asset) triggers a reinstall and is replaced with the digest
    //    of the current requirements.
    const staleRoot = await makeRoot()
    await mkdir(join(staleRoot.configRoot, 'runtime'), { recursive: true })
    await writeFile(join(staleRoot.configRoot, 'runtime', 'requirements.sha256'), 'stale-stamp\n', 'utf-8')
    const restampState = freshState()
    const restamp = await installRuntime(staleRoot, {
      runCommand: createFakePythonRunner(restampState),
      pythonCommand: 'python3',
    })
    assert.equal(restamp.success, true)
    assert.equal(restampState.pipInstallCalls.filter(call => call.includes('-r')).length, 1)
    const restampedDigest = createHash('sha256').update(assetRequirements).digest('hex')
    assert.equal(
      (await readFile(join(staleRoot.configRoot, 'runtime', 'requirements.sha256'), 'utf-8')).trim(),
      restampedDigest,
    )
    assert.equal(restamp.status.dependencies.sha256, restampedDigest)

    // 5. Missing python fails the python-environment step before anything else.
    const noPythonState = freshState({ failVersion: true })
    const noPythonRoot = await makeRoot()
    const noPython = await installRuntime(noPythonRoot, {
      runCommand: createFakePythonRunner(noPythonState),
      pythonCommand: 'python3',
    })
    assert.equal(noPython.success, false)
    assert.equal(noPython.steps.length, 1)
    assert.equal(noPython.steps[0]?.name, 'python-environment')
    assert.equal(noPython.steps[0]?.ok, false)
    assert.equal(noPython.status.python.installed, false)
    assert.equal(await pathExists(join(noPythonRoot.configRoot, 'runtime')), false)

    // 6. A pip failure fails the dependencies step and writes no stamp.
    const pipFailState = freshState({ failPipInstall: true })
    const pipFailRoot = await makeRoot()
    const pipFail = await installRuntime(pipFailRoot, {
      runCommand: createFakePythonRunner(pipFailState),
      pythonCommand: 'python3',
    })
    assert.equal(pipFail.success, false)
    assert.equal(pipFail.steps.find(step => step.name === 'dependencies')?.ok, false)
    assert.equal(await pathExists(join(pipFailRoot.configRoot, 'runtime', 'requirements.sha256')), false)

    // 7. A venv without pip triggers the ensurepip bootstrap step.
    const ensurepipState = freshState({ venvWithoutPip: true })
    const ensurepipRoot = await makeRoot()
    const ensurepip = await installRuntime(ensurepipRoot, {
      runCommand: createFakePythonRunner(ensurepipState),
      pythonCommand: 'python3',
    })
    assert.equal(ensurepip.success, true)
    assert.equal(ensurepip.steps.find(step => step.name === 'pip')?.message, 'pip bootstrapped')
    assert.equal(ensurepipState.ensurepipCalls, 1)

    // 8. A failed venv creation fails the venv step loud.
    const venvFailState = freshState({ failVenv: true })
    const venvFailRoot = await makeRoot()
    const venvFail = await installRuntime(venvFailRoot, {
      runCommand: createFakePythonRunner(venvFailState),
      pythonCommand: 'python3',
    })
    assert.equal(venvFail.success, false)
    assert.equal(venvFail.steps.find(step => step.name === 'venv')?.ok, false)

    // 9. Simulated macOS: the preflight runs through the extracted helper and
    //    reports the permissions from its JSON payload.
    const macState = freshState()
    const macRoot = await makeRoot()
    const mac = await installRuntime(macRoot, {
      runCommand: createFakePythonRunner(macState),
      pythonCommand: 'python3',
      platform: 'darwin',
    })
    assert.equal(mac.success, true)
    assert.equal(mac.status.supported, true)
    assert.equal(mac.status.preflight.status, 'ok')
    assert.equal(mac.status.preflight.accessibility, true)
    assert.equal(mac.status.preflight.screenRecording, true)
    assert.equal(await pathExists(join(macRoot.configRoot, 'runtime', 'mac_helper.py')), true)

    // 10. The bound module mirrors the service binding: status reads the state
    //     the install wrote.
    const bound = createRuntimeModule(installRoot, {
      runCommand: createFakePythonRunner(freshState()),
      pythonCommand: 'python3',
    })
    const boundStatus = await bound.getStatus()
    assert.equal(boundStatus.venv.created, true)
    assert.equal(boundStatus.dependencies.installed, true)

    console.log('COMPUTER-USE-RUNTIME-SMOKE-OK')
  } finally {
    for (const root of roots) {
      await rm(root.configRoot, { recursive: true, force: true })
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
