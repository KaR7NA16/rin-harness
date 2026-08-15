/**
 * rin agents — filesystem path helpers.
 *
 * @module @rin/agents
 */

import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Directory name for the default DeepSeek Harness home under the OS home. */
const DSH_HOME_DIR_NAME = '.dsh'

/** Whether an error means the path is simply absent. */
export function isMissingPathError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT')
}

/** List one directory's entries, returning [] when it does not exist yet. */
export async function readDirectory(path: string) {
  try {
    return await readdir(path, { withFileTypes: true })
  } catch (error) {
    if (isMissingPathError(error)) return []
    throw error
  }
}

/** Read a file's text, returning undefined when it does not exist. */
export async function readFileIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (isMissingPathError(error)) return undefined
    throw error
  }
}

/** Expand a leading `~` against the operating-system home. */
export function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/**
 * Resolve the default DeepSeek Harness home, mirroring dsh-home-paths
 * precedence: `$DSH_HOME`, else `~/.dsh`. A blank override is treated as unset.
 * @param env - environment mapping used to read DSH_HOME.
 * @returns the absolute harness home path.
 */
export function resolveDefaultDshHome(env: Record<string, string | undefined> = process.env): string {
  const fromEnv = env.DSH_HOME
  const selected = fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), DSH_HOME_DIR_NAME)
  return resolve(expandHome(selected))
}

/** Directory name for the dsh agent-presets user root under the harness home. */
export const USER_PRESET_DIRNAME = '.agent-presets'

/**
 * Resolve the default dsh agent-presets user root, mirroring the
 * `@deepseek-ai/dsh-agent-presets` plugin's `<dshHome>/.agent-presets`.
 * @param env - environment mapping used to read DSH_HOME.
 * @returns the absolute preset root path.
 */
export function resolveDefaultPresetRoot(env: Record<string, string | undefined> = process.env): string {
  return join(resolveDefaultDshHome(env), USER_PRESET_DIRNAME)
}
