/**
 * rin prompt memory — Cordis plugin entry.
 *
 * Exposes a ctx.promptMemory service (file-backed prompt memory) plus the
 * domain model: paths, budgets, insights, review log, config, seed, and store.
 * The service is also projected into the system prompt as an ordered section
 * (SOUL identity + BRIEF/USER memory, budget-bounded) kept in sync per assembly.
 *
 * @module @rin/prompt-memory
 */

import { Context, Service } from '@deepseek-ai/cordis'
import {
  readPromptMemoryConfig,
  updatePromptMemoryConfig,
} from './config.ts'
import {
  appendPromptMemoryReviewLogs,
  readPromptMemoryReviewLogs,
} from './reviewLog.ts'
import { registerPromptMemorySeam, type PromptMemorySeam } from './seam.ts'
import { createPromptMemoryStore } from './store.ts'
import type {
  PromptMemoryAutoReviewLogEntry,
  PromptMemoryConfig,
  PromptMemoryFile,
  PromptMemoryMutationResult,
  PromptMemoryRoots,
  PromptMemoryStatus,
  PromptMemoryTarget,
} from './types.ts'

export * from './types.ts'
export { boundPromptMemoryPair, boundPromptMemoryText } from './budget.ts'
export {
  buildPromptMemoryInsights,
  parsePromptMemoryInsight,
} from './insights.ts'
export {
  getBriefPath,
  getPromptMemoryConfigPath,
  getPromptMemoryDir,
  getSoulPath,
  getUserPromptMemoryPath,
} from './paths.ts'
export {
  DEFAULT_PROMPT_MEMORY_CONFIG,
  readPromptMemoryConfig,
  updatePromptMemoryConfig,
} from './config.ts'
export { ensurePromptMemorySeed } from './seed.ts'
export {
  PromptMemoryError,
  addPromptMemoryEntry,
  createPromptMemoryStore,
  formatPromptMemoryEntries,
  getPromptMemoryStatus,
  parsePromptMemoryEntries,
  parsePromptMemoryTarget,
  readPromptMemoryFile,
  removePromptMemoryEntry,
  replacePromptMemoryEntry,
  writePromptMemoryFile,
} from './store.ts'
export {
  appendPromptMemoryReviewLogs,
  getPromptMemoryReviewLogPath,
  readPromptMemoryReviewLogs,
} from './reviewLog.ts'
export {
  PROMPT_MEMORY_SECTION_NAME,
  PROMPT_MEMORY_SECTION_ORDER,
  registerPromptMemorySeam,
  type PromptAssembly,
  type PromptMemorySeam,
} from './seam.ts'
export {
  buildPromptMemorySectionText,
  type PromptMemoryProjectionOptions,
} from './projection.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    promptMemory: PromptMemoryService
    systemPrompt: PromptMemorySeam['systemPrompt']
  }
}

/** Configuration required to install the prompt memory service. */
export interface PromptMemoryPluginConfig {
  /** The directory prompt memory files are rooted under. */
  configRoot: string
  /** The identity written to SOUL.md when it does not already exist. */
  initialSoul: string
  /** Project prompt memory into the system prompt (default true). */
  injectPromptMemory?: boolean
  /** Include the SOUL identity in the projected section (default true). */
  injectSoul?: boolean
  /** Include the BRIEF working memory in the projected section (default true). */
  injectBrief?: boolean
}

/** The prompt memory service exposed on the shared context. */
export abstract class PromptMemoryService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'promptMemory')
  }

  abstract readFile(
    target: PromptMemoryTarget,
    options?: { seed?: boolean },
  ): Promise<PromptMemoryFile>

  abstract writeFile(
    target: PromptMemoryTarget,
    content: string,
  ): Promise<PromptMemoryFile>

  abstract getStatus(): Promise<PromptMemoryStatus>

  abstract addEntry(
    target: PromptMemoryTarget,
    content: string,
  ): Promise<PromptMemoryMutationResult>

  abstract replaceEntry(
    target: PromptMemoryTarget,
    oldText: string,
    content: string,
  ): Promise<PromptMemoryMutationResult>

  abstract removeEntry(
    target: PromptMemoryTarget,
    oldText: string,
  ): Promise<PromptMemoryMutationResult>

  abstract getConfig(): Promise<PromptMemoryConfig>

  abstract updateConfig(
    input: Pick<PromptMemoryConfig, 'injectEvolutionMemory'>,
  ): Promise<PromptMemoryConfig>

  abstract appendReviewLogs(
    entries: PromptMemoryAutoReviewLogEntry[],
  ): Promise<void>

  abstract readReviewLogs(
    limit?: number,
  ): Promise<PromptMemoryAutoReviewLogEntry[]>
}

/** File-backed implementation binding every operation to one configuration root. */
export class FilePromptMemoryService extends PromptMemoryService {
  private readonly roots: PromptMemoryRoots
  private readonly store: ReturnType<typeof createPromptMemoryStore>

  constructor(ctx: Context, config: PromptMemoryPluginConfig) {
    super(ctx)
    const resolved = resolvePluginConfig(config)
    this.roots = resolved.roots
    this.store = createPromptMemoryStore(this.roots, {
      initialSoul: resolved.initialSoul,
    })
  }

  override readFile(target: PromptMemoryTarget, options?: { seed?: boolean }) {
    return this.store.readFile(target, options)
  }

  override writeFile(target: PromptMemoryTarget, content: string) {
    return this.store.writeFile(target, content)
  }

  override getStatus() {
    return this.store.getStatus()
  }

  override addEntry(target: PromptMemoryTarget, content: string) {
    return this.store.addEntry(target, content)
  }

  override replaceEntry(
    target: PromptMemoryTarget,
    oldText: string,
    content: string,
  ) {
    return this.store.replaceEntry(target, oldText, content)
  }

  override removeEntry(target: PromptMemoryTarget, oldText: string) {
    return this.store.removeEntry(target, oldText)
  }

  override getConfig() {
    return readPromptMemoryConfig(this.roots)
  }

  override updateConfig(input: Pick<PromptMemoryConfig, 'injectEvolutionMemory'>) {
    return updatePromptMemoryConfig(this.roots, input)
  }

  override appendReviewLogs(entries: PromptMemoryAutoReviewLogEntry[]) {
    return appendPromptMemoryReviewLogs(this.roots, entries)
  }

  override readReviewLogs(limit?: number) {
    return readPromptMemoryReviewLogs(this.roots, limit)
  }
}

export const name = 'prompt-memory'
export const inject = ['systemPrompt']

/**
 * Install the file-backed prompt memory service and project it into the
 * system prompt.
 * @param ctx - the plugin context (must inject systemPrompt).
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: PromptMemoryPluginConfig): void {
  ctx.plugin(FilePromptMemoryService, config)
  const resolved = resolvePluginConfig(config)
  if (!resolved.injectPromptMemory) return
  registerPromptMemorySeam(ctx as unknown as PromptMemorySeam, {
    injectSoul: resolved.injectSoul,
    injectBrief: resolved.injectBrief,
  }).catch((error: unknown) => {
    ctx.logger.error('rin prompt-memory: system prompt projection failed: ' + String(error))
  })
}

/** Validate the plugin config and resolve the configuration root. */
function resolvePluginConfig(config: unknown): {
  roots: PromptMemoryRoots
  initialSoul: string
  injectPromptMemory: boolean
  injectSoul: boolean
  injectBrief: boolean
} {
  if (config === null || typeof config !== 'object') {
    throw new Error(
      'rin prompt-memory: plugin requires a config object with configRoot and initialSoul',
    )
  }
  const candidate = config as Partial<PromptMemoryPluginConfig>
  const configRoot = candidate.configRoot
  const initialSoul = candidate.initialSoul
  if (typeof configRoot !== 'string' || configRoot.trim() === '') {
    throw new Error('rin prompt-memory: config.configRoot must be a non-empty string')
  }
  if (typeof initialSoul !== 'string') {
    throw new Error('rin prompt-memory: config.initialSoul must be a string')
  }
  return {
    roots: { configRoot },
    initialSoul,
    injectPromptMemory: candidate.injectPromptMemory ?? true,
    injectSoul: candidate.injectSoul ?? true,
    injectBrief: candidate.injectBrief ?? true,
  }
}
