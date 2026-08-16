/**
 * rin brief — dependency-free core tests.
 *
 * Covers config resolution, session-event trimming and transcript rendering,
 * prompt building, byte bounding, route resolution, and LLM-driven brief
 * generation against a fake structural llm seam. No Cordis, no dsh-tools —
 * only node builtins.
 *
 * @module @rin/brief
 */

import { describe, expect, test } from 'vitest'
import {
  BRIEF_SYSTEM_PROMPT,
  BRIEF_TRANSCRIPT_TRUNCATION_MARKER,
  DEFAULT_BRIEF_MAX_EVENTS,
  DEFAULT_BRIEF_MAX_INPUT_BYTES,
  DEFAULT_BRIEF_MAX_OUTPUT_TOKENS,
  DEFAULT_BRIEF_MAX_RESULT_BYTES,
  DEFAULT_BRIEF_MODEL,
  boundUtf8Bytes,
  buildBriefPrompt,
  generateBrief,
  renderSessionEvents,
  resolveBriefConfig,
  resolveBriefLlmRoute,
  shapeBriefResult,
  trimSessionEvents,
} from '../src/core.ts'
import type {
  BriefEvent,
  BriefLlmChunk,
  BriefLlmRequest,
  BriefLlmSeam,
} from '../src/types.ts'

function event(type: string, seq: number, data: unknown, time = 1_700_000_000_000 + seq * 1000): BriefEvent {
  return { type, seq, time, data }
}

function surfaceEvents(): BriefEvent[] {
  return [
    event('turn/start', 0, { turn: 1 }),
    event('user/message', 1, { content: [{ type: 'text', text: 'Fix the payment retry bug' }] }),
    event('assistant/message', 2, { message: { content: [{ type: 'text', text: 'Inspecting the retry queue' }] } }),
    event('tool/call', 3, { name: 'bash', arguments: '{"command":"ls"}' }),
    event('tool/result', 4, { message: { content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'queue.ts' }] }] } }),
    event('turn/end', 5, { turn: 1, reason: { kind: 'stop' } }),
  ]
}

describe('resolveBriefConfig', () => {
  test('materializes every default', () => {
    const config = resolveBriefConfig(undefined)
    expect(config.maxEvents).toBe(DEFAULT_BRIEF_MAX_EVENTS)
    expect(config.maxInputBytes).toBe(DEFAULT_BRIEF_MAX_INPUT_BYTES)
    expect(config.maxResultBytes).toBe(DEFAULT_BRIEF_MAX_RESULT_BYTES)
    expect(config.maxOutputTokens).toBe(DEFAULT_BRIEF_MAX_OUTPUT_TOKENS)
    expect(config.provider).toBeUndefined()
    expect(config.model).toBeUndefined()
  })

  test('honors explicit values', () => {
    const config = resolveBriefConfig({
      provider: 'p',
      model: 'm',
      maxEvents: 42,
      maxInputBytes: 1024,
      maxResultBytes: 2048,
      maxOutputTokens: 512,
    })
    expect(config).toEqual({
      provider: 'p',
      model: 'm',
      maxEvents: 42,
      maxInputBytes: 1024,
      maxResultBytes: 2048,
      maxOutputTokens: 512,
    })
  })

  test('rejects a provider without a model and vice versa', () => {
    expect(() => resolveBriefConfig({ provider: 'p' })).toThrow(/provider and model must be configured together/)
    expect(() => resolveBriefConfig({ model: 'm' })).toThrow(/provider and model must be configured together/)
  })

  test('rejects non-positive policy fields', () => {
    expect(() => resolveBriefConfig({ maxEvents: 0 })).toThrow(/maxEvents must be a positive safe integer/)
    expect(() => resolveBriefConfig({ maxEvents: 1.5 })).toThrow(/maxEvents must be a positive safe integer/)
    expect(() => resolveBriefConfig({ maxResultBytes: -1 })).toThrow(/maxResultBytes must be a positive safe integer/)
  })
})

describe('trimSessionEvents', () => {
  test('drops log-only events and keeps the surface window', () => {
    const config = resolveBriefConfig(undefined)
    const trimmed = trimSessionEvents(surfaceEvents(), config)
    expect(trimmed.events.map(item => item.type)).toEqual([
      'user/message',
      'assistant/message',
      'tool/call',
      'tool/result',
    ])
    expect(trimmed.dropped).toBe(2)
  })

  test('caps the window at maxEvents and reports dropped', () => {
    const config = resolveBriefConfig({ maxEvents: 2 })
    const trimmed = trimSessionEvents(surfaceEvents(), config)
    expect(trimmed.events.map(item => item.type)).toEqual(['tool/call', 'tool/result'])
    expect(trimmed.dropped).toBe(4)
  })

  test('handles an empty log', () => {
    const config = resolveBriefConfig(undefined)
    const trimmed = trimSessionEvents([], config)
    expect(trimmed.events).toEqual([])
    expect(trimmed.dropped).toBe(0)
  })
})

describe('renderSessionEvents', () => {
  test('renders user/assistant/tool events into a compact transcript', () => {
    const rendered = renderSessionEvents(surfaceEvents().slice(1, 5))
    expect(rendered).toMatch(/\[\d{2}:\d{2}:\d{2}\] user\nFix the payment retry bug/)
    expect(rendered).toMatch(/\[\d{2}:\d{2}:\d{2}\] assistant\nInspecting the retry queue/)
    expect(rendered).toMatch(/\[\d{2}:\d{2}:\d{2}\] tool call bash\n\{"command":"ls"\}/)
    expect(rendered).toMatch(/\[\d{2}:\d{2}:\d{2}\] tool result\nqueue.ts/)
  })

  test('marks failed tool results and skips unknown event types', () => {
    const rendered = renderSessionEvents([
      event('tool/result', 1, { message: { content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'boom' }] }] }, error: { name: 'E', code: 'X' } }),
      event('unknown/thing', 2, { whatever: true }),
    ])
    expect(rendered).toMatch(/\[\d{2}:\d{2}:\d{2}\] tool result \(error\)\nboom/)
    expect(rendered).not.toContain('unknown/thing')
  })

  test('accepts string content and empty payloads', () => {
    const rendered = renderSessionEvents([
      event('user/message', 1, { content: 'plain string' }),
      event('assistant/message', 2, { message: { content: [] } }),
    ])
    expect(rendered).toContain('plain string')
    expect(rendered).toMatch(/\[\d{2}:\d{2}:\d{2}\] assistant/)
  })
})

describe('boundUtf8Bytes', () => {
  test('passes text through unchanged within the limit', () => {
    expect(boundUtf8Bytes('hello', 1024)).toEqual({ text: 'hello', truncated: false })
  })

  test('keeps text at an exact byte limit untruncated', () => {
    const text = 'a'.repeat(100)
    expect(boundUtf8Bytes(text, 100)).toEqual({ text, truncated: false })
  })

  test('truncates oversized text within the limit and appends the marker', () => {
    const bounded = boundUtf8Bytes('x'.repeat(500), 128)
    expect(bounded.truncated).toBe(true)
    expect(Buffer.byteLength(bounded.text, 'utf8')).toBeLessThanOrEqual(128)
    expect(bounded.text.endsWith('… (brief truncated)')).toBe(true)
  })

  test('never splits a multibyte character', () => {
    const cjk = '早'.repeat(200)
    const bounded = boundUtf8Bytes(cjk, 100)
    expect(bounded.truncated).toBe(true)
    expect(Buffer.byteLength(bounded.text, 'utf8')).toBeLessThanOrEqual(100)
    // Every remaining code unit pairs into complete CJK characters or the marker.
    const body = bounded.text.replace('\n\n… (brief truncated)', '')
    expect([...body].every(char => /^[\u4e00-\u9fff]$/u.test(char))).toBe(true)
  })

  test('drops the marker when it cannot fit a tiny limit', () => {
    const bounded = boundUtf8Bytes('abcdefghij', 8)
    expect(bounded.truncated).toBe(true)
    expect(bounded.text).not.toContain('truncated')
    expect(Buffer.byteLength(bounded.text, 'utf8')).toBeLessThanOrEqual(8)
  })
})

describe('buildBriefPrompt', () => {
  test('includes the focus hint, window stats, and transcript', () => {
    const config = resolveBriefConfig(undefined)
    const prompt = buildBriefPrompt({
      transcript: 'the transcript',
      focus: 'the database',
      eventCount: 4,
      dropped: 2,
      config,
    })
    expect(prompt).toContain('Focus this brief on: the database')
    expect(prompt).toContain('most recent 4 session events (2 earlier events omitted)')
    expect(prompt).toContain('the transcript')
  })

  test('omits the focus line when absent', () => {
    const config = resolveBriefConfig(undefined)
    const prompt = buildBriefPrompt({ transcript: 't', eventCount: 1, dropped: 0, config })
    expect(prompt).not.toContain('Focus this brief on')
    expect(prompt).not.toContain('omitted')
  })

  test('bounds the transcript to maxInputBytes', () => {
    const config = resolveBriefConfig({ maxInputBytes: 64 })
    const prompt = buildBriefPrompt({ transcript: 'y'.repeat(400), eventCount: 1, dropped: 0, config })
    expect(prompt).toContain(BRIEF_TRANSCRIPT_TRUNCATION_MARKER)
    expect(Buffer.byteLength(prompt, 'utf8')).toBeLessThanOrEqual(1024)
  })
})

describe('resolveBriefLlmRoute', () => {
  test('picks the first registered provider with the default model', () => {
    const llm: BriefLlmSeam = { listProviders: () => [{ id: 'first', name: 'First' }, { id: 'second', name: 'Second' }], stream: () => [] }
    const route = resolveBriefLlmRoute(llm, resolveBriefConfig(undefined))
    expect(route).toEqual({ provider: 'first', model: DEFAULT_BRIEF_MODEL })
  })

  test('an explicit provider/model pair wins', () => {
    const llm: BriefLlmSeam = { listProviders: () => [{ id: 'first', name: 'First' }], stream: () => [] }
    const config = resolveBriefConfig({ provider: 'custom', model: 'custom-model' })
    expect(resolveBriefLlmRoute(llm, config)).toEqual({ provider: 'custom', model: 'custom-model' })
  })

  test('fails loud without any registered provider', () => {
    const llm: BriefLlmSeam = { listProviders: () => [], stream: () => [] }
    expect(() => resolveBriefLlmRoute(llm, resolveBriefConfig(undefined))).toThrow(/no llm provider registered/)
  })
})

function fakeLlm(chunks: BriefLlmChunk[]): { llm: BriefLlmSeam; calls: BriefLlmRequest[] } {
  const calls: BriefLlmRequest[] = []
  return {
    calls,
    llm: {
      listProviders: () => [{ id: 'fake-provider', name: 'Fake' }],
      async *stream(request) {
        calls.push(request)
        for (const chunk of chunks) yield chunk
      },
    },
  }
}

describe('generateBrief', () => {
  test('joins text deltas and shapes the result from the surface window', async () => {
    const { llm, calls } = fakeLlm([
      { type: 'text-delta', text: '## Goal\n' },
      { type: 'text-delta', text: 'Fix the retry bug' },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    const result = await generateBrief(llm, resolveBriefConfig(undefined), { events: surfaceEvents() })
    expect(result.markdown).toBe('## Goal\nFix the retry bug')
    expect(result.eventCount).toBe(4)
    expect(result.truncated).toBe(false)
    expect(calls).toHaveLength(1)
    const call = calls[0]!
    expect(call.provider).toBe('fake-provider')
    expect(call.model).toBe(DEFAULT_BRIEF_MODEL)
    expect(call.system).toBe(BRIEF_SYSTEM_PROMPT)
    expect(call.maxTokens).toBe(DEFAULT_BRIEF_MAX_OUTPUT_TOKENS)
    expect(call.prompt).toContain('Fix the payment retry bug')
  })

  test('passes the focus hint into the prompt', async () => {
    const { llm, calls } = fakeLlm([{ type: 'text-delta', text: 'brief' }, { type: 'finish', reason: { kind: 'stop' } }])
    await generateBrief(llm, resolveBriefConfig(undefined), { events: surfaceEvents(), focus: 'the database' })
    expect(calls[0]!.prompt).toContain('Focus this brief on: the database')
  })

  test('surfaces the finish failure', async () => {
    const { llm } = fakeLlm([{ type: 'finish', reason: { kind: 'error', failure: { message: 'upstream 500' } } }])
    await expect(generateBrief(llm, resolveBriefConfig(undefined), { events: surfaceEvents() }))
      .rejects.toThrow(/llm call failed: upstream 500/)
  })

  test('fails loud when the model produces no text', async () => {
    const { llm } = fakeLlm([{ type: 'finish', reason: { kind: 'stop' } }])
    await expect(generateBrief(llm, resolveBriefConfig(undefined), { events: surfaceEvents() }))
      .rejects.toThrow(/no brief text/)
  })

  test('bounds oversized model output', async () => {
    const { llm } = fakeLlm([
      { type: 'text-delta', text: 'x'.repeat(2000) },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    const result = await generateBrief(llm, resolveBriefConfig({ maxResultBytes: 256 }), { events: surfaceEvents() })
    expect(result.truncated).toBe(true)
    expect(Buffer.byteLength(result.markdown, 'utf8')).toBeLessThanOrEqual(256)
  })
})

describe('shapeBriefResult', () => {
  test('trims surrounding whitespace', () => {
    const config = resolveBriefConfig(undefined)
    expect(shapeBriefResult('  ## Goal\n  ', config, 2).markdown).toBe('## Goal')
  })

  test('throws on empty output', () => {
    const config = resolveBriefConfig(undefined)
    expect(() => shapeBriefResult('   ', config, 0)).toThrow(/no brief text/)
  })
});
