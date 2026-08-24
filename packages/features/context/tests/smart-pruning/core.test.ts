/**
 * rin smart pruning — contract tests for the pruning core.
 *
 * These describe behavior, not correctness. They run under vitest in CI; the
 * sandbox cannot spawn vitest, so an equivalent strip-types smoke test is run
 * during development.
 *
 * @module @rin/context
 */

import { describe, expect, test } from 'vitest'
import {
  isSmartPruningLevel,
  pruneMessagesForAPI,
  SmartPruningService,
} from '../../src/smart-pruning/core.ts'

type Message = {
  type: string
  message: { content: unknown }
}

function assistantToolUse(id: string, name: string, input: unknown): Message {
  return {
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id, name, input }] },
  }
}

function userToolResult(id: string, text: string, isError = false): Message {
  return {
    type: 'user',
    message: {
      content: [{
        type: 'tool_result',
        tool_use_id: id,
        is_error: isError,
        content: [{ type: 'text', text }],
      }],
    },
  }
}

function filler(count: number): Message[] {
  return Array.from({ length: count }, () => ({ type: 'user', message: { content: [] } }))
}

const EMPTY_STATS = {
  prunedToolResults: 0,
  duplicateResults: 0,
  supersededReads: 0,
  truncatedResults: 0,
  savedCharacters: 0,
}

// Long enough that the omission marker is shorter than the source text.
const DUP_TEXT = 'the quick brown fox jumps over the lazy dog. '.repeat(8)
const OLD_READ = 'old version line. '.repeat(12)
const NEW_READ = 'new version line. '.repeat(12)

function duplicateFixture(): Message[] {
  return [
    assistantToolUse('call_1', 'Bash', { command: 'echo hi' }),
    userToolResult('call_1', DUP_TEXT),
    assistantToolUse('call_2', 'Bash', { command: 'echo hi' }),
    userToolResult('call_2', DUP_TEXT),
    ...filler(16),
  ]
}

describe('pruneMessagesForAPI', () => {
  test('deduplicates an older repeated tool result', () => {
    const { messages, stats } = pruneMessagesForAPI(duplicateFixture(), 'balanced')
    expect(stats.duplicateResults).toBe(1)
    expect(stats.prunedToolResults).toBe(1)
    expect(stats.savedCharacters).toBeGreaterThan(0)

    const block = (messages[1]!.message.content as Array<Record<string, unknown>>)[0]!
    expect(block.content as string).toContain('[Smart pruning: omitted older duplicate output')
    expect(block.content as string).toContain('; tool=Bash')

    const newer = (messages[3]!.message.content as Array<Record<string, unknown>>)[0]!
    expect(newer.content).toEqual([{ type: 'text', text: DUP_TEXT }])
  })

  test('omits an older read superseded by a newer read of the same path', () => {
    const messages = [
      assistantToolUse('read_2', 'Read', { file_path: 'docs.md' }),
      userToolResult('read_2', OLD_READ),
      assistantToolUse('read_1', 'Read', { file_path: 'docs.md' }),
      userToolResult('read_1', NEW_READ),
      ...filler(16),
    ]
    const { messages: out, stats } = pruneMessagesForAPI(messages, 'balanced')
    expect(stats.supersededReads).toBe(1)
    expect(stats.prunedToolResults).toBe(1)

    const block = (out[1]!.message.content as Array<Record<string, unknown>>)[0]!
    expect(block.content as string).toContain('[Smart pruning: omitted older superseded file read')
    expect(block.content as string).toContain('; tool=Read')
    expect(block.content as string).toContain('; path=docs.md')
  })

  test('truncates an over-budget older result', () => {
    const big = 'x'.repeat(20_000)
    const messages = [
      assistantToolUse('call_1', 'Bash', { command: 'cat big.txt' }),
      userToolResult('call_1', big),
      ...filler(16),
    ]
    const { messages: out, stats } = pruneMessagesForAPI(messages, 'balanced')
    expect(stats.truncatedResults).toBe(1)
    expect(stats.prunedToolResults).toBe(1)
    expect(stats.savedCharacters).toBeGreaterThan(0)

    const block = (out[1]!.message.content as Array<Record<string, unknown>>)[0]!
    const replacement = block.content as string
    expect(replacement).toContain('[Smart pruning: older tool output shortened')
    expect(replacement.length).toBeLessThan(big.length)
    expect(replacement.startsWith('xxx')).toBe(true)
    expect(replacement.endsWith('xxx')).toBe(true)
  })

  test('never prunes a failed result', () => {
    const big = 'x'.repeat(20_000)
    const messages = [
      assistantToolUse('call_1', 'Bash', { command: 'cat big.txt' }),
      userToolResult('call_1', big, true),
      ...filler(16),
    ]
    const { messages: out, stats } = pruneMessagesForAPI(messages, 'balanced')
    expect(stats).toEqual(EMPTY_STATS)
    const block = (out[1]!.message.content as Array<Record<string, unknown>>)[0]!
    expect(block.content).toEqual([{ type: 'text', text: big }])
  })

  test('never prunes a result that looks like an error', () => {
    const big = 'error: something went wrong' + '\n' + 'x'.repeat(20_000)
    const messages = [
      assistantToolUse('call_1', 'Bash', { command: 'cat big.txt' }),
      userToolResult('call_1', big),
      ...filler(16),
    ]
    const { stats } = pruneMessagesForAPI(messages, 'balanced')
    expect(stats).toEqual(EMPTY_STATS)
  })

  test('leaves the recent window untouched', () => {
    const messages = [
      assistantToolUse('call_1', 'Bash', { command: 'a' }),
      userToolResult('call_1', DUP_TEXT),
      assistantToolUse('call_2', 'Bash', { command: 'a' }),
      userToolResult('call_2', DUP_TEXT),
    ]
    const { stats } = pruneMessagesForAPI(messages, 'balanced')
    expect(stats).toEqual(EMPTY_STATS)
  })

  test('a second pass on pruned output is a no-op', () => {
    const messages = [
      assistantToolUse('call_1', 'Bash', { command: 'cat big.txt' }),
      userToolResult('call_1', 'x'.repeat(20_000)),
      ...filler(16),
    ]
    const first = pruneMessagesForAPI(messages, 'balanced')
    expect(first.stats.truncatedResults).toBe(1)
    const second = pruneMessagesForAPI(first.messages, 'balanced')
    expect(second.stats.prunedToolResults).toBe(0)
  })
})

describe('isSmartPruningLevel', () => {
  test('recognizes the three levels and rejects everything else', () => {
    expect(isSmartPruningLevel('conservative')).toBe(true)
    expect(isSmartPruningLevel('balanced')).toBe(true)
    expect(isSmartPruningLevel('aggressive')).toBe(true)
    expect(isSmartPruningLevel('')).toBe(false)
    expect(isSmartPruningLevel('Aggressive')).toBe(false)
    expect(isSmartPruningLevel(null)).toBe(false)
    expect(isSmartPruningLevel(42)).toBe(false)
  })
})

describe('SmartPruningService', () => {
  test('is disabled at balanced by default', () => {
    const service = new SmartPruningService()
    expect(service.getStatus()).toEqual({ enabled: false, level: 'balanced', mode: 'deterministic' })
    const { stats } = service.optimizeMessages(duplicateFixture())
    expect(stats).toEqual(EMPTY_STATS)
  })

  test('setEnabled and setLevel mutate state', () => {
    const service = new SmartPruningService({ enabled: true })
    expect(service.getStatus().enabled).toBe(true)
    service.setEnabled(false)
    expect(service.getStatus().enabled).toBe(false)
    service.setLevel('aggressive')
    expect(service.getStatus().level).toBe('aggressive')
  })

  test('setLevel rejects an unknown level', () => {
    const service = new SmartPruningService()
    expect(() => service.setLevel('bogus' as never)).toThrow(/unknown level/)
  })

  test('resetForTesting restores the constructor config', () => {
    const service = new SmartPruningService({ enabled: true, level: 'aggressive' })
    service.setEnabled(false)
    service.setLevel('conservative')
    service.resetForTesting()
    expect(service.getStatus()).toEqual({ enabled: true, level: 'aggressive', mode: 'deterministic' })
  })

  test('invalid constructor config fails loud', () => {
    expect(() => new SmartPruningService({ level: 'bogus' as never })).toThrow(/unknown level/)
  })

  test('an enabled service prunes duplicates', () => {
    const service = new SmartPruningService({ enabled: true, level: 'balanced' })
    const { stats } = service.optimizeMessages(duplicateFixture())
    expect(stats.duplicateResults).toBe(1)
  })
})
