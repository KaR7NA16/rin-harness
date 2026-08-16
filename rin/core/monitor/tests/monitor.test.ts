/**
 * rin monitor — snapshot core unit tests.
 *
 * The parsing tests feed sample /proc and df text as fixture strings (no real
 * /proc dependency); the CpuSampler tests feed an injected reader; the
 * assembleSnapshot test feeds fake collectors. The web-server route keeps its
 * own route tests with a fake monitor service.
 *
 * @module @rin/monitor
 */

import { describe, expect, test } from 'vitest'
import {
  assembleSnapshot,
  computeCpuPercent,
  CpuSampler,
  parseContainerLine,
  parseCpuStat,
  parseDf,
  parseLoadAvg,
  parseMemInfo,
  parseProcessStat,
  parseUptime,
  type MonitorSnapshot,
  type SnapshotCollectors,
} from '../src/monitor.ts'

const STAT_A = [
  'cpu  100 20 30 200 10 0 5 0 0 0',
  'cpu0 50 10 15 100 5 0 2 0 0 0',
].join('\n')
const STAT_B = 'cpu  200 20 50 400 20 0 5 0 0 0'

/** A fake collectors bundle whose every source returns fixed data. */
function fakeCollectors(): SnapshotCollectors {
  return {
    mem: async () => ({ memTotalMb: 16000, memUsedMb: 7200, memPercent: 45 }),
    loadAvg: async () => [0.5, 0.4, 0.3],
    uptime: async () => 86400,
    disk: async () => ({ diskTotalGb: 512, diskUsedGb: 128, diskPercent: 25 }),
    processes: async () => [{ pid: 1, name: 'init', rssMb: 12.5 }],
    containers: async () => [],
  }
}

describe('monitor: /proc/stat cpu percent', () => {
  test('parses aggregate total and idle jiffies', () => {
    expect(parseCpuStat(STAT_A)).toEqual({ total: 365, idle: 210 })
  })

  test('first sample has no delta, so percent is 0', () => {
    expect(computeCpuPercent(undefined, parseCpuStat(STAT_A))).toBe(0)
  })

  test('second sample computes busy percent between samples', () => {
    const a = parseCpuStat(STAT_A)
    const b = parseCpuStat(STAT_B)
    expect(a).toBeDefined()
    expect(b).toBeDefined()
    // totalDelta 330, idleDelta 210 → 1 - 210/330 = 36.36...% rounded to 36.4
    expect(computeCpuPercent(a, b)).toBe(36.4)
  })

  test('unreadable next sample yields 0', () => {
    expect(computeCpuPercent(parseCpuStat(STAT_A), undefined)).toBe(0)
  })

  test('non-increasing counters yield 0', () => {
    const a = parseCpuStat(STAT_B)
    const b = parseCpuStat(STAT_A)
    expect(computeCpuPercent(a, b)).toBe(0)
  })

  test('idle counter shrinking (counter reset) clamps to 100', () => {
    const reset = parseCpuStat('cpu  500 0 0 0 0 0 0 0 0 0')
    expect(computeCpuPercent(parseCpuStat(STAT_A), reset)).toBe(100)
  })

  test('non-cpu first line is rejected', () => {
    expect(parseCpuStat('intr 12345\n')).toBeUndefined()
  })

  test('too-short aggregate line is rejected', () => {
    expect(parseCpuStat('cpu  1 2\n')).toBeUndefined()
  })
})

describe('monitor: cached cpu sample (CpuSampler)', () => {
  test('first sample reports 0 and caches it', async () => {
    const sampler = new CpuSampler(async () => STAT_A)
    expect(await sampler.next()).toBe(0)
  })

  test('second sample reports the real delta between samples', async () => {
    const reads: Array<string | undefined> = [STAT_A, STAT_B]
    const sampler = new CpuSampler(async () => reads.shift() ?? STAT_A)
    expect(await sampler.next()).toBe(0)
    expect(await sampler.next()).toBe(36.4)
  })

  test('an unreadable sample reports 0 and resets the cached sample', async () => {
    const reads: Array<string | undefined> = [STAT_A, undefined, STAT_B]
    let index = 0
    const sampler = new CpuSampler(async () => reads[index++])
    expect(await sampler.next()).toBe(0)
    // Unreadable: 0, and the cache is reset so STAT_B starts a fresh delta.
    expect(await sampler.next()).toBe(0)
    expect(await sampler.next()).toBe(0)
  })
})

describe('monitor: /proc/meminfo', () => {
  test('parses MemTotal and MemAvailable', () => {
    const text = [
      'MemTotal:       16384000 kB',
      'MemFree:         8000000 kB',
      'MemAvailable:    9000000 kB',
      'Buffers:          100000 kB',
      'Cached:          2000000 kB',
    ].join('\n')
    expect(parseMemInfo(text)).toEqual({ totalKb: 16384000, availableKb: 9000000 })
  })

  test('missing MemAvailable is rejected', () => {
    const text = 'MemTotal:       16384000 kB\nMemFree:         8000000 kB\n'
    expect(parseMemInfo(text)).toBeUndefined()
  })
})

describe('monitor: /proc/loadavg and /proc/uptime', () => {
  test('parses the first three load averages', () => {
    expect(parseLoadAvg('0.52 0.58 0.59 1/234 5678')).toEqual([0.52, 0.58, 0.59])
  })

  test('garbage loadavg is rejected', () => {
    expect(parseLoadAvg('not numbers here')).toBeUndefined()
  })

  test('parses uptime seconds from the first value', () => {
    expect(parseUptime('12345.67 54321.09')).toBe(12345.67)
  })

  test('garbage uptime is rejected', () => {
    expect(parseUptime('nope')).toBeUndefined()
  })
})

describe('monitor: df -P -k', () => {
  test('skips the header and parses the first data line', () => {
    const text = [
      'Filesystem     1024-blocks      Used Available Capacity Mounted on',
      '/dev/sda1       10485760   5242880   5242880      50% /',
      'tmpfs            1000000      1000    999000       1% /dev/shm',
    ].join('\n')
    expect(parseDf(text)).toEqual({ totalKb: 10485760, usedKb: 5242880 })
  })

  test('no numeric data line is rejected', () => {
    expect(parseDf('Filesystem     1024-blocks      Used Available Capacity Mounted on\n')).toBeUndefined()
  })
})

describe('monitor: /proc/<pid>/stat rss', () => {
  /** Build a 52-field stat line; field 24 (1-based) is rss, at index 23 of the array. */
  function procStatFixture(rss: number, comm = 'worker (child) [spawned]'): string {
    const fields: string[] = new Array(52).fill('0')
    fields[0] = '1234'
    fields[22] = '1048576' // vsize (field 23) — must not be read as rss
    fields[23] = String(rss) // rss (field 24)
    return `1234 (${comm}) ${fields.slice(2).join(' ')}`
  }

  test('parses rss pages even when the comm contains spaces and parentheses', () => {
    expect(parseProcessStat(procStatFixture(512))).toEqual({ rssPages: 512 })
  })

  test('reads field 24, not the adjacent vsize field', () => {
    const parsed = parseProcessStat(procStatFixture(7))
    expect(parsed).toEqual({ rssPages: 7 })
  })

  test('missing rss field is rejected', () => {
    const fields: string[] = new Array(10).fill('0')
    expect(parseProcessStat('1234 (short) ' + fields.join(' '))).toBeUndefined()
  })

  test('line without a closing parenthesis is rejected', () => {
    expect(parseProcessStat('no parens here')).toBeUndefined()
  })
})

describe('monitor: container stats rows', () => {
  test('parses a full docker/podman stats row', () => {
    expect(parseContainerLine('abc123def456\t0.05%\t1.23MiB / 15.6GiB\t0.01%\t1.2kB / 3.4MB\t0B / 0B')).toEqual({
      containerId: 'abc123def456',
      cpuPercent: '0.05%',
      memUsage: '1.23MiB / 15.6GiB',
      memPercent: '0.01%',
      netIO: '1.2kB / 3.4MB',
      blockIO: '0B / 0B',
    })
  })

  test('short rows pad missing fields with 0', () => {
    expect(parseContainerLine('abc123\t0.05%')).toEqual({
      containerId: 'abc123',
      cpuPercent: '0.05%',
      memUsage: '0',
      memPercent: '0',
      netIO: '0',
      blockIO: '0',
    })
  })

  test('blank lines are skipped', () => {
    expect(parseContainerLine('   ')).toBeUndefined()
  })
})

describe('monitor: snapshot assembly', () => {
  test('projects host fields and passes through processes and containers', async () => {
    const snapshot: MonitorSnapshot = await assembleSnapshot(12.3, fakeCollectors(), '2026-01-01T00:00:00.000Z', 'linux')
    expect(snapshot).toEqual({
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
      containers: [],
    })
  })

  test('defaults at to a real ISO timestamp and platform to process.platform', async () => {
    const snapshot = await assembleSnapshot(0, fakeCollectors())
    expect(snapshot.at).toEqual(expect.any(String))
    expect(new Date(snapshot.at).toISOString()).toBe(snapshot.at)
    expect(snapshot.host.platform).toBe(process.platform)
  })
})
