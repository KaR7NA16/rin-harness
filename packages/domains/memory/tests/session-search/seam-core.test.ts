/**
 * rin session-search — seam-core tests.
 *
 * Covers the dependency-free projection core (config resolution, session
 * lifecycle indexing, transcript/history indexing, model-visible tool
 * descriptors, and disposal) against a fake structural seam and a temp-dir
 * SQLite index. No Cordis, no dsh-tools — only node builtins.
 *
 * @module @rin/memory/session-search
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  resolveSessionSearchConfig,
  SessionSearchCore,
  type SessionSearchSeam,
  type SessionSearchTool,
} from '../../src/session-search/seam-core.ts'
import { openSessionSearchDb } from '../../src/session-search/db.ts'
import type { SeamSession } from '../../src/session-search/projectSession.ts'
import type {
  SessionSearchScrollResult,
  SessionSearchStatsResult,
  SessionSearchToolResult,
} from '../../src/session-search/tools-core.ts'
import type { ParsedSessionTranscript } from '../../src/session-search/types.ts'

describe('resolveSessionSearchConfig', () => {
  test('derives the index path and defaults home/separator-to-dash normalization', () => {
    const config = resolveSessionSearchConfig({ configRoot: '/cfg' })
    expect(config.dbPath).toBe('/cfg/indexes/session-search.db')
    expect(config.homeDir).toBeTruthy()
    expect(config.projectPathForWorkingDirectory('/a/b')).toBe('-a-b')
    expect(config.projectPathForWorkingDirectory('C:\\x\\y')).toBe('C:-x-y')
  })

  test('honors explicit dbPath, homeDir, and normalization overrides', () => {
    const config = resolveSessionSearchConfig({
      configRoot: '/cfg',
      dbPath: '/custom/db.sqlite',
      homeDir: '/home/alice',
      projectPathForWorkingDirectory: workDir => 'p:' + workDir,
    })
    expect(config.dbPath).toBe('/custom/db.sqlite')
    expect(config.homeDir).toBe('/home/alice')
    expect(config.projectPathForWorkingDirectory('w')).toBe('p:w')
  })
})

function makeSeam() {
  const listeners: Array<{ event: string; global: boolean; fn: (session: SeamSession) => void }> = []
  const tools: SessionSearchTool[] = []
  const effects: Array<() => void> = []
  const loggedErrors: string[] = []
  const seam: SessionSearchSeam = {
    tools: {
      register(tool) {
        tools.push(tool)
        return () => {
          const at = tools.indexOf(tool)
          if (at >= 0) tools.splice(at, 1)
        }
      },
    },
    on(event, listener, options) {
      const record = { event, global: options?.global ?? false, fn: listener }
      listeners.push(record)
      return () => {
        const at = listeners.indexOf(record)
        if (at >= 0) listeners.splice(at, 1)
      }
    },
    effect(disposer) {
      effects.push(disposer)
    },
    logger: { error: message => loggedErrors.push(message) },
  }
  return { seam, listeners, tools, effects, loggedErrors }
}

describe('SessionSearchCore', () => {
  let tempRoot: string
  let config: ReturnType<typeof resolveSessionSearchConfig>
  let core: SessionSearchCore
  let seam: ReturnType<typeof makeSeam>

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'rin-seam-core-'))
    config = resolveSessionSearchConfig({
      configRoot: tempRoot,
      homeDir: '/home/user',
      projectPathForWorkingDirectory: workDir => workDir,
    })
    seam = makeSeam()
    core = new SessionSearchCore(seam.seam, config)
  })

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })

  const searchTool = (): SessionSearchTool => {
    const tool = seam.tools.find(item => item.name === 'rin_session_search')
    if (!tool) throw new Error('rin_session_search tool not registered')
    return tool
  }
  const statsTool = (): SessionSearchTool => {
    const tool = seam.tools.find(item => item.name === 'rin_session_stats')
    if (!tool) throw new Error('rin_session_stats tool not registered')
    return tool
  }

  test('registers two global lifecycle listeners, both tools, and one effect', () => {
    expect(seam.listeners).toHaveLength(2)
    expect(seam.listeners.map(listener => listener.event).sort()).toEqual([
      'session/created',
      'session/disposed',
    ])
    expect(seam.listeners.every(listener => listener.global)).toBe(true)
    expect(seam.tools.map(tool => tool.name).sort()).toEqual([
      'rin_session_search',
      'rin_session_stats',
    ])
    expect(seam.effects).toHaveLength(1)
  })

  test('indexes temporary, full, and history transcripts and reports stats', () => {
    const temporary = core.indexTranscriptContent({
      raw: [
        JSON.stringify({ type: 'session-meta', isMeta: true, workDir: '/workspace/desktop', isTemporary: true, timestamp: '2026-08-01T01:00:00.000Z' }),
        JSON.stringify({ type: 'user', uuid: 'u1', timestamp: '2026-08-01T01:01:00.000Z', message: { role: 'user', content: 'Continue the desktop project in /workspace/desktop' } }),
        JSON.stringify({ type: 'assistant', uuid: 'a1', timestamp: '2026-08-01T01:02:00.000Z', message: { role: 'assistant', model: 'test-model', content: [{ type: 'tool_use', name: 'Read', input: { path: 'file.ts' } }] } }),
      ].join('\n'),
      filePath: '/sessions/temporary.jsonl',
      projectPath: '-workspace-desktop',
      sessionId: 'temporary',
      fileBirthtime: new Date('2026-08-01T01:00:00.000Z'),
      fileMtime: new Date('2026-08-01T01:02:00.000Z'),
      fileMtimeMs: 1,
      fileSize: 100,
    })
    expect(temporary.isTemporary).toBe(true)

    core.indexTranscriptContent({
      raw: [
        JSON.stringify({ type: 'session-meta', isMeta: true, workDir: '/workspace/full', timestamp: '2026-08-02T00:00:00.000Z' }),
        JSON.stringify({ type: 'user', uuid: 'u2', timestamp: '2026-08-02T00:01:00.000Z', message: { role: 'user', content: 'Launch work' } }),
      ].join('\n'),
      filePath: '/sessions/full.jsonl',
      projectPath: '-workspace-full',
      sessionId: 'full',
      fileBirthtime: new Date('2026-08-02T00:00:00.000Z'),
      fileMtime: new Date('2026-08-02T00:01:00.000Z'),
      fileMtimeMs: 2,
      fileSize: 200,
    })

    const histories = core.indexHistoryLog(
      JSON.stringify({ display: 'Ship the dashboard fix', project: '/workspace/demo', sessionId: '00000000-0000-4000-8000-000000000001', timestamp: 1_700_000_000_000 }),
      { filePath: '/history/history.jsonl#demo', birthtime: new Date(1), mtime: new Date(2), mtimeMs: 3, size: 10 },
      { projectPathForWorkingDirectory: workDir => workDir },
    )
    expect(histories).toHaveLength(1)
    expect(histories[0]?.isTemporary).toBe(false)

    const result = core.stats()
    if ('error' in result) throw new Error('unexpected stats error: ' + result.error)
    expect(result.stats).toEqual({
      sessionCount: 3,
      messageCount: 4,
      projectMemoryCount: 1,
      indexedFileCount: 3,
    })
  })

  test('indexes a pre-parsed transcript through indexTranscript', () => {
    core.indexTranscript(fullTranscript())
    const result = core.stats()
    if ('error' in result) throw new Error('unexpected stats error: ' + result.error)
    expect(result.stats.sessionCount).toBe(1)
    expect(result.stats.messageCount).toBe(1)
    expect(result.stats.projectMemoryCount).toBe(0)
  })

  test('searches, scrolls, and reads stats through the tool execute path', async () => {
    core.indexTranscriptContent({
      raw: [
        JSON.stringify({ type: 'session-meta', isMeta: true, workDir: '/workspace/desktop', isTemporary: true, timestamp: '2026-08-01T01:00:00.000Z' }),
        JSON.stringify({ type: 'user', uuid: 'u1', timestamp: '2026-08-01T01:01:00.000Z', message: { role: 'user', content: 'Continue the desktop project in /workspace/desktop' } }),
        JSON.stringify({ type: 'assistant', uuid: 'a1', timestamp: '2026-08-01T01:02:00.000Z', message: { role: 'assistant', model: 'test-model', content: [{ type: 'tool_use', name: 'Read', input: { path: 'file.ts' } }] } }),
      ].join('\n'),
      filePath: '/sessions/temporary.jsonl',
      projectPath: '-workspace-desktop',
      sessionId: 'temporary',
      fileBirthtime: new Date('2026-08-01T01:00:00.000Z'),
      fileMtime: new Date('2026-08-01T01:02:00.000Z'),
      fileMtimeMs: 1,
      fileSize: 100,
    })

    const searchResult = await searchTool().execute({ query: 'desktop' }) as SessionSearchToolResult
    if ('error' in searchResult) throw new Error('unexpected search error: ' + searchResult.error)
    expect(searchResult.results.length).toBeGreaterThanOrEqual(1)

    const db = openSessionSearchDb(config.dbPath)
    let anchorId = 0
    try {
      const row = db.prepare('SELECT id FROM messages WHERE session_id = ? ORDER BY id ASC LIMIT 1').get('temporary') as { id: number } | undefined
      if (!row) throw new Error('temporary session message missing')
      anchorId = row.id
    } finally {
      db.close()
    }

    const scrollResult = await searchTool().execute({ sessionId: 'temporary', aroundMessageId: anchorId }) as SessionSearchScrollResult
    if ('error' in scrollResult) throw new Error('unexpected scroll error: ' + scrollResult.error)
    expect(scrollResult.scroll.messages.some(message => message.anchor)).toBe(true)

    const statsResult = statsTool().execute({}) as SessionSearchStatsResult
    if ('error' in statsResult) throw new Error('unexpected stats error: ' + statsResult.error)
    expect(statsResult.stats.sessionCount).toBe(1)
  })

  test('logs a session indexing failure without throwing out of the listener', () => {
    const created = seam.listeners.find(listener => listener.event === 'session/created')
    if (!created) throw new Error('session/created listener missing')

    let threw = false
    try {
      created.fn({ id: 'bad', header: { createdAt: Number.NaN }, events: [] } as unknown as SeamSession)
    } catch {
      threw = true
    }
    expect(threw).toBe(false)
    expect(seam.loggedErrors).toHaveLength(1)
    expect(seam.loggedErrors[0]).toContain('failed to index session bad')
  })

  test('scroll validation rejects a missing sessionId or non-finite aroundMessageId', async () => {
    await expect(core.scroll({})).resolves.toEqual({
      error: 'sessionId (string) and aroundMessageId (number) are required to scroll',
    })
    await expect(core.scroll({ sessionId: 's' })).resolves.toEqual({
      error: 'sessionId (string) and aroundMessageId (number) are required to scroll',
    })
    await expect(core.scroll({ sessionId: 's', aroundMessageId: Number.NaN })).resolves.toEqual({
      error: 'sessionId (string) and aroundMessageId (number) are required to scroll',
    })
  })

  test('renders every search tool output branch', () => {
    const tool = searchTool()
    expect(tool.output.render({}, { error: 'boom' })).toEqual([{ type: 'text', text: 'boom' }])

    expect(tool.output.render({}, {
      scroll: { sessionId: 's', projectPath: 'p', title: 't', messages: [], messagesBefore: 0, messagesAfter: 0 },
    })).toEqual([{ type: 'text', text: 'No messages around that point.' }])

    const scrollRender = tool.output.render({}, {
      scroll: {
        sessionId: 's',
        projectPath: 'p',
        title: 't',
        messages: [{ id: 1, role: 'user', type: 'user', content: 'hi', line: 1, anchor: true }],
        messagesBefore: 2,
        messagesAfter: 3,
      },
    })
    expect(scrollRender).toHaveLength(1)
    expect(scrollRender[0]?.text).toContain('t — 2 earlier, 3 later')
    expect(scrollRender[0]?.text).toContain('user (line 1): hi [anchor]')

    expect(tool.output.render({}, { results: [] })).toEqual([{
      type: 'text',
      text: 'No matching sessions found in the rin session index.',
    }])

    const resultsRender = tool.output.render({}, {
      results: [{ sessionKey: 'p:s', path: '/p', title: 'T', snippet: 'snip', score: 1 }],
    })
    expect(resultsRender[0]?.text).toContain('Found 1 session(s)')
    expect(resultsRender[0]?.text).toContain('1. T [/p] (score 1)')
    expect(resultsRender[0]?.text).toContain('snip')
  })

  test('renders every stats tool output branch', () => {
    const tool = statsTool()
    expect(tool.output.render({}, { error: 'boom' })).toEqual([{ type: 'text', text: 'boom' }])
    expect(tool.output.render({}, {
      stats: { sessionCount: 1, messageCount: 2, projectMemoryCount: 3, indexedFileCount: 4 },
    })).toEqual([{
      type: 'text',
      text: '1 session(s), 2 message(s), 3 project memor(y/ies), 4 indexed file(s)',
    }])
  })

  test('shapes presentCall cards for both tools', () => {
    const search = searchTool()
    expect(search.presentCall?.({})).toEqual({
      card: 'generic',
      title: 'Search rin session index',
      kind: 'search',
      rawInput: '',
    })
    expect(search.presentCall?.({ query: 'q' })).toEqual({
      card: 'generic',
      title: 'Search rin session index',
      kind: 'search',
      rawInput: 'q',
    })
    expect(search.presentCall?.({ aroundMessageId: 1 })).toEqual({
      card: 'generic',
      title: 'Scroll rin session index',
      kind: 'search',
      rawInput: '',
    })
    expect(statsTool().presentCall?.({})).toEqual({
      card: 'generic',
      title: 'Read rin session index stats',
      kind: 'read',
    })
  })

  test('dispose removes every listener and tool, and is idempotent', () => {
    core.dispose()
    expect(seam.listeners).toHaveLength(0)
    expect(seam.tools).toHaveLength(0)
    // A second dispose must not throw: all disposers are already consumed.
    expect(() => core.dispose()).not.toThrow()
  })
})

function fullTranscript(): ParsedSessionTranscript {
  return {
    sessionId: 'full',
    projectPath: 'project',
    filePath: '/sessions/full.jsonl',
    workDir: '/workspace/full',
    isTemporary: false,
    title: 'Full session',
    createdAt: '2026-08-01T00:00:00.000Z',
    modifiedAt: '2026-08-01T00:01:00.000Z',
    fileMtimeMs: 1,
    fileSize: 10,
    messages: [{
      messageUuid: 'm',
      role: 'user',
      type: 'user',
      contentText: 'Do the work',
      timestamp: '2026-08-01T00:00:00.000Z',
      model: null,
      lineNo: 1,
      isSidechain: false,
    }],
  }
}
