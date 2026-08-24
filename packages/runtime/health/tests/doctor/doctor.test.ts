/**
 * rin doctor — report core unit tests.
 *
 * The assembly tests feed injected fake state (runtime facts, a config
 * section, a fake monitor, a fake llm, and a mounted predicate) so no real
 * /proc, llm, or filesystem is touched; readRuntime and probeConfigHome are
 * tested against the real process and a temp directory.
 *
 * @module @rin/health/doctor
 */

import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  assembleReport,
  probeConfigHome,
  readRuntime,
  rinHome,
  RIN_AUDIT_ENTRIES,
  type DoctorAssembleDeps,
  type DoctorLlmLike,
  type DoctorMonitorLike,
  type DoctorReport,
} from '../../src/doctor/doctor.ts'

const at = '2026-01-01T00:00:00.000Z'

const runtime = { nodeVersion: 'v22.19.0', platform: 'linux', arch: 'x64', uptimeSec: 1234 }

const config = { home: '/home/u/.rin', exists: true, writable: true }

const monitor: DoctorMonitorLike = {
  async snapshot() {
    return { host: {
      cpuPercent: 12.3,
      memTotalMb: 16000,
      memUsedMb: 7200,
      memPercent: 45,
      loadAvg: [0.5, 0.4, 0.3],
      diskTotalGb: 512,
      diskUsedGb: 128,
      diskPercent: 25,
      uptimeSec: 86400,
      platform: 'linux',
    } }
  },
}

const llm: DoctorLlmLike = {
  listProviders() {
    return [{ id: 'deepseek', name: 'DeepSeek' }, { id: 'openai', name: 'OpenAI' }]
  },
}

const mountedServices = new Set(['repository', 'monitor', 'knowledge'])
const mountedTools = new Set<string>()

function deps(overrides: Partial<DoctorAssembleDeps> = {}): DoctorAssembleDeps {
  return {
    at,
    runtime,
    config,
    monitor,
    llm,
    auditEntries: RIN_AUDIT_ENTRIES,
    serviceMounted: (service: string) => mountedServices.has(service),
    toolMounted: (tool: string) => mountedTools.has(tool),
    ...overrides,
  }
}

describe('doctor: runtime facts', () => {
  test('reads the live process fields', () => {
    const value = readRuntime()
    expect(value.nodeVersion).toBe(process.version)
    expect(value.platform).toBe(process.platform)
    expect(value.arch).toBe(process.arch)
    expect(value.uptimeSec).toBeGreaterThanOrEqual(0)
  })
})

describe('doctor: config home resolution', () => {
  test('prefers RIN_HOME when set and non-blank', () => {
    const previous = process.env.RIN_HOME
    process.env.RIN_HOME = '/tmp/rin-home'
    try {
      expect(rinHome()).toBe('/tmp/rin-home')
    } finally {
      if (previous === undefined) delete process.env.RIN_HOME
      else process.env.RIN_HOME = previous
    }
  })
})

describe('doctor: config home probe', () => {
  test('existing writable directory reports exists and writable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rin-doctor-'))
    try {
      expect(await probeConfigHome(dir)).toEqual({ home: dir, exists: true, writable: true })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('missing directory reports exists false and writable false', async () => {
    const missing = join(tmpdir(), 'rin-doctor-missing-' + Date.now())
    const section = await probeConfigHome(missing)
    expect(section.exists).toBe(false)
    expect(section.writable).toBe(false)
  })

  test('existing non-writable directory reports writable false with detail', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rin-doctor-'))
    try {
      await chmod(dir, 0o555)
      const section = await probeConfigHome(dir)
      expect(section.exists).toBe(true)
      if (process.getuid?.() === 0) {
        // root bypasses permission checks, so the assertion is environment-dependent
        return
      }
      expect(section.writable).toBe(false)
      expect(section.detail).toEqual(expect.any(String))
    } finally {
      await chmod(dir, 0o755).catch(() => {})
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('doctor: report assembly', () => {
  test('assembles the full report from mounted monitor and llm', async () => {
    const report: DoctorReport = await assembleReport(deps())
    expect(report).toEqual({
      at,
      runtime,
      config,
      host: {
        monitorAvailable: true,
        cpuPercent: 12.3,
        memTotalMb: 16000,
        memUsedMb: 7200,
        memPercent: 45,
        loadAvg: [0.5, 0.4, 0.3],
        diskTotalGb: 512,
        diskUsedGb: 128,
        diskPercent: 25,
        uptimeSec: 86400,
        platform: 'linux',
      },
      llm: {
        mounted: true,
        providers: [
          { id: 'deepseek', name: 'DeepSeek' },
          { id: 'openai', name: 'OpenAI' },
        ],
        anyConfigured: true,
      },
      services: RIN_AUDIT_ENTRIES.map(entry => ({
        name: entry.label,
        mounted: entry.service !== undefined ? mountedServices.has(entry.service) : entry.tool !== undefined ? mountedTools.has(entry.tool) : false,
      })),
    })
    expect(report.services.filter(entry => entry.mounted).map(entry => entry.name))
      .toEqual(['repository', 'knowledge', 'monitor'])
  })

  test('unmounted monitor reports monitorAvailable false with no metrics', async () => {
    const report = await assembleReport(deps({ monitor: undefined }))
    expect(report.host).toEqual({ monitorAvailable: false })
    expect('cpuPercent' in report.host).toBe(false)
  })

  test('unmounted llm reports mounted false and empty providers', async () => {
    const report = await assembleReport(deps({ llm: undefined }))
    expect(report.llm).toEqual({ mounted: false, providers: [], anyConfigured: false })
  })

  test('llm with no registered providers reports anyConfigured false', async () => {
    const emptyLlm: DoctorLlmLike = { listProviders: () => [] }
    const report = await assembleReport(deps({ llm: emptyLlm }))
    expect(report.llm).toEqual({ mounted: true, providers: [], anyConfigured: false })
  })

  test('service audit reflects the mounted predicate per name', async () => {
    const report = await assembleReport(deps({
      auditEntries: [
        { label: 'monitor', service: 'monitor' },
        { label: 'brief', tool: 'brief' },
      ],
      serviceMounted: () => false,
      toolMounted: (tool) => tool === 'brief',
    }))
    expect(report.services).toEqual([
      { name: 'monitor', mounted: false },
      { name: 'brief', mounted: true },
    ])
  })

  test('config section passes through verbatim (including a failure detail)', async () => {
    const failing = { home: '/readonly', exists: true, writable: false, detail: 'EACCES: permission denied' }
    const report = await assembleReport(deps({ config: failing }))
    expect(report.config).toEqual(failing)
  })
})
