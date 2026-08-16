import { act, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@xterm/xterm', async () => {
  const { FakeTerminal } = await import('./terminalTestFakes')
  return { Terminal: FakeTerminal }
})

vi.mock('@xterm/addon-fit', async () => {
  const { FakeFitAddon } = await import('./terminalTestFakes')
  return { FitAddon: FakeFitAddon }
})

import { useSettingsStore } from '../stores/settingsStore'
import { FakeTerminal } from './terminalTestFakes'
import { Terminal } from './Terminal'

/**
 * The seam replaces xterm with fakes (vi.mock of @xterm/*) and the global
 * WebSocket with a controllable fake, so the test never resolves the
 * @xterm/* packages (not installed in the sandbox) and never opens a real
 * socket.
 */

type SocketHandler = (() => void) | ((event: { data: string }) => void)

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: FakeWebSocket[] = []

  readonly url: string
  readyState = FakeWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onmessage: SocketHandler | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []
  closed = false

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.closed = true
    this.readyState = FakeWebSocket.CLOSED
    ;(this.onclose as (() => void) | null)?.()
  }

  open() {
    this.readyState = FakeWebSocket.OPEN
    ;(this.onopen as (() => void) | null)?.()
  }

  emit(payload: unknown) {
    ;(this.onmessage as ((event: { data: string }) => void) | null)?.({
      data: JSON.stringify(payload),
    })
  }

  fail() {
    ;(this.onerror as (() => void) | null)?.()
    this.readyState = FakeWebSocket.CLOSED
    ;(this.onclose as (() => void) | null)?.()
  }
}

const originalWebSocket = globalThis.WebSocket

describe('Terminal page', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    FakeTerminal.instances = []
    FakeWebSocket.instances = []
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
  })

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket
    vi.useRealTimers()
  })

  /** Render the page and return the created socket and terminal fakes. */
  function renderTerminal(props: { terminalId?: string; spawnCommand?: string[] } = {}) {
    render(
      <Terminal
        terminalId={props.terminalId ?? '__terminal__1'}
        spawnCommand={props.spawnCommand}
      />,
    )
    return {
      ws: FakeWebSocket.instances[0],
      terminal: FakeTerminal.instances[0],
    }
  }

  it('connects to the terminal socket and spawns with argv from the tab', () => {
    const { ws, terminal } = renderTerminal({ spawnCommand: ['bash', '-l'] })

    expect(ws?.url).toBe('ws://127.0.0.1:8320/ws/terminal/__terminal__1')
    expect(terminal?.opened).toBe(true)

    act(() => ws?.open())

    expect(JSON.parse(ws!.sent[0]!)).toEqual({
      type: 'spawn',
      cols: 80,
      rows: 24,
      argv: ['bash', '-l'],
    })
  })

  it('spawns without argv when no spawnCommand is given (server defaults to the shell)', () => {
    const { ws } = renderTerminal()
    act(() => ws?.open())

    const spawn = JSON.parse(ws!.sent[0]!) as Record<string, unknown>
    expect(spawn.type).toBe('spawn')
    expect(spawn.cols).toBe(80)
    expect(spawn.rows).toBe(24)
    expect('argv' in spawn).toBe(false)
  })

  it('forwards terminal keystrokes as input frames', () => {
    const { ws, terminal } = renderTerminal()
    act(() => ws?.open())
    ws!.sent.length = 0

    act(() => terminal?.emitData('ls\r'))

    expect(JSON.parse(ws!.sent[0]!)).toEqual({ type: 'input', text: 'ls\r' })
  })

  it('writes PTY output into the terminal', () => {
    const { ws, terminal } = renderTerminal()

    act(() => ws?.emit({ type: 'data', text: 'hello\r\n' }))

    expect(terminal?.writes).toContain('hello\r\n')
  })

  it('shows an error panel when the server sends an error message', () => {
    const { ws } = renderTerminal()

    act(() => ws?.emit({ type: 'error', message: 'spawn failed', code: 'SPAWN_FAILED' }))

    expect(screen.getByTestId('terminal-error')).toBeInTheDocument()
    expect(screen.getByText('spawn failed')).toBeInTheDocument()
  })

  it('shows an error panel when the socket drops before the session is ready', () => {
    const { ws } = renderTerminal()

    act(() => ws?.fail())

    expect(screen.getByTestId('terminal-error')).toBeInTheDocument()
    expect(screen.getByText('Connection lost.')).toBeInTheDocument()
  })

  it('shows an error panel when the WebSocket cannot be constructed', () => {
    class ThrowingWebSocket {
      readyState = FakeWebSocket.CLOSED

      constructor() {
        throw new Error('connection refused')
      }
    }
    globalThis.WebSocket = ThrowingWebSocket as unknown as typeof WebSocket

    renderTerminal()

    expect(screen.getByTestId('terminal-error')).toBeInTheDocument()
    expect(screen.getByText('Unable to connect to the terminal.')).toBeInTheDocument()
  })

  it('shows the exited status when the PTY exits', () => {
    const { ws } = renderTerminal()

    act(() => ws?.emit({ type: 'exit', exitCode: 0, signal: null }))

    expect(screen.getByTestId('terminal-status')).toHaveTextContent('Exited')
  })

  it('sends close and disposes the terminal on unmount', () => {
    const { unmount } = render(<Terminal terminalId="__terminal__1" />)
    const ws = FakeWebSocket.instances[0]!
    const terminal = FakeTerminal.instances[0]!
    act(() => ws.open())

    unmount()

    expect(terminal.disposed).toBe(true)
    expect(ws.closed).toBe(true)
    expect(JSON.parse(ws.sent[ws.sent.length - 1]!)).toEqual({ type: 'close' })
  })

  it('sends ping heartbeats while connected', async () => {
    vi.useFakeTimers()
    const { ws } = renderTerminal()
    act(() => ws?.open())
    ws!.sent.length = 0

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })

    expect(JSON.parse(ws!.sent[0]!)).toEqual({ type: 'ping' })
  })
})
