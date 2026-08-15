import { useEffect, useRef, useState } from 'react'
import { Activity, Box, Cpu, Database, HardDrive, LoaderCircle, Server, X } from 'lucide-react'
import { api } from '../api/client'
import { useTranslation } from '../i18n'

type HostMetrics = {
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

type Snapshot = {
  at: string
  host: HostMetrics
  processes: { pid: number; name: string; rssMb: number }[]
  containers: {
    containerId: string
    cpuPercent: string
    memUsage: string
    memPercent: string
    netIO: string
    blockIO: string
  }[]
}

const POLL_MS = 3000
const HISTORY = 60

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function formatUpdatedAgo(at: string, t: ReturnType<typeof useTranslation>): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 1000))
  if (seconds < 10) return t('monitor.updatedJustNow')
  if (seconds < 60) return t('monitor.updatedSecondsAgo', { seconds: Math.round(seconds / 5) * 5 })
  return t('monitor.updatedMinutesAgo', { minutes: Math.floor(seconds / 60) })
}

function Sparkline({ data, color, max }: { data: number[]; color: string; max: number }) {
  const W = 220
  const H = 48
  const toPoint = (v: number, i: number) => {
    const x = (i / Math.max(data.length - 1, 1)) * W
    const y = H - Math.min(v / max, 1) * (H - 4) - 2
    return { x, y }
  }
  const points = data.map((v, i) => {
    const { x, y } = toPoint(v, i)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  let peak: { x: number; y: number } | null = null
  if (data.length > 0) {
    let peakIndex = 0
    for (let i = 1; i < data.length; i += 1) {
      if (data[i]! > data[peakIndex]!) peakIndex = i
    }
    peak = toPoint(data[peakIndex]!, peakIndex)
  }
  return (
    <svg width={W} height={H} className="block">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
      {peak && (
        <>
          <circle cx={peak.x} cy={peak.y} r="5" fill={color} opacity="0.25" />
          <circle cx={peak.x} cy={peak.y} r="2.4" fill={color} />
        </>
      )}
    </svg>
  )
}

export function Monitor() {
  const t = useTranslation()
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cpuHistory = useRef<number[]>([])
  const memHistory = useRef<number[]>([])
  const [, forceRender] = useState(0)

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const snap = await api.get<Snapshot>('/api/monitor/snapshot')
        if (cancelled) return
        setSnapshot(snap)
        setError(null)
        cpuHistory.current = [...cpuHistory.current, snap.host.cpuPercent].slice(-HISTORY)
        memHistory.current = [...memHistory.current, snap.host.memPercent].slice(-HISTORY)
        forceRender(n => n + 1)
      } catch (e) {
        if (!cancelled) setError(String(e))
      }
    }
    void poll()
    const timer = setInterval(poll, POLL_MS)
    return () => { cancelled = true; clearInterval(timer) }
  }, [])

  if (!snapshot && !error) {
    return <div className="flex h-full items-center justify-center"><LoaderCircle className="animate-spin text-[var(--color-text-tertiary)]" size={26} /></div>
  }

  const host = snapshot?.host

  return (
    <div className="h-full overflow-y-auto p-[24px]">
      <div className="mx-auto flex max-w-[860px] flex-col gap-[16px]">
        <div className="flex items-center justify-between">
          <h1 className="text-[17px] font-semibold text-[var(--color-text-primary)]">{t('monitor.title')}</h1>
          <span className="text-[11px] text-[var(--color-text-tertiary)]">
            {snapshot ? formatUpdatedAgo(snapshot.at, t) : ''}
          </span>
        </div>
        {error && (
          <div className="flex items-center justify-between gap-[12px] rounded-[10px] border border-[var(--color-error)] px-[14px] py-[10px] text-[12.5px] text-[var(--color-error)]">
            <span className="min-w-0">{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label={t('common.close')}
              className="shrink-0 rounded-full p-[2px] transition-colors hover:bg-[var(--color-error)]/10"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* 本机 */}
        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
          <div className={`rounded-[12px] border bg-[var(--color-surface)] p-[16px] transition-colors ${(host?.cpuPercent ?? 0) >= 85 ? 'border-[var(--color-warning)]' : 'border-[var(--color-border)]'}`}>
            <div className="flex items-center gap-2 text-[12px] text-[var(--color-text-tertiary)]"><Cpu size={14} />{t('monitor.cpu')}</div>
            <div className="mt-[6px] text-[22px] font-semibold text-[var(--color-text-primary)]">{host?.cpuPercent.toFixed(1)}%</div>
            <Sparkline data={cpuHistory.current} color="var(--color-text-accent)" max={100} />
            <div className="mt-[4px] text-[11px] text-[var(--color-text-tertiary)]">
              load {host?.loadAvg.map(v => v.toFixed(2)).join(' / ')} · {host?.platform}
            </div>
          </div>
          <div className={`rounded-[12px] border bg-[var(--color-surface)] p-[16px] transition-colors ${(host?.memPercent ?? 0) >= 85 ? 'border-[var(--color-warning)]' : 'border-[var(--color-border)]'}`}>
            <div className="flex items-center gap-2 text-[12px] text-[var(--color-text-tertiary)]"><Activity size={14} />{t('monitor.memory')}</div>
            <div className="mt-[6px] text-[22px] font-semibold text-[var(--color-text-primary)]">{host?.memPercent.toFixed(1)}%</div>
            <Sparkline data={memHistory.current} color="var(--color-ok)" max={100} />
            <div className="mt-[4px] text-[11px] text-[var(--color-text-tertiary)]">
              {host ? `${(host.memUsedMb / 1024).toFixed(1)} / ${(host.memTotalMb / 1024).toFixed(1)} GB` : ''}
            </div>
          </div>
          <div className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-[16px]">
            <div className="flex items-center gap-2 text-[12px] text-[var(--color-text-tertiary)]"><HardDrive size={14} />{t('monitor.disk')}</div>
            <div className="mt-[6px] text-[22px] font-semibold text-[var(--color-text-primary)]">{host?.diskPercent.toFixed(1)}%</div>
            <div className="mt-[10px] h-[6px] overflow-hidden rounded-full bg-[var(--color-surface-container-low)]">
              <div className="h-full rounded-full bg-[var(--color-text-accent)]" style={{ width: `${host?.diskPercent ?? 0}%` }} />
            </div>
            <div className="mt-[6px] text-[11px] text-[var(--color-text-tertiary)]">
              {host ? `${host.diskUsedGb} / ${host.diskTotalGb} GB` : ''}
            </div>
          </div>
          <div className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-[16px]">
            <div className="flex items-center gap-2 text-[12px] text-[var(--color-text-tertiary)]"><Server size={14} />{t('monitor.processes')}</div>
            <div className="mt-[8px] flex flex-col gap-[4px]">
              {snapshot?.processes.map(p => (
                <div key={p.pid} className="flex justify-between text-[12px]">
                  <span className="text-[var(--color-text-secondary)]">{p.name} <span className="text-[var(--color-text-tertiary)]">#{p.pid}</span></span>
                  <span className="font-mono text-[var(--color-text-primary)]">{p.rssMb} MB</span>
                </div>
              ))}
              <div className="mt-[4px] text-[11px] text-[var(--color-text-tertiary)]">
                {t('monitor.uptime')} {host ? formatUptime(host.uptimeSec) : '-'}
              </div>
            </div>
          </div>
        </div>

        {/* 容器 */}
        <div>
          <h2 className="mb-[8px] flex items-center gap-2 text-[13px] font-semibold text-[var(--color-text-primary)]">
            <Box size={15} />{t('monitor.containers')}
          </h2>
          {(!snapshot || snapshot.containers.length === 0) && (
            <div className="rounded-[12px] border border-dashed border-[var(--color-border)] py-[26px] text-center text-[12.5px] text-[var(--color-text-tertiary)]">
              {t('monitor.noContainers')}
            </div>
          )}
          <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
            {snapshot?.containers.map(c => (
              <div key={c.containerId} className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-[14px]">
                <div className="flex items-center gap-2">
                  <Database size={14} className="text-[var(--color-text-tertiary)]" />
                  <span className="font-mono text-[12.5px] font-semibold text-[var(--color-text-primary)]">{c.containerId}</span>
                </div>
                <div className="mt-[8px] grid grid-cols-2 gap-y-[4px] text-[11.5px]">
                  <span className="text-[var(--color-text-tertiary)]">CPU</span><span className="text-right font-mono text-[var(--color-text-primary)]">{c.cpuPercent}</span>
                  <span className="text-[var(--color-text-tertiary)]">MEM</span><span className="text-right font-mono text-[var(--color-text-primary)]">{c.memUsage} ({c.memPercent})</span>
                  <span className="text-[var(--color-text-tertiary)]">NET</span><span className="text-right font-mono text-[var(--color-text-primary)]">{c.netIO}</span>
                  <span className="text-[var(--color-text-tertiary)]">IO</span><span className="text-right font-mono text-[var(--color-text-primary)]">{c.blockIO}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
