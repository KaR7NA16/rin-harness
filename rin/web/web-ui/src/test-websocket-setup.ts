/**
 * Vitest setup for the web-ui (jsdom) lane: stub globalThis.WebSocket.
 *
 * Node's bundled undici WebSocket throws ERR_INVALID_ARG_TYPE on dispatchEvent
 * because the Event it receives comes from jsdom's realm, so `instanceof Event`
 * fails across realms (nodejs/undici#2663). Replacing the global with a plain
 * no-op stub means tests never construct the real undici WebSocket, so the
 * cross-realm dispatch never happens. Tests that need a controllable socket
 * (api/websocket.test.ts) still override this stub locally.
 */

class StubWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readonly url: string
  readyState = StubWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(url: string) {
    this.url = url
  }

  send(_data: string): void {}

  close(): void {
    this.readyState = StubWebSocket.CLOSED
    this.onclose?.()
  }
}

globalThis.WebSocket = StubWebSocket as unknown as typeof WebSocket
