import { useEffect, useRef, useState } from 'react'
import { getAuthToken, getBaseUrl } from '../api/client'
import { useTranslation } from '../i18n'
import { Icon } from '../components/shared/Icon'
import {
  terminalDeps,
  type XtermFitAddonHandle,
  type XtermTerminalHandle,
} from './terminalDeps'

/**
 * Interactive terminal page: an xterm.js terminal backed by the server-side
 * PTY WebSocket at /ws/terminal/<terminalId> (see @rin/web-server README).
 *
 * Wire protocol (JSON text frames):
 *   client -> server: spawn (first, once) | input | close | ping
 *   server -> client: ready | data | exit | error | pong
 *
 * Known limitation: the subprocess terminal handle has no resize method, so
 * the PTY stays at the size reported by the initial spawn (fit addon reports
 * it once on mount). Window resizes refit the local xterm rendering only; no
 * resize message is sent.
 */

type TerminalStatus = 'starting' | 'running' | 'exited' | 'error'

type TerminalError = {
  title: string
  message: string
}

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24
const PING_INTERVAL_MS = 30_000

type TerminalProps = {
  terminalId: string
  spawnCommand?: string[]
  cwd?: string
}

/** Read the app's terminal palette CSS variables, falling back to the dark defaults. */
function readTerminalTheme(): Record<string, string> {
  const styles =
    typeof document !== 'undefined' ? getComputedStyle(document.documentElement) : null
  const value = (name: string, fallback: string): string =>
    styles?.getPropertyValue(name).trim() || fallback
  return {
    background: value('--color-terminal-bg', '#1E1E1E'),
    foreground: value('--color-terminal-fg', '#D4D4D4'),
    cursor: value('--color-terminal-accent', '#28C840'),
  }
}

/** Build the PTY WebSocket URL for a terminal id, mirroring the chat websocket auth convention. */
function buildTerminalWsUrl(terminalId: string): string {
  const base = getBaseUrl().replace(/^http/, 'ws')
  const token = getAuthToken()
  const query = token ? `?token=${encodeURIComponent(token)}` : ''
  return `${base}/ws/terminal/${encodeURIComponent(terminalId)}${query}`
}

export function Terminal({ terminalId, spawnCommand, cwd }: TerminalProps) {
  const t = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<TerminalStatus>('starting')
  const [error, setError] = useState<TerminalError | null>(null)

  useEffect(() => {
    let disposed = false
    let exited = false
    let ws: WebSocket | null = null
    let terminal: XtermTerminalHandle | null = null
    let fitAddon: XtermFitAddonHandle | null = null
    let pingTimer: ReturnType<typeof setInterval> | null = null
    let resizeObserver: ResizeObserver | null = null

    const send = (message: unknown): void => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message))
      }
    }

    const showError = (title: string, message: string): void => {
      if (disposed) return
      setStatus('error')
      setError({ title, message })
    }

    const container = containerRef.current
    if (!container) return

    const term = new terminalDeps.Terminal({
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      fontFamily: 'var(--font-mono)',
      cursorBlink: true,
      scrollback: 5000,
      theme: readTerminalTheme(),
    })
    terminal = term
    term.open(container)

    const fit = new terminalDeps.FitAddon()
    fitAddon = fit
    term.loadAddon(fit)
    fit.fit()

    // Refit the local rendering when the panel resizes. The server-side PTY
    // has no resize support, so only the viewport changes; see Known
    // Limitations in the web-ui README.
    resizeObserver = new ResizeObserver(() => {
      if (!disposed && fitAddon) {
        try { fitAddon.fit() } catch { /* ignore transient layout errors */ }
      }
    })
    resizeObserver.observe(container)

    term.onData((data) => {
      send({ type: 'input', text: data })
    })
    term.focus()

    try {
      ws = new WebSocket(buildTerminalWsUrl(terminalId))
    } catch {
      showError(t('terminal.connectionFailed'), '')
      return
    }
    if (disposed) {
      try { ws.close() } catch { /* socket already gone */ }
      return
    }

    ws.onopen = () => {
      if (disposed) return
      send({
        type: 'spawn',
        cols: term.cols,
        rows: term.rows,
        ...(cwd ? { cwd } : {}),
        ...(spawnCommand && spawnCommand.length > 0 ? { argv: spawnCommand } : {}),
      })
      setStatus('running')
      pingTimer = setInterval(() => send({ type: 'ping' }), PING_INTERVAL_MS)
    }

    ws.onmessage = (event) => {
      if (disposed) return
      let parsed: unknown
      try {
        parsed = JSON.parse(String(event.data))
      } catch {
        return
      }
      if (typeof parsed !== 'object' || parsed === null) return
      const msg = parsed as Record<string, unknown>
      switch (msg.type) {
        case 'data':
          if (typeof msg.text === 'string') term.write(msg.text)
          break
        case 'exit':
          exited = true
          setStatus('exited')
          break
        case 'error':
          exited = true
          showError(
            t('settings.terminal.status.error'),
            typeof msg.message === 'string' ? msg.message : '',
          )
          break
        case 'ready':
          setStatus('running')
          break
        default:
          break
      }
    }

    // onerror is always followed by onclose; the close handler reports the failure.
    ws.onerror = () => {}

    ws.onclose = () => {
      if (disposed || exited) return
      showError(t('terminal.connectionLost'), '')
    }

    return () => {
      disposed = true
      if (ws) {
        send({ type: 'close' })
        try { ws.close() } catch { /* socket already gone */ }
      }
      if (pingTimer) clearInterval(pingTimer)
      resizeObserver?.disconnect()
      if (fitAddon) {
        try { fitAddon.dispose() } catch { /* already disposed */ }
      }
      if (terminal) {
        try { terminal.dispose() } catch { /* already disposed */ }
      }
    }
  }, [cwd, terminalId, spawnCommand, t])

  return (
    <div
      data-testid="terminal-page"
      className="relative h-full min-h-0 flex-1 overflow-hidden bg-[var(--color-terminal-bg)]"
    >
      <div ref={containerRef} className="h-full w-full overflow-hidden" />

      {status === 'exited' && (
        <div
          data-testid="terminal-status"
          className="absolute inset-x-0 bottom-0 z-10 border-t border-[var(--color-terminal-border)] bg-[var(--color-terminal-header)] px-3 py-1 text-[11px] text-[var(--color-terminal-muted)]"
        >
          {t('settings.terminal.status.exited')}
        </div>
      )}

      {status === 'error' && error && (
        <div
          data-testid="terminal-error"
          className="absolute inset-0 z-20 flex items-center justify-center bg-[var(--color-surface)] p-6"
        >
          <div className="flex max-w-md flex-col items-center gap-3 text-center">
            <Icon name="error" size={40} className="text-[var(--color-error)]" />
            <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)]">{error.title}</h2>
            {error.message ? (
              <p className="text-[13px] text-[var(--color-text-secondary)]">{error.message}</p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
