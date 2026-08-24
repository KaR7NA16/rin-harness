/**
 * rin skill-memory — skill catalog projection.
 *
 * Enumerates the durable skill-memory store and projects each memory (a skill
 * with a distilled SUMMARY.md) into a catalog entry a dsh skill provider can
 * expose. Pure over the file system: it reads the STATS.json + SUMMARY.md files
 * the store writes, applies the lifecycle gate (archived and empty memories
 * stay hidden), and derives a stable `skill-memory-*` name so a projected
 * memory never shadows the skill it recalls.
 *
 * @module @rin/memory/skill
 */

import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  SKILL_MEMORY_STATS_FILENAME,
  SKILL_MEMORY_SUMMARY_FILENAME,
  getGlobalSkillMemoryRoot,
  getProjectSkillMemoryRoot,
} from './paths.ts'
import type { SkillLifecycleStatus } from './lifecycle.ts'
import type { SkillMemoryRoots, SkillMemoryScope } from './types.ts'

/** Name prefix applied to every projected memory skill. */
export const SKILL_MEMORY_NAME_PREFIX = 'skill-memory'

/** Precedence rank for a project-scoped memory (lower rank wins duplicates). */
export const SKILL_MEMORY_PROJECT_RANK = 690

/** Precedence rank for a global-scoped memory (below every dsh skill root). */
export const SKILL_MEMORY_GLOBAL_RANK = 700

/** Maximum characters kept in a derived routing description. */
export const SKILL_MEMORY_DESCRIPTION_MAX = 200

/** One projected skill-memory entry ready to become a skill candidate. */
export interface SkillMemoryCatalogEntry {
  /** Derived dsh-valid kebab-case skill name. */
  name: string
  /** Original skill name recorded in STATS.json. */
  skillName: string
  /** Where the skill was loaded from, when recorded. */
  source?: string
  /** The load site recorded by the store, when present. */
  loadedFrom?: string
  /** Memory scope the entry lives under. */
  scope: SkillMemoryScope
  /** Lifecycle status recorded for the skill. */
  status: SkillLifecycleStatus
  /** Absolute memory directory holding STATS.json + SUMMARY.md. */
  dir: string
  /** Absolute path to the SUMMARY.md body. */
  summaryPath: string
  /** Trimmed distilled memory body. */
  content: string
}

/** Collapse a value to a strict ascii kebab-case slug. */
function kebabSlug(value: string): string {
  return value
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Stable short hash of a skill identity, used when its name has no ascii slug. */
function skillMemoryHash(skillName: string, source?: string, loadedFrom?: string): string {
  const rawKey = `${source || loadedFrom || 'unknown'}:${skillName}`
  return createHash('sha1').update(rawKey).digest('hex').slice(0, 12)
}

/**
 * Derive a valid dsh kebab-case skill name for a stored skill name.
 *
 * The name is prefixed with `skill-memory-` so a memory never shadows the
 * skill it recalls. When the stored name has no ascii alphanumerics, a stable
 * hash of the full reference identity stands in for the slug.
 *
 * @param skillName - the skill name recorded in the store.
 * @param source - the recorded source, used only for the hash fallback.
 * @param loadedFrom - the recorded load site, used only for the hash fallback.
 * @returns the dsh-valid projected skill name.
 */
export function skillMemoryDshName(
  skillName: string,
  source?: string,
  loadedFrom?: string,
): string {
  const slug = kebabSlug(skillName)
  const suffix = slug !== '' ? slug : skillMemoryHash(skillName, source, loadedFrom)
  return `${SKILL_MEMORY_NAME_PREFIX}-${suffix}`
}

/**
 * Derive a routing description from the memory body's first meaningful line.
 *
 * @param content - the trimmed memory body.
 * @returns a short description with leading markdown heading markers removed.
 */
export function skillMemoryDescription(content: string): string {
  const firstLine = content
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line !== '') ?? ''
  const cleaned = firstLine.replace(/^#+\s*/, '').trim()
  const description = cleaned === '' ? 'Skill memory' : cleaned
  return description.length <= SKILL_MEMORY_DESCRIPTION_MAX
    ? description
    : `${description.slice(0, SKILL_MEMORY_DESCRIPTION_MAX - 1).trimEnd()}`
}

/** Map an unknown stored status to a lifecycle status, defaulting to active. */
function overviewStatus(value: unknown): SkillLifecycleStatus {
  return value === 'stale' || value === 'archived' || value === 'pinned' ? value : 'active'
}

/** Read and parse STATS.json, or null when missing or unparseable. */
async function readStatsRecord(dir: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(join(dir, SKILL_MEMORY_STATS_FILENAME), 'utf-8'),
    )
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

/** Read the trimmed SUMMARY.md body, or the empty string when absent. */
async function readSummaryText(dir: string): Promise<string> {
  try {
    return (await readFile(join(dir, SKILL_MEMORY_SUMMARY_FILENAME), 'utf-8')).trim()
  } catch {
    return ''
  }
}

/** List subdirectories of a memory root, or none when the root is absent. */
async function listDirs(root: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => join(root, entry.name))
}

/**
 * Read one memory directory into a catalog entry, applying the lifecycle gate.
 *
 * @param dir - the skill memory directory (holds STATS.json + SUMMARY.md).
 * @param scope - the scope this directory belongs to.
 * @returns the catalog entry, or null when the memory is empty, nameless, or archived.
 */
export async function readSkillMemoryDir(
  dir: string,
  scope: SkillMemoryScope,
): Promise<SkillMemoryCatalogEntry | null> {
  const content = await readSummaryText(dir)
  if (content === '') return null
  const stats = await readStatsRecord(dir)
  const rawSkillName = stats?.skillName
  const skillName = typeof rawSkillName === 'string' ? rawSkillName : ''
  if (skillName === '') return null
  const status = overviewStatus(stats?.status)
  if (status === 'archived') return null
  const rawSource = stats?.source
  const rawLoadedFrom = stats?.loadedFrom
  const source = typeof rawSource === 'string' ? rawSource : undefined
  const loadedFrom = typeof rawLoadedFrom === 'string' ? rawLoadedFrom : undefined
  return {
    name: skillMemoryDshName(skillName, source, loadedFrom),
    skillName,
    ...(source !== undefined ? { source } : {}),
    ...(loadedFrom !== undefined ? { loadedFrom } : {}),
    scope,
    status,
    dir,
    summaryPath: join(dir, SKILL_MEMORY_SUMMARY_FILENAME),
    content,
  }
}

/**
 * Enumerate every gated-in skill memory across the global and project roots.
 *
 * @param roots - the injected config roots.
 * @returns the projected catalog entries, global scope first, then project.
 */
export async function listSkillMemoryEntries(
  roots: SkillMemoryRoots,
): Promise<SkillMemoryCatalogEntry[]> {
  const scopes: Array<{ scope: SkillMemoryScope; root: string }> = [
    { scope: 'global', root: getGlobalSkillMemoryRoot(roots.globalConfigRoot) },
  ]
  if (roots.projectConfigRoot !== undefined) {
    scopes.push({ scope: 'project', root: getProjectSkillMemoryRoot(roots.projectConfigRoot) })
  }
  const entries: SkillMemoryCatalogEntry[] = []
  for (const { scope, root } of scopes) {
    for (const dir of await listDirs(root)) {
      const entry = await readSkillMemoryDir(dir, scope)
      if (entry !== null) entries.push(entry)
    }
  }
  return entries
}
