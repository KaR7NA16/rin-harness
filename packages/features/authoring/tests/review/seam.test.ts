/**
 * rin review — seam projection tests against a fake structural seam.
 *
 * Asserts the ReviewCore registers the `review_artifact` tool and the
 * `/review` / `/security-review` commands, that the tool drives the fake
 * llm seam with the expected route/prompt per lens and shapes the output,
 * that the command handlers return the review, and that dispose removes every
 * registration. No Cordis, no dsh-tools.
 *
 * @module @rin/authoring/review
 */

import { describe, expect, test } from 'vitest'
import { REVIEW_SYSTEM_PROMPT_SECURITY, ReviewCore, resolveReviewConfig } from '../../src/review/core.ts'
import type {
  ReviewCommand,
  ReviewLlmChunk,
  ReviewLlmRequest,
  ReviewSeam,
  ReviewTool,
  ReviewToolResult,
} from '../../src/review/types.ts'

const FIXED_CHUNKS: ReviewLlmChunk[] = [
  { type: 'text-delta', text: '## Summary\n' },
  { type: 'text-delta', text: 'No critical issues' },
  { type: 'finish', reason: { kind: 'stop' } },
]

function makeSeam(chunks: ReviewLlmChunk[] = FIXED_CHUNKS) {
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
  return { seam, tools, commands, effects, calls }
}

describe('ReviewCore registration', () => {
  test('registers the review_artifact tool, both commands, and one disposal effect', () => {
    const { seam, tools, commands, effects } = makeSeam()
    const core = new ReviewCore(seam, resolveReviewConfig(undefined))
    expect(tools.map(tool => tool.name)).toEqual(['review_artifact'])
    expect(commands.map(command => command.name).sort()).toEqual(['review', 'security-review'])
    expect(effects).toHaveLength(1)
    core.dispose()
  })

  test('dispose removes every registration and is idempotent', () => {
    const { seam, tools, commands } = makeSeam()
    const core = new ReviewCore(seam, resolveReviewConfig(undefined))
    core.dispose()
    core.dispose()
    expect(tools).toEqual([])
    expect(commands).toEqual([])
  })
})

describe('review_artifact tool', () => {
  test('drives the fake llm with the general lens and shapes the output', async () => {
    const { seam, tools, calls } = makeSeam()
    const core = new ReviewCore(seam, resolveReviewConfig(undefined))
    const tool = tools.find(item => item.name === 'review_artifact')
    if (!tool) throw new Error('review_artifact tool not registered')

    const result = (await tool.execute({ text: 'const x = 1' }, { signal: new AbortController().signal })) as ReviewToolResult
    expect(result.markdown).toBe('## Summary\nNo critical issues')
    expect(result.kind).toBe('general')
    expect(result.truncated).toBe(false)

    expect(calls).toHaveLength(1)
    const call = calls[0]!
    expect(call.provider).toBe('fake-provider')
    expect(call.model).toBe('deepseek-v4-flash')
    expect(call.system).toContain('code and artifact reviewer')
    expect(call.prompt).toContain('Artifact to review (kind: general)')
    expect(call.prompt).toContain('const x = 1')
    core.dispose()
  })

  test('uses the security lens when kind is security', async () => {
    const { seam, tools, calls } = makeSeam()
    const core = new ReviewCore(seam, resolveReviewConfig(undefined))
    const tool = tools.find(item => item.name === 'review_artifact')!
    const result = (await tool.execute({ text: 'eval(input)', kind: 'security' }, { signal: new AbortController().signal })) as ReviewToolResult
    expect(result.kind).toBe('security')
    expect(calls[0]!.system).toBe(REVIEW_SYSTEM_PROMPT_SECURITY)
    expect(calls[0]!.prompt).toContain('Artifact to review (kind: security)')
    core.dispose()
  })

  test('rejects a blank artifact text', async () => {
    const { seam, tools } = makeSeam()
    const core = new ReviewCore(seam, resolveReviewConfig(undefined))
    const tool = tools.find(item => item.name === 'review_artifact')!
    await expect(tool.execute({ text: '   ' }, { signal: new AbortController().signal }))
      .rejects.toThrow(/text is required and must not be blank/)
    core.dispose()
  })

  test('render projects the markdown as text', async () => {
    const { seam, tools } = makeSeam()
    const core = new ReviewCore(seam, resolveReviewConfig(undefined))
    const tool = tools.find(item => item.name === 'review_artifact')!
    const result = await tool.execute({ text: 'x' }, { signal: new AbortController().signal })
    expect(tool.output.render({}, result)).toEqual([{ type: 'text', text: '## Summary\nNo critical issues' }])
    core.dispose()
  })
})

describe('/review and /security-review commands', () => {
  test('/review returns the general-lens review', async () => {
    const { seam, commands, calls } = makeSeam()
    const core = new ReviewCore(seam, resolveReviewConfig(undefined))
    const command = commands.find(item => item.name === 'review')
    if (!command) throw new Error('/review command not registered')

    const outcome = await command.handler({ rawInput: 'const x = 1', signal: new AbortController().signal })
    expect(outcome).toEqual({ kind: 'success', text: '## Summary\nNo critical issues' })
    expect(calls[0]!.system).toContain('code and artifact reviewer')
    core.dispose()
  })

  test('/security-review uses the security lens', async () => {
    const { seam, commands, calls } = makeSeam()
    const core = new ReviewCore(seam, resolveReviewConfig(undefined))
    const command = commands.find(item => item.name === 'security-review')
    if (!command) throw new Error('/security-review command not registered')

    const outcome = await command.handler({ rawInput: 'eval(input)', signal: new AbortController().signal })
    expect(outcome.kind).toBe('success')
    expect(calls[0]!.system).toBe(REVIEW_SYSTEM_PROMPT_SECURITY)
    core.dispose()
  })

  test('commands report a missing artifact as an error result', async () => {
    const { seam, commands } = makeSeam()
    const core = new ReviewCore(seam, resolveReviewConfig(undefined))
    const review = commands.find(item => item.name === 'review')!
    const security = commands.find(item => item.name === 'security-review')!
    const general = await review.handler({ rawInput: '  ', signal: new AbortController().signal })
    const secured = await security.handler({ rawInput: '', signal: new AbortController().signal })
    expect(general.kind).toBe('error')
    expect((general as { text: string }).text).toContain('after /review')
    expect(secured.kind).toBe('error')
    expect((secured as { text: string }).text).toContain('after /security-review')
    core.dispose()
  })

  test('handlers report generation failures as an error result', async () => {
    const { seam, commands } = makeSeam([{ type: 'finish', reason: { kind: 'error', failure: { message: 'upstream 500' } } }])
    const core = new ReviewCore(seam, resolveReviewConfig(undefined))
    const command = commands.find(item => item.name === 'review')!
    const outcome = await command.handler({ rawInput: 'x', signal: new AbortController().signal })
    expect(outcome.kind).toBe('error')
    expect((outcome as { text: string }).text).toContain('upstream 500')
    core.dispose()
  })
});
