/**
 * rin session-search — strip-types smoke test for the dsh seam projection.
 *
 * Run from the package directory:
 *
 *   node --experimental-strip-types tests/seam.smoke.ts
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
import type { SeamSession } from '../src/projectSession.ts'
import type { SessionSearchStatsResult, SessionSearchToolResult } from '../src/tools-core.ts'

const fixture = await mkdtemp(join(tmpdir(), 'rin-session-search-seam-'))
try {
  const config = resolveSessionSearchConfig({
    configRoot: fixture,
    homeDir: fixture,
    projectPathForWorkingDirectory: workDir => workDir,
  })

  // Fake structural seam capturing every registration for assertion + cleanup.
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

  const core = new SessionSearchCore(seam, config)

  // Session lifecycle listeners are registered with the expected scoping.
  const createdListener = listeners.find(listener => listener.event === 'session/created')
  const disposedListener = listeners.find(listener => listener.event === 'session/disposed')
  if (!createdListener || !createdListener.global) throw new Error('session/created listener not registered globally')
  if (!disposedListener) throw new Error('session/disposed listener not registered')

  // Both model-visible tools are registered under the rin_ prefix.
  const toolNames = tools.map(tool => tool.name).sort()
  if (toolNames.join(',') !== 'rin_session_search,rin_session_stats') {
    throw new Error('unexpected registered tools: ' + toolNames.join(','))
  }

  // One disposal effect is registered so cleanup runs on context dispose.
  if (effects.length !== 1) throw new Error('expected one disposal effect, got ' + effects.length)

  // Emitting session/created indexes the session into a temp-dir SQLite index.
  const session: SeamSession = {
    id: 'session-1',
    header: { createdAt: 1_700_000_000_000, cwd: '/workspace/demo' },
    events: [
      { type: 'user/message', seq: 0, time: 1_700_000_001_000, data: { content: [{ type: 'text', text: 'Fix the payment retry bug' }] } },
      { type: 'assistant/message', seq: 1, time: 1_700_000_002_000, data: { message: { content: [{ type: 'text', text: 'Inspecting the retry queue' }] } } },
    ],
  }
  createdListener.fn(session)

  const searchTool = tools.find(tool => tool.name === 'rin_session_search')
  if (!searchTool) throw new Error('rin_session_search tool missing')

  const hitResult = await searchTool.execute({ query: 'payment' }) as SessionSearchToolResult
  if ('error' in hitResult) throw new Error('unexpected search error: ' + hitResult.error)
  if (hitResult.results.length !== 1) throw new Error('expected 1 search hit, got ' + hitResult.results.length)
  const hit = hitResult.results[0]
  if (hit.title !== 'Fix the payment retry bug') throw new Error('wrong hit title: ' + hit.title)
  if (hit.sessionKey !== '/workspace/demo:session-1') throw new Error('wrong session key: ' + hit.sessionKey)
  if (!hit.snippet) throw new Error('hit snippet missing')
  if (typeof hit.score !== 'number') throw new Error('hit score missing')

  const missResult = await searchTool.execute({ query: 'nonexistent-token' }) as SessionSearchToolResult
  if ('error' in missResult) throw new Error('unexpected miss error: ' + missResult.error)
  if (missResult.results.length !== 0) throw new Error('expected no hits for unknown token')

  const statsTool = tools.find(tool => tool.name === 'rin_session_stats')
  if (!statsTool) throw new Error('rin_session_stats tool missing')
  const stats = statsTool.execute({}) as SessionSearchStatsResult
  if ('error' in stats) throw new Error('unexpected stats error: ' + stats.error)
  if (stats.stats.sessionCount !== 1) throw new Error('expected 1 indexed session, got ' + stats.stats.sessionCount)
  if (stats.stats.messageCount !== 2) throw new Error('expected 2 indexed messages, got ' + stats.stats.messageCount)

  // A malformed session fails loud (logged) but never throws out of the listener.
  let threw = false
  try {
    createdListener.fn({ id: 'bad', header: { createdAt: Number.NaN }, events: [] } as unknown as SeamSession)
  } catch {
    threw = true
  }
  if (threw) throw new Error('session/created listener must not throw')
  if (loggedErrors.length !== 1) throw new Error('expected one logged index failure, got ' + loggedErrors.length)

  // Disposal removes every listener and tool registration.
  core.dispose()
  if (listeners.length !== 0) throw new Error('listeners not cleaned up on dispose')
  if (tools.length !== 0) throw new Error('tools not cleaned up on dispose')

  console.log('SEAM-SMOKE-OK', { sessions: stats.stats.sessionCount, messages: stats.stats.messageCount, tools: toolNames.join(',') })
} finally {
  await rm(fixture, { recursive: true, force: true })
}
