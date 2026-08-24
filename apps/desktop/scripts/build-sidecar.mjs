#!/usr/bin/env node

/**
 * Build the Tauri sidecar as a native Node executable plus a deployed ESM
 * runtime. Cordis dynamically imports plugins, which requires the normal Node
 * module loader rather than a VM-snapshot single-file packager.
 */
import { chmod, copyFile, cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const desktopDir = resolve(repoRoot, 'apps/desktop')
const TARGETS = new Map([
  ['x86_64-unknown-linux-gnu', { platform: 'linux', arch: 'x64', ext: '' }],
  ['aarch64-unknown-linux-gnu', { platform: 'linux', arch: 'arm64', ext: '' }],
  ['x86_64-pc-windows-msvc', { platform: 'win32', arch: 'x64', ext: '.exe' }],
  ['aarch64-pc-windows-msvc', { platform: 'win32', arch: 'arm64', ext: '.exe' }],
  ['x86_64-apple-darwin', { platform: 'darwin', arch: 'x64', ext: '' }],
  ['aarch64-apple-darwin', { platform: 'darwin', arch: 'arm64', ext: '' }],
])
const USAGE = [
  'usage: rin [web] [--port <port>] [--host <host>]',
  '',
  'options:',
  '  --port <port>  web server port (default: 8320)',
  '  --host <host>  listen address (default: 127.0.0.1)',
  '  --version      print version',
  '  --help         print help',
].join('\n')

function argument(name) {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

function nativeTriple() {
  for (const [triple, target] of TARGETS) {
    if (target.platform === process.platform && target.arch === process.arch) return triple
  }
  throw new Error('Unsupported native Node platform ' + process.platform + '/' + process.arch)
}

function targetTriple() {
  return argument('--target') ?? process.env.TAURI_TARGET_TRIPLE ?? process.env.RUST_TARGET ?? nativeTriple()
}

function commandInvocation(command, args) {
  if (process.platform === 'win32' && command.toLowerCase().endsWith('.cmd')) {
    return {
      command: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', command, ...args],
    }
  }
  return { command, args }
}

function run(command, args) {
  const invocation = commandInvocation(command, args)
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'inherit',
    windowsHide: true,
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(command + ' ' + args.join(' ') + ' exited with status ' + result.status)
}

function capture(command, args) {
  const invocation = commandInvocation(command, args)
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(command + ' ' + args.join(' ') + ' exited with status ' + result.status)
  return result.stdout.trim()
}

async function reservePort() {
  const server = createServer()
  await new Promise((done, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', done)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('failed to reserve a smoke-test port')
  await new Promise((done, reject) => server.close(error => error ? reject(error) : done()))
  return address.port
}

async function runtimeSmoke(executable, runtimeEntry) {
  const port = await reservePort()
  const home = await mkdtemp(join(tmpdir(), 'rin-sidecar-smoke-'))
  const child = spawn(executable, [runtimeEntry, 'web', '--port', String(port), '--host', '127.0.0.1'], {
    cwd: repoRoot,
    env: { ...process.env, RIN_HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk.toString() })
  child.stderr.on('data', chunk => { output += chunk.toString() })
  let status
  try {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (child.exitCode !== null) break
      try {
        const response = await fetch('http://127.0.0.1:' + port + '/api/status')
        if (response.ok) {
          status = await response.json()
          break
        }
      } catch {}
      await new Promise(done => setTimeout(done, 500))
    }
  } finally {
    if (child.exitCode === null) {
      child.kill()
      await new Promise(done => child.once('exit', done))
    }
    await rm(home, { recursive: true, force: true })
  }
  if (status?.status !== 'ok') throw new Error('sidecar runtime smoke failed\n' + output.slice(-12000))
  return status
}

async function writeRuntimeEntry(runtimeDir) {
  const entryPath = join(runtimeDir, 'entry.mjs')
  const lines = [
    '#!/usr/bin/env node',
    "import { dirname, join } from 'node:path'",
    "import { fileURLToPath } from 'node:url'",
    '',
    'const runtimeRoot = dirname(fileURLToPath(import.meta.url))',
    "process.env.RIN_DSH_BASE_PATCH_PATH = join(runtimeRoot, 'node_modules/@deepseek-ai/dsh-base/cordis.patch.yml')",
    'process.env.RIN_BARE_MODULE_BASE_URL = import.meta.url',
    "process.env.RIN_BUILTIN_REPOSITORY_ROOT = join(runtimeRoot, 'repository')",
    "process.env.RIN_WEB_UI_DIST_ROOT = join(runtimeRoot, 'web')",
    "process.env.RIN_HOST_CONFIG_PATH = join(runtimeRoot, 'src/cordis.yml')",
    "process.env.RIN_PACKAGED_RUNTIME = '1'",
    '',
    'const USAGE = ' + JSON.stringify(USAGE),
    'function option(name) {',
    '  const index = process.argv.indexOf(name)',
    '  return index < 0 ? undefined : process.argv[index + 1]',
    '}',
    'async function main() {',
    "  if (process.argv.includes('--help')) { console.log(USAGE); return }",
    "  if (process.argv.includes('--version')) { console.log('rin 0.1.0'); return }",
    "  const portText = option('--port')",
    '  const port = portText === undefined ? undefined : Number(portText)',
    "  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('invalid --port: ' + portText)",
    "  const { startHost } = await import('./lib/types/host.js')",
    "  const host = await startHost({ port, host: option('--host') })",
    "  console.log('rin host on ' + host.baseUrl)",
    '  let exiting = false',
    '  const close = code => {',
    '    if (exiting) return',
    '    exiting = true',
    '    void host.close().finally(() => process.exit(code))',
    '  }',
    "  process.on('SIGINT', () => close(130))",
    "  process.on('SIGTERM', () => close(0))",
    '  const parentPid = Number(process.env.RIN_PARENT_PID)',
    '  if (Number.isInteger(parentPid) && parentPid > 0) {',
    '    const watchdog = setInterval(() => {',
    '      try { process.kill(parentPid, 0) } catch { close(0) }',
    '    }, 1000)',
    '    watchdog.unref()',
    '  }',
    '}',
    'void main().catch(error => {',
    "  console.error('rin:')",
    '  console.dir(error, { depth: null })',
    '  process.exitCode = 1',
    '})',
    '',
  ]
  await writeFile(entryPath, lines.join('\n'), 'utf8')
  await chmod(entryPath, 0o755)
  return entryPath
}

async function build() {
  const triple = targetTriple()
  const target = TARGETS.get(triple)
  if (target === undefined) throw new Error('Unsupported sidecar target ' + triple)
  if (target.platform !== process.platform || target.arch !== process.arch) {
    throw new Error('Sidecar target ' + triple + ' requires a native ' + target.platform + '/' + target.arch + ' runner; current Node is ' + process.platform + '/' + process.arch)
  }
  const outputDir = resolve(argument('--output-dir') ?? join(desktopDir, 'src-tauri/binaries'))
  const runtimeDir = resolve(argument('--runtime-dir') ?? join(desktopDir, 'src-tauri/sidecar-runtime'))
  const outputPath = join(outputDir, 'rin-sidecar-' + triple + target.ext)
  await rm(runtimeDir, { recursive: true, force: true })
  await mkdir(outputDir, { recursive: true })

  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  // Deployment consumes compiled package outputs. Build the host project and
  // all of its project references so a clean checkout never depends on ignored
  // lib/ artifacts left behind by an earlier local typecheck.
  run(pnpm, ['exec', 'tsc', '-b', 'packages/runtime/host/tsconfig.json'])
  // The modern deploy implementation injects workspace packages into the
  // virtual store, producing a self-contained runtime. Legacy deploy preserves
  // links back into the checkout and can also copy workspace-local node_modules,
  // which Tauri cannot package reliably.
  run(pnpm, [
    '--config.node-linker=hoisted',
    '--filter',
    '@rin/host',
    'deploy',
    '--prod',
    runtimeDir,
  ])
  await cp(
    resolve(repoRoot, 'packages/domains/assets/builtin'),
    join(runtimeDir, 'repository'),
    { recursive: true },
  )
  await cp(resolve(repoRoot, 'apps/web/dist'), join(runtimeDir, 'web'), { recursive: true })
  const runtimeEntry = await writeRuntimeEntry(runtimeDir)
  await copyFile(process.execPath, outputPath)
  if (target.ext === '') await chmod(outputPath, 0o755)

  const help = capture(outputPath, [runtimeEntry, '--help'])
  if (!help.includes('usage: rin')) throw new Error('sidecar --help did not print the rin usage contract')
  const runtimeStatus = await runtimeSmoke(outputPath, runtimeEntry)
  console.log('sidecar: ' + outputPath)
  console.log('sidecar runtime: ' + runtimeDir)
  console.log('sidecar target: ' + triple + ' (native Node ' + process.version + ')')
  console.log('sidecar smoke: --help passed, runtime status=' + runtimeStatus.status)
}

async function main() {
  const triple = targetTriple()
  const target = TARGETS.get(triple)
  if (target === undefined) throw new Error('Unsupported sidecar target ' + triple)
  if (process.argv.includes('--check')) {
    console.log('sidecar target mapping: ' + triple + ' -> ' + target.platform + '/' + target.arch)
    console.log('node: ' + process.version)
    return
  }
  await build()
}

main().catch(error => {
  console.error('build-sidecar: ' + (error instanceof Error ? error.message : String(error)))
  process.exitCode = 1
})
