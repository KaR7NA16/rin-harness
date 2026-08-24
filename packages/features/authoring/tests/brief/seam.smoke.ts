/**
 * rin brief — strip-types smoke test for the seam projection.
 *
 * Run from the package directory:
 *
 *   node --experimental-strip-types tests/seam.smoke.ts
 *
 * @module @rin/authoring/brief
 */

import { BriefCore, resolveBriefConfig } from '../../src/brief/core.ts'
import type {
  BriefCommand,
  BriefEvent,
  BriefLlmChunk,
  BriefLlmRequest,
  BriefSeam,
  BriefTool,
  BriefToolResult,
} from '../../src/brief/types.ts'

function events(): BriefEvent[] {
  return [
    { type: 'user/message', seq: 1, time: 1_700_000_001_000, data: { content: [{ type: 'text', text: 'Fix the retry bug' }] } },
    { type: 'assistant/message', seq: 2, time: 1_700_000_002_000, data: { message: { content: [{ type: 'text', text: 'Inspecting the queue' }] } } },
    { type: 'tool/call', seq: 3, time: 1_700_000_003_000, data: { name: 'bash', arguments: '{"command":"ls"}' } },
    { type: 'tool/result', seq: 4, time: 1_700_000_004_000, data: { message: { content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'queue.ts' }] }] } } },
  ]
}

const chunks: BriefLlmChunk[] = [
  { type: 'text-delta', text: '## Goal\nFix the retry bug' },
  { type: 'finish', reason: { kind: 'stop' } },
]

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

const core = new BriefCore(seam, resolveBriefConfig(undefined))

if (tools.map(tool => tool.name).join(',') !== 'brief') throw new Error('brief tool not registered')
if (commands.map(command => command.name).join(',') !== 'brief') throw new Error('/brief command not registered')
if (effects.length !== 1) throw new Error('expected one disposal effect, got ' + effects.length)

const tool = tools[0]
if (!tool) throw new Error('brief tool missing')
const result = await tool.execute({}, { agent: { session: { events: events() } }, signal: new AbortController().signal }) as BriefToolResult
if (result.markdown !== '## Goal\nFix the retry bug') throw new Error('unexpected brief: ' + JSON.stringify(result.markdown))
if (result.eventCount !== 4) throw new Error('unexpected eventCount: ' + result.eventCount)
if (result.truncated !== false) throw new Error('unexpected truncated flag')
if (calls.length !== 1) throw new Error('expected one llm call')
if (calls[0].provider !== 'fake-provider') throw new Error('wrong provider: ' + calls[0].provider)
if (!calls[0].prompt.includes('Fix the retry bug')) throw new Error('prompt missing transcript text')

const command = commands[0]
if (!command) throw new Error('/brief command missing')
const outcome = await command.handler({ agent: { session: { events: events() } }, rawInput: '', signal: new AbortController().signal })
if (outcome.kind !== 'success' || outcome.text !== '## Goal\nFix the retry bug') {
  throw new Error('unexpected command outcome: ' + JSON.stringify(outcome))
}

core.dispose()
if (tools.length !== 0 || commands.length !== 0) throw new Error('dispose did not remove registrations')

console.log('BRIEF-SEAM-SMOKE-OK', { calls: calls.length, eventCount: result.eventCount })
