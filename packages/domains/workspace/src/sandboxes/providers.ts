/**
 * rin sandboxes — per-type providers.
 *
 * LocalProvider probes the host and spawns commands locally; ContainerProvider
 * wraps docker/podman exec with pure command construction and probe parsing;
 * RemoteProvider is an explicit stub (P3). The provider contract lives in
 * types.ts; this module owns the subprocess calls.
 *
 * @module @rin/workspace/sandboxes
 */

import { execFile, spawn } from 'node:child_process'
import type { ResolverCapabilities } from '@rin/assets'
import type {
  ContainerConfig,
  ProbeExec,
  SandboxProfile,
  SandboxProvider,
  SandboxProviders,
  StageExecutionResult,
} from './types.ts'
import {
  containerCapabilityProbeScript,
  parseCapabilityProbe,
  probeLocalRuntimes,
  resolveContainerRuntime,
  PROBE_TIMEOUT_MS,
} from './probe.ts'

const CONTAINER_NAME_PREFIX = 'rin-sbx-'
const REMOTE_NOT_IMPLEMENTED = 'rin sandboxes: remote sandbox execution is not implemented (P3)'

/**
 * A promise wrapper over execFile that resolves stdout or rejects on any
 * failure (missing binary, non-zero exit, or timeout).
 *
 * @param file - the executable to probe.
 * @param args - the arguments to pass.
 * @returns the process stdout.
 */
export function defaultProbeExec(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: PROBE_TIMEOUT_MS }, (error, stdout) => {
      if (error) reject(error)
      else resolve(String(stdout))
    })
  })
}

/** Local host executor: probes installed runtimes and spawns commands locally. */
export class LocalProvider implements SandboxProvider {
  readonly type = 'local-sandbox'
  private readonly exec: ProbeExec
  private readonly platform: string

  constructor(options: { exec?: ProbeExec; platform?: string } = {}) {
    this.exec = options.exec ?? defaultProbeExec
    this.platform = options.platform ?? process.platform
  }

  async probeCapabilities(_profile: SandboxProfile): Promise<ResolverCapabilities> {
    return { platform: this.platform, runtimes: await probeLocalRuntimes(this.exec, this.platform) }
  }

  async runCommand(profile: SandboxProfile, command: string): Promise<StageExecutionResult> {
    return spawnShell(command, profile.repositoryPath)
  }
}

/** docker/podman executor: probes via container exec and runs commands inside. */
export class ContainerProvider implements SandboxProvider {
  readonly type = 'container'

  async probeCapabilities(profile: SandboxProfile): Promise<ResolverCapabilities> {
    const container = requireContainer(profile)
    const runtime = await this.resolveRuntime(container)
    const result = await this.execIn(profile.id, runtime, container.shell, containerCapabilityProbeScript())
    if (result.code !== 0) {
      throw new Error('rin sandboxes: capability probe failed: ' + (result.stderr || 'exit ' + result.code))
    }
    return parseCapabilityProbe(result.stdout)
  }

  async runCommand(profile: SandboxProfile, command: string): Promise<StageExecutionResult> {
    const container = requireContainer(profile)
    const runtime = await this.resolveRuntime(container)
    return this.execIn(profile.id, runtime, container.shell, command)
  }

  private async resolveRuntime(container: ContainerConfig): Promise<'docker' | 'podman'> {
    return resolveContainerRuntime(container.runtime, await this.detectRuntime())
  }

  private async detectRuntime(): Promise<'docker' | 'podman' | null> {
    for (const candidate of ['docker', 'podman'] as const) {
      const result = await spawnProcess(candidate, ['--version'])
      if (result.code === 0 && (result.stdout || result.stderr)) return candidate
    }
    return null
  }

  private async execIn(id: string, runtime: 'docker' | 'podman', shell: string | undefined, command: string): Promise<StageExecutionResult> {
    return spawnProcess(runtime, buildContainerExecArgs(runtime, containerName(id), shell, command))
  }
}

/** Explicit stub for remote SSH sandboxes; deferred to P3. */
export class RemoteProvider implements SandboxProvider {
  readonly type = 'remote'

  async probeCapabilities(_profile: SandboxProfile): Promise<ResolverCapabilities> {
    throw new Error(REMOTE_NOT_IMPLEMENTED)
  }

  async runCommand(_profile: SandboxProfile, _command: string): Promise<StageExecutionResult> {
    throw new Error(REMOTE_NOT_IMPLEMENTED)
  }
}

/**
 * Build the docker/podman exec argv for one command.
 *
 * @param runtime - the runtime CLI to invoke.
 * @param name - the container name.
 * @param shell - the container shell (defaults to /bin/sh).
 * @param command - the shell command to run.
 * @returns the argv array.
 */
export function buildContainerExecArgs(runtime: 'docker' | 'podman', name: string, shell: string | undefined, command: string): string[] {
  return [runtime, 'exec', name, shell ?? '/bin/sh', '-lc', command]
}

/**
 * Derive the container name from a profile id.
 *
 * @param id - the profile id.
 * @returns the namespaced container name.
 */
export function containerName(id: string): string {
  return CONTAINER_NAME_PREFIX + id
}

/**
 * The three default providers.
 *
 * @param localOptions - optional overrides for the local provider.
 * @returns the provider set.
 */
export function defaultProviders(localOptions?: { exec?: ProbeExec; platform?: string }): SandboxProviders {
  return {
    local: new LocalProvider(localOptions),
    container: new ContainerProvider(),
    remote: new RemoteProvider(),
  }
}

/**
 * Select the provider for a profile's type.
 *
 * @param profile - the profile to dispatch.
 * @param providers - the provider set.
 * @returns the matching provider.
 */
export function providerFor(profile: SandboxProfile, providers: SandboxProviders): SandboxProvider {
  switch (profile.type) {
    case 'local-sandbox': return providers.local
    case 'container': return providers.container
    case 'remote': return providers.remote
    default: return assertNever(profile.type)
  }
}

function assertNever(value: never): never {
  throw new Error('rin sandboxes: unexpected sandbox type: ' + String(value))
}

function requireContainer(profile: SandboxProfile): ContainerConfig {
  if (!profile.container?.image) {
    throw new Error('rin sandboxes: container profile "' + profile.id + '" has no image')
  }
  return profile.container
}

function spawnShell(command: string, cwd: string | undefined): Promise<StageExecutionResult> {
  return spawnCapture(command, [], { shell: true, cwd })
}

function spawnProcess(file: string, args: string[]): Promise<StageExecutionResult> {
  return spawnCapture(file, args, {})
}

function spawnCapture(
  file: string,
  args: string[],
  options: { shell?: boolean; cwd?: string | undefined },
): Promise<StageExecutionResult> {
  return new Promise((resolve) => {
    const child = spawn(file, args, {
      shell: options.shell ?? false,
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => { stdout += String(chunk) })
    child.stderr?.on('data', (chunk: Buffer) => { stderr += String(chunk) })
    child.on('error', (error) => { resolve({ code: 1, stdout, stderr: error.message }) })
    child.on('close', (code) => { resolve({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() }) })
  })
}