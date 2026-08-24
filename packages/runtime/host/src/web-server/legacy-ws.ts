/**
 * rin web-server — legacy desktop WebSocket chat bridge.
 *
 * The migrated desktop frontend opens `/ws/<sessionId>` and speaks the old
 * client-message/server-message protocol. This module drives the dsh Agent for
 * that session and projects the dsh session events into the legacy messages:
 * text/reasoning deltas, tool calls/results, completion, and errors.
 *
 * @module @rin/host/web-server
 */

import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import type { Config } from './types.ts'
import { extractBearerToken, isAllowedHostHeader } from './http.ts'
import type { DshAgentHandleLike, RinServiceRefs } from './routes.ts'
import { isTerminalWsPathname } from './terminal-ws.ts'

const WS_PATH_RE = /^\/ws\/([^/]+)$/

/** A legacy client message understood by this bridge. */
interface ClientMessage {
  type: 'ping' | 'user_message' | 'stop_generation'
  content?: string
}

/**
 * Attach the legacy WebSocket upgrade route to the running HTTP server.
 * @param server - the node:http server to attach the upgrade handler to.
 * @param services - thunks that read the optional @rin services.
 * @param config - the resolved plugin configuration (authToken and bound port).
 * @param getBoundPort - reads the actual bound port, set after listen().
 */
export function attachLegacyWebSocket(
  server: Server,
  services: RinServiceRefs,
  config: Config,
  getBoundPort: () => number,
): void {
  const wss = new WebSocketServer({ noServer: true })
  const agents = new Map<string, Promise<DshAgentHandleLike>>()

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const match = WS_PATH_RE.exec(url.pathname)
    if (match === null) {
      // Terminal routes belong to the terminal bridge; anything else is a
      // garbage upgrade that must not hang the socket.
      if (isTerminalWsPathname(url.pathname)) return
      socket.destroy()
      return
    }
    if (!isAllowedHostHeader(req.headers.host, getBoundPort())) {
      rejectUpgrade(socket, 403, 'Forbidden')
      return
    }
    if (config.authToken !== undefined && extractBearerToken(req.headers.authorization, url.search) !== config.authToken) {
      rejectUpgrade(socket, 401, 'Unauthorized')
      return
    }
    wss.handleUpgrade(req, socket, head, ws => {
      void handleSocket(ws, decodeURIComponent(match[1] ?? ''), services, agents)
    })
  })
}

/** Write a minimal HTTP rejection to an upgrade socket and close it. */
function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
}

async function handleSocket(
  ws: WebSocket,
  sessionId: string,
  services: RinServiceRefs,
  agents: Map<string, Promise<DshAgentHandleLike>>,
): Promise<void> {
  send(ws, { type: 'connected', sessionId })
  trackLegacySocket(sessionId, ws)

  ws.on('message', raw => {
    let message: ClientMessage
    try {
      message = JSON.parse(String(raw)) as ClientMessage
    } catch {
      return
    }
    void handleClientMessage(ws, sessionId, message, services, agents)
  })

  ws.on('error', () => {
    // Socket close follows; the agent stays alive for reconnect.
  })
}

async function handleClientMessage(
  ws: WebSocket,
  sessionId: string,
  message: ClientMessage,
  services: RinServiceRefs,
  agents: Map<string, Promise<DshAgentHandleLike>>,
): Promise<void> {
  try {
    await handleClientMessageInner(ws, sessionId, message, services, agents)
  } catch (err) {
    // A single client message must never take down the whole host: report the
    // failure on the socket and keep serving.
    send(ws, { type: 'error', message: err instanceof Error ? err.message : String(err), code: 'INTERNAL' })
  }
}

async function handleClientMessageInner(
  ws: WebSocket,
  sessionId: string,
  message: ClientMessage,
  services: RinServiceRefs,
  agents: Map<string, Promise<DshAgentHandleLike>>,
): Promise<void> {
  if (message.type === 'ping') {
    send(ws, { type: 'pong' })
    return
  }

  const handle = await getOrCreateAgent(sessionId, services, agents)
  if (handle === undefined) {
    send(ws, { type: 'error', message: 'agent runtime is not available', code: 'AGENT_UNAVAILABLE' })
    return
  }

  if (message.type === 'stop_generation') {
    handle.agent.cancel({ kind: 'user' })
    send(ws, { type: 'status', state: 'idle' })
    return
  }

  if (message.type === 'user_message') {
    const content = message.content?.trim() ?? ''
    if (content === '') return
    send(ws, { type: 'status', state: 'thinking', verb: 'thinking' })
    handle.agent.followup({
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: content }],
      source: { kind: 'user' },
    })
  }
}

async function getOrCreateAgent(
  sessionId: string,
  services: RinServiceRefs,
  agents: Map<string, Promise<DshAgentHandleLike>>,
): Promise<DshAgentHandleLike | undefined> {
  const existing = agents.get(sessionId)
  if (existing !== undefined) return existing

  const registry = services.dshAgents()
  if (registry === undefined) return undefined

  const existingHandle = registry.get(sessionId)
  if (existingHandle !== undefined) {
    agents.set(sessionId, Promise.resolve(existingHandle))
    return existingHandle
  }

  const model = services.agentDefaultModel()?.currentSelection()
    ?? { provider: 'deepseek-official', model: 'deepseek-v4-flash' }

  const created = registry.create({
    sessionId,
    meta: { cwd: process.cwd() },
    agentOptions: { provider: model.provider, model: model.model },
  }).then(handle => {
    attachProjection(handle)
    return handle
  }).catch(err => {
    agents.delete(sessionId)
    throw err
  })

  agents.set(sessionId, created)
  return created
}

/** Project one dsh session event into legacy server messages on every connected socket. */
function attachProjection(handle: DshAgentHandleLike): void {
  const sockets = legacySocketRegistries.get(handle.agent.id) ?? new Set<WebSocket>()
  const agent = handle.agent

  // Register through the shared socket set inside handleSocket. Kept process-global
  // is unnecessary; each socket registers itself through this closure below.
  const disposer = agent.ctx.on('session/event', (...args: unknown[]) => {
    const event = args[1] as { type: string; data: unknown } | undefined
    if (event === undefined) return
    const data = event.data as Record<string, unknown>
    for (const ws of sockets) {
      try {
        projectEvent(ws, event.type, data)
      } catch {
        // A malformed projection must not break agent event delivery.
      }
    }
  })

  const errorDisposer = agent.ctx.on('agent/error', (...args: unknown[]) => {
    const payload = args[0] as { error?: unknown } | undefined
    const message = payload?.error instanceof Error
      ? payload.error.message
      : 'agent run failed'
    for (const ws of sockets) {
      send(ws, { type: 'error', message, code: 'AGENT_ERROR' })
      send(ws, { type: 'status', state: 'idle' })
    }
  })

  // Expose registration by monkey-patching the handle's private socket set is
  // too clever; instead sockets are tracked by a process-level map keyed by
  // session id through this module's exported register helper below.
  legacySocketRegistries.set(agent.id, sockets)
  legacyProjectionDisposers.set(agent.id, () => {
    if (typeof disposer === 'function') disposer()
    if (typeof errorDisposer === 'function') errorDisposer()
    legacySocketRegistries.delete(agent.id)
    legacyProjectionDisposers.delete(agent.id)
  })
}

/** Socket sets per session, shared between socket acceptance and event projection. */
const legacySocketRegistries = new Map<string, Set<WebSocket>>()
const legacyProjectionDisposers = new Map<string, () => void>()

/** Track a connected socket in its session's projection set. */
function trackLegacySocket(sessionId: string, ws: WebSocket): void {
  let sockets = legacySocketRegistries.get(sessionId)
  if (sockets === undefined) {
    sockets = new Set()
    legacySocketRegistries.set(sessionId, sockets)
  }
  sockets.add(ws)
  ws.on('close', () => {
    sockets.delete(ws)
  })
}

function projectEvent(ws: WebSocket, type: string, data: Record<string, unknown>): void {
  switch (type) {
    case 'assistant/chunk': {
      const chunk = data['chunk'] as Record<string, unknown>
      if (chunk['type'] === 'text-delta' && typeof chunk['text'] === 'string') {
        send(ws, { type: 'content_start', blockType: 'text' })
        send(ws, { type: 'content_delta', text: chunk['text'] })
        send(ws, { type: 'status', state: 'streaming' })
      } else if (chunk['type'] === 'reasoning-delta' && typeof chunk['text'] === 'string') {
        send(ws, { type: 'thinking', text: chunk['text'] })
      }
      break
    }
    case 'assistant/message': {
      const message = data['message'] as Record<string, unknown> | undefined
      const usage = data['usage'] as Record<string, unknown> | undefined
      send(ws, {
        type: 'message_complete',
        usage: {
          input_tokens: usage?.['inputTokens'] ?? 0,
          output_tokens: usage?.['outputTokens'] ?? 0,
          cache_read_input_tokens: usage?.['cacheReadTokens'],
          cache_creation_input_tokens: usage?.['cacheWriteTokens'],
        },
      })
      send(ws, { type: 'status', state: 'idle' })
      void message
      break
    }
    case 'tool/call': {
      let input: unknown = data['arguments']
      try { input = JSON.parse(String(data['arguments'])) } catch { /* keep raw */ }
      send(ws, {
        type: 'content_start',
        blockType: 'tool_use',
        toolName: String(data['name'] ?? 'tool'),
        toolUseId: String(data['callId'] ?? ''),
      })
      send(ws, {
        type: 'tool_use_complete',
        toolName: String(data['name'] ?? 'tool'),
        toolUseId: String(data['callId'] ?? ''),
        input,
      })
      send(ws, { type: 'status', state: 'tool_executing' })
      break
    }
    case 'tool/result': {
      const message = data['message'] as Record<string, unknown> | undefined
      const content = Array.isArray(message?.['content']) ? message['content'] : []
      const block = (content as Array<Record<string, unknown>>)[0]
      send(ws, {
        type: 'tool_result',
        toolUseId: String(block?.['toolCallId'] ?? ''),
        content: block?.['content'] ?? null,
        isError: data['error'] !== undefined,
      })
      break
    }
    default:
      break
  }
}

function send(ws: WebSocket, message: unknown): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message))
  }
}
