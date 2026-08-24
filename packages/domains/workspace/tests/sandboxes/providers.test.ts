/**
 * rin sandboxes — providers module tests.
 *
 * Pure provider logic: capability-probe parsing, runtime resolution, exec
 * argv construction, provider dispatch, and local runtime detection against
 * an injected probe function.
 */

import { describe, expect, it } from 'vitest'
import type { ResolverCapabilities } from '@rin/assets'
import {
  buildContainerExecArgs,
  containerName,
  providerFor,
  RemoteProvider,
} from '../../src/sandboxes/providers.ts'
import {
  containerCapabilityProbeScript,
  parseCapabilityProbe,
  probeLocalRuntimes,
  resolveContainerRuntime,
} from '../../src/sandboxes/probe.ts'
import type { SandboxProfile, SandboxProviders } from '../../src/sandboxes/types.ts'

const CAPABILITIES: ResolverCapabilities = {
  platform: 'linux',
  runtimes: { apt: true, python: true, pip: true, r: true, npm: true, tlmgr: true },
}

function profile(type: SandboxProfile['type']): SandboxProfile {
  return {
    id: 'p1',
    name: 'p',
    type,
    isDefault: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('parseCapabilityProbe', () => {
  it('parses key=value lines into capabilities', () => {
    const caps = parseCapabilityProbe('platform=Linux\napt=1\npython=1\npip=1\nr=0\nnpm=0\ntlmgr=0')
    expect(caps.platform).toBe('linux')
    expect(caps.runtimes).toEqual({ apt: true, python: true, pip: true, r: false, npm: false, tlmgr: false })
  })

  it('normalizes darwin and win32 platforms', () => {
    expect(parseCapabilityProbe('platform=Darwin').platform).toBe('darwin')
    expect(parseCapabilityProbe('platform=MINGW64_NT-10.0').platform).toBe('win32')
  })

  it('defaults missing keys to false and an unknown platform', () => {
    const caps = parseCapabilityProbe('')
    expect(caps.platform).toBe('unknown')
    expect(caps.runtimes).toEqual({ apt: false, python: false, pip: false, r: false, npm: false, tlmgr: false })
  })
})

describe('resolveContainerRuntime', () => {
  it('prefers an explicit runtime', () => {
    expect(resolveContainerRuntime('podman', 'docker')).toBe('podman')
  })

  it('falls back to the detected runtime for auto or missing preference', () => {
    expect(resolveContainerRuntime('auto', 'docker')).toBe('docker')
    expect(resolveContainerRuntime(undefined, 'podman')).toBe('podman')
  })

  it('throws when no runtime is available', () => {
    expect(() => resolveContainerRuntime('auto', null)).toThrow(/no container runtime/)
  })
})

describe('buildContainerExecArgs', () => {
  it('builds a docker exec argv with the default shell', () => {
    expect(buildContainerExecArgs('docker', 'rin-sbx-x', undefined, 'echo hi'))
      .toEqual(['docker', 'exec', 'rin-sbx-x', '/bin/sh', '-lc', 'echo hi'])
  })

  it('honors a custom shell', () => {
    expect(buildContainerExecArgs('podman', 'n', '/bin/bash', 'x')[3]).toBe('/bin/bash')
  })
})

describe('containerName', () => {
  it('namespaces the container name', () => {
    expect(containerName('abc')).toBe('rin-sbx-abc')
  })
})

describe('containerCapabilityProbeScript', () => {
  it('probes all six runtimes', () => {
    const script = containerCapabilityProbeScript()
    expect(script).toContain("echo 'apt=1'")
    expect(script).toContain("echo 'tlmgr=1'")
    expect(script).toContain('uname -s')
  })
})

describe('probeLocalRuntimes', () => {
  it('detects present runtimes via the injected exec', async () => {
    const exec = async (file: string) => {
      if (file === 'python') return 'ok'
      throw new Error('missing ' + file)
    }
    const runtimes = await probeLocalRuntimes(exec, 'linux')
    expect(runtimes).toEqual({ apt: false, python: true, pip: true, r: false, npm: false, tlmgr: false })
  })

  it('never reports apt outside Linux', async () => {
    const exec = async () => 'ok'
    const runtimes = await probeLocalRuntimes(exec, 'win32')
    expect(runtimes.apt).toBe(false)
    expect(runtimes.python).toBe(true)
  })
})

describe('providerFor', () => {
  const providers: SandboxProviders = {
    local: fake('local-sandbox'),
    container: fake('container'),
    remote: fake('remote'),
  }

  it('dispatches each type to its provider', () => {
    expect(providerFor(profile('local-sandbox'), providers)).toBe(providers.local)
    expect(providerFor(profile('container'), providers)).toBe(providers.container)
    expect(providerFor(profile('remote'), providers)).toBe(providers.remote)
  })
})

describe('RemoteProvider', () => {
  it('throws the P3 not-implemented error for probe and run', async () => {
    const remote = new RemoteProvider()
    await expect(remote.probeCapabilities(profile('remote'))).rejects.toThrow(/P3/)
    await expect(remote.runCommand(profile('remote'), 'echo hi')).rejects.toThrow(/P3/)
  })
})

function fake(type: SandboxProfile['type']): SandboxProviders['local'] {
  return {
    type,
    probeCapabilities: async () => CAPABILITIES,
    runCommand: async () => ({ code: 0, stdout: '', stderr: '' }),
  }
}
