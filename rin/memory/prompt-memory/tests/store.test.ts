import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  PROMPT_MEMORY_TOTAL_CHAR_LIMIT,
  boundPromptMemoryPair,
  boundPromptMemoryText,
} from '../src/budget.ts'
import {
  buildPromptMemoryInsights,
  parsePromptMemoryInsight,
} from '../src/insights.ts'
import {
  getBriefPath,
  getPromptMemoryConfigPath,
  getPromptMemoryDir,
  getSoulPath,
  getUserPromptMemoryPath,
  type PromptMemoryRoots,
} from '../src/paths.ts'
import { ensurePromptMemorySeed } from '../src/seed.ts'
import {
  DEFAULT_PROMPT_MEMORY_CONFIG,
  readPromptMemoryConfig,
  updatePromptMemoryConfig,
} from '../src/config.ts'
import { PromptMemoryError, createPromptMemoryStore } from '../src/store.ts'
import {
  appendPromptMemoryReviewLogs,
  getPromptMemoryReviewLogPath,
  readPromptMemoryReviewLogs,
} from '../src/reviewLog.ts'
import type { PromptMemoryAutoReviewLogEntry } from '../src/types.ts'

describe('Prompt Memory persistence', () => {
  const initialSoul = 'A product-provided identity.\n'
  let tempRoot: string
  let roots: PromptMemoryRoots

  beforeEach(async () => {
    tempRoot = join(tmpdir(), `rin-prompt-memory-${randomUUID()}`)
    await mkdir(tempRoot, { recursive: true })
    roots = { configRoot: tempRoot }
  })

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })

  test('derives every path only from the injected configuration root', () => {
    expect(getSoulPath(roots)).toBe(join(tempRoot, 'SOUL.md'))
    expect(getPromptMemoryDir(roots)).toBe(join(tempRoot, 'prompt-memory'))
    expect(getBriefPath(roots)).toBe(join(tempRoot, 'prompt-memory', 'BRIEF.md'))
    expect(getUserPromptMemoryPath(roots)).toBe(
      join(tempRoot, 'prompt-memory', 'USER.md'),
    )
    expect(getPromptMemoryConfigPath(roots)).toBe(
      join(tempRoot, 'prompt-memory', 'config.json'),
    )
  })

  test('seeds identity without overwriting an existing identity file', async () => {
    await ensurePromptMemorySeed(roots, initialSoul)
    expect(await readFile(getSoulPath(roots), 'utf8')).toBe(initialSoul)

    const store = createPromptMemoryStore(roots, { initialSoul })
    await store.writeFile('soul', 'A deliberate identity.')
    await ensurePromptMemorySeed(roots, initialSoul)
    expect((await store.readFile('soul')).content).toBe('A deliberate identity.')
  })

  test('persists configuration through the injected root', async () => {
    expect(await readPromptMemoryConfig(roots)).toEqual(
      DEFAULT_PROMPT_MEMORY_CONFIG,
    )
    const updated = await updatePromptMemoryConfig(roots, {
      injectEvolutionMemory: false,
    })
    expect(updated.injectEvolutionMemory).toBe(false)
    expect((await readPromptMemoryConfig(roots)).injectEvolutionMemory).toBe(
      false,
    )
  })

  test('serializes entry mutations and rejects identity entry mutation', async () => {
    const store = createPromptMemoryStore(roots, { initialSoul })
    await Promise.all([
      store.addEntry('user', 'Prefers precise evidence.'),
      store.addEntry('user', 'Uses Chinese for collaboration.'),
    ])

    expect((await store.readFile('user')).entries.sort()).toEqual([
      'Prefers precise evidence.',
      'Uses Chinese for collaboration.',
    ].sort())

    await store.replaceEntry(
      'user',
      'precise evidence',
      'Prefers evidence-backed conclusions.',
    )
    await store.removeEntry('user', 'Uses Chinese')
    expect((await store.readFile('user')).entries).toEqual([
      'Prefers evidence-backed conclusions.',
    ])

    expect(store.addEntry('soul', 'Not permitted.')).rejects.toBeInstanceOf(
      PromptMemoryError,
    )
  })

  test('deduplicates adds and reports errors with the rin prefix and codes', async () => {
    const store = createPromptMemoryStore(roots, { initialSoul })
    const first = await store.addEntry('brief', 'Inspect evidence before conclusions.')
    expect(first.changed).toBe(true)
    const second = await store.addEntry('brief', 'Inspect evidence before conclusions.')
    expect(second.changed).toBe(false)
    expect(second.message).toBe('Entry already exists.')

    await expect(store.addEntry('user', '   ')).rejects.toMatchObject({
      code: 'EMPTY_ENTRY',
      message: expect.stringContaining('rin prompt-memory:'),
    })
    await expect(store.removeEntry('user', 'does not exist')).rejects.toMatchObject({
      code: 'ENTRY_NOT_FOUND',
      status: 404,
    })
    await expect(store.addEntry('soul', 'nope')).rejects.toMatchObject({
      code: 'SOUL_ENTRY_MUTATION_FORBIDDEN',
    })
  })

  test('rejects an ambiguous oldText matching multiple entries', async () => {
    const store = createPromptMemoryStore(roots, { initialSoul })
    await store.addEntry('brief', 'Run the test suite first.')
    await store.addEntry('brief', 'Run the lint suite first.')
    await expect(store.removeEntry('brief', 'suite')).rejects.toMatchObject({
      code: 'AMBIGUOUS_ENTRY',
    })
  })
})

describe('Prompt Memory budgets', () => {
  test('preserves content that fits and reports truncation explicitly', () => {
    expect(boundPromptMemoryText('USER.md', 'abc', 3)).toEqual({
      content: 'abc',
      limit: 3,
      originalLength: 3,
      truncated: false,
    })
    expect(boundPromptMemoryText('USER.md', 'abcdef', 4)).toMatchObject({
      originalLength: 6,
      truncated: true,
    })
  })

  test('keeps the combined brief and user projection within its total budget', () => {
    const result = boundPromptMemoryPair({
      brief: 'b'.repeat(PROMPT_MEMORY_TOTAL_CHAR_LIMIT),
      user: 'u'.repeat(PROMPT_MEMORY_TOTAL_CHAR_LIMIT),
    })
    expect(result.brief.content.length + result.user.content.length)
      .toBeLessThanOrEqual(PROMPT_MEMORY_TOTAL_CHAR_LIMIT)
  })
})

describe('Prompt Memory insights', () => {
  test('classifies tagged and legacy memories', () => {
    expect(parsePromptMemoryInsight(
      '[communication] User prefers concise Chinese replies.',
      'user',
    )).toMatchObject({
      category: 'communication',
      content: 'User prefers concise Chinese replies.',
    })
    expect(parsePromptMemoryInsight(
      'Always run focused tests before the production build.',
      'brief',
    ).category).toBe('meta-method')
  })

  test('deduplicates the visible profile while preserving provenance', () => {
    const result = buildPromptMemoryInsights({
      files: {
        user: { entries: ['[quality] Always verify outputs.'] },
        brief: { entries: ['[meta-method] Inspect evidence before conclusions.'] },
      },
      logs: [{
        timestamp: '2026-08-12T00:00:00.000Z',
        trigger: 'explicit',
        target: 'user',
        changed: true,
        content: '[quality] Always verify outputs.',
      }],
    })
    expect(result.insights).toHaveLength(2)
    expect(result.insights[0]).toHaveProperty('source')
    expect(result.stats).toMatchObject({ total: 2, user: 1, methods: 1 })
  })
})

describe('Prompt Memory review log', () => {
  let tempRoot: string
  let roots: PromptMemoryRoots

  beforeEach(async () => {
    tempRoot = join(tmpdir(), `rin-prompt-memory-review-${randomUUID()}`)
    await mkdir(tempRoot, { recursive: true })
    roots = { configRoot: tempRoot }
  })

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })

  test('appends audit entries and reads newest valid entries first', async () => {
    const entries: PromptMemoryAutoReviewLogEntry[] = [
      makeEntry('first', 'add'),
      makeEntry('second', 'replace'),
    ]
    await appendPromptMemoryReviewLogs(roots, entries)
    await appendFile(getPromptMemoryReviewLogPath(roots), 'not-json\n', 'utf8')

    expect(await readPromptMemoryReviewLogs(roots, 1)).toEqual([entries[1]])
    expect(await readPromptMemoryReviewLogs(roots, 20)).toEqual([
      entries[1],
      entries[0],
    ])
  })

  test('returns an empty log when persistence is absent', async () => {
    expect(await readPromptMemoryReviewLogs(roots)).toEqual([])
  })
})

function makeEntry(
  id: string,
  action: PromptMemoryAutoReviewLogEntry['action'],
): PromptMemoryAutoReviewLogEntry {
  return {
    id,
    timestamp: '2026-08-12T00:00:00.000Z',
    sessionId: 'session',
    trigger: 'interval',
    target: 'brief',
    action,
    changed: true,
    message: `${action} complete`,
  }
}
