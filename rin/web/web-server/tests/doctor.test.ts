/**
 * rin web-server — /api/doctor route tests.
 *
 * The route consumes ctx.doctor through the RinServiceRefs doctor thunk;
 * these tests drive it with a fake doctor service (no real diagnostic runs).
 * The report assembly tests for the service itself live in the owning
 * @rin/doctor package (rin/core/doctor/tests).
 *
 * @module @rin/web-server
 */

import { describe, expect, test } from 'vitest'
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
    plugins: () => undefined,
    codegraph: () => undefined,
    monitorSnapshot: () => undefined,
    doctor: () => undefined,
  }
  return { ...base, ...overrides }
}

const report = {
  at: '2026-01-01T00:00:00.000Z',
  runtime: { nodeVersion: 'v22.19.0', platform: 'linux', arch: 'x64', uptimeSec: 1234 },
  config: { home: '/home/u/.rin', exists: true, writable: true },
  host: { monitorAvailable: false },
  llm: { mounted: false, providers: [], anyConfigured: false },
  services: [{ name: 'monitor', mounted: false }],
}

describe('web-server: doctor route', () => {
  test('GET returns the ctx.doctor service report body', async () => {
    const services = makeServices({ doctor: () => ({ runDiagnostics: async () => report }) })
    const res = await handle('/api/doctor', '', 'GET', undefined, services, config)
    expect(res).toEqual({ status: 200, body: report })
  })

  test('non-GET returns 405', async () => {
    const services = makeServices({ doctor: () => ({ runDiagnostics: async () => report }) })
    expect(await handle('/api/doctor', '', 'POST', undefined, services, config))
      .toEqual({ status: 405, body: { error: 'method not allowed' } })
  })

  test('unmounted doctor service returns an explicit 501', async () => {
    expect(await handle('/api/doctor', '', 'GET', undefined, makeServices(), config))
      .toEqual({ status: 501, body: { error: 'doctor service is not mounted' } })
  })

  test('service failure returns 500', async () => {
    const services = makeServices({
      doctor: () => ({ runDiagnostics: async () => { throw new Error('probe failed') } }),
    })
    expect(await handle('/api/doctor', '', 'GET', undefined, services, config))
      .toEqual({ status: 500, body: { error: 'probe failed' } })
  })
})
