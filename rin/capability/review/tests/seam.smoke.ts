/**
 * rin review — strip-types smoke test for the seam projection.
 *
 * Run from the package directory:
 *
 *   node --experimental-strip-types tests/seam.smoke.ts
 *
 * @module @rin/review
 */

import { REVIEW_SYSTEM_PROMPT_SECURITY, ReviewCore, resolveReviewConfig } from '../src/core.ts'
import type {
  ReviewCommand,
  ReviewLlmChunk,
  ReviewLlmRequest,
  ReviewSeam,
  ReviewTool,
  ReviewToolResult,
} from '../src/types.ts'

const chunks: ReviewLlmChunk[] = [
  { type: 'text-delta', text: '## Summary\nNo critical issues' },
  { type: 'finish', reason: { kind: 'stop' } },
]

const tools: ReviewTool[] = []
const commands: ReviewCommand[] = []
const effects: Array<() => void> = []
const calls: ReviewLlmRequest[] = []
const seam: ReviewSeam = {
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

const core = new ReviewCore(seam, resolveReviewConfig(undefined))

if (tools.map(tool => tool.name).join(',') !== 'review_artifact') throw new Error('review_artifact tool not registered')
if (commands.map(command => command.name).sort().join(',') !== 'review,security-review') throw new Error('review commands not registered')
if (effects.length !== 1) throw new Error('expected one disposal effect, got ' + effects.length)

const tool = tools[0]
if (!tool) throw new Error('review_artifact tool missing')
const result = await tool.execute({ text: 'const x = 1' }, { signal: new AbortController().signal }) as ReviewToolResult
if (result.markdown !== '## Summary\nNo critical issues') throw new Error('unexpected review: ' + JSON.stringify(result.markdown))
if (result.kind !== 'general') throw new Error('unexpected kind: ' + result.kind)
if (result.truncated !== false) throw new Error('unexpected truncated flag')
if (calls.length !== 1) throw new Error('expected one llm call')
if (calls[0].provider !== 'fake-provider') throw new Error('wrong provider: ' + calls[0].provider)

const security = await tool.execute({ text: 'eval(input)', kind: 'security' }, { signal: new AbortController().signal }) as ReviewToolResult
if (security.kind !== 'security') throw new Error('security kind not honored')
if (calls[1].system !== REVIEW_SYSTEM_PROMPT_SECURITY) throw new Error('security system prompt not used')

const reviewCommand = commands.find(command => command.name === 'review')
if (!reviewCommand) throw new Error('/review command missing')
const outcome = await reviewCommand.handler({ rawInput: 'x', signal: new AbortController().signal })
if (outcome.kind !== 'success' || outcome.text !== '## Summary\nNo critical issues') {
  throw new Error('unexpected command outcome: ' + JSON.stringify(outcome))
}

core.dispose()
if (tools.length !== 0 || commands.length !== 0) throw new Error('dispose did not remove registrations')

console.log('REVIEW-SEAM-SMOKE-OK', { calls: calls.length, kinds: [result.kind, security.kind] })
