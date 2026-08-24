/**
 * rin web-server — human terminal WebSocket bridge.
 *
 * Speaks the /ws/terminal/<terminalId> JSON protocol on top of the terminal
 * session registry. Mirrors the legacy bridge's auth/host-header upgrade
 * guards; each connection owns one spawned session keyed by the frontend tab
 * id, and the session dies with the connection.
 *
 * @module @rin/host/web-server
 */

import type { Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import type { Config } from './types.ts'
import { extractBearerToken, isAllowedHostHeader } from './http.ts'
import type { RinServiceRefs, TerminalSignal } from './routes.ts'
import { TerminalError, TerminalRegistry, type TerminalExit, type TerminalSession } from './terminal.ts'

const TERMINAL_WS_PATH_RE = /^\/ws\/terminal\/([^/]+)$/
/** Signals accepted by the protocol's "signal" message. */
const TERMINAL_SIGNALS: ReadonlySet<string> = new Set(['SIGINT', 'SIGTERM', 'SIGKILL', 'SIGTSTP', 'SIGHUP'])

/**
 * True when the pathname is owned by this bridge.
 * @param pathname - the request URL pathname (no query string).
 * @returns true for /ws/terminal/<terminalId> routes.
 */
export function isTerminalWsPathname(pathname: string): boolean {
  return TERMINAL_WS_PATH_RE.test(pathname)
}

/** One client message understood by this bridge. */
interface TerminalClientMessage {
  type: 'spawn' | 'input' | 'signal' | 'close' | 'ping'
  argv?: unknown
  cwd?: unknown
  cols?: unknown
  rows?: unknown
  text?: unknown
  signal?: unknown
}

/** Mutable per-socket state shared between the message and close handlers. */
interface SocketState {
  session: TerminalSession | undefined
  finished: boolean
}

/** The teardown handle the server close path awaits. */
export interface TerminalBridge {
  /** Terminate every live session; the server close path calls this. */
  dispose(): Promise<void>
}

/**
 * Attach the terminal WebSocket upgrade route to the running HTTP server.
 * @param server - the node:http server to attach the upgrade handler to.
 * @param services - thunks that read the optional @rin services.
 * @param config - the resolved plugin configuration (authToken and bound port).
 * @param getBoundPort - reads the actual bound port, set after listen().
 * @returns a handle that terminates every live session on teardown.
 */
export function attachTerminalWebSocket(
  server: Server,
  services: RinServiceRefs,
  config: Config,
  getBoundPort: () => number,
): TerminalBridge {
  const wss = new WebSocketServer({ noServer: true })
  const registry = new TerminalRegistry(() => services.subprocess())

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const match = TERMINAL_WS_PATH_RE.exec(url.pathname)
    if (match === null) return
    if (!isAllowedHostHeader(req.headers.host, getBoundPort())) {
      rejectUpgrade(socket, 403, 'Forbidden')
      return
    }
    if (config.authToken !== undefined && extractBearerToken(req.headers.authorization, url.search) !== config.authToken) {
      rejectUpgrade(socket, 401, 'Unauthorized')
      return
    }
    wss.handleUpgrade(req, socket, head, ws => {
      void handleSocket(ws, decodeURIComponent(match[1] ?? ''), registry)
    })
  })

  return {
    dispose: () => registry.dispose(),
  }
}

/** Write a minimal HTTP rejection to an upgrade socket and close it. */
function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
}

/** Wire one socket: parse messages, forward verbs, terminate the session on close. */
async function handleSocket(ws: WebSocket, terminalId: string, registry: TerminalRegistry): Promise<void> {
  const state: SocketState = { session: undefined, finished: false }

  ws.on('message', raw => {
    let message: TerminalClientMessage
    try {
      message = JSON.parse(String(raw)) as TerminalClientMessage
    } catch {
      return
    }
    void handleClientMessage(ws, terminalId, message, registry, state)
  })

  ws.on('error', () => {
    // Socket close follows; the session terminates there.
  })

  ws.on('close', () => {
    // The human tab is gone and there is no resume protocol in v1, so the
    // session has no driver left: terminate it.
    if (state.session !== undefined) void state.session.close()
  })
}

/** Dispatch one client message; a failure never takes down the whole host. */
async function handleClientMessage(
  ws: WebSocket,
  terminalId: string,
  message: TerminalClientMessage,
  registry: TerminalRegistry,
  state: SocketState,
): Promise<void> {
  try {
    await handleClientMessageInner(ws, terminalId, message, registry, state)
  } catch (err) {
    send(ws, {
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
      code: err instanceof TerminalError ? err.code : 'INTERNAL',
    })
  }
}

async function handleClientMessageInner(
  ws: WebSocket,
  terminalId: string,
  message: TerminalClientMessage,
  registry: TerminalRegistry,
  state: SocketState,
): Promise<void> {
  switch (message.type) {
    case 'ping':
      send(ws, { type: 'pong' })
      return
    case 'spawn': {
      if (state.session !== undefined || state.finished) {
        throw new TerminalError('INTERNAL', 'terminal session already spawned on this connection')
      }
      const session = await registry.spawn({
        terminalId,
        argv: parseArgv(message.argv),
        cwd: parseCwd(message.cwd),
        cols: parseSize(message.cols),
        rows: parseSize(message.rows),
        onData: text => send(ws, { type: 'data', text }),
        onExit: (exit: TerminalExit) => {
          state.finished = true
          send(ws, { type: 'exit', exitCode: exit.exitCode, signal: exit.signal })
        },
      })
      state.session = session
      send(ws, { type: 'ready', terminalId, pid: session.pid })
      return
    }
    case 'input': {
      const text = typeof message.text === 'string' ? message.text : ''
      requireSession(state)
      if (text !== '') await state.session?.write(text)
      return
    }
    case 'signal': {
      const signal = message.signal
      if (typeof signal !== 'string' || !TERMINAL_SIGNALS.has(signal)) {
        throw new TerminalError('INTERNAL', 'unsupported signal: ' + String(signal))
      }
      requireSession(state)
      await state.session?.signal(signal as TerminalSignal)
      return
    }
    case 'close': {
      requireSession(state)
      state.finished = true
      await state.session?.close()
      return
    }
    default:
      throw new TerminalError('INTERNAL', 'unknown terminal message type: ' + String((message as { type?: unknown }).type))
  }
}

/** Reject protocol verbs that need a live spawned session. */
function requireSession(state: SocketState): void {
  if (state.session === undefined || state.finished) {
    throw new TerminalError('NOT_SPAWNED', 'terminal session is not spawned')
  }
}

/** Parse the optional argv field: an array of strings, or undefined for the login-shell default. */
function parseArgv(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) return value as string[]
  throw new TerminalError('INTERNAL', 'argv must be an array of strings')
}

/** Parse the optional cwd field: a non-empty string, or undefined for process.cwd(). */
function parseCwd(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string' && value.length > 0) return value
  throw new TerminalError('INTERNAL', 'cwd must be a non-empty string')
}

/** Parse one optional geometry field: a positive integer, or undefined for the fixed v1 default. */
function parseSize(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
  throw new TerminalError('INTERNAL', 'cols and rows must be positive integers')
}

function send(ws: WebSocket, message: unknown): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message))
  }
}
