/**
 * rin web-server — node:http server assembly.
 *
 * Wires the JSON API routes and the static frontend into one node:http
 * server. Owns no cordis concepts; index.ts wraps it as a Cordis service.
 *
 * @module @rin/web-server
 */

import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import type { Config, JsonResponse } from './types.ts'
import { errorMessage } from './http.ts'
import { routeApi } from './routes.ts'
import type { RinServiceRefs } from './routes.ts'
import { readStaticFile } from './static.ts'
import type { StaticFile } from './static.ts'

/** Default static frontend root: the package's web/ directory. */
const DEFAULT_STATIC_ROOT = fileURLToPath(new URL('../web/', import.meta.url))

/** A startable HTTP server handle owned by the plugin. */
export interface RinWebServer {
  /** Start listening; resolves once the socket is bound. */
  listen(port: number, host: string): Promise<void>
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
    listen(port: number, host: string): Promise<void> {
      return new Promise<void>((resolveListen, rejectListen) => {
        server.once('error', rejectListen)
        server.listen(port, host, () => {
          server.off('error', rejectListen)
          resolveListen()
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
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    respondError(res, 405, 'method not allowed')
    return
  }
  const headOnly = req.method === 'HEAD'
  const url = new URL(req.url ?? '/', 'http://localhost')
  const response = await routeApi(url.pathname, url.search, services, config)
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
