import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  PROMPT_MEMORY_REVIEW_LOG_FILENAME,
  type PromptMemoryAutoReviewLogEntry,
} from './types.ts'
import { getPromptMemoryDir, type PromptMemoryRoots } from './paths.ts'

export function getPromptMemoryReviewLogPath(
  roots: PromptMemoryRoots,
): string {
  return join(
    getPromptMemoryDir(roots),
    PROMPT_MEMORY_REVIEW_LOG_FILENAME,
  ).normalize('NFC')
}

export async function appendPromptMemoryReviewLogs(
  roots: PromptMemoryRoots,
  entries: PromptMemoryAutoReviewLogEntry[],
): Promise<void> {
  if (entries.length === 0) return
  const logPath = getPromptMemoryReviewLogPath(roots)
  await mkdir(dirname(logPath), { recursive: true })
  await appendFile(
    logPath,
    `${entries.map(entry => JSON.stringify(entry)).join('\n')}\n`,
    'utf-8',
  )
}

export async function readPromptMemoryReviewLogs(
  roots: PromptMemoryRoots,
  limit = 50,
): Promise<PromptMemoryAutoReviewLogEntry[]> {
  const boundedLimit = Math.max(1, Math.min(limit, 200))
  try {
    const raw = await readFile(getPromptMemoryReviewLogPath(roots), 'utf-8')
    return raw
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        try {
          return JSON.parse(line) as PromptMemoryAutoReviewLogEntry
        } catch {
          return null
        }
      })
      .filter((entry): entry is PromptMemoryAutoReviewLogEntry => entry !== null)
      .reverse()
      .slice(0, boundedLimit)
  } catch {
    return []
  }
}
