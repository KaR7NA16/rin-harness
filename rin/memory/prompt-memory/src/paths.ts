import { join } from 'node:path'
import {
  BRIEF_FILENAME,
  PROMPT_MEMORY_CONFIG_FILENAME,
  PROMPT_MEMORY_DIRNAME,
  SOUL_FILENAME,
  USER_PROMPT_MEMORY_FILENAME,
  type PromptMemoryRoots,
} from './types.ts'

export type { PromptMemoryRoots }

export function getSoulPath(roots: PromptMemoryRoots): string {
  return join(roots.configRoot, SOUL_FILENAME).normalize('NFC')
}

export function getPromptMemoryDir(roots: PromptMemoryRoots): string {
  return join(roots.configRoot, PROMPT_MEMORY_DIRNAME).normalize('NFC')
}

export function getBriefPath(roots: PromptMemoryRoots): string {
  return join(getPromptMemoryDir(roots), BRIEF_FILENAME).normalize('NFC')
}

export function getUserPromptMemoryPath(roots: PromptMemoryRoots): string {
  return join(getPromptMemoryDir(roots), USER_PROMPT_MEMORY_FILENAME).normalize('NFC')
}

export function getPromptMemoryConfigPath(roots: PromptMemoryRoots): string {
  return join(getPromptMemoryDir(roots), PROMPT_MEMORY_CONFIG_FILENAME).normalize('NFC')
}
