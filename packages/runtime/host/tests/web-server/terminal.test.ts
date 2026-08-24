import { afterEach, describe, expect, test } from 'vitest'
import { request as httpRequest } from 'node:http'
import { PassThrough } from 'node:stream'
import { WebSocket } from 'ws'
import { createWebServer } from '../../src/web-server/server.ts'
import { TerminalError, TerminalRegistry } from '../../src/web-server/terminal.ts'
import type { RinServiceRefs } from '../../src/web-server/routes.ts'
import type { Config } from '../../src/web-server/types.ts'

/** A fake SubprocessTerminalHandle: a real PassThrough output plus recorded verbs. */
class FakeTerminalHandle {
  readonly pid = 4242
  readonly output = new PassThrough()
  readonly writes: string[] = []
  readonly signals: string[] = []
  terminated = 0
  private resolveDone!: (exit: { exitCode: number | null; signal: NodeJS.Signals | null }) => void
  readonly done: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }> =
    new Promise(resolve => { this.resolveDone = resolve })

  async write(data: string): Promise<void> {
    this.writes.push(data)
  }

  async inspectForeground(): Promise<{ processGroupId: number; inputWaiting: boolean } | undefined> {
    return { processGroupId: 7, inputWaiting: true }
  }

  async signalForeground(signal: string): Promise<number> {
    this.signals.push(signal)
    return 7
  }

  async terminate(): Promise<void> {
    this.terminated += 1
  }

  emit(text: string): void {
    this.output.write(Buffer.from(text, 'utf8'))
  }

  exit(exitCode: number | null, signal: NodeJS.Signals | null = null): void {
    this.resolveDone({ exitCode, signal })
  }

  failTransport(): void {
    this.output.destroy(new Error('transport failed'))
  }
}

/** A fake DshSubprocessLike recording every spawn spec. */
function fakeSubprocess(): {
  service: { spawnTerminal(spec: unknown): Promise<FakeTerminalHandle> }
  spawned: Array<{ spec: Record<string, unknown>; handle: FakeTerminalHandle }>
  handles: FakeTerminalHandle[]
} {
  const spawned: Array<{ spec: Record<string, unknown>; handle: FakeTerminalHandle }> = []
  const handles: FakeTerminalHandle[] = []
  return {
    spawned,
    handles,
    service: {
      async spawnTerminal(spec: unknown) {
        const handle = new FakeTerminalHandle()
        spawned.push({ spec: spec as Record<string, unknown>, handle })
        handles.push(handle)
        return handle
      },
    },
  }
}

/** A services bag whose every optional service except subprocess is absent. */
function makeServices(subprocessService: unknown = undefined): RinServiceRefs {
  const absent = () => undefined
  return {
    repository: absent,
    environment: absent,
    filesystem: absent,
    sessionBackup: absent,
    memory: absent,
    smartPruning: absent,
    knowledge: absent,
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
    sessionTitle: absent,
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
    subprocess: () => subprocessService,
    mcp: absent,
    providerProbe: absent,
    plugins: absent,
    codegraph: absent,
    teams: absent,
    tasks: absent,
    computerUse: absent,
    agentMigration: absent,
    monitorSnapshot: absent,
  }
}

/** Await the microtask/next-tick chain so settle-once callbacks have run. */
async function tick(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve))
}

/** Capture a rejection as the thrown value, failing when the promise resolved. */
async function catchError(promise: Promise<unknown>): Promise<TerminalError> {
  try {
    await promise
  } catch (err) {
    return err as TerminalError
  }
  throw new Error('expected the promise to reject')
}

describe('terminal registry', () => {
  test('spawn fails with SUBPROCESS_UNAVAILABLE when the subprocess service is absent', async () => {
    const registry = new TerminalRegistry(() => undefined)
    const err = await catchError(registry.spawn({ terminalId: 't1', onData() {}, onExit() {} }))
    expect(err).toBeInstanceOf(TerminalError)
    expect(err.code).toBe('SUBPROCESS_UNAVAILABLE')
  })

  test('spawn maps a provider failure to SPAWN_FAILED', async () => {
    const registry = new TerminalRegistry(() => ({
      async spawnTerminal() { throw new Error('pty boom') },
    }))
    const err = await catchError(registry.spawn({ terminalId: 't1', onData() {}, onExit() {} }))
    expect(err.code).toBe('SPAWN_FAILED')
    expect(err.message).toContain('pty boom')
  })

  test('spawn defaults argv to $SHELL, cwd to process.cwd(), and geometry to 80x24', async () => {
    const previousShell = process.env.SHELL
    process.env.SHELL = '/bin/zsh'
    try {
      const fake = fakeSubprocess()
      const registry = new TerminalRegistry(() => fake.service)
      await registry.spawn({ terminalId: 't1', onData() {}, onExit() {} })
      expect(fake.spawned[0]?.spec).toMatchObject({
        argv: ['/bin/zsh'],
        cwd: process.cwd(),
        cols: 80,
        rows: 24,
        graceMs: 2000,
      })
    } finally {
      if (previousShell === undefined) delete process.env.SHELL
      else process.env.SHELL = previousShell
    }
  })

  test('spawn falls back to /bin/bash when $SHELL is unset', async () => {
    const previousShell = process.env.SHELL
    delete process.env.SHELL
    try {
      const fake = fakeSubprocess()
      const registry = new TerminalRegistry(() => fake.service)
      await registry.spawn({ terminalId: 't1', onData() {}, onExit() {} })
      expect(fake.spawned[0]?.spec.argv).toEqual(['/bin/bash'])
    } finally {
      if (previousShell === undefined) delete process.env.SHELL
      else process.env.SHELL = previousShell
    }
  })

  test('spawn forwards explicit argv, cwd, and geometry', async () => {
    const fake = fakeSubprocess()
    const registry = new TerminalRegistry(() => fake.service)
    await registry.spawn({ terminalId: 't1', argv: ['/bin/sh', '-c', 'echo hi'], cwd: '/tmp', cols: 120, rows: 40, onData() {}, onExit() {} })
    expect(fake.spawned[0]?.spec).toMatchObject({ argv: ['/bin/sh', '-c', 'echo hi'], cwd: '/tmp', cols: 120, rows: 40 })
  })

  test('spawn returns a session carrying the handle pid', async () => {
    const fake = fakeSubprocess()
    const registry = new TerminalRegistry(() => fake.service)
    const session = await registry.spawn({ terminalId: 't1', onData() {}, onExit() {} })
    expect(session.pid).toBe(4242)
    expect(registry.get('t1')).toBe(session)
  })

  test('non-POSIX hosts fail loud with SPAWN_FAILED before any spawn', async () => {
    const original = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    try {
      const fake = fakeSubprocess()
      const registry = new TerminalRegistry(() => fake.service)
      const err = await catchError(registry.spawn({ terminalId: 't1', onData() {}, onExit() {} }))
      expect(err.code).toBe('SPAWN_FAILED')
      expect(fake.spawned.length).toBe(0)
    } finally {
      if (original !== undefined) Object.defineProperty(process, 'platform', original)
    }
  })

  test('output chunks pipe to onData as decoded text', async () => {
    const fake = fakeSubprocess()
    const registry = new TerminalRegistry(() => fake.service)
    const received: string[] = []
    await registry.spawn({ terminalId: 't1', onData: text => { received.push(text) }, onExit() {} })
    fake.handles[0]?.emit('hello\n')
    fake.handles[0]?.emit('world')
    await tick()
    expect(received).toEqual(['hello\n', 'world'])
  })

  test('write forwards to the handle without adding a newline', async () => {
    const fake = fakeSubprocess()
    const registry = new TerminalRegistry(() => fake.service)
    const session = await registry.spawn({ terminalId: 't1', onData() {}, onExit() {} })
    await session.write('ls -la')
    expect(fake.handles[0]?.writes).toEqual(['ls -la'])
  })

  test('signal forwards to the handle foreground group', async () => {
    const fake = fakeSubprocess()
    const registry = new TerminalRegistry(() => fake.service)
    const session = await registry.spawn({ terminalId: 't1', onData() {}, onExit() {} })
    const groupId = await session.signal('SIGINT')
    expect(groupId).toBe(7)
    expect(fake.handles[0]?.signals).toEqual(['SIGINT'])
  })

  test('exit emits the exit facts and removes the session', async () => {
    const fake = fakeSubprocess()
    const registry = new TerminalRegistry(() => fake.service)
    const exits: Array<{ exitCode: number | null; signal: string | null }> = []
    await registry.spawn({ terminalId: 't1', onData() {}, onExit: exit => { exits.push(exit) } })
    fake.handles[0]?.exit(0)
    await tick()
    expect(exits).toEqual([{ exitCode: 0, signal: null }])
    expect(registry.get('t1')).toBeUndefined()

    fake.handles[0]?.exit(null, 'SIGTERM')
    await tick()
    expect(exits).toEqual([{ exitCode: 0, signal: null }])
  })

  test('a signal exit reports the terminating signal', async () => {
    const fake = fakeSubprocess()
    const registry = new TerminalRegistry(() => fake.service)
    const exits: Array<{ exitCode: number | null; signal: string | null }> = []
    await registry.spawn({ terminalId: 't1', onData() {}, onExit: exit => { exits.push(exit) } })
    fake.handles[0]?.exit(null, 'SIGTERM')
    await tick()
    expect(exits).toEqual([{ exitCode: null, signal: 'SIGTERM' }])
  })

  test('a transport failure settles the session with null facts', async () => {
    const fake = fakeSubprocess()
    const registry = new TerminalRegistry(() => fake.service)
    const exits: Array<{ exitCode: number | null; signal: string | null }> = []
    await registry.spawn({ terminalId: 't1', onData() {}, onExit: exit => { exits.push(exit) } })
    fake.handles[0]?.failTransport()
    await tick()
    expect(exits).toEqual([{ exitCode: null, signal: null }])
    expect(registry.get('t1')).toBeUndefined()
  })

  test('close terminates the handle, emits null exit facts, and removes the session', async () => {
    const fake = fakeSubprocess()
    const registry = new TerminalRegistry(() => fake.service)
    const exits: Array<{ exitCode: number | null; signal: string | null }> = []
    const session = await registry.spawn({ terminalId: 't1', onData() {}, onExit: exit => { exits.push(exit) } })
    await session.close()
    expect(fake.handles[0]?.terminated).toBe(1)
    expect(exits).toEqual([{ exitCode: null, signal: null }])
    expect(registry.get('t1')).toBeUndefined()
  })

  test('write and signal after exit fail with NOT_SPAWNED', async () => {
    const fake = fakeSubprocess()
    const registry = new TerminalRegistry(() => fake.service)
    const session = await registry.spawn({ terminalId: 't1', onData() {}, onExit() {} })
    fake.handles[0]?.exit(1)
    await tick()
    expect((await catchError(session.write('x'))).code).toBe('NOT_SPAWNED')
    expect((await catchError(session.signal('SIGINT'))).code).toBe('NOT_SPAWNED')
    expect(fake.handles[0]?.writes).toEqual([])
    expect(fake.handles[0]?.signals).toEqual([])
  })

  test('close after exit is a no-op', async () => {
    const fake = fakeSubprocess()
    const registry = new TerminalRegistry(() => fake.service)
    const exits: unknown[] = []
    const session = await registry.spawn({ terminalId: 't1', onData() {}, onExit: exit => { exits.push(exit) } })
    fake.handles[0]?.exit(0)
    await tick()
    await session.close()
    expect(fake.handles[0]?.terminated).toBe(0)
    expect(exits.length).toBe(1)
  })

  test('dispose terminates every live session and rejects later spawns', async () => {
    const fake = fakeSubprocess()
    const registry = new TerminalRegistry(() => fake.service)
    const exits: string[] = []
    await registry.spawn({ terminalId: 'a', onData() {}, onExit: () => { exits.push('a') } })
    await registry.spawn({ terminalId: 'b', onData() {}, onExit: () => { exits.push('b') } })
    await registry.dispose()
    expect(fake.handles.map(handle => handle.terminated)).toEqual([1, 1])
    expect(exits.sort()).toEqual(['a', 'b'])
    expect(registry.get('a')).toBeUndefined()
    expect(registry.get('b')).toBeUndefined()
    expect((await catchError(registry.spawn({ terminalId: 'c', onData() {}, onExit() {} }))).code).toBe('INTERNAL')
  })

  test('re-spawning a live id closes the previous session first', async () => {
    const fake = fakeSubprocess()
    const registry = new TerminalRegistry(() => fake.service)
    const first = await registry.spawn({ terminalId: 't1', onData() {}, onExit() {} })
    const second = await registry.spawn({ terminalId: 't1', onData() {}, onExit() {} })
    expect(fake.handles[0]?.terminated).toBe(1)
    expect(second.pid).toBe(first.pid)
    expect(registry.get('t1')).toBe(second)
  })

  test('a spawn that settles during dispose is terminated, not leaked', async () => {
    let resolveSpawn!: (handle: FakeTerminalHandle) => void
    const fake = fakeSubprocess()
    const registry = new TerminalRegistry(() => ({
      spawnTerminal(spec: unknown) {
        const handle = new FakeTerminalHandle()
        fake.spawned.push({ spec: spec as Record<string, unknown>, handle })
        fake.handles.push(handle)
        return new Promise<FakeTerminalHandle>(resolve => { resolveSpawn = resolve })
      },
    }))
    const pending = registry.spawn({ terminalId: 't1', onData() {}, onExit() {} })
    await registry.dispose()
    resolveSpawn(fake.handles[0] as FakeTerminalHandle)
    expect((await catchError(pending)).code).toBe('INTERNAL')
    expect(fake.handles[0]?.terminated).toBe(1)
    expect(registry.get('t1')).toBeUndefined()
  })
})

/** A WebSocket client collecting parsed frames. */
interface WsClient {
  ws: WebSocket
  frames: Array<Record<string, unknown>>
  send(message: unknown): void
  next(predicate?: (frame: Record<string, unknown>) => boolean, timeoutMs?: number): Promise<Record<string, unknown>>
  close(): Promise<void>
}

async function openTerminal(port: number, terminalId: string, token?: string): Promise<WsClient> {
  const ws = new WebSocket(
    'ws://127.0.0.1:' + port + '/ws/terminal/' + terminalId + (token !== undefined ? '?token=' + token : ''),
  )
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve())
    ws.on('error', reject)
  })
  const frames: Array<Record<string, unknown>> = []
  ws.on('message', raw => {
    frames.push(JSON.parse(String(raw)) as Record<string, unknown>)
  })
  return {
    ws,
    frames,
    send: message => ws.send(JSON.stringify(message)),
    next: async (predicate = () => true, timeoutMs = 2000) => {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        const found = frames.find(predicate)
        if (found !== undefined) return found
        await new Promise(resolve => setTimeout(resolve, 5))
      }
      throw new Error('timed out waiting for a terminal frame; received ' + JSON.stringify(frames))
    },
    close: () => new Promise<void>(resolve => {
      if (ws.readyState === ws.CLOSED) {
        resolve()
        return
      }
      ws.once('close', () => resolve())
      ws.close()
    }),
  }
}

async function startServer(
  services: RinServiceRefs,
  config: Partial<Config> = {},
): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createWebServer({ port: 0, host: '127.0.0.1', ...config }, services)
  const address = await server.listen(0, '127.0.0.1')
  return { port: address.port, close: () => server.close() }
}

/** Poll until a condition holds, failing after the timeout. */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('condition not met in time')
}

const openServers: Array<{ close: () => Promise<void> }> = []
afterEach(async () => {
  await Promise.allSettled(openServers.splice(0).map(server => server.close()))
})

describe('terminal WebSocket bridge', () => {
  test('spawn sends ready with the terminal id and pid', async () => {
    const fake = fakeSubprocess()
    const server = await startServer(makeServices(fake.service))
    openServers.push(server)
    const client = await openTerminal(server.port, '__terminal__1')
    client.send({ type: 'spawn' })
    const ready = await client.next(frame => frame.type === 'ready')
    expect(ready).toEqual({ type: 'ready', terminalId: '__terminal__1', pid: 4242 })
    await client.close()
  })

  test('input forwards raw text to the handle write', async () => {
    const fake = fakeSubprocess()
    const server = await startServer(makeServices(fake.service))
    openServers.push(server)
    const client = await openTerminal(server.port, '__terminal__1')
    client.send({ type: 'spawn' })
    await client.next(frame => frame.type === 'ready')
    client.send({ type: 'input', text: 'echo hi\n' })
    await waitFor(() => (fake.handles[0]?.writes ?? []).length === 1)
    expect(fake.handles[0]?.writes).toEqual(['echo hi\n'])
    await client.close()
  })

  test('pty output deltas arrive as data frames', async () => {
    const fake = fakeSubprocess()
    const server = await startServer(makeServices(fake.service))
    openServers.push(server)
    const client = await openTerminal(server.port, '__terminal__1')
    client.send({ type: 'spawn' })
    await client.next(frame => frame.type === 'ready')
    fake.handles[0]?.emit('$ ')
    const data = await client.next(frame => frame.type === 'data')
    expect(data).toEqual({ type: 'data', text: '$ ' })
    await client.close()
  })

  test('exit is sent when the pty settles', async () => {
    const fake = fakeSubprocess()
    const server = await startServer(makeServices(fake.service))
    openServers.push(server)
    const client = await openTerminal(server.port, '__terminal__1')
    client.send({ type: 'spawn' })
    await client.next(frame => frame.type === 'ready')
    fake.handles[0]?.exit(3)
    const exit = await client.next(frame => frame.type === 'exit')
    expect(exit).toEqual({ type: 'exit', exitCode: 3, signal: null })
    await client.close()
  })

  test('signal forwards to the handle foreground group', async () => {
    const fake = fakeSubprocess()
    const server = await startServer(makeServices(fake.service))
    openServers.push(server)
    const client = await openTerminal(server.port, '__terminal__1')
    client.send({ type: 'spawn' })
    await client.next(frame => frame.type === 'ready')
    client.send({ type: 'signal', signal: 'SIGTSTP' })
    await waitFor(() => (fake.handles[0]?.signals ?? []).length === 1)
    expect(fake.handles[0]?.signals).toEqual(['SIGTSTP'])
    await client.close()
  })

  test('close terminates the session and reports null exit facts', async () => {
    const fake = fakeSubprocess()
    const server = await startServer(makeServices(fake.service))
    openServers.push(server)
    const client = await openTerminal(server.port, '__terminal__1')
    client.send({ type: 'spawn' })
    await client.next(frame => frame.type === 'ready')
    client.send({ type: 'close' })
    const exit = await client.next(frame => frame.type === 'exit')
    expect(exit).toEqual({ type: 'exit', exitCode: null, signal: null })
    expect(fake.handles[0]?.terminated).toBe(1)
    await client.close()
  })

  test('ping answers pong', async () => {
    const server = await startServer(makeServices())
    openServers.push(server)
    const client = await openTerminal(server.port, '__terminal__1')
    client.send({ type: 'ping' })
    await expect(client.next(frame => frame.type === 'pong')).resolves.toEqual({ type: 'pong' })
    await client.close()
  })

  test('input before spawn fails with NOT_SPAWNED', async () => {
    const fake = fakeSubprocess()
    const server = await startServer(makeServices(fake.service))
    openServers.push(server)
    const client = await openTerminal(server.port, '__terminal__1')
    client.send({ type: 'input', text: 'x' })
    const err = await client.next(frame => frame.type === 'error')
    expect(err).toMatchObject({ code: 'NOT_SPAWNED' })
    expect(fake.spawned.length).toBe(0)
    await client.close()
  })

  test('input after exit fails with NOT_SPAWNED', async () => {
    const fake = fakeSubprocess()
    const server = await startServer(makeServices(fake.service))
    openServers.push(server)
    const client = await openTerminal(server.port, '__terminal__1')
    client.send({ type: 'spawn' })
    await client.next(frame => frame.type === 'ready')
    fake.handles[0]?.exit(0)
    await client.next(frame => frame.type === 'exit')
    client.send({ type: 'input', text: 'x' })
    const err = await client.next(frame => frame.type === 'error')
    expect(err).toMatchObject({ code: 'NOT_SPAWNED' })
    await client.close()
  })

  test('a second spawn on the same connection is rejected', async () => {
    const fake = fakeSubprocess()
    const server = await startServer(makeServices(fake.service))
    openServers.push(server)
    const client = await openTerminal(server.port, '__terminal__1')
    client.send({ type: 'spawn' })
    await client.next(frame => frame.type === 'ready')
    client.send({ type: 'spawn' })
    const err = await client.next(frame => frame.type === 'error')
    expect(err).toMatchObject({ code: 'INTERNAL' })
    expect(fake.spawned.length).toBe(1)
    await client.close()
  })

  test('spawn without the subprocess service reports SUBPROCESS_UNAVAILABLE', async () => {
    const server = await startServer(makeServices())
    openServers.push(server)
    const client = await openTerminal(server.port, '__terminal__1')
    client.send({ type: 'spawn' })
    const err = await client.next(frame => frame.type === 'error')
    expect(err).toMatchObject({ code: 'SUBPROCESS_UNAVAILABLE' })
    await client.close()
  })

  test('a spawn failure reports SPAWN_FAILED', async () => {
    const server = await startServer(makeServices({
      async spawnTerminal() { throw new Error('pty gone') },
    }))
    openServers.push(server)
    const client = await openTerminal(server.port, '__terminal__1')
    client.send({ type: 'spawn' })
    const err = await client.next(frame => frame.type === 'error')
    expect(err).toMatchObject({ code: 'SPAWN_FAILED' })
    expect(String(err.message)).toContain('pty gone')
    await client.close()
  })

  test('closing the socket terminates the session', async () => {
    const fake = fakeSubprocess()
    const server = await startServer(makeServices(fake.service))
    openServers.push(server)
    const client = await openTerminal(server.port, '__terminal__1')
    client.send({ type: 'spawn' })
    await client.next(frame => frame.type === 'ready')
    await client.close()
    await waitFor(() => (fake.handles[0]?.terminated ?? 0) === 1)
  })

  test('server close terminates live sessions', async () => {
    const fake = fakeSubprocess()
    const server = await startServer(makeServices(fake.service))
    openServers.push(server)
    const client = await openTerminal(server.port, '__terminal__1')
    client.send({ type: 'spawn' })
    await client.next(frame => frame.type === 'ready')
    const closing = server.close()
    await waitFor(() => (fake.handles[0]?.terminated ?? 0) === 1)
    await client.close()
    await closing
  })

  test('the legacy bridge still accepts its own path', async () => {
    const server = await startServer(makeServices())
    openServers.push(server)
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket('ws://127.0.0.1:' + server.port + '/ws/s1')
      ws.on('message', raw => {
        const frame = JSON.parse(String(raw)) as { type: string }
        expect(frame.type).toBe('connected')
        ws.close()
        resolve()
      })
      ws.on('error', reject)
    })
  })

  test('host-header guard rejects a non-loopback Host on the terminal route', async () => {
    const server = await startServer(makeServices())
    openServers.push(server)
    const res = await rawUpgrade(server.port, '/ws/terminal/__terminal__1', { Host: 'evil.com' })
    expect(res.status).toBe(403)
  })

  test('token guard rejects a tokenless upgrade when configured', async () => {
    const server = await startServer(makeServices(), { authToken: 'secret' })
    openServers.push(server)
    expect((await rawUpgrade(server.port, '/ws/terminal/__terminal__1')).status).toBe(401)
    const client = await openTerminal(server.port, '__terminal__1', 'secret')
    client.send({ type: 'ping' })
    await expect(client.next(frame => frame.type === 'pong')).resolves.toEqual({ type: 'pong' })
    await client.close()
  })
})

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
