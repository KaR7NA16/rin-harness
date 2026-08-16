/**
 * rin web-server — human-facing terminal session registry.
 *
 * Owns live PTY sessions for browser humans, one per frontend tab id. Unlike
 * @deepseek-ai/dsh-terminal (which is Agent-owned), these sessions are driven
 * by the /ws/terminal/<id> bridge, die with their owning server, and never
 * attach to an agent session.
 *
 * @module @rin/web-server
 */

import type { DshSubprocessLike, TerminalHandleLike, TerminalSignal } from './routes.ts'
import { errorMessage } from './http.ts'

/** Stable terminal-protocol error codes (subset of the WebSocket wire codes). */
export type TerminalErrorCode = 'SUBPROCESS_UNAVAILABLE' | 'SPAWN_FAILED' | 'NOT_SPAWNED' | 'INTERNAL'

/** An error carrying the stable wire code the WebSocket bridge must report. */
export class TerminalError extends Error {
  /** The protocol code sent to the client as the error frame's "code" field. */
  readonly code: TerminalErrorCode

  /**
   * @param code - stable protocol code for the error frame.
   * @param message - human-readable failure detail.
   */
  constructor(code: TerminalErrorCode, message: string) {
    super(message)
    this.name = 'TerminalError'
    this.code = code
  }
}

/** Exit facts of one terminal session, wire-shaped for the WebSocket protocol. */
export interface TerminalExit {
  exitCode: number | null
  signal: string | null
}

/** A live terminal session handle exposed to the WebSocket bridge. */
export interface TerminalSession {
  /** The frontend tab id this session is keyed by. */
  readonly terminalId: string
  /** Top-level terminal process id. */
  readonly pid: number
  /**
   * Write raw text to the terminal input.
   * @param data - text delivered without implicit newline conversion.
   */
  write(data: string): Promise<void>
  /**
   * Deliver a signal to the foreground process group.
   * @param signal - permitted terminal signal.
   * @returns the process-group id that received it.
   */
  signal(signal: TerminalSignal): Promise<number>
  /**
   * Terminate the terminal session; the exit callback fires once with null facts.
   */
  close(): Promise<void>
}

/** One spawn request from the WebSocket bridge. */
export interface TerminalSpawnOptions {
  /** The frontend tab id; a live session with this id is closed first. */
  terminalId: string
  /** Optional program + arguments; defaults to the login shell. */
  argv?: readonly string[] | undefined
  /** Optional working directory; defaults to process.cwd(). */
  cwd?: string | undefined
  /** Optional column count; defaults to DEFAULT_COLS. */
  cols?: number | undefined
  /** Optional row count; defaults to DEFAULT_ROWS. */
  rows?: number | undefined
  /** Receives every PTY output delta as decoded text. */
  onData: (text: string) => void
  /** Receives the session's exit facts exactly once, then the session is gone. */
  onExit: (exit: TerminalExit) => void
}

/** Fixed v1 terminal geometry; resize is not implemented (Known Limitation). */
const DEFAULT_COLS = 80
/** Fixed v1 terminal geometry; resize is not implemented (Known Limitation). */
const DEFAULT_ROWS = 24
/** TERM-to-KILL cleanup grace for the subprocess provider's terminate escalation. */
const TERMINAL_GRACE_MS = 2000

/**
 * Resolve the login shell argv default: $SHELL on POSIX, /bin/bash fallback.
 * @returns the single-element argv for an interactive login shell.
 */
function loginShellArgv(): readonly string[] {
  const shell = process.env.SHELL
  if (typeof shell === 'string' && shell.length > 0) return [shell]
  return ['/bin/bash']
}

/**
 * The live-session registry. Keyed by frontend tab id; a re-spawn of a live id
 * closes the previous session first so a reconnecting tab cannot leak its PTY.
 */
export class TerminalRegistry {
  private readonly sessions = new Map<string, TerminalSessionImpl>()
  private readonly getSubprocess: () => DshSubprocessLike | undefined
  private disposed = false

  /**
   * @param getSubprocess - thunk reading the optional dsh subprocess provider.
   */
  constructor(getSubprocess: () => DshSubprocessLike | undefined) {
    this.getSubprocess = getSubprocess
  }

  /**
   * Spawn one terminal session and start piping its output to the subscriber.
   * @param options - spawn request plus the per-session data/exit subscribers.
   * @returns the live session once the PTY is allocated.
   */
  async spawn(options: TerminalSpawnOptions): Promise<TerminalSession> {
    if (this.disposed) {
      throw new TerminalError('INTERNAL', 'terminal registry is disposed; spawn rejected')
    }
    // v1 is POSIX-only: the login-shell default is a POSIX concept and the
    // provider's PTY semantics are only verified there. Fail loud up front.
    if (process.platform === 'win32') {
      throw new TerminalError('SPAWN_FAILED', 'terminal sessions require a POSIX host; win32 is not supported in v1')
    }
    const subprocess = this.getSubprocess()
    if (subprocess === undefined) {
      throw new TerminalError('SUBPROCESS_UNAVAILABLE', 'subprocess service is not mounted; cannot spawn a terminal')
    }
    const existing = this.sessions.get(options.terminalId)
    if (existing !== undefined) await existing.close()

    const spec = {
      argv: options.argv !== undefined && options.argv.length > 0 ? options.argv : loginShellArgv(),
      cwd: options.cwd ?? process.cwd(),
      rows: options.rows ?? DEFAULT_ROWS,
      cols: options.cols ?? DEFAULT_COLS,
      graceMs: TERMINAL_GRACE_MS,
    }
    let handle: TerminalHandleLike
    try {
      handle = await subprocess.spawnTerminal(spec)
    } catch (err) {
      throw new TerminalError('SPAWN_FAILED', 'terminal spawn failed: ' + errorMessage(err))
    }
    // dispose() may have run while the provider allocated the PTY; never leak
    // a handle the teardown promise already missed.
    if (this.disposed) {
      await handle.terminate()
      throw new TerminalError('INTERNAL', 'terminal registry is disposed; spawn rejected')
    }
    const session = new TerminalSessionImpl(
      options.terminalId,
      handle,
      options.onData,
      options.onExit,
      () => { this.sessions.delete(options.terminalId) },
    )
    this.sessions.set(options.terminalId, session)
    return session
  }

  /**
   * Read the live session for a tab id, if any.
   * @param terminalId - the frontend tab id.
   * @returns the live session, or undefined when absent or already exited.
   */
  get(terminalId: string): TerminalSession | undefined {
    return this.sessions.get(terminalId)
  }

  /**
   * Terminate every live session and stop accepting new spawns. Used by the
   * plugin teardown (ctx.effect) so no PTY outlives the web-server.
   */
  async dispose(): Promise<void> {
    this.disposed = true
    const live = [...this.sessions.values()]
    this.sessions.clear()
    await Promise.allSettled(live.map(session => session.close()))
  }
}

/** One live session: forwards input/signals, pipes output, settles on exit. */
class TerminalSessionImpl implements TerminalSession {
  readonly terminalId: string
  readonly pid: number
  private readonly handle: TerminalHandleLike
  private readonly onData: (text: string) => void
  private readonly onExit: (exit: TerminalExit) => void
  private readonly onRemoved: () => void
  private finished = false

  constructor(
    terminalId: string,
    handle: TerminalHandleLike,
    onData: (text: string) => void,
    onExit: (exit: TerminalExit) => void,
    onRemoved: () => void,
  ) {
    this.terminalId = terminalId
    this.pid = handle.pid
    this.handle = handle
    this.onData = onData
    this.onExit = onExit
    this.onRemoved = onRemoved
    handle.output.on('data', (chunk: unknown) => this.emitOutput(chunk))
    handle.output.on('error', () => this.finish({ exitCode: null, signal: null }))
    void handle.done.then(
      exit => this.finish({ exitCode: exit.exitCode, signal: exit.signal ?? null }),
      () => this.finish({ exitCode: null, signal: null }),
    )
  }

  /** Decode one output chunk (the local provider emits utf8 Buffers) and forward it. */
  private emitOutput(chunk: unknown): void {
    const text = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
    this.onData(text)
  }

  /** Settle the session exactly once: remove it, then report the exit. */
  private finish(exit: TerminalExit): void {
    if (this.finished) return
    this.finished = true
    this.onRemoved()
    this.onExit(exit)
  }

  async write(data: string): Promise<void> {
    if (this.finished) throw new TerminalError('NOT_SPAWNED', 'terminal session is not running')
    await this.handle.write(data)
  }

  async signal(signal: TerminalSignal): Promise<number> {
    if (this.finished) throw new TerminalError('NOT_SPAWNED', 'terminal session is not running')
    return this.handle.signalForeground(signal)
  }

  async close(): Promise<void> {
    if (this.finished) return
    await this.handle.terminate()
    // The user asked for teardown; report null exit facts so the client gets
    // one uniform "session over" signal regardless of how the PTY died.
    this.finish({ exitCode: null, signal: null })
  }
}
