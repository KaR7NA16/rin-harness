/**
 * rin session-search — tools-core tests.
 *
 * Model-visible tool logic over the derived index: keyword search, message
 * scrolling, and aggregate stats. Exercises the use-then-close entry points
 * against a real temp-dir SQLite index (node builtins only, no Cordis).
 *
 * @module @rin/session-search
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openSessionSearchDb } from '../src/db.ts'
import { writeSessionToSearchIndex } from '../src/indexStore.ts'
import {
  scrollSessionIndex,
  searchSessionIndex,
  sessionIndexStats,
} from '../src/tools-core.ts'
import type { ParsedSessionTranscript } from '../src/types.ts'

describe('session-search tools-core', () => {
  let tempRoot: string
  let dbPath: string

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'rin-tools-core-'))
    dbPath = join(tempRoot, 'index', 'session-search.db')
  })

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })

  function seed(): void {
    const db = openSessionSearchDb(dbPath)
    try {
      writeSessionToSearchIndex(db, transcript(), { homeDir: '/home/user' })
    } finally {
      db.close()
    }
  }

  function firstMessageId(): number {
    const db = openSessionSearchDb(dbPath)
    try {
      const row = db.prepare('SELECT id FROM messages ORDER BY line_no ASC, id ASC LIMIT 1').get() as { id: number }
      return row.id
    } finally {
      db.close()
    }
  }

  test('reports zero counts for an empty index', () => {
    expect(sessionIndexStats(dbPath)).toEqual({
      stats: { sessionCount: 0, messageCount: 0, projectMemoryCount: 0, indexedFileCount: 0 },
    })
  })

  test('counts indexed sessions, messages, and files', () => {
    seed()
    expect(sessionIndexStats(dbPath)).toEqual({
      stats: { sessionCount: 1, messageCount: 3, projectMemoryCount: 0, indexedFileCount: 1 },
    })
  })

  test('rejects an empty or whitespace query', async () => {
    await expect(searchSessionIndex({ dbPath, query: '' })).resolves.toEqual({
      error: 'query must not be empty',
    })
    await expect(searchSessionIndex({ dbPath, query: '   ' })).resolves.toEqual({
      error: 'query must not be empty',
    })
  })

  test('returns an explicit error when the index path is unusable', async () => {
    const blocked = join(tempRoot, 'blocked')
    await writeFile(blocked, 'not a directory')
    const badPath = join(blocked, 'db.sqlite')

    await expect(searchSessionIndex({ dbPath: badPath, query: 'x' })).resolves.toMatchObject({
      error: expect.stringContaining('session-search index unavailable'),
    })
    expect(sessionIndexStats(badPath)).toMatchObject({
      error: expect.stringContaining('session-search index unavailable'),
    })
    await expect(scrollSessionIndex({ dbPath: badPath, sessionId: 's', aroundMessageId: 1 })).resolves.toMatchObject({
      error: expect.stringContaining('session-search index unavailable'),
    })
  })

  test('searches the index and shapes per-session hits with scores', async () => {
    seed()
    const result = await searchSessionIndex({ dbPath, query: 'launch checklist' })
    if ('error' in result) throw new Error('unexpected error: ' + result.error)
    expect(result.results).toHaveLength(1)
    expect(result.results[0]).toMatchObject({
      sessionKey: 'project:session',
      path: '/workspace/project',
      title: 'Launch work',
    })
    expect(result.results[0]?.snippet).toBeTruthy()
    expect(result.results[0]?.score).toBe(1)
  })

  test('scopes search to one project and returns no hits for a miss', async () => {
    seed()
    const scoped = await searchSessionIndex({ dbPath, query: 'launch', scope: 'other' })
    if ('error' in scoped) throw new Error('unexpected error: ' + scoped.error)
    expect(scoped.results).toHaveLength(0)

    const hit = await searchSessionIndex({ dbPath, query: 'launch', scope: 'project' })
    if ('error' in hit) throw new Error('unexpected error: ' + hit.error)
    expect(hit.results).toHaveLength(1)
  })

  test('scrolls around a message and anchors the window', async () => {
    seed()
    const anchorId = firstMessageId()
    const result = await scrollSessionIndex({
      dbPath,
      sessionId: 'session',
      aroundMessageId: anchorId,
      window: 1,
    })
    if ('error' in result) throw new Error('unexpected error: ' + result.error)
    expect(result.scroll).toMatchObject({
      sessionId: 'session',
      projectPath: 'project',
      title: 'Launch work',
    })
    expect(result.scroll.messages.some(message => message.anchor)).toBe(true)
    expect(result.scroll.messagesBefore).toBe(0)
    expect(result.scroll.messagesAfter).toBe(1)
  })

  test('returns an explicit error when the scroll target is missing', async () => {
    seed()
    const result = await scrollSessionIndex({ dbPath, sessionId: 'nope', aroundMessageId: 1 })
    if ('scroll' in result) throw new Error('expected scroll error')
    expect(result.error).toContain('no session or message found')
  })
})

function transcript(): ParsedSessionTranscript {
  return {
    sessionId: 'session',
    projectPath: 'project',
    filePath: '/sessions/session.jsonl',
    workDir: '/workspace/project',
    isTemporary: false,
    title: 'Launch work',
    createdAt: '2026-08-01T00:00:00.000Z',
    modifiedAt: '2026-08-01T00:03:00.000Z',
    fileMtimeMs: 1,
    fileSize: 100,
    messages: ['Start work', 'Review launch checklist', 'Finish work'].map((contentText, index) => ({
      messageUuid: 'message-' + index,
      role: index === 1 ? 'assistant' : 'user',
      type: index === 1 ? 'assistant' : 'user',
      contentText,
      timestamp: '2026-08-01T00:0' + index + ':00.000Z',
      model: index === 1 ? 'test-model' : null,
      lineNo: index + 1,
      isSidechain: false,
    })),
  }
}
