/**
 * rin web-server — /api/monitor/snapshot route tests.
 *
 * The route consumes ctx.monitor through the RinServiceRefs monitorSnapshot
 * thunk; these tests drive it with a fake monitor service (no /proc reads).
 * The parsing and snapshot-core tests for the service itself live in the
 * owning @rin/monitor package (rin/core/monitor/tests/monitor.test.ts).
 */

import { describe, expect, test } from 'vitest'
import type { MonitorSnapshot } from '@rin/monitor'
import { handle } from '../src/routes/legacy.ts'

const config = { port: 8320, host: '127.0.0.1', repositoryRoot: '/repo' }

/** Services bag whose every optional service is absent; overrides replace thunks. */
function makeServices(overrides: Record<string, () => unknown> = {}) {
  const base: Record<string, () => unknown> = {
    repository: () => undefined,
    environment: () => undefined,
    smartPruning: () => undefined,
    knowledge: () => undefined,
    sessionSearch: () => undefined,
    promptMemory: () => undefined,
    evolution: () => undefined,
    skillMemory: () => undefined,
    agents: () => undefined,
    notes: () => undefined,
    sandboxes: () => undefined,
    tokenOptimization: () => undefined,
    sessions: () => undefined,
    sessionPersistence: () => undefined,
    sessionTitle: () => undefined,
    dshAgents: () => undefined,
    agentDefaultModel: () => undefined,
    settings: () => undefined,
    permissionPresets: () => undefined,
    llm: () => undefined,
    credentials: () => undefined,
    workspaceRegistry: () => undefined,
    commands: () => undefined,
    tokenMeter: () => undefined,
    sessionProjections: () => undefined,
    shell: () => undefined,
    mcp: () => undefined,
    providerProbe: () => undefined,
    teams: () => undefined,
    tasks: () => undefined,
    computerUse: () => undefined,
    agentMigration: () => undefined,
    filesystem: () => undefined,
    sessionBackup: () => undefined,
    memory: () => undefined,
    plugins: () => undefined,
    codegraph: () => undefined,
    monitorSnapshot: () => undefined,
  }
  return { ...base, ...overrides }
}

const snapshot: MonitorSnapshot = {
  at: '2026-01-01T00:00:00.000Z',
  host: {
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
  processes: [{ pid: 1, name: 'init', rssMb: 12.5 }],
  containers: [{ containerId: 'abc', cpuPercent: '0.05%', memUsage: '1.2MiB / 15.6GiB', memPercent: '0.01%', netIO: '1kB / 2kB', blockIO: '0B / 0B' }],
}

describe('web-server: monitor snapshot route', () => {
  test('GET returns the ctx.monitor service snapshot body', async () => {
    const services = makeServices({ monitorSnapshot: () => ({ snapshot: async () => snapshot }) })
    const res = await handle('/api/monitor/snapshot', '', 'GET', undefined, services, config)
    expect(res).toEqual({ status: 200, body: snapshot })
  })

  test('non-GET returns 405', async () => {
    const services = makeServices({ monitorSnapshot: () => ({ snapshot: async () => snapshot }) })
    expect(await handle('/api/monitor/snapshot', '', 'POST', undefined, services, config))
      .toEqual({ status: 405, body: { error: 'method not allowed' } })
  })

  test('unmounted monitor service returns notMounted', async () => {
    expect(await handle('/api/monitor/snapshot', '', 'GET', undefined, makeServices(), config))
      .toEqual({ status: 200, body: { mounted: false } })
  })

  test('service failure returns 500', async () => {
    const services = makeServices({
      monitorSnapshot: () => ({ snapshot: async () => { throw new Error('proc unreadable') } }),
    })
    expect(await handle('/api/monitor/snapshot', '', 'GET', undefined, services, config))
      .toEqual({ status: 500, body: { error: 'proc unreadable' } })
  })
})
