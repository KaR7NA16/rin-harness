/**
 * rin doctor — host diagnostic report core.
 *
 * Assembles one honest DoctorReport from injected real state: the node
 * runtime (process.*), the config home (RIN_HOME or ~/.rin) checked through
 * node:fs access, a live monitor snapshot when the monitor service is
 * mounted, the registered LLM providers (never a paid inference call), and a
 * mounted/absent audit of the known @rin services. Nothing is fabricated:
 * an unmounted monitor reports monitorAvailable:false, an unmounted llm
 * reports mounted:false, and a missing or unwritable config home reports
 * exists/writable false. This module is Cordis-free and dependency-free
 * (node: builtins only) so the assembly logic is unit-testable by feeding
 * fake state.
 *
 * @module @rin/health/doctor
 */

import { access, constants } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** One audited @rin capability: its display label and how to detect it. */
export interface DoctorAuditEntry {
  /** Display name (the @rin package name, kebab-case). */
  readonly label: string
  /** ctx.get service name when the package registers a Cordis service (super(ctx, <name>)). */
  readonly service?: string
  /** Model tool name to look up when the package registers a stable tool instead of a service. */
  readonly tool?: string
}

/**
 * The known @rin capabilities the audit enumerates, in assembly order.
 *
 * Detection differs by plugin shape: most register a Cordis service (the
 * ctx.get key is the super(ctx, <name>) service name, which is camelCase for
 * several and 'rinAgents' for agents); brief / review are function plugins
 * that register a single stable tool; @rin/mcp/client is a dynamic bridge with
 * no stable service or tool name, so it is deliberately omitted from this
 * ctx/tool-based audit (documented in the README).
 */
export const RIN_AUDIT_ENTRIES: readonly DoctorAuditEntry[] = [
  { label: 'repository', service: 'repository' },
  { label: 'environment', service: 'environment' },
  { label: 'filesystem', service: 'filesystem' },
  { label: 'session-backup', service: 'sessionBackup' },
  { label: 'knowledge', service: 'knowledge' },
  { label: 'prompt-memory', service: 'promptMemory' },
  { label: 'skill-memory', service: 'skill-memory' },
  { label: 'session-search', service: 'sessionSearch' },
  { label: 'evolution', service: 'evolution' },
  { label: 'token-optimization', service: 'tokenOptimization' },
  { label: 'codegraph', service: 'codegraph' },
  { label: 'smart-pruning', service: 'smartPruning' },
  { label: 'notes', service: 'notes' },
  { label: 'agents', service: 'rinAgents' },
  { label: 'plugins', service: 'plugins' },
  { label: 'sandboxes', service: 'sandboxes' },
  { label: 'tasks', service: 'tasks' },
  { label: 'mcp', service: 'mcp' },
  { label: 'provider-probe', service: 'providerProbe' },
  { label: 'computer-use', service: 'computerUse' },
  { label: 'agent-migration', service: 'agentMigration' },
  { label: 'teams', service: 'teams' },
  { label: 'monitor', service: 'monitor' },
  { label: 'brief', tool: 'brief' },
  { label: 'review', tool: 'review_artifact' },
]

/** Node runtime facts read from the live process. */
export interface DoctorRuntime {
  /** process.version, e.g. "v22.19.0". */
  nodeVersion: string
  /** process.platform, e.g. "linux". */
  platform: string
  /** process.arch, e.g. "x64". */
  arch: string
  /** process.uptime() in seconds. */
  uptimeSec: number
}

/** Config-home state: existence and writability through node:fs access. */
export interface DoctorConfigSection {
  /** The resolved home path (RIN_HOME, else ~/.rin). */
  home: string
  /** Whether the home directory exists. */
  exists: boolean
  /** Whether the home directory is writable by this process (checked only when it exists). */
  writable: boolean
  /** The fs error message when the writability check failed (e.g. EACCES). */
  detail?: string
}

/**
 * The host section of the report. Always present: an unmounted monitor
 * reports monitorAvailable:false and no metric fields; a mounted monitor
 * reports the real host metrics verbatim from its snapshot.
 */
export interface DoctorHostSection {
  /** True only when the monitor service was mounted and its snapshot read. */
  monitorAvailable: boolean
  /** CPU busy percent from the monitor snapshot (0 on the first sample). */
  cpuPercent?: number
  /** Total memory in MB. */
  memTotalMb?: number
  /** Used memory in MB. */
  memUsedMb?: number
  /** Used memory percent 0-100. */
  memPercent?: number
  /** 1/5/15-minute load averages. */
  loadAvg?: number[]
  /** Total disk in GB. */
  diskTotalGb?: number
  /** Used disk in GB. */
  diskUsedGb?: number
  /** Used disk percent 0-100. */
  diskPercent?: number
  /** Host uptime in seconds. */
  uptimeSec?: number
  /** Host platform reported by the monitor snapshot. */
  platform?: string
}

/** One registered LLM provider route. */
export interface DoctorLlmProvider {
  /** Provider route key used by generate options. */
  id: string
  /** Human-readable provider name. */
  name: string
}

/** LLM capability state; no inference call is ever made. */
export interface DoctorLlmSection {
  /** True only when the llm service is mounted on the context. */
  mounted: boolean
  /** The registered provider routes (empty when unmounted). */
  providers: DoctorLlmProvider[]
  /** True when at least one provider route is registered. */
  anyConfigured: boolean
}

/** One row of the @rin service audit. */
export interface DoctorServiceEntry {
  /** The service key audited through ctx.get(name). */
  name: string
  /** Whether the service is currently mounted. */
  mounted: boolean
}

/** The complete diagnostic report returned by ctx.doctor.runDiagnostics(). */
export interface DoctorReport {
  /** ISO timestamp of the report. */
  at: string
  /** Node runtime facts. */
  runtime: DoctorRuntime
  /** Config-home existence and writability. */
  config: DoctorConfigSection
  /** Live host metrics when the monitor service is mounted. */
  host: DoctorHostSection
  /** LLM provider registration state. */
  llm: DoctorLlmSection
  /** Mounted/absent audit of the known @rin services. */
  services: DoctorServiceEntry[]
}

/** Structural view of the monitor service used by the report (ctx.get('monitor')). */
export interface DoctorMonitorLike {
  snapshot(): Promise<{ host: DoctorMonitorHostLike }>
}

/** Structural view of one monitor snapshot's host metrics. */
export interface DoctorMonitorHostLike {
  cpuPercent: number
  memTotalMb: number
  memUsedMb: number
  memPercent: number
  loadAvg: readonly number[]
  diskTotalGb: number
  diskUsedGb: number
  diskPercent: number
  uptimeSec: number
  platform: string
}

/** Structural view of the llm service used by the report (ctx.get('llm')). */
export interface DoctorLlmLike {
  listProviders(): Array<{ id: string; name: string }>
}

/** Everything assembleReport needs; all state is injected for testability. */
export interface DoctorAssembleDeps {
  /** ISO timestamp stamped on the report. */
  at: string
  /** The runtime facts (readRuntime() in production). */
  runtime: DoctorRuntime
  /** The config-home section (probeConfigHome() in production). */
  config: DoctorConfigSection
  /** The mounted monitor service, or undefined when absent. */
  monitor: DoctorMonitorLike | undefined
  /** The mounted llm service, or undefined when absent. */
  llm: DoctorLlmLike | undefined
  /** The capabilities to audit (defaults to RIN_AUDIT_ENTRIES in production). */
  auditEntries: readonly DoctorAuditEntry[]
  /** Mounted predicate per service name (ctx.get(name) !== undefined in production). */
  serviceMounted: (service: string) => boolean
  /** Mounted predicate per tool name (ctx.tools.get(name) !== undefined in production). */
  toolMounted: (tool: string) => boolean
}

/**
 * Resolve the rin configuration home: RIN_HOME when set and non-blank, else
 * ~/.rin. Mirrors the @rin/host helper without depending on it.
 * @returns the absolute (or override-resolved) home path.
 */
export function rinHome(): string {
  const fromEnv = process.env.RIN_HOME
  return fromEnv !== undefined && fromEnv.trim() !== '' ? fromEnv : join(homedir(), '.rin')
}

/** Read the live node runtime facts (process.*). */
export function readRuntime(): DoctorRuntime {
  return {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    uptimeSec: process.uptime(),
  }
}

/**
 * Probe a config home's existence and writability through node:fs access.
 * A missing home reports exists:false and writable:false (nothing to write
 * to); an existing home's writability is the process's effective W_OK result,
 * with the fs error message kept as detail on failure.
 * @param home - the absolute home path to probe.
 * @returns the config section.
 */
export async function probeConfigHome(home: string): Promise<DoctorConfigSection> {
  let exists = false
  try {
    await access(home)
    exists = true
  } catch {
    return { home, exists: false, writable: false }
  }
  try {
    await access(home, constants.W_OK)
    return { home, exists, writable: true }
  } catch (err) {
    return { home, exists, writable: false, detail: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Assemble one full diagnostic report from injected state. Optional sources
 * degrade honestly instead of failing the report: an unmounted monitor or
 * llm yields its own "unavailable" section, and the service audit reflects
 * the mounted predicate per name. A mounted monitor's snapshot failure
 * propagates (the monitor service contract says snapshots never throw).
 * @param deps - the injected state.
 * @returns the assembled report.
 */
export async function assembleReport(deps: DoctorAssembleDeps): Promise<DoctorReport> {
  let host: DoctorHostSection
  if (deps.monitor === undefined) {
    host = { monitorAvailable: false }
  } else {
    const metrics = (await deps.monitor.snapshot()).host
    host = {
      monitorAvailable: true,
      cpuPercent: metrics.cpuPercent,
      memTotalMb: metrics.memTotalMb,
      memUsedMb: metrics.memUsedMb,
      memPercent: metrics.memPercent,
      loadAvg: [...metrics.loadAvg],
      diskTotalGb: metrics.diskTotalGb,
      diskUsedGb: metrics.diskUsedGb,
      diskPercent: metrics.diskPercent,
      uptimeSec: metrics.uptimeSec,
      platform: metrics.platform,
    }
  }
  let llm: DoctorLlmSection
  if (deps.llm === undefined) {
    llm = { mounted: false, providers: [], anyConfigured: false }
  } else {
    const providers = deps.llm.listProviders().map(provider => ({ id: provider.id, name: provider.name }))
    llm = { mounted: true, providers, anyConfigured: providers.length > 0 }
  }
  const services = deps.auditEntries.map(entry => ({
    name: entry.label,
    mounted: entry.service !== undefined
      ? deps.serviceMounted(entry.service)
      : entry.tool !== undefined
        ? deps.toolMounted(entry.tool)
        : false,
  }))
  return { at: deps.at, runtime: deps.runtime, config: deps.config, host, llm, services }
}
