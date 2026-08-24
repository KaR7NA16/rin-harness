/**
 * rin monitor — strip-types smoke test for the tool seam.
 *
 * Registers monitor_snapshot against a fake structural seam and drives the
 * registered tool: mounted service returns the real snapshot with containers
 * omitted, unmounted fails loud. Runs under the rin smoke runner (tsx); also
 * runnable directly with node --experimental-strip-types from this directory.
 *
 * @module @rin/health/monitor
 */

import {
  MONITOR_PROMPT_SECTION,
  MONITOR_TOOL_NAME,
  registerMonitorTool,
} from '../../src/monitor/seam.ts'

/** The registered-tool surface the smoke drives. */
interface RegisteredTool {
  name: string
  parameters: Record<string, unknown>
  execute(args: unknown): Promise<{ at: string; host: { cpuPercent: number }; processes: unknown[] }>
}

const tools: unknown[] = []
const sections: Array<{ name: string; order: number; text: string }> = []
let mounted = false

const seam = {
  tools: { register(tool) { tools.push(tool); return () => undefined } },
  systemPrompt: { section(section) { sections.push(section) } },
  monitor: () => (mounted
    ? {
      snapshot: async () => ({
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
      }),
    }
    : undefined),
}

registerMonitorTool(seam)

if (tools.length !== 1) throw new Error('expected exactly one registered tool, got ' + tools.length)
const tool = tools[0] as RegisteredTool
if (tool.name !== MONITOR_TOOL_NAME) throw new Error('expected tool ' + MONITOR_TOOL_NAME + ', got ' + tool.name)
if (tool.parameters.type !== 'object' || Object.keys(tool.parameters.properties ?? {}).length !== 0) {
  throw new Error('monitor_snapshot must take no parameters, got: ' + JSON.stringify(tool.parameters))
}
if (sections.length !== 1 || sections[0].name !== MONITOR_PROMPT_SECTION) throw new Error('missing monitor prompt section')

mounted = true
const value = await tool.execute({})
if (value.at !== '2026-01-01T00:00:00.000Z') throw new Error('snapshot at mismatch')
if (value.host.cpuPercent !== 12.3) throw new Error('snapshot host mismatch')
if (value.processes.length !== 1) throw new Error('snapshot processes mismatch')
if ('containers' in value) throw new Error('monitor_snapshot must omit containers')

mounted = false
let threw = false
try { await tool.execute({}) } catch { threw = true }
if (!threw) throw new Error('unmounted tool execution must fail loud')

console.log('MONITOR-SEAM-SMOKE-OK', { tool: tool.name, sections: sections.length })