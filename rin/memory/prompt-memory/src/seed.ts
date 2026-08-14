import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  getPromptMemoryDir,
  getSoulPath,
  type PromptMemoryRoots,
} from './paths.ts'

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

/**
 * Seed the SOUL identity file with the provided initial identity without
 * overwriting an existing file. Missing parent directories are created first.
 */
export async function ensurePromptMemorySeed(
  roots: PromptMemoryRoots,
  initialSoul: string,
): Promise<void> {
  await mkdir(getPromptMemoryDir(roots), { recursive: true })
  const soulPath = getSoulPath(roots)
  await mkdir(dirname(soulPath), { recursive: true })

  try {
    await writeFile(soulPath, initialSoul, {
      encoding: 'utf-8',
      flag: 'wx',
    })
  } catch (error) {
    if (getErrnoCode(error) === 'EEXIST') return
    if (!isFsInaccessible(error)) throw error
  }
}
