/**
 * rin brief — seam projection tests against a fake structural seam.
 *
 * Asserts the BriefCore registers the `brief` tool and the `/brief` command,
 * that the tool drives the fake llm seam with the expected route/prompt and
 * shapes the output, that the command handler returns the brief, and that
 * dispose removes every registration. No Cordis, no dsh-tools.
 *
 * @module @rin/authoring/brief
 */

import { describe, expect, test } from 'vitest'
import { BRIEF_SYSTEM_PROMPT, BriefCore, resolveBriefConfig } from '../../src/brief/core.ts'
import type {
  BriefCommand,
  BriefEvent,
  BriefLlmChunk,
  BriefLlmRequest,
  BriefSeam,
  BriefTool,
  BriefToolResult,
} from '../../src/brief/types.ts'

function makeEvents(): BriefEvent[] {
  return [
    { type: 'turn/start', seq: 0, time: 1_700_000_000_000, data: { turn: 1 } },
    { type: 'user/message', seq: 1, time: 1_700_000_001_000, data: { content: [{ type: 'text', text: 'Fix the retry bug' }] } },
    { type: 'assistant/message', seq: 2, time: 1_700_000_002_000, data: { message: { content: [{ type: 'text', text: 'Inspecting the queue' }] } } },
    { type: 'tool/call', seq: 3, time: 1_700_000_003_000, data: { name: 'bash', arguments: '{"command":"ls"}' } },
    { type: 'tool/result', seq: 4, time: 1_700_000_004_000, data: { message: { content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'queue.ts' }] }] } } },
    { type: 'turn/end', seq: 5, time: 1_700_000_005_000, data: { turn: 1, reason: { kind: 'stop' } } },
  ]
}

const FIXED_CHUNKS: BriefLlmChunk[] = [
  { type: 'text-delta', text: '## Goal\n' },
  { type: 'text-delta', text: 'Fix the retry bug' },
  { type: 'finish', reason: { kind: 'stop' } },
]

function makeSeam(chunks: BriefLlmChunk[] = FIXED_CHUNKS) {
  const tools: BriefTool[] = []
  const commands: BriefCommand[] = []
  const effects: Array<() => void> = []
  const calls: BriefLlmRequest[] = []
  const seam: BriefSeam = {
    tools: {
      register(tool) {
        tools.push(tool)
        return () => {
          const at = tools.indexOf(tool)
          if (at >= 0) tools.splice(at, 1)
        }
      },
    },
    commands: {
      register(command) {
        commands.push(command)
        return () => {
          const at = commands.indexOf(command)
          if (at >= 0) commands.splice(at, 1)
        }
      },
    },
    llm: {
      listProviders: () => [{ id: 'fake-provider', name: 'Fake' }],
      async *stream(request) {
        calls.push(request)
        for (const chunk of chunks) yield chunk
      },
    },
    effect(disposer) {
      effects.push(disposer)
    },
  }
  return { seam, tools, commands, effects, calls }
}

function exec() {
  return { agent: { session: { events: makeEvents() } }, signal: new AbortController().signal }
}

function invocation(rawInput = '') {
  return { agent: { session: { events: makeEvents() } }, rawInput, signal: new AbortController().signal }
}

describe('BriefCore registration', () => {
  test('registers the brief tool, the /brief command, and one disposal effect', () => {
    const { seam, tools, commands, effects } = makeSeam()
    const core = new BriefCore(seam, resolveBriefConfig(undefined))
    expect(tools.map(tool => tool.name)).toEqual(['brief'])
    expect(commands.map(command => command.name)).toEqual(['brief'])
    expect(effects).toHaveLength(1)
    core.dispose()
  })

  test('dispose removes every registration and is idempotent', () => {
    const { seam, tools, commands } = makeSeam()
    const core = new BriefCore(seam, resolveBriefConfig(undefined))
    core.dispose()
    core.dispose()
    expect(tools).toEqual([])
    expect(commands).toEqual([])
  })
})

describe('brief tool', () => {
  test('drives the fake llm and shapes the output', async () => {
    const { seam, tools, calls } = makeSeam()
    const core = new BriefCore(seam, resolveBriefConfig(undefined))
    const tool = tools.find(item => item.name === 'brief')
    if (!tool) throw new Error('brief tool not registered')

    const result = (await tool.execute({}, exec())) as BriefToolResult
    expect(result.markdown).toBe('## Goal\nFix the retry bug')
    expect(result.eventCount).toBe(4)
    expect(result.truncated).toBe(false)

    expect(calls).toHaveLength(1)
    const call = calls[0]!
    expect(call.provider).toBe('fake-provider')
    expect(call.model).toBe('deepseek-v4-flash')
    expect(call.system).toBe(BRIEF_SYSTEM_PROMPT)
    expect(call.maxTokens).toBe(2048)
    expect(call.prompt).toContain('Fix the retry bug')
    expect(call.prompt).toContain('queue.ts')
    core.dispose()
  })

  test('passes the focus argument into the prompt', async () => {
    const { seam, tools, calls } = makeSeam()
    const core = new BriefCore(seam, resolveBriefConfig(undefined))
    const tool = tools.find(item => item.name === 'brief')!
    await tool.execute({ focus: 'the database' }, exec())
    expect(calls[0]!.prompt).toContain('Focus this brief on: the database')
    core.dispose()
  })

  test('fails loud without an initiating agent', async () => {
    const { seam, tools } = makeSeam()
    const core = new BriefCore(seam, resolveBriefConfig(undefined))
    const tool = tools.find(item => item.name === 'brief')!
    await expect(tool.execute({}, { signal: new AbortController().signal }))
      .rejects.toThrow(/requires an initiating agent/)
    core.dispose()
  })

  test('render projects the markdown as text', async () => {
    const { seam, tools } = makeSeam()
    const core = new BriefCore(seam, resolveBriefConfig(undefined))
    const tool = tools.find(item => item.name === 'brief')!
    const result = await tool.execute({}, exec())
    const rendered = tool.output.render({}, result)
    expect(rendered).toEqual([{ type: 'text', text: '## Goal\nFix the retry bug' }])
    core.dispose()
  })
})

describe('/brief command', () => {
  test('handler returns the generated brief as a success result', async () => {
    const { seam, commands, calls } = makeSeam()
    const core = new BriefCore(seam, resolveBriefConfig(undefined))
    const command = commands.find(item => item.name === 'brief')
    if (!command) throw new Error('/brief command not registered')

    const outcome = await command.handler(invocation('focus on tests'))
    expect(outcome).toEqual({ kind: 'success', text: '## Goal\nFix the retry bug' })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.prompt).toContain('Focus this brief on: focus on tests')
    core.dispose()
  })

  test('handler reports generation failures as an error result', async () => {
    const { seam, commands } = makeSeam([{ type: 'finish', reason: { kind: 'error', failure: { message: 'upstream 500' } } }])
    const core = new BriefCore(seam, resolveBriefConfig(undefined))
    const command = commands.find(item => item.name === 'brief')!
    const outcome = await command.handler(invocation())
    expect(outcome.kind).toBe('error')
    expect((outcome as { text: string }).text).toContain('upstream 500')
    core.dispose()
  })
});
