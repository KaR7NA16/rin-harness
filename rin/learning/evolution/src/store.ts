/**
 * rin evolution — file-backed skill learning store.
 *
 * createEvolutionStore(roots) owns the candidate/event state (state.json),
 * the learning configuration (config.json), file locking, atomic writes, and
 * bounded retention. It depends on no runtime types; the runtime injects the
 * configuration root and reads/writes through this store.
 *
 * @module @rin/evolution
 */

import { randomBytes, randomUUID } from 'node:crypto'
import {
  chmod,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { dirname, isAbsolute, resolve, sep } from 'node:path'
import {
  getSkillLearningConfigPath,
  getSkillLearningRoot,
  getSkillLearningStatePath,
} from './paths.ts'
import { DEFAULT_SKILL_LEARNING_CONFIG } from './types.ts'
import type {
  EvolutionRoots,
  SkillCandidate,
  SkillLearningConfig,
  SkillLearningEvent,
  SkillLearningEventKind,
  SkillLearningState,
  SkillMemoryOverview,
} from './types.ts'
import {
  getSkillMemoryRoot,
  SKILL_MEMORY_STATS_FILENAME,
  SKILL_MEMORY_SUMMARY_FILENAME,
} from '@rin/skill-memory'
import type { SkillMemoryScope } from '@rin/skill-memory'

const LOCK_STALE_MS = 30_000
const LOCK_RETRIES = 50
const LOCK_DELAY_MS = 20
const MAX_CANDIDATES = 200
const MAX_EVENTS = 120

function delay(ms: number): Promise<void> {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms))
}

async function ensurePrivateDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true, mode: 0o700 })
  await chmod(dirPath, 0o700).catch(() => {
    // best-effort; creation already applied the mode on supported platforms
  })
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await ensurePrivateDir(dirname(filePath))
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

async function acquireLock(filePath: string): Promise<() => Promise<void>> {
  const lockPath = `${filePath}.lock`
  await ensurePrivateDir(dirname(lockPath))

  for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
    try {
      const handle = await open(lockPath, 'wx', 0o600)
      await handle.writeFile(`${process.pid}\n`)
      await handle.close()
      return () => rm(lockPath, { force: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      try {
        const info = await stat(lockPath)
        if (Date.now() - info.mtimeMs > LOCK_STALE_MS) {
          await rm(lockPath, { force: true })
          continue
        }
      } catch {
        // the lock disappeared between open and stat; retry immediately
      }
      await delay(LOCK_DELAY_MS)
    }
  }

  throw new Error(`Could not acquire Skill Learning lock: ${lockPath}`)
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, 'utf-8')) as T
  } catch {
    return fallback
  }
}

/**
 * Create the file-backed skill learning store bound to one configuration root.
 *
 * @param roots - the global and optional project configuration roots.
 */
export function createEvolutionStore(roots: EvolutionRoots) {
  const getStatePath = () => getSkillLearningStatePath(roots)
  const getConfigPath = () => getSkillLearningConfigPath(roots)

  async function readState(): Promise<SkillLearningState> {
    return readJson<SkillLearningState>(getStatePath(), {
      version: 1,
      candidates: [],
      events: [],
    })
  }

  async function mutateState<T>(
    mutate: (state: SkillLearningState) => T | Promise<T>,
  ): Promise<T> {
    const statePath = getStatePath()
    const release = await acquireLock(statePath)
    try {
      const state = await readState()
      const result = await mutate(state)
      state.candidates = state.candidates.slice(-MAX_CANDIDATES)
      state.events = state.events.slice(-MAX_EVENTS)
      await atomicWrite(statePath, `${JSON.stringify(state, null, 2)}\n`)
      return result
    } finally {
      await release()
    }
  }

  async function readConfig(): Promise<SkillLearningConfig> {
    const stored = await readJson<Partial<SkillLearningConfig>>(getConfigPath(), {})
    return {
      ...DEFAULT_SKILL_LEARNING_CONFIG,
      ...stored,
      version: 1,
    }
  }

  async function updateConfig(
    input: Partial<Omit<SkillLearningConfig, 'version'>>,
  ): Promise<SkillLearningConfig> {
    const current = await readConfig()
    const next: SkillLearningConfig = {
      ...current,
      ...input,
      version: 1,
      updatedAt: new Date().toISOString(),
    }
    await atomicWrite(getConfigPath(), `${JSON.stringify(next, null, 2)}\n`)
    return next
  }

  async function saveCandidate(
    candidate: Omit<SkillCandidate, 'version' | 'id' | 'status' | 'createdAt' | 'updatedAt'>,
  ): Promise<{ candidate: SkillCandidate; created: boolean }> {
    return mutateState(state => {
      const existing = state.candidates.find(item =>
        item.sourceFingerprint === candidate.sourceFingerprint &&
        item.status !== 'rejected' &&
        item.status !== 'failed'
      )
      if (existing) return { candidate: existing, created: false }

      const now = new Date().toISOString()
      const saved: SkillCandidate = {
        ...candidate,
        version: 1,
        id: randomUUID(),
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      }
      state.candidates.push(saved)
      return { candidate: saved, created: true }
    })
  }

  async function getCandidate(id: string): Promise<SkillCandidate | null> {
    const state = await readState()
    return state.candidates.find(candidate => candidate.id === id) ?? null
  }

  async function updateCandidate(
    id: string,
    update: Partial<SkillCandidate>,
  ): Promise<SkillCandidate> {
    return mutateState(state => {
      const index = state.candidates.findIndex(candidate => candidate.id === id)
      if (index < 0) throw new Error(`Skill candidate not found: ${id}`)
      const current = state.candidates[index]!
      const next: SkillCandidate = {
        ...current,
        ...update,
        id: current.id,
        version: 1,
        updatedAt: new Date().toISOString(),
      }
      state.candidates[index] = next
      return next
    })
  }

  async function recordEvent(params: {
    kind: SkillLearningEventKind
    message: string
    projectRoot?: string
    sessionId?: string
    candidateId?: string
    skillName?: string
    toolUseCount?: number
  }): Promise<SkillLearningEvent> {
    return mutateState(state => {
      const event: SkillLearningEvent = {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        ...params,
      }
      state.events.push(event)
      return event
    })
  }

  function isCandidateVisibleFromCwd(candidate: SkillCandidate, cwd: string): boolean {
    if (candidate.scope === 'global') return true
    if (!candidate.projectRoot || !isAbsolute(candidate.projectRoot)) return false
    const projectRoot = resolve(candidate.projectRoot)
    const requested = resolve(cwd)
    return requested === projectRoot || requested.startsWith(`${projectRoot}${sep}`)
  }

  function isEventVisibleFromCwd(event: SkillLearningEvent, cwd: string): boolean {
    if (!event.projectRoot) return true
    const projectRoot = resolve(event.projectRoot)
    const requested = resolve(cwd)
    return requested === projectRoot || requested.startsWith(`${projectRoot}${sep}`)
  }

  async function collectMemoryRoot(root: string, scope: SkillMemoryScope): Promise<SkillMemoryOverview[]> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      return []
    }

    const records: SkillMemoryOverview[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const dir = resolve(root, entry.name)
      const stats = await readJson<Record<string, unknown> | null>(
        resolve(dir, SKILL_MEMORY_STATS_FILENAME),
        null,
      )
      if (!stats || typeof stats.skillName !== 'string') continue
      let summary: string | undefined
      try {
        const content = (await readFile(resolve(dir, SKILL_MEMORY_SUMMARY_FILENAME), 'utf-8')).trim()
        if (content) summary = content
      } catch {
        // a skill can be learning without having produced a summary yet
      }
      records.push({
        id: `${scope}:${entry.name}`,
        skillName: stats.skillName,
        scope,
        status: overviewStatus(stats.status),
        useCount: typeof stats.useCount === 'number' ? stats.useCount : 0,
        pendingCount: typeof stats.pendingCount === 'number' ? stats.pendingCount : 0,
        evidenceCount: typeof stats.evidenceCount === 'number' ? stats.evidenceCount : 0,
        ...(typeof stats.lastUsedAt === 'string' ? { lastUsedAt: stats.lastUsedAt } : {}),
        ...(typeof stats.summaryUpdatedAt === 'string' ? { summaryUpdatedAt: stats.summaryUpdatedAt } : {}),
        ...(summary === undefined ? {} : { summary }),
      })
    }
    return records
  }

  async function listSkillMemoryOverview(params: {
    roots: EvolutionRoots
  }): Promise<SkillMemoryOverview[]> {
    const groups = await Promise.all([
      collectMemoryRoot(getSkillMemoryRoot('global', params.roots), 'global'),
      ...(params.roots.projectConfigRoot
        ? [collectMemoryRoot(getSkillMemoryRoot('project', params.roots), 'project')]
        : []),
    ])
    return groups
      .flat()
      .sort((a, b) =>
        (b.summaryUpdatedAt ?? b.lastUsedAt ?? '').localeCompare(
          a.summaryUpdatedAt ?? a.lastUsedAt ?? '',
        ),
      )
  }

  async function ensureRoot(): Promise<string> {
    const root = getSkillLearningRoot(roots)
    await ensurePrivateDir(root)
    return root
  }

  return {
    ensureRoot,
    getCandidate,
    isCandidateVisibleFromCwd,
    isEventVisibleFromCwd,
    listSkillMemoryOverview,
    readConfig,
    readState,
    recordEvent,
    saveCandidate,
    updateCandidate,
    updateConfig,
  }
}

function overviewStatus(value: unknown): SkillMemoryOverview['status'] {
  return value === 'stale' || value === 'archived' || value === 'pinned'
    ? value
    : 'active'
}

export type EvolutionStore = ReturnType<typeof createEvolutionStore>
