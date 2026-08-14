/**
 * rin evolution — skill candidate approval.
 *
 * createEvolutionApproval(deps) validates candidate markdown, resolves the
 * output skill directory, writes SKILL.md atomically (with a backup on
 * update), and records the approved/rejected event. It depends on no runtime
 * types; catalog refresh and debug logging arrive as injected adapters.
 *
 * @module @rin/evolution
 */

import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { scanForSecrets } from './secrets.ts'
import { getGlobalSkillsRoot, getProjectSkillsRoot, getSkillLearningBackupsRoot } from './paths.ts'
import type { EvolutionRoots, SkillCandidate } from './types.ts'
import type { EvolutionStore } from './store.ts'

const SKILL_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/
const MAX_SKILL_MARKDOWN_CHARS = 40_000
const FRONTMATTER_PATTERN = /^---\s*\n([\s\S]*?)---\s*\n?/

function assertSafeSkillName(name: string): void {
  if (!SKILL_NAME_PATTERN.test(name)) {
    throw new Error('Skill name must use 1-64 lowercase letters, numbers, or hyphens.')
  }
}

function assertProjectRoot(projectRoot: string | undefined): string {
  if (!projectRoot || !isAbsolute(projectRoot)) {
    throw new Error('Project-scoped Skill candidate is missing a valid project root.')
  }
  return resolve(projectRoot)
}

function skillRootForCandidate(candidate: SkillCandidate, roots: EvolutionRoots): string {
  if (candidate.action === 'update' && candidate.target) {
    if (candidate.target.source === 'user') {
      return join(getGlobalSkillsRoot(roots), candidate.target.skillName)
    }
    return join(getProjectSkillsRoot(assertProjectRoot(candidate.projectRoot)), candidate.target.skillName)
  }
  if (candidate.scope === 'global') {
    return join(getGlobalSkillsRoot(roots), candidate.name)
  }
  return join(getProjectSkillsRoot(assertProjectRoot(candidate.projectRoot)), candidate.name)
}

function parseFrontmatterName(markdown: string): string | null {
  const match = markdown.match(FRONTMATTER_PATTERN)
  if (!match || !match[1]) return null
  const nameLine = match[1].split('\n').find(line => /^name:\s*(.*)$/.test(line))
  if (!nameLine) return null
  const value = nameLine.replace(/^name:\s*/, '').trim()
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}

function validateCandidateMarkdown(candidate: SkillCandidate): void {
  assertSafeSkillName(candidate.name)
  if (!candidate.markdown.trim()) throw new Error('Skill candidate is empty.')
  if (candidate.markdown.length > MAX_SKILL_MARKDOWN_CHARS) {
    throw new Error('Skill candidate is too large to save safely.')
  }
  const frontmatterName = parseFrontmatterName(candidate.markdown)
  const expectedName = candidate.target?.skillName ?? candidate.name
  if (typeof frontmatterName !== 'string' || frontmatterName !== expectedName) {
    throw new Error(`Skill frontmatter name must be "${expectedName}" before it can be saved.`)
  }
  const secrets = scanForSecrets(candidate.markdown)
  if (secrets.length > 0) {
    throw new Error(
      `Skill candidate contains possible credentials: ${secrets.map(item => item.label).join(', ')}`,
    )
  }
}

function isInside(child: string, parent: string): boolean {
  const normalizedChild = resolve(child)
  const normalizedParent = resolve(parent)
  return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}${sep}`)
}

function assertTargetBoundary(candidate: SkillCandidate, skillRoot: string, roots: EvolutionRoots): void {
  const allowedRoot =
    candidate.scope === 'global' || candidate.target?.source === 'user'
      ? getGlobalSkillsRoot(roots)
      : getProjectSkillsRoot(assertProjectRoot(candidate.projectRoot))
  if (!isInside(skillRoot, allowedRoot)) {
    throw new Error('Skill candidate resolved outside its allowed skills directory.')
  }
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

async function backupExistingSkill(
  candidate: SkillCandidate,
  existingContent: string,
  roots: EvolutionRoots,
): Promise<void> {
  const backupDir = join(getSkillLearningBackupsRoot(roots), candidate.id)
  await mkdir(backupDir, { recursive: true, mode: 0o700 })
  await writeFile(join(backupDir, 'SKILL.md'), existingContent, {
    encoding: 'utf-8',
    mode: 0o600,
  })
}

export function createEvolutionApproval(deps: {
  roots: EvolutionRoots
  store: EvolutionStore
  clearCatalog?: () => void | Promise<void>
  logDebug?: (message: string) => void
}) {
  const { roots, store, clearCatalog, logDebug } = deps

  async function approveCandidate(
    id: string,
    options: { automatic?: boolean } = {},
  ): Promise<SkillCandidate> {
    const candidate = await store.getCandidate(id)
    if (!candidate) throw new Error(`Skill candidate not found: ${id}`)
    if (candidate.status !== 'pending') {
      throw new Error(`Skill candidate is already ${candidate.status}.`)
    }
    validateCandidateMarkdown(candidate)

    const skillRoot = skillRootForCandidate(candidate, roots)
    assertTargetBoundary(candidate, skillRoot, roots)
    const skillPath = join(skillRoot, 'SKILL.md')

    if (candidate.action === 'create') {
      try {
        await stat(skillPath)
        throw new Error(`A Skill named "${candidate.name}" already exists.`)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      await mkdir(skillRoot, { recursive: true, mode: 0o700 })
      await writeFile(skillPath, candidate.markdown, {
        encoding: 'utf-8',
        mode: 0o600,
        flag: 'wx',
      })
    } else {
      let existingContent: string
      try {
        existingContent = await readFile(skillPath, 'utf-8')
      } catch {
        throw new Error(`The Skill selected for update no longer exists: ${skillPath}`)
      }
      await backupExistingSkill(candidate, existingContent, roots)
      await atomicWrite(skillPath, candidate.markdown)
    }

    const now = new Date().toISOString()
    const approved = await store.updateCandidate(id, {
      status: 'approved',
      reviewedAt: now,
      outputPath: skillPath,
    })
    await store.recordEvent({
      kind: options.automatic ? 'candidate-auto-approved' : 'candidate-approved',
      message: options.automatic
        ? `Automatically saved /${approved.name}.`
        : `Approved and saved /${approved.name}.`,
      ...(approved.projectRoot === undefined ? {} : { projectRoot: approved.projectRoot }),
      ...(approved.sourceSessionId === undefined ? {} : { sessionId: approved.sourceSessionId }),
      candidateId: approved.id,
      skillName: approved.name,
      toolUseCount: approved.sourceToolUses,
    })
    try {
      await clearCatalog?.()
    } catch (error) {
      logDebug?.(`[skill-learning] failed to refresh the Skill catalog: ${String(error)}`)
    }
    return approved
  }

  async function rejectCandidate(id: string): Promise<SkillCandidate> {
    const candidate = await store.getCandidate(id)
    if (!candidate) throw new Error(`Skill candidate not found: ${id}`)
    if (candidate.status !== 'pending') {
      throw new Error(`Skill candidate is already ${candidate.status}.`)
    }
    const rejected = await store.updateCandidate(id, {
      status: 'rejected',
      reviewedAt: new Date().toISOString(),
    })
    await store.recordEvent({
      kind: 'candidate-rejected',
      message: `Rejected /${rejected.name}.`,
      ...(rejected.projectRoot === undefined ? {} : { projectRoot: rejected.projectRoot }),
      ...(rejected.sourceSessionId === undefined ? {} : { sessionId: rejected.sourceSessionId }),
      candidateId: rejected.id,
      skillName: rejected.name,
      toolUseCount: rejected.sourceToolUses,
    })
    return rejected
  }

  return { approveCandidate, rejectCandidate }
}

export type EvolutionApproval = ReturnType<typeof createEvolutionApproval>
