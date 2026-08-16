/**
 * rin monitor — host performance snapshot core.
 *
 * Reads real Linux sources only (node: builtins; no stubs or fakes): /proc/stat
 * (CPU jiffies, sampled twice to get a real percent over time), /proc/meminfo,
 * /proc/loadavg, /proc/uptime, a spawned `df -P -k /`, a scan of /proc/<pid>
 * (stat + comm) for the top processes by RSS, and `docker stats` / `podman
 * stats` for containers. The /proc reads themselves are Linux-only; memory has
 * a node:os fallback so a snapshot still assembles elsewhere (see
 * isMonitorSupported for the platform gate used by the web-server route).
 *
 * Degradation is honest: when a /proc source is unreadable or malformed its
 * metric degrades to 0 / [0, 0, 0] / empty, and when no container CLI is
 * available the containers array is empty. Nothing is fabricated.
 *
 * This module is Cordis-free (node: builtins only) so the parsing logic is
 * unit-testable by feeding fixture strings; the Cordis service and tool seam
 * live in service.ts and seam.ts.
 *
 * @module @rin/monitor
 */

import { execFile } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { freemem, totalmem } from 'node:os'
import { promisify } from 'node:util'

/** Linux page size in bytes used to convert /proc/<pid>/stat rss (pages) to MB. */
const PAGE_SIZE_BYTES = 4096

/** Cap on the processes reported, sorted by RSS descending. */
const MAX_PROCESSES = 10

/** Timeout for spawned df / docker / podman, so a stalled CLI cannot hang a poll. */
const CLI_TIMEOUT_MS = 5000

/** Go-template passed to docker/podman stats; emitted verbatim with tab separators. */
const CONTAINER_STATS_FORMAT = '{{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.BlockIO}}'

/** One aggregate /proc/stat sample: total and idle jiffies. */
export interface CpuStat {
  readonly total: number
  readonly idle: number
}

/** Host-level metrics reported under snapshot.host. */
export interface HostMetrics {
  cpuPercent: number
  memTotalMb: number
  memUsedMb: number
  memPercent: number
  loadAvg: [number, number, number]
  diskTotalGb: number
  diskUsedGb: number
  diskPercent: number
  uptimeSec: number
  platform: string
}

/** One process under snapshot.processes. */
export interface ProcessMetrics {
  pid: number
  name: string
  rssMb: number
}

/** One container under snapshot.containers; string fields keep the CLI's raw text. */
export interface ContainerMetrics {
  containerId: string
  cpuPercent: string
  memUsage: string
  memPercent: string
  netIO: string
  blockIO: string
}

/** The full body served by GET /api/monitor/snapshot and ctx.monitor.snapshot(). */
export interface MonitorSnapshot {
  at: string
  host: HostMetrics
  processes: ProcessMetrics[]
  containers: ContainerMetrics[]
}

/** Memory fields of snapshot.host, computed by collectMem(). */
export interface MemMetrics {
  memTotalMb: number
  memUsedMb: number
  memPercent: number
}

/** Disk fields of snapshot.host, computed by collectDisk(). */
export interface DiskMetrics {
  diskTotalGb: number
  diskUsedGb: number
  diskPercent: number
}

/** True only on Linux, the only platform the /proc reads work on. */
export function isMonitorSupported(): boolean {
  return process.platform === 'linux'
}

/**
 * Parse the aggregate first line of /proc/stat into total and idle jiffies.
 * @param text - raw /proc/stat contents.
 * @returns the sample, or undefined when the first line is not the aggregate cpu line.
 */
export function parseCpuStat(text: string): CpuStat | undefined {
  const first = text.split('\n')[0]
  if (first === undefined || !/^cpu\s/.test(first)) return undefined
  const tokens = first.trim().split(/\s+/)
  if (tokens.length < 5) return undefined
  let total = 0
  let idle = 0
  for (let i = 1; i < tokens.length; i += 1) {
    const value = Number(tokens[i])
    if (!Number.isFinite(value)) return undefined
    total += value
    // Field 5 is idle, field 6 is iowait; both count as idle time.
    if (i === 4 || i === 5) idle += value
  }
  if (total <= 0) return undefined
  return { total, idle }
}

/**
 * CPU busy percent between two /proc/stat samples, rounded to one decimal and
 * clamped to 0-100. Returns 0 when there is no prior sample (the first call
 * after startup) or when the counters cannot form a delta, so the UI shows a
 * neutral 0.0% once before the first real reading.
 * @param prev - the previous sample, or undefined on the first call.
 * @param next - the current sample, or undefined when /proc/stat was unreadable.
 * @returns busy percent 0-100.
 */
export function computeCpuPercent(prev: CpuStat | undefined, next: CpuStat | undefined): number {
  if (prev === undefined || next === undefined) return 0
  const totalDelta = next.total - prev.total
  const idleDelta = next.idle - prev.idle
  if (totalDelta <= 0) return 0
  const busy = 1 - idleDelta / totalDelta
  return clamp(Math.round(busy * 1000) / 10, 0, 100)
}

/**
 * Parse MemTotal and MemAvailable from /proc/meminfo (kB values).
 * @param text - raw /proc/meminfo contents.
 * @returns the two values, or undefined when either line is missing.
 */
export function parseMemInfo(text: string): { totalKb: number; availableKb: number } | undefined {
  let totalKb: number | undefined
  let availableKb: number | undefined
  for (const line of text.split('\n')) {
    const totalMatch = /^MemTotal:\s+(\d+)\s+kB$/.exec(line)
    if (totalMatch?.[1] !== undefined) totalKb = Number(totalMatch[1])
    const availableMatch = /^MemAvailable:\s+(\d+)\s+kB$/.exec(line)
    if (availableMatch?.[1] !== undefined) availableKb = Number(availableMatch[1])
  }
  if (totalKb === undefined || availableKb === undefined) return undefined
  return { totalKb, availableKb }
}

/**
 * Parse the first three load averages from /proc/loadavg.
 * @param text - raw /proc/loadavg contents.
 * @returns the 1/5/15-minute load tuple, or undefined when unparsable.
 */
export function parseLoadAvg(text: string): [number, number, number] | undefined {
  const tokens = text.trim().split(/\s+/)
  const oneMinute = Number(tokens[0])
  const fiveMinutes = Number(tokens[1])
  const fifteenMinutes = Number(tokens[2])
  if (!Number.isFinite(oneMinute) || !Number.isFinite(fiveMinutes) || !Number.isFinite(fifteenMinutes)) return undefined
  return [oneMinute, fiveMinutes, fifteenMinutes]
}

/**
 * Parse the system uptime in seconds from /proc/uptime.
 * @param text - raw /proc/uptime contents.
 * @returns the uptime in seconds, or undefined when unparsable.
 */
export function parseUptime(text: string): number | undefined {
  const value = Number(text.trim().split(/\s+/)[0])
  return Number.isFinite(value) ? value : undefined
}

/**
 * Parse the first data line of `df -P -k` output into total and used kB.
 * The header line is skipped because its "1024-blocks" column is non-numeric.
 * @param text - raw df stdout.
 * @returns the total/used kB of the first filesystem line, or undefined when none fits.
 */
export function parseDf(text: string): { totalKb: number; usedKb: number } | undefined {
  for (const line of text.split('\n')) {
    const tokens = line.trim().split(/\s+/)
    const total = tokens[1]
    const used = tokens[2]
    if (total === undefined || used === undefined) continue
    if (!/^\d+$/.test(total) || !/^\d+$/.test(used)) continue
    const totalKb = Number(total)
    const usedKb = Number(used)
    if (totalKb <= 0) continue
    return { totalKb, usedKb }
  }
  return undefined
}

/**
 * Parse the resident-set size (field 24) from one /proc/<pid>/stat line. The
 * process name (field 2, parenthesized) may contain spaces and parentheses, so
 * the line is split at the LAST ')' and field 24 is read at offset 21 of the
 * remaining fields (fields 3..52).
 * @param text - raw /proc/<pid>/stat contents.
 * @returns the rss in pages, or undefined when the line is unparsable.
 */
export function parseProcessStat(text: string): { rssPages: number } | undefined {
  const close = text.lastIndexOf(')')
  if (close === -1) return undefined
  const fields = text.slice(close + 1).trim().split(/\s+/)
  const rss = fields[21]
  if (rss === undefined) return undefined
  const rssPages = Number(rss)
  if (!Number.isFinite(rssPages) || rssPages < 0) return undefined
  return { rssPages }
}

/**
 * Parse one docker/podman stats --format row (tab-separated) into the container
 * fields. Missing fields pad with '0'; present fields keep the CLI's raw text.
 * @param line - one stdout line from the stats CLI.
 * @returns the parsed container, or undefined for a blank line.
 */
export function parseContainerLine(line: string): ContainerMetrics | undefined {
  const trimmed = line.trim()
  if (trimmed === '') return undefined
  const parts = trimmed.split('\t')
  return {
    containerId: parts[0] ?? '0',
    cpuPercent: parts[1] ?? '0',
    memUsage: parts[2] ?? '0',
    memPercent: parts[3] ?? '0',
    netIO: parts[4] ?? '0',
    blockIO: parts[5] ?? '0',
  }
}

/** Round a value to one decimal; non-finite input degrades to 0. */
function round1(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 10) / 10
}

/** Percent with one decimal, clamped to 0-100; non-finite or zero denominator degrades to 0. */
function percent(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0
  return clamp(Math.round((numerator / denominator) * 1000) / 10, 0, 100)
}

/** Clamp a value into [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Read a file as utf8; any read failure (ENOENT, EACCES, ...) yields undefined. */
export async function readProcText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    // Unreadable /proc entry: callers degrade that metric instead of failing the snapshot.
    return undefined
  }
}

/** Promisified execFile with string (utf8) stdout/stderr. */
const execFileAsync = promisify(execFile) as (
  file: string,
  args: string[],
  options: { encoding: 'utf8'; timeout: number; maxBuffer: number },
) => Promise<{ stdout: string; stderr: string }>

/**
 * Run a CLI and resolve with its stdout, or undefined when the CLI is absent,
 * exits non-zero, or exceeds the timeout. Errors never propagate: container and
 * disk collection degrade to empty/zero data (honest) rather than failing the
 * snapshot.
 * @param command - the executable name.
 * @param args - the argument vector.
 * @returns the stdout on success, else undefined.
 */
async function runCli(command: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(command, args, { encoding: 'utf8', timeout: CLI_TIMEOUT_MS, maxBuffer: 1024 * 1024 })
    return stdout
  } catch {
    // CLI not installed (ENOENT), daemon unreachable, or timeout: the caller returns empty data.
    return undefined
  }
}

/** Memory from /proc/meminfo (used = total - available); node:os as a real fallback. */
export async function collectMem(): Promise<MemMetrics> {
  const text = await readProcText('/proc/meminfo')
  const parsed = text === undefined ? undefined : parseMemInfo(text)
  if (parsed !== undefined) {
    const usedKb = parsed.totalKb - parsed.availableKb
    return { memTotalMb: round1(parsed.totalKb / 1024), memUsedMb: round1(usedKb / 1024), memPercent: percent(usedKb, parsed.totalKb) }
  }
  const totalBytes = totalmem()
  const usedBytes = totalBytes - freemem()
  return { memTotalMb: round1(totalBytes / 1024 / 1024), memUsedMb: round1(usedBytes / 1024 / 1024), memPercent: percent(usedBytes, totalBytes) }
}

/** Load averages from /proc/loadavg; unreadable degrades to a zero tuple. */
export async function collectLoadAvg(): Promise<[number, number, number]> {
  const text = await readProcText('/proc/loadavg')
  return text === undefined ? [0, 0, 0] : (parseLoadAvg(text) ?? [0, 0, 0])
}

/** System uptime seconds from /proc/uptime; unreadable degrades to 0. */
export async function collectUptime(): Promise<number> {
  const text = await readProcText('/proc/uptime')
  return text === undefined ? 0 : (parseUptime(text) ?? 0)
}

/** Disk usage for / from `df -P -k /`; unreadable degrades to a zero tuple. */
export async function collectDisk(): Promise<DiskMetrics> {
  const stdout = await runCli('df', ['-P', '-k', '/'])
  const parsed = stdout === undefined ? undefined : parseDf(stdout)
  if (parsed === undefined) return { diskTotalGb: 0, diskUsedGb: 0, diskPercent: 0 }
  return {
    diskTotalGb: round1(parsed.totalKb / 1024 / 1024),
    diskUsedGb: round1(parsed.usedKb / 1024 / 1024),
    diskPercent: percent(parsed.usedKb, parsed.totalKb),
  }
}

/** Top processes by RSS from /proc/<pid>/stat + comm; unreadable /proc yields []. */
export async function collectProcesses(maxCount: number): Promise<ProcessMetrics[]> {
  let names: string[]
  try {
    names = await readdir('/proc')
  } catch {
    // /proc not mounted or unreadable: no process data.
    return []
  }
  const pids = names.filter(name => /^\d+$/.test(name))
  const scanned = await Promise.all(pids.map(async pid => {
    const statText = await readProcText('/proc/' + pid + '/stat')
    const commText = await readProcText('/proc/' + pid + '/comm')
    if (statText === undefined) return undefined
    const parsed = parseProcessStat(statText)
    if (parsed === undefined) return undefined
    const name = commText === undefined ? 'unknown' : commText.trim()
    return { pid: Number(pid), name, rssMb: round1((parsed.rssPages * PAGE_SIZE_BYTES) / (1024 * 1024)) }
  }))
  const processes = scanned.filter((p): p is ProcessMetrics => p !== undefined)
  processes.sort((a, b) => b.rssMb - a.rssMb)
  return processes.slice(0, maxCount)
}

/** Container stats from docker stats, then podman stats; both absent yields []. */
export async function collectContainers(): Promise<ContainerMetrics[]> {
  const stdout = (await runCli('docker', ['stats', '--no-stream', '--format', CONTAINER_STATS_FORMAT]))
    ?? (await runCli('podman', ['stats', '--no-stream', '--format', CONTAINER_STATS_FORMAT]))
  if (stdout === undefined || stdout.trim() === '') return []
  const containers: ContainerMetrics[] = []
  for (const line of stdout.split('\n')) {
    const parsed = parseContainerLine(line)
    if (parsed !== undefined) containers.push(parsed)
  }
  return containers
}

/**
 * Stateful CPU sampler with a cached previous /proc/stat sample. The CPU
 * percent needs two samples, so the first next() reports 0 (neutral) and every
 * later one reports a real delta; an unreadable sample resets the cache so the
 * next readable sample starts a fresh delta.
 */
export class CpuSampler {
  private previous: CpuStat | undefined

  /**
   * @param readStat - reads the raw /proc/stat text; undefined on read failure.
   */
  constructor(private readonly readStat: () => Promise<string | undefined>) {
  }

  /** Read one sample, update the cache, and resolve the busy percent 0-100. */
  async next(): Promise<number> {
    const text = await this.readStat()
    const next = text === undefined ? undefined : parseCpuStat(text)
    const cpuPercent = computeCpuPercent(this.previous, next)
    this.previous = next
    return cpuPercent
  }
}

/** The per-source collectors one snapshot() call drives, injectable for tests. */
export interface SnapshotCollectors {
  mem(): Promise<MemMetrics>
  loadAvg(): Promise<[number, number, number]>
  uptime(): Promise<number>
  disk(): Promise<DiskMetrics>
  processes(): Promise<ProcessMetrics[]>
  containers(): Promise<ContainerMetrics[]>
}

/** The real /proc + CLI-backed collectors used by the production service. */
export const defaultCollectors: SnapshotCollectors = {
  mem: collectMem,
  loadAvg: collectLoadAvg,
  uptime: collectUptime,
  disk: collectDisk,
  processes: () => collectProcesses(MAX_PROCESSES),
  containers: collectContainers,
}

/**
 * Assemble one full snapshot from a cpu percent and the per-source collectors.
 * Pure composition: collectors already degrade honestly, so this never throws.
 * @param cpuPercent - busy percent from the CpuSampler.
 * @param collectors - the per-source collectors.
 * @param at - the snapshot timestamp (defaults to now).
 * @param platform - the host platform (defaults to process.platform).
 * @returns the assembled snapshot.
 */
export async function assembleSnapshot(
  cpuPercent: number,
  collectors: SnapshotCollectors,
  at: string = new Date().toISOString(),
  platform: string = process.platform,
): Promise<MonitorSnapshot> {
  const [mem, loadAvg, uptimeSec, disk, processes, containers] = await Promise.all([
    collectors.mem(),
    collectors.loadAvg(),
    collectors.uptime(),
    collectors.disk(),
    collectors.processes(),
    collectors.containers(),
  ])
  return {
    at,
    host: {
      cpuPercent,
      ...mem,
      ...disk,
      loadAvg,
      uptimeSec,
      platform,
    },
    processes,
    containers,
  }
}
