/**
 * rin monitor — tool registration tests.
 *
 * Register monitor_snapshot against a fake structural seam (tools registry +
 * system-prompt sections + a lazy monitor accessor) so no dsh tools graph is
 * booted. Asserts the registration surface and the execute-time behavior:
 * the tool returns the real service snapshot with containers omitted, and
 * fails loud when the monitor service is not mounted.
 *
 * @module @rin/health/monitor
 */

import { describe, expect, test } from 'vitest'
import {
  collectMonitorToolSnapshot,
  MONITOR_PROMPT_SECTION,
  MONITOR_TOOL_NAME,
  registerMonitorTool,
  type MonitorToolSeam,
} from '../../src/monitor/seam.ts'
import type { MonitorService } from '../../src/monitor/service.ts'
import type { MonitorSnapshot } from '../../src/monitor/monitor.ts'

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

/** A fake structural seam capturing registrations and serving a monitor. */
function makeSeam(monitor: MonitorService | undefined) {
  const tools: unknown[] = []
  const sections: Array<{ name: string; order: number; text: string }> = []
  const seam: MonitorToolSeam = {
    tools: { register(tool) { tools.push(tool); return () => undefined } },
    systemPrompt: { section(section) { sections.push(section) } },
    monitor: () => monitor,
  }
  return { seam, tools, sections }
}

describe('registerMonitorTool', () => {
  test('registers one monitor_snapshot tool with no parameters', () => {
    const { seam, tools } = makeSeam({ snapshot: async () => snapshot } as MonitorService)
    registerMonitorTool(seam)
    expect(tools).toHaveLength(1)
    const tool = tools[0] as { name: string; parameters: Record<string, unknown>; description: string }
    expect(tool.name).toBe(MONITOR_TOOL_NAME)
    // defineTool compiles an empty parameters map into an explicit empty object schema.
    expect(tool.parameters).toEqual({ type: 'object', properties: {} })
    expect(tool.description).toContain('CPU')
  })

  test('adds a short system-prompt section for the tool', () => {
    const { seam, sections } = makeSeam({ snapshot: async () => snapshot } as MonitorService)
    registerMonitorTool(seam)
    expect(sections).toHaveLength(1)
    expect(sections[0]?.name).toBe(MONITOR_PROMPT_SECTION)
    expect(sections[0]?.order).toBeGreaterThan(100)
    expect(sections[0]?.text).toContain('monitor_snapshot')
  })

  test('executing the tool returns the service snapshot with containers omitted', async () => {
    const { seam, tools } = makeSeam({ snapshot: async () => snapshot } as MonitorService)
    registerMonitorTool(seam)
    const tool = tools[0] as { execute(args: unknown): Promise<unknown> }
    const value = await tool.execute({})
    expect(value).toEqual({
      at: '2026-01-01T00:00:00.000Z',
      host: snapshot.host,
      processes: snapshot.processes,
    })
    expect('containers' in (value as object)).toBe(false)
  })

  test('executing the tool fails loud when the monitor service is not mounted', async () => {
    const { seam, tools } = makeSeam(undefined)
    registerMonitorTool(seam)
    const tool = tools[0] as { execute(args: unknown): Promise<unknown> }
    await expect(tool.execute({})).rejects.toThrow(/not mounted/)
  })
})

describe('collectMonitorToolSnapshot', () => {
  test('projects the service snapshot without containers', async () => {
    const value = await collectMonitorToolSnapshot({ snapshot: async () => snapshot } as MonitorService)
    expect(value).toEqual({ at: snapshot.at, host: snapshot.host, processes: snapshot.processes })
  })

  test('rejects with a clear error when the service is absent', async () => {
    await expect(collectMonitorToolSnapshot(undefined)).rejects.toThrow(/not mounted/)
  })
})
