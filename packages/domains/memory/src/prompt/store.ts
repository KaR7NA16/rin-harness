/**
 * rin prompt memory — persistence, serialized entry mutations, and atomic writes.
 *
 * @module @rin/memory/prompt
 */

import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  BRIEF_CHAR_LIMIT,
  BRIEF_FILENAME,
  PROMPT_MEMORY_ENTRY_DELIMITER,
  SOUL_CHAR_LIMIT,
  SOUL_FILENAME,
  USER_PROMPT_MEMORY_CHAR_LIMIT,
  USER_PROMPT_MEMORY_FILENAME,
  type PromptMemoryAction,
  type PromptMemoryEntryTarget,
  type PromptMemoryFile,
  type PromptMemoryFormat,
  type PromptMemoryMutationResult,
  type PromptMemoryStatus,
  type PromptMemoryTarget,
} from './types.ts'
import {
  getBriefPath,
  getSoulPath,
  getUserPromptMemoryPath,
  type PromptMemoryRoots,
} from './paths.ts'
import { ensurePromptMemorySeed } from './seed.ts'

const ENTRY_SPLIT_PATTERN = /\n\s*§\s*\n/
const LOCK_STALE_MS = 30_000
const LOCK_RETRY_COUNT = 50
const LOCK_RETRY_DELAY_MS = 20

type TargetConfig = {
  target: PromptMemoryTarget
  filename: string
  path: string
  limit: number
}

export class PromptMemoryError extends Error {
  public readonly code: string
  public readonly status: number

  constructor(message: string, code: string, status = 400) {
    super(message)
    this.code = code
    this.status = status
    this.name = 'PromptMemoryError'
  }
}

function getErrnoCode(error: unknown): string | undefined {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code
  }
  return undefined
}

function isFsInaccessible(error: unknown): boolean {
  return ['ENOENT', 'EACCES', 'EPERM', 'ENOTDIR', 'ELOOP'].includes(
    getErrnoCode(error) ?? '',
  )
}

function getTargetConfig(
  roots: PromptMemoryRoots,
  target: PromptMemoryTarget,
): TargetConfig {
  switch (target) {
    case 'soul':
      return {
        target,
        filename: SOUL_FILENAME,
        path: getSoulPath(roots),
        limit: SOUL_CHAR_LIMIT,
      }
    case 'brief':
      return {
        target,
        filename: BRIEF_FILENAME,
        path: getBriefPath(roots),
        limit: BRIEF_CHAR_LIMIT,
      }
    case 'user':
      return {
        target,
        filename: USER_PROMPT_MEMORY_FILENAME,
        path: getUserPromptMemoryPath(roots),
        limit: USER_PROMPT_MEMORY_CHAR_LIMIT,
      }
  }
}

export function parsePromptMemoryTarget(
  value: string | undefined,
): PromptMemoryTarget | null {
  if (value === 'soul' || value === 'brief' || value === 'user') return value
  return null
}

function assertEntryTarget(
  target: PromptMemoryTarget,
): asserts target is PromptMemoryEntryTarget {
  if (target === 'soul') {
    throw new PromptMemoryError(
      'rin prompt-memory: SOUL.md is an identity file. Write it explicitly instead of using entry mutations.',
      'SOUL_ENTRY_MUTATION_FORBIDDEN',
    )
  }
}

function normalizeEntry(content: string): string {
  return content.trim()
}

export function parsePromptMemoryEntries(raw: string): {
  entries: string[]
  format: PromptMemoryFormat
} {
  const content = raw.trim()
  if (!content) return { entries: [], format: 'empty' }
  if (!ENTRY_SPLIT_PATTERN.test(content)) {
    return { entries: [content], format: 'plain' }
  }
  return {
    entries: content
      .split(ENTRY_SPLIT_PATTERN)
      .map(entry => entry.trim())
      .filter(Boolean),
    format: 'entries',
  }
}

export function formatPromptMemoryEntries(entries: string[]): string {
  const content = entries
    .map(entry => entry.trim())
    .filter(Boolean)
    .join(PROMPT_MEMORY_ENTRY_DELIMITER)
  return content ? `${content}\n` : ''
}

async function readRawFile(filePath: string): Promise<{
  content: string
  exists: boolean
}> {
  try {
    return { content: await readFile(filePath, 'utf-8'), exists: true }
  } catch (error) {
    if (isFsInaccessible(error)) return { content: '', exists: false }
    throw error
  }
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}`
  await writeFile(tmpPath, content, 'utf-8')
  try {
    await rename(tmpPath, filePath)
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => {})
    throw error
  }
}

async function acquireLock(lockPath: string): Promise<void> {
  await mkdir(dirname(lockPath), { recursive: true })

  for (let attempt = 0; attempt < LOCK_RETRY_COUNT; attempt++) {
    try {
      await writeFile(lockPath, `${process.pid}\n`, {
        encoding: 'utf-8',
        flag: 'wx',
      })
      return
    } catch (error) {
      if (getErrnoCode(error) !== 'EEXIST') throw error
      try {
        const info = await stat(lockPath)
        if (Date.now() - info.mtimeMs > LOCK_STALE_MS) {
          await rm(lockPath, { force: true })
          continue
        }
      } catch (statError) {
        if (!isFsInaccessible(statError)) throw statError
      }
      await delay(LOCK_RETRY_DELAY_MS)
    }
  }

  throw new PromptMemoryError(
    `rin prompt-memory: could not acquire prompt memory lock: ${lockPath}`,
    'LOCK_TIMEOUT',
    409,
  )
}

async function withPromptMemoryLock<T>(
  filePath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lockPath = `${filePath}.lock`
  await acquireLock(lockPath)
  try {
    return await fn()
  } finally {
    await rm(lockPath, { force: true }).catch(() => {})
  }
}

function assertWithinLimit(
  target: PromptMemoryTarget,
  content: string,
  limit: number,
): void {
  if (content.trim().length <= limit) return
  throw new PromptMemoryError(
    `rin prompt-memory: ${target.toUpperCase()} prompt memory exceeds ${limit} characters.`,
    'LIMIT_EXCEEDED',
    413,
  )
}

export async function readPromptMemoryFile(
  roots: PromptMemoryRoots,
  initialSoul: string,
  target: PromptMemoryTarget,
  options: { seed?: boolean } = {},
): Promise<PromptMemoryFile> {
  if (options.seed !== false) {
    await ensurePromptMemorySeed(roots, initialSoul)
  }

  const config = getTargetConfig(roots, target)
  const { content, exists } = await readRawFile(config.path)
  const trimmed = content.trim()
  const parsed: { entries: string[]; format: PromptMemoryFormat } =
    target === 'soul'
      ? { entries: trimmed ? [trimmed] : [], format: trimmed ? 'plain' : 'empty' }
      : parsePromptMemoryEntries(trimmed)

  return {
    target,
    filename: config.filename,
    path: config.path,
    exists,
    content: trimmed,
    entries: parsed.entries,
    format: parsed.format,
    charCount: trimmed.length,
    limit: config.limit,
    overLimit: trimmed.length > config.limit,
  }
}

export async function getPromptMemoryStatus(
  roots: PromptMemoryRoots,
  initialSoul: string,
): Promise<PromptMemoryStatus> {
  const [soul, brief, user] = await Promise.all([
    readPromptMemoryFile(roots, initialSoul, 'soul'),
    readPromptMemoryFile(roots, initialSoul, 'brief'),
    readPromptMemoryFile(roots, initialSoul, 'user'),
  ])
  return { files: { soul, brief, user } }
}

export async function writePromptMemoryFile(
  roots: PromptMemoryRoots,
  initialSoul: string,
  target: PromptMemoryTarget,
  content: string,
): Promise<PromptMemoryFile> {
  await ensurePromptMemorySeed(roots, initialSoul)
  const config = getTargetConfig(roots, target)
  const trimmed = content.trim()
  assertWithinLimit(target, trimmed, config.limit)

  return withPromptMemoryLock(config.path, async () => {
    await atomicWrite(config.path, trimmed ? `${trimmed}\n` : '')
    return readPromptMemoryFile(roots, initialSoul, target, { seed: false })
  })
}

async function mutatePromptMemoryEntries(
  roots: PromptMemoryRoots,
  initialSoul: string,
  target: PromptMemoryTarget,
  action: PromptMemoryAction,
  mutator: (entries: string[]) => {
    entries: string[]
    changed: boolean
    message: string
  },
): Promise<PromptMemoryMutationResult> {
  assertEntryTarget(target)
  await ensurePromptMemorySeed(roots, initialSoul)
  const config = getTargetConfig(roots, target)

  return withPromptMemoryLock(config.path, async () => {
    const current = await readPromptMemoryFile(
      roots,
      initialSoul,
      target,
      { seed: false },
    )
    const result = mutator(current.entries)
    const nextContent = formatPromptMemoryEntries(result.entries)
    assertWithinLimit(target, nextContent, config.limit)

    if (result.changed) {
      await atomicWrite(config.path, nextContent)
    }

    const next = await readPromptMemoryFile(
      roots,
      initialSoul,
      target,
      { seed: false },
    )
    return {
      target,
      path: next.path,
      action,
      changed: result.changed,
      message: result.message,
      entries: next.entries,
      entryCount: next.entries.length,
      charCount: next.charCount,
      limit: next.limit,
      overLimit: next.overLimit,
    }
  })
}

export async function addPromptMemoryEntry(
  roots: PromptMemoryRoots,
  initialSoul: string,
  target: PromptMemoryTarget,
  content: string,
): Promise<PromptMemoryMutationResult> {
  const entry = normalizeEntry(content)
  if (!entry) {
    throw new PromptMemoryError(
      'rin prompt-memory: memory entry cannot be empty.',
      'EMPTY_ENTRY',
    )
  }

  return mutatePromptMemoryEntries(roots, initialSoul, target, 'add', entries => {
    if (entries.includes(entry)) {
      return {
        entries,
        changed: false,
        message: 'Entry already exists.',
      }
    }
    return {
      entries: [...entries, entry],
      changed: true,
      message: 'Entry added. It will affect future conversations.',
    }
  })
}

export async function replacePromptMemoryEntry(
  roots: PromptMemoryRoots,
  initialSoul: string,
  target: PromptMemoryTarget,
  oldText: string,
  content: string,
): Promise<PromptMemoryMutationResult> {
  const needle = normalizeEntry(oldText)
  const replacement = normalizeEntry(content)
  if (!needle) {
    throw new PromptMemoryError(
      'rin prompt-memory: oldText cannot be empty.',
      'EMPTY_OLD_TEXT',
    )
  }
  if (!replacement) {
    throw new PromptMemoryError(
      'rin prompt-memory: replacement entry cannot be empty.',
      'EMPTY_ENTRY',
    )
  }

  return mutatePromptMemoryEntries(roots, initialSoul, target, 'replace', entries => {
    const matches = entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.includes(needle))
    if (matches.length === 0) {
      throw new PromptMemoryError(
        'rin prompt-memory: no memory entry matched oldText.',
        'ENTRY_NOT_FOUND',
        404,
      )
    }
    if (matches.length > 1) {
      throw new PromptMemoryError(
        'rin prompt-memory: oldText matched multiple memory entries. Provide a more specific oldText.',
        'AMBIGUOUS_ENTRY',
      )
    }

    const next = [...entries]
    next[matches[0]!.index] = replacement
    return {
      entries: next,
      changed: next[matches[0]!.index] !== matches[0]!.entry,
      message: 'Entry replaced. It will affect future conversations.',
    }
  })
}

export async function removePromptMemoryEntry(
  roots: PromptMemoryRoots,
  initialSoul: string,
  target: PromptMemoryTarget,
  oldText: string,
): Promise<PromptMemoryMutationResult> {
  const needle = normalizeEntry(oldText)
  if (!needle) {
    throw new PromptMemoryError(
      'rin prompt-memory: oldText cannot be empty.',
      'EMPTY_OLD_TEXT',
    )
  }

  return mutatePromptMemoryEntries(roots, initialSoul, target, 'remove', entries => {
    const matches = entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.includes(needle))
    if (matches.length === 0) {
      throw new PromptMemoryError(
        'rin prompt-memory: no memory entry matched oldText.',
        'ENTRY_NOT_FOUND',
        404,
      )
    }
    if (matches.length > 1) {
      throw new PromptMemoryError(
        'rin prompt-memory: oldText matched multiple memory entries. Provide a more specific oldText.',
        'AMBIGUOUS_ENTRY',
      )
    }

    return {
      entries: entries.filter((_, index) => index !== matches[0]!.index),
      changed: true,
      message: 'Entry removed. The change will affect future conversations.',
    }
  })
}

/** Bind persistence operations to an explicitly provided configuration root. */
export function createPromptMemoryStore(
  roots: PromptMemoryRoots,
  options: { initialSoul: string },
) {
  const initialSoul = options.initialSoul
  return {
    addEntry: (target: PromptMemoryTarget, content: string) =>
      addPromptMemoryEntry(roots, initialSoul, target, content),
    getStatus: () => getPromptMemoryStatus(roots, initialSoul),
    readFile: (
      target: PromptMemoryTarget,
      options: { seed?: boolean } = {},
    ) => readPromptMemoryFile(roots, initialSoul, target, options),
    removeEntry: (target: PromptMemoryTarget, oldText: string) =>
      removePromptMemoryEntry(roots, initialSoul, target, oldText),
    replaceEntry: (
      target: PromptMemoryTarget,
      oldText: string,
      content: string,
    ) => replacePromptMemoryEntry(roots, initialSoul, target, oldText, content),
    writeFile: (target: PromptMemoryTarget, content: string) =>
      writePromptMemoryFile(roots, initialSoul, target, content),
  }
}
