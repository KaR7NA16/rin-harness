import { describe, expect, test } from 'vitest'
import { request as httpRequest } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { createWebServer } from '../../src/web-server/server.ts'
import { FileScheduledTaskStore } from '@rin/automation'
import type { RinServiceRefs } from '../../src/web-server/routes.ts'
import type { Config } from '../../src/web-server/types.ts'

/** A services bag whose every optional service is absent. */
function emptyServices(): RinServiceRefs {
  const absent = () => undefined
  return {
    repository: absent,
    environment: absent,
    filesystem: absent,
    sessionBackup: absent,
    memory: absent,
    smartPruning: absent,
    knowledge: absent,
    knowledgeGraph: absent,
    sessionSearch: absent,
    promptMemory: absent,
    evolution: absent,
    skillMemory: absent,
    agents: absent,
    notes: absent,
    sandboxes: absent,
    tokenOptimization: absent,
    sessions: absent,
    sessionPersistence: absent,
    dshAgents: absent,
    agentDefaultModel: absent,
    settings: absent,
    permissionPresets: absent,
    llm: absent,
    credentials: absent,
    workspaceRegistry: absent,
    commands: absent,
    tokenMeter: absent,
    sessionProjections: absent,
    shell: absent,
    subprocess: absent,
    mcp: absent,
    providerProbe: absent,
    plugins: absent,
    codegraph: absent,
    teams: absent,
    tasks: absent,
    computerUse: absent,
    agentMigration: absent,
    monitorSnapshot: absent,
    doctor: absent,
  }
}

interface RawResponse {
  status: number
  body: unknown
  text: string
  headers: NodeJS.Dict<string | string[]>
}

/** Issue a raw node:http request with full header control (Host included). */
function rawRequest(
  port: number,
  path: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string | Buffer } = {},
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method: opts.method ?? 'GET',
        headers: opts.headers ?? {},
      },
      res => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', chunk => { text += chunk })
        res.on('end', () => {
          let body: unknown = text
          try { body = JSON.parse(text) } catch { /* non-JSON body */ }
          resolve({ status: res.statusCode ?? 0, body, text, headers: res.headers })
        })
      },
    )
    req.on('error', reject)
    if (opts.body !== undefined) req.write(opts.body)
    req.end()
  })
}

/** Send a raw HTTP upgrade request and resolve with the response status. */
function rawUpgrade(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version': '13',
          ...headers,
        },
      },
      res => {
        res.resume()
        res.on('end', () => resolve({ status: res.statusCode ?? 0 }))
      },
    )
    req.on('error', reject)
    req.end()
  })
}

async function startServer(
  config: Partial<Config> = {},
  services: RinServiceRefs = emptyServices(),
): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createWebServer({ port: 0, host: '127.0.0.1', ...config }, services)
  const address = await server.listen(0, '127.0.0.1')
  return { port: address.port, close: () => server.close() }
}

describe('web-server note-asset binary routes', () => {
  test('uploads a PDF as raw bytes and serves it back as application/pdf', async () => {
    const pdf = Buffer.from('%PDF-1.4 test-document')
    let savedFileName = ''
    let savedContent: Buffer | null = null
    const services: RinServiceRefs = {
      ...emptyServices(),
      notes: () => ({
        saveAsset: async (fileName: string, content: Buffer) => {
          savedFileName = fileName
          savedContent = content
          return { path: 'assets/test-document.pdf', url: '/api/notes/assets/assets/test-document.pdf' }
        },
        readAsset: async (path: string) => {
          expect(path).toBe('assets/test-document.pdf')
          return { content: pdf, mimeType: 'application/pdf' }
        },
      }),
    }
    const s = await startServer({}, services)
    try {
      const upload = await rawRequest(s.port, '/api/notes/assets/raw?fileName=test-document.pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/pdf' },
        body: pdf,
      })
      expect(upload.status).toBe(200)
      expect(upload.body).toEqual({ path: 'assets/test-document.pdf', url: '/api/notes/assets/assets/test-document.pdf' })
      expect(savedFileName).toBe('test-document.pdf')
      expect(savedContent?.equals(pdf)).toBe(true)

      const download = await rawRequest(s.port, '/api/notes/assets/assets/test-document.pdf')
      expect(download.status).toBe(200)
      expect(download.headers['content-type']).toBe('application/pdf')
      expect(download.headers['content-disposition']).toBe('inline')
      expect(download.text).toBe('%PDF-1.4 test-document')
    } finally {
      await s.close()
    }
  })

  test('serves contained filesystem files inline and as download', async () => {
    const content = Buffer.from('%PDF-1.4 workspace-file')
    const services: RinServiceRefs = {
      ...emptyServices(),
      filesystem: () => ({
        readBinary: async (path: string) => {
          expect(path).toBe('/tmp/workspace.pdf')
          return { path, content, sizeBytes: content.length, mimeType: 'application/pdf' }
        },
      }),
    }
    const s = await startServer({}, services)
    try {
      const inline = await rawRequest(s.port, '/api/filesystem/file?path=%2Ftmp%2Fworkspace.pdf')
      expect(inline.status).toBe(200)
      expect(inline.headers['content-type']).toBe('application/pdf')
      expect(inline.headers['content-disposition']).toBe('inline')
      expect(inline.text).toBe('%PDF-1.4 workspace-file')

      const download = await rawRequest(s.port, '/api/filesystem/file?path=%2Ftmp%2Fworkspace.pdf&download=1')
      expect(download.headers['content-disposition']).toBe('attachment')
    } finally {
      await s.close()
    }
  })

  test('filesystem file route reports 400 without path and 500 unmounted', async () => {
    const s = await startServer()
    try {
      const missing = await rawRequest(s.port, '/api/filesystem/file')
      expect(missing.status).toBe(400)
      expect(missing.body).toEqual({ error: 'path is required' })
    } finally {
      await s.close()
    }
  })

  test('raw note-asset upload reports 500 when notes is unmounted', async () => {
    const s = await startServer()
    try {
      const upload = await rawRequest(s.port, '/api/notes/assets/raw?fileName=a.pdf', {
        method: 'POST',
        body: Buffer.from('%PDF'),
      })
      expect(upload.status).toBe(500)
      expect(upload.body).toEqual({ error: 'notes service is not mounted' })
    } finally {
      await s.close()
    }
  })
})

describe('web-server request body limits', () => {
  test('rejects invalid JSON and bodies over the 1 MiB cap before routing', async () => {
    const s = await startServer()
    try {
      const invalid = await rawRequest(s.port, '/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not-json',
      })
      expect(invalid.status).toBe(400)
      expect(invalid.body).toEqual({ error: 'invalid JSON body' })

      const oversized = await rawRequest(s.port, '/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'x'.repeat(1024 * 1024 + 1),
      })
      expect(oversized.status).toBe(413)
      expect(oversized.body).toEqual({ error: 'request body exceeds 1 MiB' })
    } finally {
      await s.close()
    }
  })
})

describe('web-server scheduled tasks integration', () => {
  test('persists and executes a scheduled task through the real HTTP server', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-scheduled-http-'))
    const store = new FileScheduledTaskStore(root)
    let seenPrompt = ''
    const tasks = {
      listScheduledTasks: () => store.list(),
      getScheduledTask: (id: string) => store.get(id),
      createScheduledTask: (input: never) => store.create(input),
      updateScheduledTask: (id: string, patch: never) => store.update(id, patch),
      deleteScheduledTask: (id: string) => store.delete(id),
      runScheduledTask: (id: string, executor: never) => store.run(id, executor),
      listScheduledTaskRuns: (limit?: number) => store.listRuns(limit),
      listScheduledTaskRunsForTask: (id: string) => store.listTaskRuns(id),
    }
    const services: RinServiceRefs = {
      ...emptyServices(),
      tasks: () => tasks as never,
      dshAgents: () => ({
        async create(options: unknown) {
          const sessionId = String((options as { sessionId?: string }).sessionId)
          return {
            agent: {
              id: sessionId,
              session: { id: sessionId },
              ctx: { on() { return () => {} } },
              followup(message: unknown) {
                seenPrompt = String((message as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? '')
              },
              cancel() {},
              async whenIdle() {
                expect(seenPrompt).toBe('run the integration check')
              },
            },
            async dispose() {},
          }
        },
        get() {
          return undefined
        },
      }),
    }
    const server = await startServer({}, services)
    try {
      const created = await rawRequest(server.port, '/api/scheduled-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'HTTP integration',
          cron: '0 9 * * *',
          prompt: 'run the integration check',
        }),
      })
      expect(created.status).toBe(200)
      const taskId = (created.body as { task: { id: string } }).task.id

      const run = await rawRequest(server.port, '/api/scheduled-tasks/' + taskId + '/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      expect(run.status).toBe(200)
      expect(run.body).toMatchObject({ ok: true, run: { status: 'completed', prompt: 'run the integration check' } })
      expect(seenPrompt).toBe('run the integration check')

      const history = await rawRequest(server.port, '/api/scheduled-tasks/' + taskId + '/runs')
      expect(history.status).toBe(200)
      expect(history.body).toMatchObject({ runs: [{ status: 'completed', taskId }] })
    } finally {
      await server.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('web-server Host/Origin/auth guards', () => {
  test('serves the API and static frontend on a loopback Host (default compatible)', async () => {
    const s = await startServer()
    try {
      const health = await rawRequest(s.port, '/api/health')
      expect(health.status).toBe(200)
      expect(health.body).toMatchObject({ ok: true })

      const home = await rawRequest(s.port, '/')
      expect(home.status).toBe(200)
      expect(home.text).toContain('<!DOCTYPE html>')
    } finally {
      await s.close()
    }
  })

  test('rejects a non-loopback Host with 403 on the API and static routes', async () => {
    const s = await startServer()
    try {
      const api = await rawRequest(s.port, '/api/health', { headers: { Host: 'evil.com:8320' } })
      expect(api.status).toBe(403)
      expect(api.body).toEqual({ error: 'forbidden host' })

      const home = await rawRequest(s.port, '/', { headers: { Host: 'evil.com' } })
      expect(home.status).toBe(403)
    } finally {
      await s.close()
    }
  })

  test('rejects a cross-origin Origin with 403 and accepts a same-origin one', async () => {
    const s = await startServer()
    try {
      const cross = await rawRequest(s.port, '/api/health', {
        headers: { Origin: 'http://evil.com' },
      })
      expect(cross.status).toBe(403)
      expect(cross.body).toEqual({ error: 'cross-origin request forbidden' })

      const same = await rawRequest(s.port, '/api/health', {
        headers: { Origin: 'http://127.0.0.1:' + s.port },
      })
      expect(same.status).toBe(200)
    } finally {
      await s.close()
    }
  })

  test('enforces the token on /api/* but leaves static files open when configured', async () => {
    const s = await startServer({ authToken: 'secret' })
    try {
      const missing = await rawRequest(s.port, '/api/health')
      expect(missing.status).toBe(401)
      expect(missing.body).toEqual({ error: 'unauthorized' })

      const wrong = await rawRequest(s.port, '/api/health', {
        headers: { Authorization: 'Bearer nope' },
      })
      expect(wrong.status).toBe(401)

      const viaQuery = await rawRequest(s.port, '/api/health?token=secret')
      expect(viaQuery.status).toBe(200)

      const viaHeader = await rawRequest(s.port, '/api/health', {
        headers: { Authorization: 'Bearer secret' },
      })
      expect(viaHeader.status).toBe(200)

      const home = await rawRequest(s.port, '/')
      expect(home.status).toBe(200)
    } finally {
      await s.close()
    }
  })

  test('rejects a WebSocket upgrade with a non-loopback Host', async () => {
    const s = await startServer()
    try {
      const res = await rawUpgrade(s.port, '/ws/s1', { Host: 'evil.com' })
      expect(res.status).toBe(403)
    } finally {
      await s.close()
    }
  })

  test('rejects a WebSocket upgrade missing the token when configured', async () => {
    const s = await startServer({ authToken: 'secret' })
    try {
      const res = await rawUpgrade(s.port, '/ws/s1')
      expect(res.status).toBe(401)
    } finally {
      await s.close()
    }
  })

  test('accepts a WebSocket upgrade with the token via ?token= when configured', async () => {
    const s = await startServer({ authToken: 'secret' })
    try {
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket('ws://127.0.0.1:' + s.port + '/ws/s1?token=secret')
        ws.on('open', () => {
          ws.close()
          resolve()
        })
        ws.on('error', reject)
      })
    } finally {
      await s.close()
    }
  })
})
