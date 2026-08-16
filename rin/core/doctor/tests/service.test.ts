/**
 * rin doctor — service tests.
 *
 * Drives HostDoctorService against a real Cordis root context with fake
 * services provided through ctx.provide, plus an injected getService accessor
 * variant, so no real monitor snapshot, llm, or config home is read.
 *
 * @module @rin/doctor
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, test } from 'vitest'
import { HostDoctorService } from '../src/service.ts'

const hostMetrics = {
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
}

const fakeMonitor = { async snapshot() { return { host: hostMetrics } } }
const fakeLlm = { listProviders: () => [{ id: 'deepseek', name: 'DeepSeek' }] }
const fakeRepository = { list: async () => [] }

/** A real Cordis context with the fake optional services provided. */
function ctxWith(entries: Array<[string, unknown]>): Context {
  const ctx = new Context()
  for (const [name, value] of entries) ctx.provide(name, value)
  return ctx
}

describe('HostDoctorService', () => {
  test('reads the mounted monitor, llm, and audited services from ctx.get', async () => {
    const ctx = ctxWith([
      ['monitor', fakeMonitor],
      ['llm', fakeLlm],
      ['repository', fakeRepository],
    ])
    const service = new HostDoctorService(ctx, { at: '2026-01-01T00:00:00.000Z' })
    const report = await service.runDiagnostics()
    expect(report.host).toEqual({ monitorAvailable: true, ...hostMetrics })
    expect(report.llm).toEqual({ mounted: true, providers: [{ id: 'deepseek', name: 'DeepSeek' }], anyConfigured: true })
    expect(report.services.find(entry => entry.name === 'repository')?.mounted).toBe(true)
    expect(report.services.find(entry => entry.name === 'monitor')?.mounted).toBe(true)
    expect(report.services.find(entry => entry.name === 'brief')?.mounted).toBe(false)
    expect(report.services).toHaveLength(25)
  })

  test('unmounted monitor and llm degrade honestly', async () => {
    const service = new HostDoctorService(new Context(), { at: '2026-01-01T00:00:00.000Z' })
    const report = await service.runDiagnostics()
    expect(report.host).toEqual({ monitorAvailable: false })
    expect(report.llm).toEqual({ mounted: false, providers: [], anyConfigured: false })
    expect(report.services.every(entry => entry.mounted === false)).toBe(true)
  })

  test('an injected getService accessor overrides ctx.get', async () => {
    const values = new Map<string, unknown>([
      ['monitor', fakeMonitor],
      ['llm', fakeLlm],
    ])
    const service = new HostDoctorService(new Context(), {
      at: '2026-01-01T00:00:00.000Z',
      getService: (name: string) => values.get(name),
    })
    const report = await service.runDiagnostics()
    expect(report.host.monitorAvailable).toBe(true)
    expect(report.llm.mounted).toBe(true)
    // the audit goes through the injected accessor too: 'monitor' is in the map, 'brief' is not
    expect(report.services.find(entry => entry.name === 'monitor')?.mounted).toBe(true)
    expect(report.services.find(entry => entry.name === 'brief')?.mounted).toBe(false)
  })

  test('an injected checkConfig overrides the real fs probe', async () => {
    const service = new HostDoctorService(new Context(), {
      at: '2026-01-01T00:00:00.000Z',
      configHome: '/fake/home',
      checkConfig: async (home: string) => ({ home, exists: false, writable: false }),
    })
    const report = await service.runDiagnostics()
    expect(report.config).toEqual({ home: '/fake/home', exists: false, writable: false })
  })
})
