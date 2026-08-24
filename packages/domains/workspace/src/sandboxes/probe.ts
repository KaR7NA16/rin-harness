/**
 * rin sandboxes — capability probing.
 *
 * Pure probe logic: the POSIX probe script run inside a container, the
 * key=value output parser, the container-runtime resolver, and local runtime
 * detection against an injected execFile. No process spawning here;
 * providers.ts injects the real execFile wrapper.
 *
 * @module @rin/workspace/sandboxes
 */

import type { ResolverCapabilities } from '@rin/assets'
import type { ContainerRuntime, ProbeExec } from './types.ts'

/** Cap for a single runtime probe; a probe exceeding it counts as absent. */
export const PROBE_TIMEOUT_MS = 3_000

const LOCAL_RUNTIME_CANDIDATES: Record<keyof ResolverCapabilities['runtimes'], Array<readonly [string, string[]]>> = {
  apt: [['apt-get', ['--version']]],
  python: [['python', ['--version']], ['python3', ['--version']]],
  pip: [['python', ['-m', 'pip', '--version']], ['python3', ['-m', 'pip', '--version']], ['pip', ['--version']]],
  r: [['Rscript', ['--version']]],
  npm: [['npm', ['--version']]],
  tlmgr: [['tlmgr', ['--version']]],
}

/**
 * The POSIX probe script executed inside a container. It prints one
 * key=value line per runtime, consumed by parseCapabilityProbe.
 *
 * @returns the probe shell script.
 */
export function containerCapabilityProbeScript(): string {
  return [
    "printf 'platform='; uname -s",
    "command -v apt-get >/dev/null 2>&1 && echo 'apt=1' || echo 'apt=0'",
    "command -v python >/dev/null 2>&1 && echo 'python=1' || echo 'python=0'",
    "python -m pip --version >/dev/null 2>&1 && echo 'pip=1' || echo 'pip=0'",
    "command -v Rscript >/dev/null 2>&1 && echo 'r=1' || echo 'r=0'",
    "command -v npm >/dev/null 2>&1 && echo 'npm=1' || echo 'npm=0'",
    "command -v tlmgr >/dev/null 2>&1 && echo 'tlmgr=1' || echo 'tlmgr=0'",
  ].join('; ')
}

/**
 * Parse probe output lines (key=value) into capabilities.
 *
 * @param output - the probe script's combined stdout.
 * @returns the resolved capabilities.
 */
export function parseCapabilityProbe(output: string): ResolverCapabilities {
  const values = new Map<string, string>()
  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    values.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim())
  }
  return {
    platform: normalizePlatform(values.get('platform')),
    runtimes: {
      apt: values.get('apt') === '1',
      python: values.get('python') === '1',
      pip: values.get('pip') === '1',
      r: values.get('r') === '1',
      npm: values.get('npm') === '1',
      tlmgr: values.get('tlmgr') === '1',
    },
  }
}

/**
 * Resolve the effective container runtime from a preference and a detection
 * result. A concrete preference wins; otherwise the detected runtime is used.
 *
 * @param preferred - the profile's runtime preference (may be 'auto').
 * @param detected - the runtime detected on the host, or null.
 * @returns the runtime to invoke.
 */
export function resolveContainerRuntime(
  preferred: ContainerRuntime | undefined,
  detected: 'docker' | 'podman' | null,
): 'docker' | 'podman' {
  if (preferred === 'docker' || preferred === 'podman') return preferred
  if (detected === 'docker' || detected === 'podman') return detected
  throw new Error('rin sandboxes: no container runtime found (docker/podman)')
}

/**
 * Detect local runtimes by probing each binary with the injected exec.
 *
 * @param exec - the execFile wrapper to probe with.
 * @param platform - the host platform (process.platform).
 * @returns the runtime presence flags.
 */
export async function probeLocalRuntimes(exec: ProbeExec, platform: string): Promise<ResolverCapabilities['runtimes']> {
  const linuxOnly = platform === 'linux'
  return {
    apt: linuxOnly && await anyProbe(exec, LOCAL_RUNTIME_CANDIDATES.apt),
    python: await anyProbe(exec, LOCAL_RUNTIME_CANDIDATES.python),
    pip: await anyProbe(exec, LOCAL_RUNTIME_CANDIDATES.pip),
    r: await anyProbe(exec, LOCAL_RUNTIME_CANDIDATES.r),
    npm: await anyProbe(exec, LOCAL_RUNTIME_CANDIDATES.npm),
    tlmgr: await anyProbe(exec, LOCAL_RUNTIME_CANDIDATES.tlmgr),
  }
}

function normalizePlatform(value: string | undefined): string {
  if (!value) return 'unknown'
  const lower = value.toLowerCase()
  if (lower.startsWith('linux')) return 'linux'
  if (lower.startsWith('darwin')) return 'darwin'
  if (lower.startsWith('mingw') || lower.startsWith('msys') || lower.startsWith('cygwin') || lower.startsWith('win32')) return 'win32'
  return lower
}

async function anyProbe(exec: ProbeExec, candidates: Array<readonly [string, string[]]>): Promise<boolean> {
  for (const [file, args] of candidates) {
    try {
      await exec(file, [...args])
      return true
    } catch {
      // A missing binary or failed version check means "not present"; try the next candidate.
    }
  }
  return false
}
