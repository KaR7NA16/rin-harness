/**
 * rin monitor — Cordis plugin entry.
 *
 * Installs the ctx.monitor service (a /proc-backed host performance snapshot
 * reader) and registers the model-facing monitor_snapshot tool plus its short
 * system-prompt guidance. The snapshot core is Cordis-free (monitor.ts); the
 * service classes and tool seam are thin.
 *
 * @module @rin/health/monitor
 */

import { Context } from '@deepseek-ai/cordis'
import { MonitorService, ProcMonitorService } from './service.ts'
import { registerSeam } from './seam.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    monitor: MonitorService
  }
}

export { MonitorService, ProcMonitorService } from './service.ts'
export type { MonitorToolSeam, MonitorToolSnapshot } from './seam.ts'
export { collectMonitorToolSnapshot, MONITOR_TOOL_NAME, registerMonitorTool } from './seam.ts'
export {
  assembleSnapshot,
  collectContainers,
  collectDisk,
  collectLoadAvg,
  collectMem,
  collectProcesses,
  collectUptime,
  computeCpuPercent,
  CpuSampler,
  defaultCollectors,
  isMonitorSupported,
  parseContainerLine,
  parseCpuStat,
  parseDf,
  parseLoadAvg,
  parseMemInfo,
  parseProcessStat,
  parseUptime,
  readProcText,
} from './monitor.ts'
export type {
  ContainerMetrics,
  CpuStat,
  DiskMetrics,
  HostMetrics,
  MemMetrics,
  MonitorSnapshot,
  ProcessMetrics,
  SnapshotCollectors,
} from './monitor.ts'

/** Cordis plugin name. */
export const name = 'monitor'
/** Required capability and prompt seams; the monitor service is read lazily. */
export const inject = ['tools', 'systemPrompt']

/**
 * Install the /proc-backed monitor service and register the tool seam.
 * @param ctx - the plugin context.
 */
export function apply(ctx: Context): void {
  ctx.plugin(ProcMonitorService)
  registerSeam(ctx)
}
