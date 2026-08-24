/**
 * rin web-server — node:http server assembly.
 *
 * Wires the JSON API routes and the static frontend into one node:http
 * server. Owns no cordis concepts; index.ts wraps it as a Cordis service.
 * GET/HEAD serve the API and static files; POST is accepted for /api/*
 * (JSON body, capped at 1 MiB) so the write endpoints can mutate host state.
 *
 * @module @rin/host/web-server
 */

import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import type { Config, JsonResponse } from './types.ts'
import { errorMessage, extractBearerToken, isAllowedHostHeader, isSameOrigin } from './http.ts'
import { routeApi } from './routes.ts'
import type { RinServiceRefs } from './routes.ts'
import { readStaticFile } from './static.ts'
import { attachLegacyWebSocket } from './legacy-ws.ts'
import { attachTerminalWebSocket, type TerminalBridge } from './terminal-ws.ts'
import type { StaticFile } from './static.ts'

/** Default static frontend root: the package's static/ directory. */
const DEFAULT_STATIC_ROOT = fileURLToPath(new URL('../../static/', import.meta.url))

/** Upper bound on a POST /api/* JSON body. */
const MAX_BODY_BYTES = 1024 * 1024
/** Maximum accepted binary session-import body (64 MiB). */
const MAX_IMPORT_BODY_BYTES = 64 * 1024 * 1024

/** A startable HTTP server handle owned by the plugin. */
export interface RinWebServer {
  /** Start listening; resolves with the bound address once the socket is open. */
  listen(port: number, host: string): Promise<AddressInfo>
  /**
   * Stop the server: first terminate every live terminal session (the terminal
   * route dies with this server), then close the socket; resolves once closed.
   */
  close(): Promise<void>
}

/**
 * Build the node:http server without starting it.
 * @param config - the resolved plugin configuration.
 * @param services - thunks that read the optional @rin services.
 * @returns a handle with listen() and close().
 */
export function createWebServer(config: Config, services: RinServiceRefs): RinWebServer {
  const staticRoot = config.staticRoot ?? DEFAULT_STATIC_ROOT
  // Actual bound port, captured after listen(); Host/Origin validation compares
  // against this rather than config.port so ephemeral ports (port 0) still work.
  let boundPort = config.port
  const server: Server = createServer((req, res) => {
    handleRequest(req, res, services, config, staticRoot, boundPort).catch((err: unknown) => {
      if (res.headersSent || res.writableEnded) {
        res.destroy()
        return
      }
      respondError(res, 500, errorMessage(err))
    })
  })
  const terminals: TerminalBridge = attachTerminalWebSocket(server, services, config, () => boundPort)
  attachLegacyWebSocket(server, services, config, () => boundPort)

  return {
    listen(port: number, host: string): Promise<AddressInfo> {
      return new Promise<AddressInfo>((resolveListen, rejectListen) => {
        server.once('error', rejectListen)
        server.listen(port, host, () => {
          server.off('error', rejectListen)
          const address = server.address()
          if (address === null || typeof address === 'string') {
            rejectListen(new Error('rin web-server: unexpected listen address'))
            return
          }
          boundPort = address.port
          resolveListen(address)
        })
      })
    },
    close(): Promise<void> {
      return (async () => {
        await terminals.dispose()
        await new Promise<void>((resolveClose) => {
          server.close(() => resolveClose())
        })
      })()
    },
  }
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  services: RinServiceRefs,
  config: Config,
  staticRoot: string,
  boundPort: number,
): Promise<void> {
  const method = req.method ?? 'GET'
  const url = new URL(req.url ?? '/', 'http://localhost')
  const isApi = url.pathname.startsWith('/api/')

  // Host validation (anti DNS-rebinding): reject any request whose Host header
  // is not a loopback name on the bound port, regardless of token configuration.
  if (!isAllowedHostHeader(req.headers.host, boundPort)) {
    respondError(res, 403, 'forbidden host')
    return
  }

  // Token gate for the mutating/reading API surface when authToken is configured.
  // The static frontend stays unauthenticated so a tokenless deployment (the
  // default) keeps working exactly as before.
  if (isApi && config.authToken !== undefined) {
    const provided = extractBearerToken(req.headers.authorization, url.search)
    if (provided !== config.authToken) {
      respondError(res, 401, 'unauthorized')
      return
    }
  }

  // Origin check (CSRF/DNS-rebinding): when a browser sent an Origin, it must be
  // same-origin as the request Host.
  if (req.headers.origin !== undefined && !isSameOrigin(req.headers.origin, req.headers.host, boundPort)) {
    respondError(res, 403, 'cross-origin request forbidden')
    return
  }

  if (method === 'GET' || method === 'HEAD') {
    const headOnly = method === 'HEAD'
    // Contained filesystem file reads are served as raw bytes; PDFs and
    // media render inline in the browser, downloads use ?download=1.
    if (url.pathname === '/api/filesystem/file') {
      const path = url.searchParams.get('path')?.trim() ?? ''
      if (path === '') {
        respondError(res, 400, 'path is required')
        return
      }
      const filesystem = services.filesystem()
      if (filesystem === undefined) {
        respondError(res, 500, 'filesystem service is not mounted')
        return
      }
      try {
        const file = await filesystem.readBinary(path)
        respondBinary(
          res,
          file.content,
          file.mimeType,
          url.searchParams.get('download') === '1' ? 'attachment' : 'inline',
        )
      } catch (err) {
        respondError(res, 404, err instanceof Error ? err.message : String(err))
      }
      return
    }
    // Note assets are served as raw bytes for <img>/download URLs.
    if (url.pathname.startsWith('/api/notes/assets/')) {
      const notes = services.notes()
      if (notes === undefined) {
        respondError(res, 500, 'notes service is not mounted')
        return
      }
      const relPath = decodeURIComponent(url.pathname.slice('/api/notes/assets/'.length))
      try {
        const asset = await notes.readAsset(relPath)
        respondBinary(res, asset.content, asset.mimeType, asset.mimeType === 'application/pdf' ? 'inline' : undefined)
      } catch (err) {
        respondError(res, 404, err instanceof Error ? err.message : String(err))
      }
      return
    }
    const response = await routeApi(url.pathname, url.search, method, undefined, services, config)
    if (response !== null) {
      respondJson(res, response, headOnly)
      return
    }
    const file = await readStaticFile(staticRoot, url.pathname)
    if (file === null) {
      respondError(res, 404, 'not found')
      return
    }
    respondStatic(res, file, headOnly, url.pathname)
    return
  }

  if ((method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') && isApi) {
    // Binary archive and session export/import bypass the JSON route system.
    if (method === 'POST' && url.pathname === '/api/archive/export') {
      const backup = services.sessionBackup()
      if (backup === undefined) {
        respondError(res, 500, 'session backup service is not mounted')
        return
      }
      try {
        respondBinary(res, await backup.exportArchive(), 'application/gzip', 'attachment')
      } catch (err) {
        respondError(res, 500, err instanceof Error ? err.message : String(err))
      }
      return
    }
    if (method === 'POST' && url.pathname === '/api/archive/import') {
      const backup = services.sessionBackup()
      if (backup === undefined) {
        respondError(res, 500, 'session backup service is not mounted')
        return
      }
      try {
        const buffer = await readRawBody(req)
        respondJson(res, { status: 200, body: await backup.importArchive(buffer) }, false)
      } catch (err) {
        const status = err instanceof Error && (err as { statusCode?: unknown }).statusCode === 413 ? 413 : 400
        respondError(res, status, err instanceof Error ? err.message : String(err))
      }
      return
    }
    if (method === 'POST' && url.pathname === '/api/sessions/export') {
      const exportBody = await readJsonBody(req)
      if (!exportBody.ok) {
        respondError(res, exportBody.status, exportBody.message)
        return
      }
      const backup = services.sessionBackup()
      if (backup === undefined) {
        respondError(res, 500, 'session backup service is not mounted')
        return
      }
      try {
        respondBinary(res, await backup.exportSessions(), 'application/gzip')
      } catch (err) {
        respondError(res, 500, err instanceof Error ? err.message : String(err))
      }
      return
    }
    if (method === 'POST' && url.pathname === '/api/sessions/import') {
      const backup = services.sessionBackup()
      if (backup === undefined) {
        respondError(res, 500, 'session backup service is not mounted')
        return
      }
      try {
        const buffer = await readRawBody(req)
        respondJson(res, { status: 200, body: await backup.importSessions(buffer) }, false)
      } catch (err) {
        const status = err instanceof Error && (err as { statusCode?: unknown }).statusCode === 413 ? 413 : 400
        respondError(res, status, err instanceof Error ? err.message : String(err))
      }
      return
    }
    // Raw note-asset upload: keeps PDFs and other binary notes attachments
    // out of the base64 JSON body cap. The vault sanitizes `fileName`.
    if (method === 'POST' && url.pathname === '/api/notes/assets/raw') {
      const notes = services.notes()
      if (notes === undefined) {
        respondError(res, 500, 'notes service is not mounted')
        return
      }
      const fileName = url.searchParams.get('fileName') ?? 'document'
      try {
        const content = await readRawBody(req)
        respondJson(res, { status: 200, body: await notes.saveAsset(fileName, content) }, false)
      } catch (err) {
        const status = err instanceof Error && (err as { statusCode?: unknown }).statusCode === 413 ? 413 : 400
        respondError(res, status, err instanceof Error ? err.message : String(err))
      }
      return
    }
    const bodyResult = await readJsonBody(req)
    if (!bodyResult.ok) {
      respondError(res, bodyResult.status, bodyResult.message)
      return
    }
    const response = await routeApi(url.pathname, url.search, method, bodyResult.value, services, config)
    if (response !== null) {
      respondJson(res, response, false)
      return
    }
    respondError(res, 404, 'not found')
    return
  }

  respondError(res, 405, 'method not allowed')
}

class BodyTooLargeError extends Error {
  readonly statusCode = 413

  constructor(message: string) {
    super(message)
    this.name = 'BodyTooLargeError'
  }
}

/** Read a request body once and enforce the caller's byte cap. */
async function readBody(req: IncomingMessage, maxBytes: number, message: string): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    total += buffer.length
    if (total > maxBytes) throw new BodyTooLargeError(message)
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

/** Read and parse an API JSON body, enforcing the 1 MiB cap and JSON syntax. */
async function readJsonBody(
  req: IncomingMessage,
): Promise<{ ok: true; value: unknown } | { ok: false; status: number; message: string }> {
  let body: Buffer
  try {
    body = await readBody(req, MAX_BODY_BYTES, 'request body exceeds 1 MiB')
  } catch (err) {
    if (err instanceof BodyTooLargeError) return { ok: false, status: err.statusCode, message: err.message }
    throw err
  }
  if (body.length === 0) return { ok: true, value: undefined }
  try {
    return { ok: true, value: JSON.parse(body.toString('utf-8')) }
  } catch {
    return { ok: false, status: 400, message: 'invalid JSON body' }
  }
}

/** Read a raw request body as a Buffer, enforcing the import cap. */
function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return readBody(req, MAX_IMPORT_BODY_BYTES, 'request body exceeds 64 MiB')
}

/** Respond with a raw binary body. */
function respondBinary(
  res: ServerResponse,
  buffer: Buffer,
  contentType: string,
  contentDisposition?: 'inline' | 'attachment',
): void {
  res.writeHead(200, {
    'content-type': contentType,
    'content-length': buffer.length,
    ...(contentDisposition !== undefined ? { 'content-disposition': contentDisposition } : {}),
  })
  res.end(buffer)
}

function respondJson(res: ServerResponse, response: JsonResponse, headOnly: boolean): void {
  const body = JSON.stringify(response.body)
  res.writeHead(response.status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  if (headOnly) {
    res.end()
    return
  }
  res.end(body)
}

function respondError(res: ServerResponse, status: number, message: string): void {
  respondJson(res, { status, body: { error: message } }, false)
}

function respondStatic(res: ServerResponse, file: StaticFile, headOnly: boolean, pathname: string): void {
  // Cache policy: hashed build assets (dist/assets/**) are immutable, so a
  // content-addressed filename can be cached forever; every other file —
  // index.html above all — must revalidate so a redeployed UI is picked up
  // on the next reload instead of serving a heuristic-cached stale shell
  // that references chunk filenames which no longer exist.
  const isHashedAsset = pathname.startsWith('/assets/')
  res.writeHead(200, {
    'content-type': file.contentType,
    'content-length': file.content.length,
    'cache-control': isHashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  if (headOnly) {
    res.end()
    return
  }
  res.end(file.content)
}
