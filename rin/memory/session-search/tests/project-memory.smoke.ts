/**
 * rin session-search — strip-types smoke test for the project-memory
 * derivation path and the history/transcript index inputs.
 *
 * Run from the package directory:
 *
 *   node --experimental-strip-types tests/project-memory.smoke.ts
 *
 * @module @rin/session-search
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  resolveSessionSearchConfig,
  SessionSearchCore,
} from '../src/seam-core.ts'
import type { SessionSearchSeam, SessionSearchTool } from '../src/seam-core.ts'
import { openSessionSearchDb } from '../src/db.ts'
import { searchProjectMemories } from '../src/projectMemory.ts'
import type { SessionSearchStatsResult, SessionSearchScrollResult, SessionSearchToolResult } from '../src/tools-core.ts'

const fixture = await mkdtemp(join(tmpdir(), 'rin-session-search-projmem-'))
try {
  const config = resolveSessionSearchConfig({
    configRoot: fixture,
    homeDir: join(fixture, 'home'),
    projectPathForWorkingDirectory: workDir => workDir,
  })

  // Fake structural seam capturing every registration for assertion + cleanup.
  const tools: SessionSearchTool[] = []
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
    on() {
      return () => {}
    },
    effect() {},
    logger: { error: message => console.error('SEAM-ERROR', message) },
  }

  const core = new SessionSearchCore(seam, config)
  const statsTool = tools.find(tool => tool.name === 'rin_session_stats')
  const searchTool = tools.find(tool => tool.name === 'rin_session_search')
  if (!statsTool || !searchTool) throw new Error('tools not registered')

  const readStats = () => {
    const result = statsTool.execute({}) as SessionSearchStatsResult
    if ('error' in result) throw new Error('unexpected stats error: ' + result.error)
    return result.stats
  }

  // 1. A temporary transcript (session-meta isTemporary: true) derives a
  //    project memory instead of leaving the derivation path a no-op delete.
  const temporaryRaw = [
    JSON.stringify({ type: 'session-meta', isMeta: true, workDir: '/workspace/desktop', isTemporary: true, timestamp: '2026-08-01T01:00:00.000Z' }),
    JSON.stringify({ type: 'user', uuid: 'u1', timestamp: '2026-08-01T01:01:00.000Z', message: { role: 'user', content: 'Continue the desktop project in /workspace/desktop' } }),
    JSON.stringify({ type: 'assistant', uuid: 'a1', timestamp: '2026-08-01T01:02:00.000Z', message: { role: 'assistant', model: 'test-model', content: [{ type: 'tool_use', name: 'Read', input: { path: 'file.ts' } }] } }),
  ].join('\n')

  const parsed = core.indexTranscriptContent({
    raw: temporaryRaw,
    filePath: '/sessions/temporary.jsonl',
    projectPath: '-workspace-desktop',
    sessionId: 'temporary',
    fileBirthtime: new Date('2026-08-01T01:00:00.000Z'),
    fileMtime: new Date('2026-08-01T01:02:00.000Z'),
    fileMtimeMs: 1,
    fileSize: temporaryRaw.length,
  })
  if (parsed.isTemporary !== true) throw new Error('expected temporary transcript, got isTemporary=' + parsed.isTemporary)

  let stats = readStats()
  if (stats.projectMemoryCount !== 1) throw new Error('expected 1 derived project memory, got ' + stats.projectMemoryCount)
  if (stats.sessionCount !== 1) throw new Error('expected 1 indexed session, got ' + stats.sessionCount)
  if (stats.messageCount !== 2) throw new Error('expected 2 indexed messages, got ' + stats.messageCount)

  // The derived memory is searchable through the project-memory query path.
  const db = openSessionSearchDb(config.dbPath)
  try {
    const memories = searchProjectMemories({ db, query: 'desktop' })
    if (memories.length !== 1) throw new Error('expected 1 searchable project memory, got ' + memories.length)
    if (memories[0]!.source !== 'temporary-session') throw new Error('wrong memory source: ' + memories[0]!.source)
  } finally {
    db.close()
  }

  // 2. A history log projects to a full (non-temporary) session, so it adds a
  //    session row without deriving a second project memory.
  const historyRaw = [
    JSON.stringify({ display: 'Ship the dashboard fix', project: '/workspace/demo', sessionId: '00000000-0000-4000-8000-000000000001', timestamp: 1_700_000_000_000 }),
  ].join('\n')
  const historyTranscripts = core.indexHistoryLog(
    historyRaw,
    { filePath: '/history/history.jsonl#demo', birthtime: new Date(1), mtime: new Date(2), mtimeMs: 2, size: historyRaw.length },
    { projectPathForWorkingDirectory: workDir => workDir },
  )
  if (historyTranscripts.length !== 1) throw new Error('expected 1 history transcript, got ' + historyTranscripts.length)
  if (historyTranscripts[0]!.isTemporary) throw new Error('history transcripts must not be temporary')

  stats = readStats()
  if (stats.sessionCount !== 2) throw new Error('expected 2 indexed sessions after history, got ' + stats.sessionCount)
  if (stats.projectMemoryCount !== 1) throw new Error('history must not derive a project memory')

  // 3. A non-temporary transcript indexes as a session without a memory.
  const fullRaw = [
    JSON.stringify({ type: 'session-meta', isMeta: true, workDir: '/workspace/full', timestamp: '2026-08-02T00:00:00.000Z' }),
    JSON.stringify({ type: 'user', uuid: 'u2', timestamp: '2026-08-02T00:01:00.000Z', message: { role: 'user', content: 'Launch work' } }),
  ].join('\n')
  core.indexTranscriptContent({
    raw: fullRaw,
    filePath: '/sessions/full.jsonl',
    projectPath: '-workspace-full',
    sessionId: 'full',
    fileBirthtime: new Date('2026-08-02T00:00:00.000Z'),
    fileMtime: new Date('2026-08-02T00:01:00.000Z'),
    fileMtimeMs: 3,
    fileSize: fullRaw.length,
  })

  stats = readStats()
  if (stats.sessionCount !== 3) throw new Error('expected 3 indexed sessions after full transcript, got ' + stats.sessionCount)
  if (stats.projectMemoryCount !== 1) throw new Error('full transcripts must not derive a project memory')

  // 4. rin_session_search scrolls around a message when aroundMessageId is set.
  const anchorDb = openSessionSearchDb(config.dbPath)
  let anchorId: number
  try {
    const row = anchorDb.prepare('SELECT id FROM messages WHERE session_id = ? ORDER BY id ASC LIMIT 1').get('temporary') as { id: number } | undefined
    if (!row) throw new Error('temporary session message missing')
    anchorId = row.id
  } finally {
    anchorDb.close()
  }

  const scrollResult = await searchTool.execute({
    sessionId: 'temporary',
    aroundMessageId: anchorId,
    projectPath: '-workspace-desktop',
    window: 1,
  }) as SessionSearchScrollResult
  if ('error' in scrollResult) throw new Error('unexpected scroll error: ' + scrollResult.error)
  if (!scrollResult.scroll.messages.some(message => message.anchor)) {
    throw new Error('scroll window must anchor on aroundMessageId')
  }
  if (scrollResult.scroll.title !== 'Continue the desktop project in /workspace/desktop') {
    throw new Error('wrong scroll title: ' + scrollResult.scroll.title)
  }

  // A query-only search still returns the keyword result shape.
  const searchResult = await searchTool.execute({ query: 'desktop' }) as SessionSearchToolResult
  if ('error' in searchResult) throw new Error('unexpected search error: ' + searchResult.error)
  if (searchResult.results.length < 1) throw new Error('expected at least 1 search hit for "desktop"')

  core.dispose()
  if (tools.length !== 0) throw new Error('tools not cleaned up on dispose')

  console.log('PROJECT-MEMORY-SMOKE-OK', {
    sessions: stats.sessionCount,
    messages: stats.messageCount,
    projectMemories: stats.projectMemoryCount,
    scrollAnchored: true,
  })
} finally {
  await rm(fixture, { recursive: true, force: true })
}
