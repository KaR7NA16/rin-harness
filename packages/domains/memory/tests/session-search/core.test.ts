import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendProjectMemoryContext,
  hasProjectMemoryContext,
  stripProjectMemoryContext,
} from '../../src/session-search/contextTag.ts'
import { openSessionSearchDb, sessionKey } from '../../src/session-search/db.ts'
import {
  getSessionSearchDbPath,
  getSessionSearchIndexDir,
  type SessionSearchRoots,
} from '../../src/session-search/paths.ts'
import { buildSessionHistoryTranscripts } from '../../src/session-search/history.ts'
import { parseSessionTranscriptContent } from '../../src/session-search/transcript.ts'
import {
  deleteSessionFromSearchIndexByKey,
  isProjectMemoryFileIndexCurrent,
  readIndexedFileMetadata,
  reconcileSearchIndexFiles,
  writeProjectMemoryFileToSearchIndex,
  writeSessionToSearchIndex,
} from '../../src/session-search/indexStore.ts'
import {
  deleteProjectMemoryBySessionKey,
  searchProjectMemories,
  upsertProjectMemoryFile,
  upsertProjectMemoryForParsedSession,
} from '../../src/session-search/projectMemory.ts'
import {
  browseSessionSearch,
  discoverSessionSearch,
  readSessionSearch,
  scrollSessionSearch,
} from '../../src/session-search/query.ts'
import type { ParsedSessionTranscript } from '../../src/session-search/types.ts'

describe('session-search foundation', () => {
  let tempRoot: string
  let roots: SessionSearchRoots

  beforeEach(async () => {
    tempRoot = join(tmpdir(), `session-search-rin-${randomUUID()}`)
    await mkdir(tempRoot, { recursive: true })
    roots = { configRoot: tempRoot }
  })

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })

  test('derives the index path only from the injected root', () => {
    expect(getSessionSearchIndexDir(roots)).toBe(join(tempRoot, 'indexes'))
    expect(getSessionSearchDbPath(roots)).toBe(
      join(tempRoot, 'indexes', 'session-search.db'),
    )
  })

  test('opens an explicit database path and initializes the schema', () => {
    const dbPath = getSessionSearchDbPath(roots)
    const db = openSessionSearchDb(dbPath)
    try {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')")
        .all() as Array<{ name: string }>
      const names = new Set(tables.map(table => table.name))
      expect(names.has('sessions')).toBe(true)
      expect(names.has('messages')).toBe(true)
      expect(names.has('project_memories')).toBe(true)
      expect(names.has('messages_fts')).toBe(true)
      expect(sessionKey('project', 'session')).toBe('project:session')
    } finally {
      db.close()
    }
  })

  test('supports an in-memory index without touching the filesystem', () => {
    const db = openSessionSearchDb(':memory:')
    try {
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE name = 'sessions'").get(),
      ).not.toBeNull()
    } finally {
      db.close()
    }
  })

  test('round-trips injected context without leaking it into visible text', () => {
    const tagged = appendProjectMemoryContext(
      'Visible request.',
      'Derived recall context.',
    )
    expect(hasProjectMemoryContext(tagged)).toBe(true)
    expect(stripProjectMemoryContext(tagged)).toBe('Visible request.')
  })
})

describe('session history projection', () => {
  test('groups valid JSONL entries and preserves original line numbers', () => {
    const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const raw = [
      JSON.stringify({ display: 'First request', project: '/work/app', sessionId, timestamp: 1_700_000_000_000 }),
      '{partial',
      JSON.stringify({ display: 'Second request', project: '/work/app', sessionId, timestamp: '2026-08-02T00:00:00Z' }),
      JSON.stringify({ display: '', project: '/work/app', sessionId }),
    ].join('\n')

    const sessions = buildSessionHistoryTranscripts(
      raw,
      {
        filePath: '/config/history.jsonl',
        birthtime: new Date('2026-08-01T00:00:00Z'),
        mtime: new Date('2026-08-03T00:00:00Z'),
        mtimeMs: 42,
        size: raw.length,
      },
      { projectPathForWorkingDirectory: value => value.replaceAll('/', '-') },
    )

    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.projectPath).toBe('-work-app')
    expect(sessions[0]?.filePath).toBe(`/config/history.jsonl#-work-app:${sessionId}`)
    expect(sessions[0]?.messages.map(message => message.lineNo)).toEqual([1, 3])
    expect(sessions[0]?.messages[0]?.timestamp).toBe('2023-11-14T22:13:20.000Z')
    expect(sessions[0]?.modifiedAt).toBe('2026-08-02T00:00:00.000Z')
  })

  test('filters by normalized project and falls back to source dates', () => {
    const raw = JSON.stringify({
      display: 'No timestamp',
      project: 'C:\\work\\app',
      sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    })
    const source = {
      filePath: 'C:\\config\\history.jsonl',
      birthtime: new Date('2026-08-01T00:00:00Z'),
      mtime: new Date('2026-08-03T00:00:00Z'),
      mtimeMs: 43,
      size: raw.length,
    }
    const options = {
      projectPathForWorkingDirectory: (value: string) => value.replaceAll('\\', '-').replace(':', ''),
      projectFilter: 'C-work-app',
    }

    const [session] = buildSessionHistoryTranscripts(raw, source, options)
    expect(session?.createdAt).toBe('2026-08-01T00:00:00.000Z')
    expect(session?.modifiedAt).toBe('2026-08-03T00:00:00.000Z')
    expect(buildSessionHistoryTranscripts(raw, source, { ...options, projectFilter: 'elsewhere' })).toEqual([])
  })
})

describe('session transcript parser', () => {
  const metadata = {
    filePath: '/sessions/session.jsonl',
    projectPath: '-workspace-demo',
    sessionId: 'session',
    fileBirthtime: new Date('2026-08-01T00:00:00.000Z'),
    fileMtime: new Date('2026-08-02T00:00:00.000Z'),
    fileMtimeMs: 123,
    fileSize: 456,
  }

  test('normalizes visible messages and strips injected recall context', () => {
    const parsed = parseSessionTranscriptContent({
      ...metadata,
      raw: [
        jsonLine({
          type: 'session-meta',
          isMeta: true,
          workDir: '/workspace/demo',
          isTemporary: true,
          timestamp: '2026-08-01T01:00:00.000Z',
        }),
        jsonLine({
          type: 'user',
          uuid: 'user-1',
          timestamp: '2026-08-01T01:01:00.000Z',
          message: {
            role: 'user',
            content: appendProjectMemoryContext(
              'Continue the visible task.',
              'Derived context must not be indexed.',
            ),
          },
        }),
        jsonLine({
          type: 'assistant',
          uuid: 'assistant-1',
          timestamp: '2026-08-01T01:02:00.000Z',
          message: {
            role: 'assistant',
            model: 'test-model',
            content: [
              { type: 'text', text: 'I will inspect it.' },
              { type: 'tool_use', name: 'Read', input: { path: 'file.ts' } },
            ],
          },
        }),
      ].join(''),
    })

    expect(parsed.workDir).toBe('/workspace/demo')
    expect(parsed.isTemporary).toBe(true)
    expect(parsed.title).toBe('Continue the visible task.')
    expect(parsed.messages).toHaveLength(2)
    expect(parsed.messages[0]?.contentText).toBe('Continue the visible task.')
    expect(parsed.messages[1]).toMatchObject({
      type: 'tool_use',
      model: 'test-model',
    })
    expect(parsed.messages[1]?.contentText).toContain('tool:Read')
    expect(JSON.stringify(parsed)).not.toContain('Derived context')
  })

  test('skips malformed, meta, command breadcrumb, and interruption rows', () => {
    const parsed = parseSessionTranscriptContent({
      ...metadata,
      raw: [
        '{malformed}\n',
        jsonLine({
          type: 'user',
          uuid: 'command',
          message: { role: 'user', content: '<command-name>help</command-name>' },
        }),
        jsonLine({
          type: 'user',
          uuid: 'interrupted',
          message: { role: 'user', content: '[Request interrupted by user]' },
        }),
        jsonLine({
          type: 'assistant',
          uuid: 'empty',
          message: { role: 'assistant', content: 'No response requested.' },
        }),
      ].join(''),
    })

    expect(parsed.messages).toEqual([])
    expect(parsed.createdAt).toBe('2026-08-01T00:00:00.000Z')
  })
})

describe('session-search index store', () => {
  test('atomically replaces session messages and both FTS projections', () => {
    const db = openSessionSearchDb(':memory:')
    try {
      writeSessionToSearchIndex(db, transcript('first searchable text'), {
        homeDir: '/home/user',
      })
      writeSessionToSearchIndex(db, transcript('replacement searchable text'), {
        homeDir: '/home/user',
      })

      expect(readIndexedFileMetadata(db, '/sessions/session.jsonl')).toEqual({
        file_mtime_ms: 123,
        file_size: 456,
      })
      expect(
        db.prepare('SELECT content_text FROM messages').all(),
      ).toEqual([{ content_text: 'replacement searchable text' }])
      expect(
        db.prepare("SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'first'").all(),
      ).toEqual([])
      expect(
        db.prepare("SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'replacement'").all(),
      ).toHaveLength(1)
      expect(db.prepare('SELECT id FROM project_memories').all()).toHaveLength(1)

      deleteSessionFromSearchIndexByKey(db, 'project:session')
      expect(db.prepare('SELECT id FROM messages').all()).toEqual([])
      expect(db.prepare('SELECT rowid FROM messages_fts').all()).toEqual([])
      expect(db.prepare('SELECT id FROM project_memories').all()).toEqual([])
      expect(db.prepare('SELECT session_key FROM sessions').all()).toEqual([])
      expect(db.prepare('SELECT file_path FROM indexed_files').all()).toEqual([])
    } finally {
      db.close()
    }
  })

  test('owns memory-file metadata and stale-file reconciliation', () => {
    const db = openSessionSearchDb(':memory:')
    try {
      const memoryFile = {
        filePath: '/memory/project.md',
        projectPath: 'project',
        workDir: '/workspace',
        title: 'Project memory',
        content: 'The deployment checklist lives in docs/release.md.',
        keywords: ['release'],
        source: 'auto-memory-file' as const,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-02T00:00:00.000Z',
        fileMtimeMs: 321,
        fileSize: 654,
      }
      expect(writeProjectMemoryFileToSearchIndex(db, memoryFile)).toBe(true)
      expect(isProjectMemoryFileIndexCurrent(db, memoryFile)).toBe(true)

      writeSessionToSearchIndex(db, transcript('live transcript'), {
        homeDir: '/home/user',
      })
      reconcileSearchIndexFiles(db, new Set(['/sessions/session.jsonl']), 'project')

      expect(db.prepare('SELECT id FROM project_memories').all()).toHaveLength(1)
      expect(
        db.prepare('SELECT file_path FROM indexed_files').all(),
      ).toEqual([{ file_path: '/sessions/session.jsonl' }])
      expect(isProjectMemoryFileIndexCurrent(db, memoryFile)).toBe(false)
    } finally {
      db.close()
    }
  })
})

describe('session-search memory projection', () => {
  test('distills temporary project work while redacting secrets', () => {
    const db = openSessionSearchDb(':memory:')
    try {
      const parsed = temporaryTranscript()
      upsertProjectMemoryForParsedSession(db, parsed, {
        homeDir: '/home/user',
      })

      const memories = searchProjectMemories({
        db,
        query: 'desktop',
        includeRecentFallback: false,
      })
      expect(memories).toHaveLength(1)
      expect(memories[0]?.summary).toContain('/workspace/desktop')
      expect(memories[0]?.summary).not.toContain('super-secret')

      deleteProjectMemoryBySessionKey(
        db,
        sessionKey(parsed.projectPath, parsed.sessionId),
      )
      expect(searchProjectMemories({ db, query: 'desktop' })).toEqual([])
    } finally {
      db.close()
    }
  })

  test('indexes external memory projections and filters Prompt Memory', () => {
    const db = openSessionSearchDb(':memory:')
    try {
      const result = upsertProjectMemoryFile(db, {
        filePath: '/memory/USER.md',
        projectPath: '__global_prompt_memory',
        workDir: '/memory',
        title: 'Prompt memory: USER.md',
        content: 'The user calls the agent Starlight.',
        keywords: ['prompt-memory', 'USER.md'],
        source: 'prompt-memory',
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      })
      expect(result).not.toBeNull()
      expect(searchProjectMemories({ db, query: 'Starlight' })).toHaveLength(1)
      expect(
        searchProjectMemories({
          db,
          query: 'Starlight',
          includePromptMemory: false,
        }),
      ).toEqual([])
    } finally {
      db.close()
    }
  })
})

describe('session-search query', () => {
  test('discovers, browses, reads, and scrolls an existing index without source refresh', async () => {
    const db = openSessionSearchDb(':memory:')
    try {
      writeSessionToSearchIndex(db, transcript(), { homeDir: '/home/user' })

      const discovered = await discoverSessionSearch({
        db,
        query: 'launch checklist',
      })
      expect(discovered.mode).toBe('discover')
      expect(discovered.count).toBe(1)
      const hit = discovered.mode === 'discover' ? discovered.results[0] : null
      expect(hit?.messages.some(message => message.anchor)).toBe(true)

      const browsed = await browseSessionSearch({ db, project: 'project' })
      expect(browsed.count).toBe(1)
      expect((await browseSessionSearch({ db, project: 'other' })).count).toBe(0)

      const read = await readSessionSearch({ db, sessionId: 'session' })
      expect(read?.mode).toBe('read')
      expect(read?.count).toBe(3)

      const scrolled = await scrollSessionSearch({
        db,
        sessionId: 'session',
        aroundMessageId: hit!.matchMessageId!,
        window: 1,
      })
      expect(scrolled?.mode).toBe('scroll')
      if (!scrolled || scrolled.mode !== 'scroll') {
        throw new Error('Expected scroll result')
      }
      expect(scrolled.messages.some(message => message.anchor)).toBe(true)
    } finally {
      db.close()
    }
  })
})

function jsonLine(value: Record<string, unknown>): string {
  return `${JSON.stringify(value)}\n`
}

function transcript(contentText?: string): ParsedSessionTranscript {
  if (contentText !== undefined) {
    return {
      sessionId: 'session',
      projectPath: 'project',
      filePath: '/sessions/session.jsonl',
      workDir: '/workspace',
      isTemporary: true,
      title: 'Session',
      createdAt: '2026-08-01T00:00:00.000Z',
      modifiedAt: '2026-08-02T00:00:00.000Z',
      fileMtimeMs: 123,
      fileSize: 456,
      messages: [
        {
          messageUuid: 'message',
          role: 'user',
          type: 'user',
          contentText,
          timestamp: '2026-08-01T00:00:00.000Z',
          model: null,
          lineNo: 1,
          isSidechain: false,
        },
      ],
    }
  }
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
    messages: ['Start work', 'Review launch checklist', 'Finish work'].map(
      (contentText, index) => ({
        messageUuid: `message-${index}`,
        role: index === 1 ? 'assistant' : 'user',
        type: index === 1 ? 'assistant' : 'user',
        contentText,
        timestamp: `2026-08-01T00:0${index}:00.000Z`,
        model: index === 1 ? 'test-model' : null,
        lineNo: index + 1,
        isSidechain: false,
      }),
    ),
  }
}

function temporaryTranscript(): ParsedSessionTranscript {
  return {
    sessionId: 'temporary',
    projectPath: 'project',
    filePath: '/sessions/temporary.jsonl',
    workDir: '/workspace/desktop',
    isTemporary: true,
    title: 'Desktop project',
    createdAt: '2026-08-01T00:00:00.000Z',
    modifiedAt: '2026-08-01T00:05:00.000Z',
    fileMtimeMs: 1,
    fileSize: 100,
    messages: [
      {
        messageUuid: 'user',
        role: 'user',
        type: 'user',
        contentText:
          'Continue the desktop project in /workspace/desktop. password=super-secret',
        timestamp: '2026-08-01T00:01:00.000Z',
        model: null,
        lineNo: 1,
        isSidechain: false,
      },
    ],
  }
}
