import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  getPromptMemoryConfigPath,
  type PromptMemoryRoots,
} from './paths.ts'
import type { PromptMemoryConfig } from './types.ts'

export const DEFAULT_PROMPT_MEMORY_CONFIG: PromptMemoryConfig = {
  version: 1,
  injectEvolutionMemory: true,
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 })
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}`
  await writeFile(tmpPath, content, { encoding: 'utf-8', mode: 0o600 })
  try {
    await rename(tmpPath, filePath)
    await chmod(filePath, 0o600).catch(() => {})
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => {})
    throw error
  }
}

export async function readPromptMemoryConfig(
  roots: PromptMemoryRoots,
): Promise<PromptMemoryConfig> {
  try {
    const stored = JSON.parse(
      await readFile(getPromptMemoryConfigPath(roots), 'utf-8'),
    ) as Partial<PromptMemoryConfig>
    return {
      ...DEFAULT_PROMPT_MEMORY_CONFIG,
      ...(typeof stored.injectEvolutionMemory === 'boolean'
        ? { injectEvolutionMemory: stored.injectEvolutionMemory }
        : {}),
      version: 1,
      ...(typeof stored.updatedAt === 'string'
        ? { updatedAt: stored.updatedAt }
        : {}),
    }
  } catch {
    return { ...DEFAULT_PROMPT_MEMORY_CONFIG }
  }
}

export async function updatePromptMemoryConfig(
  roots: PromptMemoryRoots,
  input: Pick<PromptMemoryConfig, 'injectEvolutionMemory'>,
): Promise<PromptMemoryConfig> {
  const next: PromptMemoryConfig = {
    version: 1,
    injectEvolutionMemory: input.injectEvolutionMemory,
    updatedAt: new Date().toISOString(),
  }
  await atomicWrite(
    getPromptMemoryConfigPath(roots),
    `${JSON.stringify(next, null, 2)}\n`,
  )
  return next
}
