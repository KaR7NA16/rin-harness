/**
 * rin monitor — dsh seam registration.
 *
 * Registers the model-facing monitor_snapshot tool and its short system-prompt
 * guidance. The registration drives a structural MonitorToolSeam (tools
 * registry, system-prompt sections, and a lazy monitor accessor), so a unit
 * test can register the tool against a fake registry without booting the dsh
 * tools graph; registerSeam() adapts the real Cordis context.
 *
 * @module @rin/monitor
 */

import { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { HostMetrics, ProcessMetrics } from './monitor.ts'
import type { MonitorService } from './service.ts'

/** The model-facing snapshot: host metrics plus top processes, no containers. */
export interface MonitorToolSnapshot {
  at: string
  host: HostMetrics
  processes: ProcessMetrics[]
}

/** Minimal structural view of the seams the tool registration touches. */
export interface MonitorToolSeam {
  tools: { register(tool: unknown): unknown }
  systemPrompt: { section(section: { name: string; order: number; text: string }): unknown }
  /** Lazy service accessor; undefined when the monitor service is not mounted. */
  monitor(): MonitorService | undefined
}

/** The model-facing tool name registered on the tools seam. */
export const MONITOR_TOOL_NAME = 'monitor_snapshot'
/** The system-prompt section name contributed by this seam. */
export const MONITOR_PROMPT_SECTION = 'tool:monitor'

/** Model-facing description of the tool. */
export const MONITOR_TOOL_DESCRIPTION =
  'Read one live host performance snapshot: CPU percent, memory total/used/percent, '
  + '1/5/15-minute load averages, disk usage, uptime, platform, and the top processes by '
  + 'resident set size. Read-only; never modifies host state.'

/**
 * Resolve one tool snapshot from the monitor service, or fail loud when the
 * service is not mounted. Containers are deliberately omitted from the
 * model-facing view (the route and service keep them).
 * @param monitor - the mounted monitor service, or undefined.
 * @returns the host metrics and top processes.
 */
export async function collectMonitorToolSnapshot(monitor: MonitorService | undefined): Promise<MonitorToolSnapshot> {
  if (monitor === undefined) {
    throw new Error('monitor_snapshot: the monitor service is not mounted on this host')
  }
  const snapshot = await monitor.snapshot()
  return { at: snapshot.at, host: snapshot.host, processes: snapshot.processes }
}

/** One line of the rendered text output, tab-free so the model sees clean text. */
function formatMb(mb: number): string {
  return Number.isFinite(mb) ? mb.toFixed(1) : '0.0'
}

/**
 * Render a tool snapshot into a compact text summary for the model. The render
 * input is the schema-inferred shape (loadAvg is a plain number array), which
 * both the canonical MonitorToolSnapshot and the validated value satisfy.
 * @param value - the validated tool snapshot.
 * @returns the text content block.
 */
function renderSnapshot(value: {
  at: string
  host: {
    cpuPercent: number
    memTotalMb: number
    memUsedMb: number
    memPercent: number
    loadAvg: number[]
    diskTotalGb: number
    diskUsedGb: number
    diskPercent: number
    uptimeSec: number
    platform: string
  }
  processes: Array<{ pid: number; name: string; rssMb: number }>
}): string {
  const h = value.host
  const load = h.loadAvg.map(item => item.toFixed(2)).join(' / ')
  const lines = [
    `snapshot at ${value.at} (platform ${h.platform})`,
    `cpu: ${h.cpuPercent.toFixed(1)}%`,
    `memory: ${formatMb(h.memUsedMb)} MB / ${formatMb(h.memTotalMb)} MB (${h.memPercent.toFixed(1)}% used)`,
    `load: ${load}`,
    `disk: ${formatMb(h.diskUsedGb)} GB / ${formatMb(h.diskTotalGb)} GB (${h.diskPercent.toFixed(1)}% used)`,
    `uptime: ${h.uptimeSec.toFixed(0)}s`,
    'top processes by rss:',
    ...value.processes.map(p => `  ${p.pid} ${p.name} ${formatMb(p.rssMb)} MB`),
  ]
  return lines.join('\n')
}

/**
 * Register the monitor_snapshot tool and its prompt guidance on a structural seam.
 * @param seam - the tools / system-prompt / monitor accessor seam.
 */
export function registerMonitorTool(seam: MonitorToolSeam): void {
  seam.systemPrompt.section({
    name: MONITOR_PROMPT_SECTION,
    order: 107,
    text: 'monitor_snapshot reads live host performance metrics (CPU, memory, load, disk, uptime, and the top processes by RSS). Use it when a task needs current resource usage; it is read-only.',
  })

  seam.tools.register(defineTool({
    name: MONITOR_TOOL_NAME,
    description: MONITOR_TOOL_DESCRIPTION,
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          at: { type: 'string', required: true },
          host: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              cpuPercent: { type: 'number', required: true },
              memTotalMb: { type: 'number', required: true },
              memUsedMb: { type: 'number', required: true },
              memPercent: { type: 'number', required: true },
              loadAvg: { type: 'array', required: true, items: { type: 'number' } },
              diskTotalGb: { type: 'number', required: true },
              diskUsedGb: { type: 'number', required: true },
              diskPercent: { type: 'number', required: true },
              uptimeSec: { type: 'number', required: true },
              platform: { type: 'string', required: true },
            },
          },
          processes: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                pid: { type: 'integer', required: true },
                name: { type: 'string', required: true },
                rssMb: { type: 'number', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderSnapshot(value) }],
    },
    execute() {
      return collectMonitorToolSnapshot(seam.monitor())
    },
    presentCall: () => ({ card: 'generic', title: 'Read host performance snapshot', kind: 'read' }),
  }))
}

/**
 * Register the monitor seam on a real Cordis context.
 * @param ctx - the plugin context (must inject tools and systemPrompt).
 */
export function registerSeam(ctx: Context): void {
  registerMonitorTool({
    tools: ctx.tools,
    systemPrompt: ctx.systemPrompt,
    monitor: () => ctx.get('monitor'),
  })
}
