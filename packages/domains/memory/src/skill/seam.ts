/**
 * rin skill-memory — dsh skill provider projection.
 *
 * Wires the file-backed skill-memory catalog into ctx.skills as a provider, so
 * each remembered skill's distilled SUMMARY.md is loadable through the standard
 * skill seam. Discovery applies the deterministic lifecycle gate (archived and
 * empty memories stay hidden) and derives stable `skill-memory-*` names so
 * the projected memories never shadow the skills they recall.
 *
 * @module @rin/memory/skill
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  SkillCandidate,
  SkillDefinition,
  SkillInvocationPolicy,
  SkillLookupOptions,
  SkillProvider,
  SkillProviderControl,
  SkillSource,
} from '@deepseek-ai/dsh-skill'
import {
  listSkillMemoryEntries,
  readSkillMemoryDir,
  skillMemoryDescription,
  SKILL_MEMORY_GLOBAL_RANK,
  SKILL_MEMORY_PROJECT_RANK,
  type SkillMemoryCatalogEntry,
} from './catalog.ts'
import type { SkillMemoryRoots, SkillMemoryScope } from './types.ts'

/** Default provider name registered on ctx.skills. */
export const SKILL_MEMORY_PROVIDER_NAME = 'rin-skill-memory'

/** Prompt-visible source bucket for every projected memory. */
const SKILL_MEMORY_SOURCE: SkillSource = 'rin-skill-memory'

/** Invocation policy: memories are model- and user-invocable like runtime skills. */
const SKILL_MEMORY_INVOCATION: SkillInvocationPolicy = {
  modelInvocable: true,
  userInvocable: true,
}

/** Opaque discovery handle passed back to get(). */
interface SkillMemoryLocator {
  dir: string
  scope: SkillMemoryScope
}

/** Seam configuration consumed by registerSkillMemorySeam. */
export interface SkillMemorySeamConfig {
  /** Config roots that locate the skill-memory store; omit to register an empty provider. */
  roots?: SkillMemoryRoots
  /** Unique provider name; defaults to SKILL_MEMORY_PROVIDER_NAME. */
  providerName?: string
}

/** Provider that maps the file-backed skill-memory store into ctx.skills. */
export class SkillMemoryProvider implements SkillProvider {
  readonly name: string
  private readonly roots: SkillMemoryRoots | undefined
  private disposed = false

  /**
   * @param control - registration-scoped lifecycle and invalidation control.
   * @param roots - config roots locating the store; undefined yields an empty catalog.
   * @param providerName - unique provider name; defaults to SKILL_MEMORY_PROVIDER_NAME.
   */
  constructor(
    control: SkillProviderControl,
    roots: SkillMemoryRoots | undefined,
    providerName?: string,
  ) {
    this.roots = roots
    this.name = providerName ?? SKILL_MEMORY_PROVIDER_NAME
    control.signal.addEventListener('abort', () => { this.disposed = true }, { once: true })
  }

  /**
   * List skill-memory candidates across the global and project roots.
   * @param _options - lookup options (unused; memory roots are injected, not cwd-sensitive).
   * @returns a complete candidate array, empty when unconfigured or disposed.
   */
  async list(_options: SkillLookupOptions): Promise<readonly SkillCandidate[]> {
    if (this.disposed || this.roots === undefined) return []
    const entries = await listSkillMemoryEntries(this.roots)
    return entries.map(entry => this.toCandidate(entry))
  }

  /**
   * Load a complete memory body for a previously listed candidate.
   * @param candidate - the winning candidate returned by this provider.
   * @param _options - lookup options (unused).
   * @returns the full memory skill, or undefined when it is no longer loadable.
   */
  async get(
    candidate: SkillCandidate,
    _options: SkillLookupOptions,
  ): Promise<SkillDefinition | undefined> {
    const locator = candidate.locator as SkillMemoryLocator
    const entry = await readSkillMemoryDir(locator.dir, locator.scope)
    if (entry === null) return undefined
    return this.toDefinition(entry)
  }

  /** Stop serving catalog entries; any later list() returns an empty catalog. */
  dispose(): void {
    this.disposed = true
  }

  private toCandidate(entry: SkillMemoryCatalogEntry): SkillCandidate {
    return {
      name: entry.name,
      description: skillMemoryDescription(entry.content),
      invocation: SKILL_MEMORY_INVOCATION,
      source: SKILL_MEMORY_SOURCE,
      provider: this.name,
      rank: entry.scope === 'project' ? SKILL_MEMORY_PROJECT_RANK : SKILL_MEMORY_GLOBAL_RANK,
      locator: { dir: entry.dir, scope: entry.scope },
      resourceBase: { kind: 'directory', path: entry.dir },
      path: entry.summaryPath,
      metadata: { skillName: entry.skillName, scope: entry.scope, status: entry.status },
    }
  }

  private toDefinition(entry: SkillMemoryCatalogEntry): SkillDefinition {
    return {
      name: entry.name,
      description: skillMemoryDescription(entry.content),
      invocation: SKILL_MEMORY_INVOCATION,
      source: SKILL_MEMORY_SOURCE,
      provider: this.name,
      resourceBase: { kind: 'directory', path: entry.dir },
      content: entry.content,
      path: entry.summaryPath,
      metadata: { skillName: entry.skillName, scope: entry.scope, status: entry.status },
    }
  }
}

/**
 * Register the skill-memory provider on ctx.skills.
 * @param ctx - the plugin context (must inject `skills`).
 * @param config - seam configuration carrying the config roots and optional provider name.
 */
export function registerSkillMemorySeam(ctx: Context, config: SkillMemorySeamConfig = {}): void {
  ctx.skills.registerProvider(
    (control) => new SkillMemoryProvider(control, config.roots, config.providerName),
  )
}
