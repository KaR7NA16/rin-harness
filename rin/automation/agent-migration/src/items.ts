/**
 * rin agent-migration — migration items and migrate core.
 *
 * Discovers migratable items (agent skills and instruction files) under an
 * external agent's config root, previews a text file prefix, and migrates
 * skills into the rin skill-memory root and instructions into a rules root.
 * Simplified port of the legacy desktop agent migration (skills + instructions only;
 * the per-agent format adapters, content transforms, and project discovery are
 * not ported). Cordis-free: node: builtins only.
 *
 * @module @rin/agent-migration
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

export type MigrationItemKind = 'skill' | 'instruction'

export interface MigrationItem {
  id: string
  agentId: string
  kind: MigrationItemKind
  name: string
  sourcePath: string
  sizeBytes: number
}

export interface MigrationResultItem {
  id: string
  status: 'imported' | 'skipped' | 'failed'
  destinationPath?: string
  message?: string
}

export interface MigrationResult {
  imported: number
  skipped: number
  failed: number
  items: MigrationResultItem[]
}

const SKILL_ENTRY_FILES = ['SKILL.md', 'skill.md']
const PREVIEW_BYTES = 160 * 1024
const MAX_ITEM_BYTES = 2 * 1024 * 1024

async function listSkillDirectories(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true })
    return entries.filter(entry => entry.isDirectory()).map(entry => join(root, entry.name))
  } catch {
    return []
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/** Discover migratable skills + instructions under one agent config root. */
export async function discoverItems(agentId: string, root: string): Promise<MigrationItem[]> {
  const items: MigrationItem[] = []

  const skillsRoot = join(root, 'skills')
  for (const dir of await listSkillDirectories(skillsRoot)) {
    for (const entryFile of SKILL_ENTRY_FILES) {
      const skillPath = join(dir, entryFile)
      if (!(await isFile(skillPath))) continue
      const size = (await stat(skillPath)).size
      items.push({ id: 'skill-' + shortHash(skillPath), agentId, kind: 'skill', name: basename(dir), sourcePath: skillPath, sizeBytes: size })
      break
    }
  }

  const claudeMd = join(root, 'CLAUDE.md')
  if (await isFile(claudeMd)) {
    const size = (await stat(claudeMd)).size
    items.push({ id: 'instruction-' + shortHash(claudeMd), agentId, kind: 'instruction', name: 'CLAUDE.md', sourcePath: claudeMd, sizeBytes: size })
  }
  const rulesRoot = join(root, 'rules')
  try {
    for (const entry of await readdir(rulesRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const rulePath = join(rulesRoot, entry.name)
      const size = (await stat(rulePath)).size
      items.push({ id: 'instruction-' + shortHash(rulePath), agentId, kind: 'instruction', name: entry.name, sourcePath: rulePath, sizeBytes: size })
    }
  } catch {
    // A config root without a rules directory is normal.
  }

  return items
}

/** Read a previewable text file's first bytes, reporting truncation. */
export async function previewItem(item: MigrationItem): Promise<{ content: string; truncated: boolean }> {
  const content = await readFile(item.sourcePath, 'utf-8')
  const truncated = content.length > PREVIEW_BYTES
  return { content: truncated ? content.slice(0, PREVIEW_BYTES) : content, truncated }
}

/** Migrate one skill or instruction into the rin skill-memory / rules roots. */
export async function migrateItem(item: MigrationItem, skillsRoot: string, rulesRoot: string): Promise<MigrationResultItem> {
  if (item.sizeBytes > MAX_ITEM_BYTES) {
    return { id: item.id, status: 'skipped', message: 'Item exceeds the migration size limit' }
  }
  try {
    const content = await readFile(item.sourcePath)
    if (item.kind === 'skill') {
      const destDir = join(skillsRoot, item.name)
      await mkdir(destDir, { recursive: true })
      await writeFile(join(destDir, 'SKILL.md'), content)
      return { id: item.id, status: 'imported', destinationPath: join(destDir, 'SKILL.md') }
    }
    await mkdir(rulesRoot, { recursive: true })
    const destPath = join(rulesRoot, item.name)
    await writeFile(destPath, content)
    return { id: item.id, status: 'imported', destinationPath: destPath }
  } catch (err) {
    return { id: item.id, status: 'failed', message: err instanceof Error ? err.message : String(err) }
  }
}

/** Migrate a list of items, aggregating the result. */
export async function migrateItems(items: MigrationItem[], skillsRoot: string, rulesRoot: string): Promise<MigrationResult> {
  const result: MigrationResult = { imported: 0, skipped: 0, failed: 0, items: [] }
  for (const item of items) {
    const outcome = await migrateItem(item, skillsRoot, rulesRoot)
    result.items.push(outcome)
    if (outcome.status === 'imported') result.imported += 1
    else if (outcome.status === 'skipped') result.skipped += 1
    else result.failed += 1
  }
  return result
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}
