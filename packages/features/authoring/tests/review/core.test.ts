/**
 * rin review — dependency-free core tests.
 *
 * Covers config resolution, review prompt building for both lenses, byte
 * bounding, route resolution, lens normalization, and LLM-driven review
 * generation against a fake structural llm seam. No Cordis, no dsh-tools —
 * only node builtins.
 *
 * @module @rin/authoring/review
 */

import { describe, expect, test } from 'vitest'
import {
  DEFAULT_REVIEW_MAX_INPUT_BYTES,
  DEFAULT_REVIEW_MAX_OUTPUT_TOKENS,
  DEFAULT_REVIEW_MAX_RESULT_BYTES,
  DEFAULT_REVIEW_MODEL,
  REVIEW_SYSTEM_PROMPT_GENERAL,
  REVIEW_SYSTEM_PROMPT_SECURITY,
  boundUtf8Bytes,
  buildReviewPrompt,
  generateReview,
  normalizeReviewKind,
  resolveReviewConfig,
  resolveReviewLlmRoute,
  reviewSystemPrompt,
  shapeReviewResult,
} from '../../src/review/core.ts'
import type {
  ReviewLlmChunk,
  ReviewLlmRequest,
  ReviewLlmSeam,
} from '../../src/review/types.ts'

describe('resolveReviewConfig', () => {
  test('materializes every default', () => {
    const config = resolveReviewConfig(undefined)
    expect(config.maxInputBytes).toBe(DEFAULT_REVIEW_MAX_INPUT_BYTES)
    expect(config.maxResultBytes).toBe(DEFAULT_REVIEW_MAX_RESULT_BYTES)
    expect(config.maxOutputTokens).toBe(DEFAULT_REVIEW_MAX_OUTPUT_TOKENS)
    expect(config.provider).toBeUndefined()
    expect(config.model).toBeUndefined()
  })

  test('honors explicit values', () => {
    const config = resolveReviewConfig({ provider: 'p', model: 'm', maxInputBytes: 1024, maxResultBytes: 2048, maxOutputTokens: 512 })
    expect(config).toEqual({ provider: 'p', model: 'm', maxInputBytes: 1024, maxResultBytes: 2048, maxOutputTokens: 512 })
  })

  test('rejects a provider without a model and vice versa', () => {
    expect(() => resolveReviewConfig({ provider: 'p' })).toThrow(/provider and model must be configured together/)
    expect(() => resolveReviewConfig({ model: 'm' })).toThrow(/provider and model must be configured together/)
  })

  test('rejects non-positive policy fields', () => {
    expect(() => resolveReviewConfig({ maxResultBytes: 0 })).toThrow(/maxResultBytes must be a positive safe integer/)
    expect(() => resolveReviewConfig({ maxOutputTokens: 1.5 })).toThrow(/maxOutputTokens must be a positive safe integer/)
  })
})

describe('reviewSystemPrompt', () => {
  test('selects the general lens by default', () => {
    expect(reviewSystemPrompt('general')).toBe(REVIEW_SYSTEM_PROMPT_GENERAL)
    expect(REVIEW_SYSTEM_PROMPT_GENERAL).toContain('## Summary')
    expect(REVIEW_SYSTEM_PROMPT_GENERAL).toContain('### Critical')
  })

  test('selects the security lens explicitly', () => {
    expect(reviewSystemPrompt('security')).toBe(REVIEW_SYSTEM_PROMPT_SECURITY)
    expect(REVIEW_SYSTEM_PROMPT_SECURITY).toContain('security-focused reviewer')
    expect(REVIEW_SYSTEM_PROMPT_SECURITY).toContain('injection')
    expect(REVIEW_SYSTEM_PROMPT_SECURITY).toContain('secrets')
  })
})

describe('normalizeReviewKind', () => {
  test('maps unknown values to general', () => {
    expect(normalizeReviewKind(undefined)).toBe('general')
    expect(normalizeReviewKind('nope')).toBe('general')
    expect(normalizeReviewKind('security')).toBe('security')
    expect(normalizeReviewKind('general')).toBe('general')
  })
})

describe('buildReviewPrompt', () => {
  test('frames the artifact with its kind', () => {
    const config = resolveReviewConfig(undefined)
    expect(buildReviewPrompt('const x = 1', 'general', config)).toBe('Artifact to review (kind: general):\nconst x = 1')
  })

  test('bounds the artifact text to maxInputBytes', () => {
    const config = resolveReviewConfig({ maxInputBytes: 64 })
    const prompt = buildReviewPrompt('y'.repeat(400), 'security', config)
    expect(prompt).toContain('… (artifact truncated)')
    expect(Buffer.byteLength(prompt, 'utf8')).toBeLessThanOrEqual(1024)
  })
})

describe('boundUtf8Bytes', () => {
  test('passes text through unchanged within the limit', () => {
    expect(boundUtf8Bytes('hello', 1024)).toEqual({ text: 'hello', truncated: false })
  })

  test('truncates oversized text within the limit and appends the marker', () => {
    const bounded = boundUtf8Bytes('x'.repeat(500), 128)
    expect(bounded.truncated).toBe(true)
    expect(Buffer.byteLength(bounded.text, 'utf8')).toBeLessThanOrEqual(128)
    expect(bounded.text.endsWith('… (review truncated)')).toBe(true)
  })

  test('never splits a multibyte character', () => {
    const cjk = '早'.repeat(200)
    const bounded = boundUtf8Bytes(cjk, 100)
    expect(bounded.truncated).toBe(true)
    expect(Buffer.byteLength(bounded.text, 'utf8')).toBeLessThanOrEqual(100)
  })

  test('drops the marker when it cannot fit a tiny limit', () => {
    const bounded = boundUtf8Bytes('abcdefghij', 8)
    expect(bounded.truncated).toBe(true)
    expect(bounded.text).not.toContain('truncated')
    expect(Buffer.byteLength(bounded.text, 'utf8')).toBeLessThanOrEqual(8)
  })
})

describe('resolveReviewLlmRoute', () => {
  test('picks the first registered provider with the default model', () => {
    const llm: ReviewLlmSeam = { listProviders: () => [{ id: 'first', name: 'First' }], stream: () => [] }
    expect(resolveReviewLlmRoute(llm, resolveReviewConfig(undefined))).toEqual({ provider: 'first', model: DEFAULT_REVIEW_MODEL })
  })

  test('an explicit provider/model pair wins', () => {
    const llm: ReviewLlmSeam = { listProviders: () => [{ id: 'first', name: 'First' }], stream: () => [] }
    const config = resolveReviewConfig({ provider: 'custom', model: 'custom-model' })
    expect(resolveReviewLlmRoute(llm, config)).toEqual({ provider: 'custom', model: 'custom-model' })
  })

  test('fails loud without any registered provider', () => {
    const llm: ReviewLlmSeam = { listProviders: () => [], stream: () => [] }
    expect(() => resolveReviewLlmRoute(llm, resolveReviewConfig(undefined))).toThrow(/no llm provider registered/)
  })
})

function fakeLlm(chunks: ReviewLlmChunk[]): { llm: ReviewLlmSeam; calls: ReviewLlmRequest[] } {
  const calls: ReviewLlmRequest[] = []
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

describe('generateReview', () => {
  test('joins text deltas and preserves the kind', async () => {
    const { llm, calls } = fakeLlm([
      { type: 'text-delta', text: '## Summary\n' },
      { type: 'text-delta', text: 'Looks fine' },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    const result = await generateReview(llm, resolveReviewConfig(undefined), { text: 'const x = 1', kind: 'general' })
    expect(result.markdown).toBe('## Summary\nLooks fine')
    expect(result.kind).toBe('general')
    expect(result.truncated).toBe(false)
    expect(calls).toHaveLength(1)
    const call = calls[0]!
    expect(call.provider).toBe('fake-provider')
    expect(call.model).toBe(DEFAULT_REVIEW_MODEL)
    expect(call.system).toBe(REVIEW_SYSTEM_PROMPT_GENERAL)
    expect(call.maxTokens).toBe(DEFAULT_REVIEW_MAX_OUTPUT_TOKENS)
    expect(call.prompt).toContain('Artifact to review (kind: general)')
    expect(call.prompt).toContain('const x = 1')
  })

  test('uses the security system prompt for the security lens', async () => {
    const { llm, calls } = fakeLlm([{ type: 'text-delta', text: '## Summary' }, { type: 'finish', reason: { kind: 'stop' } }])
    const result = await generateReview(llm, resolveReviewConfig(undefined), { text: 'eval(input)', kind: 'security' })
    expect(result.kind).toBe('security')
    expect(calls[0]!.system).toBe(REVIEW_SYSTEM_PROMPT_SECURITY)
  })

  test('surfaces the finish failure', async () => {
    const { llm } = fakeLlm([{ type: 'finish', reason: { kind: 'error', failure: { message: 'upstream 500' } } }])
    await expect(generateReview(llm, resolveReviewConfig(undefined), { text: 'x', kind: 'general' }))
      .rejects.toThrow(/llm call failed: upstream 500/)
  })

  test('fails loud when the model produces no text', async () => {
    const { llm } = fakeLlm([{ type: 'finish', reason: { kind: 'stop' } }])
    await expect(generateReview(llm, resolveReviewConfig(undefined), { text: 'x', kind: 'general' }))
      .rejects.toThrow(/no review text/)
  })

  test('bounds oversized model output', async () => {
    const { llm } = fakeLlm([
      { type: 'text-delta', text: 'x'.repeat(2000) },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    const result = await generateReview(llm, resolveReviewConfig({ maxResultBytes: 256 }), { text: 'x', kind: 'general' })
    expect(result.truncated).toBe(true)
    expect(Buffer.byteLength(result.markdown, 'utf8')).toBeLessThanOrEqual(256)
  })
})

describe('shapeReviewResult', () => {
  test('trims surrounding whitespace and keeps the kind', () => {
    const config = resolveReviewConfig(undefined)
    expect(shapeReviewResult('  ## Summary\n  ', 'security', config)).toEqual({
      markdown: '## Summary',
      kind: 'security',
      truncated: false,
    })
  })

  test('throws on empty output', () => {
    const config = resolveReviewConfig(undefined)
    expect(() => shapeReviewResult('   ', 'general', config)).toThrow(/no review text/)
  })
});
