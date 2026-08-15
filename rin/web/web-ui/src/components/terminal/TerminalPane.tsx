import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { terminalApi } from '../../api/terminal'
import { useTranslation } from '../../i18n'
import { Icon } from '../shared/Icon'
import { resolveTerminalTheme } from './theme'

type XTerm = import('@xterm/xterm').Terminal
type XTermFit = import('@xterm/addon-fit').FitAddon

export type PaneStatus = 'idle' | 'starting' | 'running' | 'exited' | 'error' | 'unavailable'

export function TerminalPane({
  active,
  focused,
  spawnCommand,
  onFocus,
  onClose,
  showClose,
  testId,
  onStatusChange,
}: {
  active: boolean
  focused: boolean
  spawnCommand?: string[]
  onFocus: () => void
  onClose?: () => void
  showClose: boolean
  testId?: string
  onStatusChange?: (status: PaneStatus) => void
}) {
  const t = useTranslation()
  const hostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const fitRef = useRef<XTermFit | null>(null)
  const sessionIdRef = useRef<number | null>(null)
  const unlistenRef = useRef<Array<() => void>>([])
  const resizeRafRef = useRef<number | null>(null)
  const [status, setStatus] = useState<PaneStatus>('idle')
  const [shellInfo, setShellInfo] = useState<{ shell: string; cwd: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const generationRef = useRef(0)

  useEffect(() => {
    onStatusChange?.(status)
  }, [status, onStatusChange])

  const resizeSession = useCallback(() => {
    const terminal = terminalRef.current
    const sessionId = sessionIdRef.current
    if (!terminal) return
    if (resizeRafRef.current !== null) cancelAnimationFrame(resizeRafRef.current)
    resizeRafRef.current = requestAnimationFrame(() => {
      resizeRafRef.current = null
      try {
        fitRef.current?.fit()
      } catch { /* host hidden */ }
      if (sessionId) {
        // Promise.resolve: some test mocks return undefined from resize().
        void Promise.resolve(terminalApi.resize(sessionId, terminal.cols, terminal.rows)).catch(() => {})
      }
    })
  }, [])

  const startTerminal = useCallback(async () => {
    if (!terminalApi.isAvailable()) {
      setStatus('unavailable')
      return
    }
    const host = hostRef.current
    if (!host) return

    const generation = ++generationRef.current
    const isStale = () => generationRef.current !== generation

    setError(null)
    setStatus('starting')
    setShellInfo(null)

    const existing = sessionIdRef.current
    if (existing) {
      await terminalApi.kill(existing).catch(() => {})
      if (isStale()) return
      sessionIdRef.current = null
    }
    unlistenRef.current.forEach((u) => u())
    unlistenRef.current = []

    terminalRef.current?.dispose()
    terminalRef.current = null
    fitRef.current = null
    host.innerHTML = ''

    const [{ Terminal }, { FitAddon }] = await Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
    ])
    if (isStale()) return

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: false,
      fontFamily: "var(--font-mono), 'SFMono-Regular', Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 4000,
      theme: resolveTerminalTheme(),
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(host)
    terminalRef.current = terminal
    fitRef.current = fit
    fit.fit()

    const discardTerminal = (unlisteners: Array<() => void>) => {
      unlisteners.forEach((u) => u())
      terminal.dispose()
      if (terminalRef.current === terminal) {
        terminalRef.current = null
        fitRef.current = null
      }
    }

    const outputUnlisten = await terminalApi.onOutput((payload) => {
      if (payload.session_id === sessionIdRef.current) {
        terminal.write(payload.data)
      }
    })
    if (isStale()) {
      discardTerminal([outputUnlisten])
      return
    }
    const exitUnlisten = await terminalApi.onExit((payload) => {
      if (payload.session_id !== sessionIdRef.current) return
      setStatus('exited')
      const signal = payload.signal ? `, ${payload.signal}` : ''
      terminal.writeln(`\r\n[process exited: ${payload.code}${signal}]`)
      sessionIdRef.current = null
    })
    if (isStale()) {
      discardTerminal([outputUnlisten, exitUnlisten])
      return
    }
    unlistenRef.current = [outputUnlisten, exitUnlisten]

    terminal.onData((data) => {
      const sessionId = sessionIdRef.current
      if (sessionId) {
        void terminalApi.write(sessionId, data).catch((err) => {
          setError(err instanceof Error ? err.message : String(err))
          setStatus('error')
        })
      }
    })

    try {
      const result = await terminalApi.spawn({
        cols: terminal.cols,
        rows: terminal.rows,
        ...(spawnCommand ? { command: spawnCommand } : {}),
      })
      if (isStale()) {
        void terminalApi.kill(result.session_id).catch(() => {})
        discardTerminal([outputUnlisten, exitUnlisten])
        return
      }
      sessionIdRef.current = result.session_id
      setShellInfo({ shell: result.shell, cwd: result.cwd })
      setStatus('running')
      resizeSession()
    } catch (err) {
      discardTerminal([outputUnlisten, exitUnlisten])
      if (isStale()) return
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }, [resizeSession, spawnCommand])

  useEffect(() => {
    if (!terminalApi.isAvailable()) return
    void startTerminal()
    const observer = new ResizeObserver(() => resizeSession())
    if (hostRef.current) observer.observe(hostRef.current)
    return () => {
      generationRef.current += 1
      observer.disconnect()
      if (resizeRafRef.current !== null) {
        cancelAnimationFrame(resizeRafRef.current)
        resizeRafRef.current = null
      }
      const sessionId = sessionIdRef.current
      if (sessionId) void terminalApi.kill(sessionId).catch(() => {})
      terminalRef.current?.dispose()
      terminalRef.current = null
      fitRef.current = null
      unlistenRef.current.forEach((u) => u())
      unlistenRef.current = []
      sessionIdRef.current = null
    }
  }, [resizeSession, startTerminal])

  useEffect(() => {
    if (active || focused) resizeSession()
  }, [active, focused, resizeSession])

  // 主题实时跟随: data-theme 变化时更新 xterm 主题
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const terminal = terminalRef.current
      if (terminal) terminal.options.theme = resolveTerminalTheme()
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  if (status === 'unavailable') {
    return (
      <div className="flex h-full items-center justify-center text-[12.5px] text-[var(--color-text-tertiary)]">
        {t('settings.terminal.unavailableTitle')}
      </div>
    )
  }

  const dotClass =
    status === 'running'
      ? 'bg-[var(--color-success)]'
      : status === 'error'
        ? 'bg-[var(--color-error)]'
        : status === 'starting'
          ? 'bg-[var(--color-warning)]'
          : 'bg-[var(--color-terminal-muted)]'

  return (
    <div
      onMouseDown={onFocus}
      className={`relative flex h-full min-h-0 flex-col overflow-hidden bg-[var(--color-terminal-bg)] transition-shadow ${
        focused ? 'shadow-[inset_0_0_0_1px_var(--color-text-accent)]' : ''
      }`}
    >
      <div className="flex h-[26px] shrink-0 items-center gap-2 border-b border-[var(--color-terminal-border)] bg-[var(--color-terminal-header)] px-[8px]">
        <span className={`h-[6px] w-[6px] rounded-full ${dotClass}`} />
        <span className="shrink-0 truncate font-mono text-[10.5px] text-[var(--color-terminal-muted)]">
          {shellInfo ? shellInfo.shell : t('settings.terminal.windowTitle')}
        </span>
        {shellInfo && (
          <span className="truncate font-mono text-[10.5px] text-[var(--color-terminal-muted)]">
            {shellInfo.cwd}
          </span>
        )}
        {error && <span className="truncate text-[10.5px] text-[var(--color-error)]">{error}</span>}
        <div className="flex-1" />
        {showClose && onClose && (
          <button
            onClick={(e) => { e.stopPropagation(); onClose() }}
            className="rounded p-[2px] text-[var(--color-terminal-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
            aria-label={t('terminal.closePane')}
          >
            <X size={11} />
          </button>
        )}
      </div>
      <div ref={hostRef} data-testid={testId} className="min-h-0 flex-1" />
      {(status === 'error' || status === 'exited') && (
        <div className="absolute inset-x-0 bottom-0 top-[26px] z-10 flex items-center justify-center bg-[var(--color-terminal-bg)]/70">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); void startTerminal() }}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-3 text-[12px] font-bold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
          >
            <Icon name="restart_alt" size={14} />
            {t('settings.terminal.restart')}
          </button>
        </div>
      )}
    </div>
  )
}
