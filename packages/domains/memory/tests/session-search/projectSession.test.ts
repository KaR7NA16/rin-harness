/**
 * rin session-search — projectSession projection tests.
 *
 * Pure, dependency-free coverage for {@link projectSessionToTranscript}: the
 * event-sourced session -> normalized transcript projection the derived index
 * consumes. No Cordis, no filesystem — only structural seam inputs.
 *
 * @module @rin/memory/session-search
 */

import { describe, expect, test } from 'vitest'
import {
  projectSessionToTranscript,
  type SeamSession,
} from '../../src/session-search/projectSession.ts'

function session(events: SeamSession['events'], header: SeamSession['header'] = { createdAt: 1_700_000_000_000 }): SeamSession {
  return { id: 's1', header, events }
}

describe('projectSessionToTranscript', () => {
  test('projects user and assistant text messages with roles, types, and metadata', () => {
    const parsed = projectSessionToTranscript(
      session(
        [
          { type: 'user/message', seq: 0, time: 1_700_000_001_000, data: { content: [{ type: 'text', text: 'Fix the bug' }] } },
          { type: 'assistant/message', seq: 1, time: 1_700_000_002_000, data: { message: { content: [{ type: 'text', text: 'Inspecting the retry queue' }] } } },
        ],
        { createdAt: 1_700_000_000_000, cwd: '/workspace/app' },
      ),
      { projectPath: '-workspace-app', filePath: 'live:s1' },
    )

    expect(parsed.sessionId).toBe('s1')
    expect(parsed.projectPath).toBe('-workspace-app')
    expect(parsed.filePath).toBe('live:s1')
    expect(parsed.workDir).toBe('/workspace/app')
    expect(parsed.isTemporary).toBe(false)
    expect(parsed.title).toBe('Fix the bug')
    expect(parsed.createdAt).toBe('2023-11-14T22:13:20.000Z')
    expect(parsed.modifiedAt).toBe('2023-11-14T22:13:22.000Z')
    expect(parsed.fileMtimeMs).toBe(1_700_000_002_000)
    expect(parsed.messages).toHaveLength(2)
    expect(parsed.messages[0]).toMatchObject({
      messageUuid: 's1:0',
      role: 'user',
      type: 'user',
      contentText: 'Fix the bug',
      timestamp: '2023-11-14T22:13:21.000Z',
      model: null,
      lineNo: 0,
      isSidechain: false,
    })
    expect(parsed.messages[1]).toMatchObject({
      role: 'assistant',
      type: 'assistant',
      contentText: 'Inspecting the retry queue',
    })
    expect(parsed.fileSize).toBe('Fix the bug'.length + 'Inspecting the retry queue'.length)
  })

  test('projects tool calls and tool results into their index role/type pairs', () => {
    const parsed = projectSessionToTranscript(
      session([
        { type: 'tool/call', seq: 0, time: 1, data: { name: 'Read', arguments: '{"path":"a.ts"}' } },
        { type: 'tool/result', seq: 1, time: 2, data: { message: { content: [{ type: 'text', text: 'file contents' }] } } },
      ]),
      { projectPath: 'p', filePath: 'f' },
    )

    expect(parsed.messages).toHaveLength(2)
    expect(parsed.messages[0]).toMatchObject({
      role: 'assistant',
      type: 'tool_use',
      contentText: ['Read', '{"path":"a.ts"}'].join('\n'),
    })
    expect(parsed.messages[1]).toMatchObject({
      role: 'user',
      type: 'tool_result',
      contentText: 'file contents',
    })
  })

  test('drops reasoning blocks and non-searchable events', () => {
    const parsed = projectSessionToTranscript(
      session([
        { type: 'assistant/message', seq: 0, time: 1, data: { message: { content: [{ type: 'reasoning', text: 'internal thinking' }] } } },
        { type: 'assistant/message', seq: 1, time: 2, data: { message: { content: [] } } },
        { type: 'some/other', seq: 2, time: 3, data: { content: 'ignored' } },
        { type: 'user/message', seq: 3, time: 4, data: { content: 'not-an-array' } },
      ]),
      { projectPath: 'p', filePath: 'f' },
    )

    expect(parsed.messages).toEqual([])
    expect(parsed.title).toBe('s1')
  })

  test('extracts tool-call blocks and tool-result blocks from mixed content', () => {
    const parsed = projectSessionToTranscript(
      session([
        {
          type: 'assistant/message',
          seq: 0,
          time: 1,
          data: {
            message: {
              content: [
                { type: 'text', text: 'Calling the tool' },
                { type: 'tool-call', name: 'Bash', arguments: '{"command":"ls"}' },
              ],
            },
          },
        },
        {
          type: 'user/message',
          seq: 1,
          time: 2,
          data: {
            content: [
              { type: 'tool-result', content: [{ type: 'text', text: 'result text' }] },
            ],
          },
        },
      ]),
      { projectPath: 'p', filePath: 'f' },
    )

    expect(parsed.messages).toHaveLength(2)
    expect(parsed.messages[0]?.contentText).toBe(['Calling the tool', 'Bash', '{"command":"ls"}'].join('\n'))
    expect(parsed.messages[1]?.contentText).toBe('result text')
    expect(parsed.messages[1]?.type).toBe('user')
  })

  test('truncates a long title and derives workDir from the header cwd', () => {
    const long = 'x'.repeat(90)
    const parsed = projectSessionToTranscript(
      session(
        [{ type: 'user/message', seq: 0, time: 1, data: { content: [{ type: 'text', text: long }] } }],
        { createdAt: 0, cwd: '/home/alice' },
      ),
      { projectPath: 'p', filePath: 'f' },
    )

    expect(parsed.title).toBe('x'.repeat(80) + '...')
    expect(parsed.workDir).toBe('/home/alice')
  })

  test('leaves workDir null when the header has no cwd and skips blank text', () => {
    const parsed = projectSessionToTranscript(
      session([{ type: 'user/message', seq: 0, time: 1, data: { content: [{ type: 'text', text: '   ' }] } }]),
      { projectPath: 'p', filePath: 'f' },
    )

    expect(parsed.workDir).toBeNull()
    expect(parsed.title).toBe('s1')
    expect(parsed.messages).toEqual([])
  })

  test('stamps the last event time and falls back to header time when empty', () => {
    const parsed = projectSessionToTranscript(
      session([], { createdAt: 1_700_000_000_000 }),
      { projectPath: 'p', filePath: 'f' },
    )

    expect(parsed.messages).toEqual([])
    expect(parsed.createdAt).toBe('2023-11-14T22:13:20.000Z')
    expect(parsed.modifiedAt).toBe('2023-11-14T22:13:20.000Z')
    expect(parsed.fileMtimeMs).toBe(1_700_000_000_000)
    expect(parsed.fileSize).toBe(0)
  })
})
