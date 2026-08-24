/**
 * rin agent-migration — external-agent scan core.
 *
 * Scans the home directory for known external agent config roots (Claude Code,
 * Codex, Cursor, ...) and reports which ones exist with agents/skills entries.
 * Pure over an injected home directory and free of any cordis import, so it
 * runs under plain node --experimental-strip-types.
 *
 * @module @rin/agent-migration
 */

import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentMigrationScan, DetectedExternalAgent, ExternalAgentId, ExternalAgentStatus } from './types.ts'

/** Destination agent reported when the caller names none. */
export const DEFAULT_TARGET_AGENT_ID = 'claude-code'

/** One known external agent and its home-relative config roots. */
export type AgentSource = {
  /** Stable agent id. */
  id: ExternalAgentId
  /** Human-readable agent name. */
  name: string
  /** Home-relative config roots, tried in order; the first existing one wins. */
  roots: readonly string[]
}

/** Known external agents and their home-relative config roots. */
export const AGENT_SOURCES: readonly AgentSource[] = [
  { id: 'claude-code', name: 'Claude Code', roots: ['.claude'] },
  { id: 'codex', name: 'Codex', roots: ['.codex', '.agents'] },
  { id: 'cursor', name: 'Cursor', roots: ['.cursor'] },
  { id: 'openclaw', name: 'OpenClaw', roots: ['.openclaw'] },
  { id: 'hermes-agent', name: 'Hermes Agent', roots: ['.hermes'] },
  { id: 'deepseek-tui', name: 'DeepSeek TUI', roots: ['.codewhale', '.deepseek'] },
]

/** Subdirectories of a config root that hold migratable agent/skill entries. */
const CONFIG_SUBDIRS = ['agents', 'skills'] as const

/**
 * Scan a home directory for external agent config and report the detected ones.
 *
 * A missing config root contributes nothing (no error), so a home with none of
 * the known directories yields an empty `agents` list.
 *
 * @param homeDir — the directory to scan (typically the OS home).
 * @param targetAgentId — destination agent id reported in the result.
 * @returns the scan result.
 */
export async function scanAgentMigration(
  homeDir: string,
  targetAgentId: string = DEFAULT_TARGET_AGENT_ID,
): Promise<AgentMigrationScan> {
  const agents: DetectedExternalAgent[] = []
  for (const source of AGENT_SOURCES) {
    const root = await firstExistingRoot(homeDir, source.roots)
    if (root === null) continue
    const status = await detectStatus(root)
    agents.push({
      id: source.id,
      name: source.name,
      source: root,
      status,
      installed: true,
      executablePath: null,
      dataRoots: [root],
      counts: { skills: 0, memories: 0, instructions: 0, projects: 0 },
      items: [],
      projects: [],
    })
  }
  return {
    scannedAt: new Date().toISOString(),
    targetAgentId,
    agents,
  }
}

/**
 * Resolve the first config root under `homeDir` that is an existing directory.
 *
 * @param homeDir — the directory the relative roots resolve against.
 * @param roots — home-relative config roots, tried in order.
 * @returns the resolved path of the first existing root, or null when none exist.
 */
async function firstExistingRoot(homeDir: string, roots: readonly string[]): Promise<string | null> {
  for (const root of roots) {
    const resolved = join(homeDir, root)
    if (await isDirectory(resolved)) return resolved
  }
  return null
}

/**
 * Report whether a config root holds any agents/skills entries.
 *
 * @param root — the config root to inspect.
 * @returns 'detected' when an agents/skills entry exists, otherwise 'empty'.
 */
async function detectStatus(root: string): Promise<ExternalAgentStatus> {
  const entries: string[] = []
  for (const subdir of CONFIG_SUBDIRS) {
    try {
      const found = await readdir(join(root, subdir), { withFileTypes: true })
      entries.push(...found.map(entry => entry.name))
    } catch {
      // A config root without an agents/skills subdirectory is normal.
    }
  }
  return entries.length > 0 ? 'detected' : 'empty'
}

/**
 * Return true when `path` names an existing directory (following symlinks).
 *
 * @param path — the path to check.
 * @returns whether the path is an existing directory.
 */
async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}
