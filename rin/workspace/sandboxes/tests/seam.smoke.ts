/**
 * rin sandboxes — shell-seam strip-types smoke.
 *
 * Exercises the structural shell-seam adapters with a fake ctx.shell: request
 * construction, ShellRunResult → StageExecutionResult folding, per-stage command
 * ordering and failure short-circuit, the dryRun path (no shell call), and the
 * fail-loud behavior when the shell seam is unavailable.
 *
 * Run from the package directory:
 *   node --experimental-strip-types tests/seam.smoke.ts
 */

import { buildStageExecutor } from '../src/exec.ts'
import {
  buildShellRunCommand,
  registerShellSeam,
  resolveStageRunner,
} from '../src/seam.ts'

// A fake shell recording every resolved command and the requests it saw.
const commands = []
const requests = []
const fakeShell = {
  resolve(request) {
    requests.push(request)
    return {
      command: request.command,
      workdir: request.workdir ?? '/workspace',
      timeoutMs: request.timeoutMs ?? 60_000,
    }
  },
  run: async (spec) => {
    commands.push(spec.command)
    if (spec.command.includes('fail')) {
      return { exitCode: 7, stdout: { text: 'boom-out' }, stderr: { text: 'boom-err' } }
    }
    return { exitCode: 0, stdout: { text: 'ok:' + spec.command }, stderr: { text: '' } }
  },
}

const profile = {
  id: 'sbx-1',
  name: 'Local',
  type: 'local-sandbox',
  isDefault: false,
  createdAt: '',
  updatedAt: '',
}

// 1. buildShellRunCommand folds a ShellRunResult into a StageExecutionResult
//    and forwards the resolved timeout.
const runCommand = buildShellRunCommand({ shell: fakeShell }, { timeoutMs: 5000 })
const single = await runCommand(profile, 'pip install numpy')
if (single.code !== 0) throw new Error('expected code 0, got ' + single.code)
if (single.stdout !== 'ok:pip install numpy') throw new Error('stdout mismatch: ' + single.stdout)
if (requests[0]?.timeoutMs !== 5000) throw new Error('timeout was not forwarded to the request')

// 2. buildStageExecutor runs every stage command in order and folds output.
const executor = buildStageExecutor({ runCommand }, profile)
const ok = await executor({ id: 'python', commands: ['pip a', 'pip b'] }, undefined)
if (ok.code !== 0) throw new Error('stage should succeed, got code ' + ok.code)
if (ok.stdout !== 'ok:pip a\nok:pip b') throw new Error('folded stdout mismatch: ' + ok.stdout)

// 3. A failing command stops the stage and forwards the non-zero exit code.
const before = commands.length
const failed = await executor({ id: 'python', commands: ['pip a', 'pip fail', 'pip c'] }, undefined)
if (failed.code !== 7) throw new Error('expected failed code 7, got ' + failed.code)
if (failed.stderr !== 'boom-err') throw new Error('stderr mismatch: ' + failed.stderr)
if (commands.length !== before + 2) throw new Error('commands after the failure must not run')

// 4. dryRun records success without ever calling the shell.
const dryRun = resolveStageRunner(fakeShell, { dryRun: true })
const beforeDry = commands.length
const dry = await dryRun.runCommand(profile, 'pip install x')
if (dry.code !== 0) throw new Error('dry-run should succeed')
if (commands.length !== beforeDry) throw new Error('dry-run must not call the shell')

// 5. An unavailable shell fails loud, unless dryRun is set.
let threw = false
try { resolveStageRunner(undefined, {}) } catch { threw = true }
if (!threw) throw new Error('an unavailable shell should fail loud')
resolveStageRunner(undefined, { dryRun: true }) // must not throw

// 6. registerShellSeam is lazy: it never asserts at load, so a shell provider
//    mounted later in the composition is honored. Fail-loud is deferred to
//    resolveStageRunner (covered above).
registerShellSeam({ get: (name) => (name === 'shell' ? fakeShell : undefined) })
registerShellSeam({ get: () => undefined }, { dryRun: true })
registerShellSeam({ get: () => undefined }) // must not throw (lazy)

console.log('SEAM-SMOKE-OK', {
  commands: commands.length,
  folded: ok.stdout,
  failedCode: failed.code,
  dryRunCommands: commands.length - beforeDry,
})
