/**
 * rin web-server — node:http server assembly.
 *
 * Wires the JSON API routes and the static frontend into one node:http
 * server. Owns no cordis concepts; index.ts wraps it as a Cordis service.
 * GET/HEAD serve the API and static files; POST is accepted for /api/*
 * (JSON body, capped at 1 MiB) so the write endpoints can mutate host state.
 *
 * @module @rin/web-server
 */

import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import type { Config, JsonResponse } from './types.ts'
import { errorMessage } from './http.ts'
import { routeApi } from './routes.ts'
import type { RinServiceRefs } from './routes.ts'
import { readStaticFile } from './static.ts'
import type { StaticFile } from './static.ts'

/** Default static frontend root: the package's static/ directory. */
const DEFAULT_STATIC_ROOT = fileURLToPath(new URL('../static/', import.meta.url))

/** Upper bound on a POST /api/* JSON body. */
const MAX_BODY_BYTES = 1024 * 1024

/** A startable HTTP server handle owned by the plugin. */
export interface RinWebServer {
  /** Start listening; resolves with the bound address once the socket is open. */
  listen(port: number, host: string): Promise<AddressInfo>
  /** Stop the server; resolves once the socket is closed. */
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
  const server: Server = createServer((req, res) => {
    handleRequest(req, res, services, config, staticRoot).catch((err: unknown) => {
      if (res.headersSent || res.writableEnded) {
        res.destroy()
        return
      }
      respondError(res, 500, errorMessage(err))
    })
  })

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
          resolveListen(address)
        })
      })
    },
    close(): Promise<void> {
      return new Promise<void>((resolveClose) => {
        server.close(() => resolveClose())
      })
    },
  }
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  services: RinServiceRefs,
  config: Config,
  staticRoot: string,
): Promise<void> {
  const method = req.method ?? 'GET'
  const url = new URL(req.url ?? '/', 'http://localhost')
  const isApi = url.pathname.startsWith('/api/')

  if (method === 'GET' || method === 'HEAD') {
    const headOnly = method === 'HEAD'
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
    respondStatic(res, file, headOnly)
    return
  }

  if ((method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') && isApi) {
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

/** Read and parse an API JSON body, enforcing the 1 MiB cap and JSON syntax. */
async function readJsonBody(
  req: IncomingMessage,
): Promise<{ ok: true; value: unknown } | { ok: false; status: number; message: string }> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    total += buffer.length
    if (total > MAX_BODY_BYTES) {
      return { ok: false, status: 413, message: 'request body exceeds 1 MiB' }
    }
    chunks.push(buffer)
  }
  if (chunks.length === 0) return { ok: true, value: undefined }
  const text = Buffer.concat(chunks).toString('utf-8')
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false, status: 400, message: 'invalid JSON body' }
  }
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

function respondStatic(res: ServerResponse, file: StaticFile, headOnly: boolean): void {
  res.writeHead(200, {
    'content-type': file.contentType,
    'content-length': file.content.length,
  })
  if (headOnly) {
    res.end()
    return
  }
  res.end(file.content)
}
