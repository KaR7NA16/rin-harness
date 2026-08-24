import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  COMPUTER_USE_DIRNAME,
  COMPUTER_USE_STATE_FILENAME,
  type ComputerUseRoots,
} from './types.ts'

export type { ComputerUseRoots }

/**
 * The default configuration root, under the user's home directory.
 * @returns the absolute default root directory (~/.rin/computer-use).
 */
export function getDefaultComputerUseRoot(): string {
  return join(homedir(), '.rin', COMPUTER_USE_DIRNAME).normalize('NFC')
}

/**
 * Resolve the persisted state file path from a configuration root.
 * @param roots - the configuration root.
 * @returns the absolute state file path.
 */
export function getComputerUseStatePath(roots: ComputerUseRoots): string {
  return join(roots.configRoot, COMPUTER_USE_STATE_FILENAME).normalize('NFC')
}
