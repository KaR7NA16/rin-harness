/**
 * rin monitor — the ctx.monitor Cordis service.
 *
 * Thin Service classes over the Cordis-free snapshot core (monitor.ts): the
 * abstract MonitorService declares the surface, ProcMonitorService is the
 * /proc-backed implementation holding the cached cpu sample. The plugin apply()
 * installs ProcMonitorService; the tool seam reads it back through ctx.get().
 *
 * @module @rin/monitor
 */

import { Context, Service } from '@deepseek-ai/cordis'
import {
  assembleSnapshot,
  CpuSampler,
  defaultCollectors,
  readProcText,
  type MonitorSnapshot,
  type SnapshotCollectors,
} from './monitor.ts'

/** The monitor service exposed on the shared context. */
export abstract class MonitorService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'monitor')
  }

  /** Collect one host performance snapshot from the real Linux sources. */
  abstract snapshot(): Promise<MonitorSnapshot>
}

/** Options for the /proc-backed monitor service; both override the defaults. */
export interface ProcMonitorServiceOptions {
  /** Reads raw /proc/stat text; undefined on read failure. Defaults to the real file. */
  cpuRead?: () => Promise<string | undefined>
  /** Per-source collectors; defaults to the real /proc + CLI collectors. */
  collectors?: SnapshotCollectors
}

/**
 * /proc-backed monitor service. The CPU percent needs two /proc/stat samples,
 * so the first snapshot() reports cpuPercent 0 (neutral) and every later one
 * reports a real delta; an unreadable sample resets the cached sample.
 */
export class ProcMonitorService extends MonitorService {
  private readonly cpu: CpuSampler
  private readonly collectors: SnapshotCollectors

  constructor(ctx: Context, options: ProcMonitorServiceOptions = {}) {
    super(ctx)
    this.cpu = new CpuSampler(options.cpuRead ?? (() => readProcText('/proc/stat')))
    this.collectors = options.collectors ?? defaultCollectors
  }

  override async snapshot(): Promise<MonitorSnapshot> {
    const cpuPercent = await this.cpu.next()
    return assembleSnapshot(cpuPercent, this.collectors)
  }
}
