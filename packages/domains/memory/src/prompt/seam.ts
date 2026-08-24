/**
 * rin prompt-memory — system prompt seam projection (structural, cordis-free).
 *
 * Registers the prompt memory (SOUL identity + BRIEF/USER memory) as an ordered
 * system prompt section and keeps that section in sync with the store on every
 * assembly through the `system-prompt/assemble` waterfall. The seam is
 * structural: it consumes only the minimal context surface declared here, so
 * the wiring is strip-types smoke-testable without @deepseek-ai/cordis.
 *
 * @module @rin/memory/prompt
 */

import {
  boundPromptMemoryPair,
  boundPromptMemoryText,
} from './budget.ts'
import { SOUL_CHAR_LIMIT, USER_PROMPT_MEMORY_CHAR_LIMIT } from './types.ts'
import type { PromptMemoryFile, PromptMemoryStatus } from './types.ts'
import type {
  MemoryInjectionRecord,
  MemoryItem,
  MemoryItemInput,
  MemoryListOptions,
} from '@rin/memory'
import { removeMemoryProjectionSource, syncMemoryProjection } from '@rin/memory'

import {
  buildPromptMemorySectionText,
  type PromptMemoryProjectionOptions,
} from './projection.ts'

export const PROMPT_MEMORY_SECTION_NAME = 'rin:prompt-memory'

/** Prompt order of the memory section: after the persona (0), before tool guidance (100–199). */
export const PROMPT_MEMORY_SECTION_ORDER = 50

/** One assembled system prompt, mirroring the seam's merge-extensible input. */
export interface PromptAssembly {
  sections: Array<{ name: string; text: string }>
  contexts: Array<{ name: string; text: string }>
  tools: unknown[]
  variables: Record<string, string | undefined>
}

/** An expert waterfall listener over the assembled system prompt. */
export type PromptAssemblyListener = (
  assembly: PromptAssembly,
  context: unknown,
  next: () => Promise<PromptAssembly>,
) => Promise<PromptAssembly> | void

/** The minimal context surface the projection consumes (structural subset of Context). */
export interface PromptMemorySeam {
  systemPrompt: {
    /** Register an ordered prompt section; returns its disposer. */
    section(section: { name: string; order: number; text: string }): () => void
  }
  /** Register an event listener; returns its disposer. */
  on(event: string, listener: PromptAssemblyListener): () => void
  /** Register a disposal callback for the owning context. */
  effect(disposer: () => void, label?: string): void
  promptMemory: {
    getStatus(): Promise<PromptMemoryStatus>
  }
  /** Optional canonical catalog used to audit model-visible memory versions. */
  memory?: {
    list(options?: MemoryListOptions): MemoryItem[]
    get(id: string): MemoryItem | undefined
    upsert(input: MemoryItemInput): MemoryItem
    delete(id: string): boolean
    recordInjection(input: MemoryInjectionRecord): MemoryInjectionRecord
  }
}

/**
 * Project prompt memory into the system prompt.
 *
 * Registers an ordered section with the current store snapshot, then keeps its
 * text in sync with the store by re-reading on every `system-prompt/assemble`.
 * All registrations are disposed together when the owning context is disposed.
 *
 * @param ctx - the structural context surface (systemPrompt + promptMemory).
 * @param options - which memory components to include.
 */
export async function registerPromptMemorySeam(
  ctx: PromptMemorySeam,
  options: PromptMemoryProjectionOptions,
): Promise<void> {
  const initial = await ctx.promptMemory.getStatus()
  syncPromptMemoryCatalog(ctx, initial, options)
  const disposeSection = ctx.systemPrompt.section({
    name: PROMPT_MEMORY_SECTION_NAME,
    order: PROMPT_MEMORY_SECTION_ORDER,
    text: buildPromptMemorySectionText(initial, options),
  })

  const disposeListener = ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembled = await next()
    const status = await ctx.promptMemory.getStatus()
    syncPromptMemoryCatalog(ctx, status, options, true)
    const text = buildPromptMemorySectionText(status, options)
    return {
      ...assembled,
      sections: assembled.sections.map(section =>
        section.name === PROMPT_MEMORY_SECTION_NAME ? { ...section, text } : section,
      ),
    }
  })

  ctx.effect(() => {
    disposeListener()
    disposeSection()
  }, 'prompt-memory.seam')
}

function projectedFiles(
  status: PromptMemoryStatus,
  options: PromptMemoryProjectionOptions,
): Array<{ file: PromptMemoryFile; content: string }> {
  const { soul, brief, user } = status.files
  const files: Array<{ file: PromptMemoryFile; content: string }> = []
  if (options.injectSoul) {
    const bounded = boundPromptMemoryText('SOUL.md', soul.content, SOUL_CHAR_LIMIT)
    if (bounded.content !== '') files.push({ file: soul, content: bounded.content })
  }
  if (options.injectBrief) {
    const pair = boundPromptMemoryPair({ brief: brief.content, user: user.content })
    if (pair.brief.content !== '') files.push({ file: brief, content: pair.brief.content })
    if (pair.user.content !== '') files.push({ file: user, content: pair.user.content })
  } else {
    const bounded = boundPromptMemoryText('USER.md', user.content, USER_PROMPT_MEMORY_CHAR_LIMIT)
    if (bounded.content !== '') files.push({ file: user, content: bounded.content })
  }
  return files
}

function syncPromptMemoryCatalog(
  ctx: PromptMemorySeam,
  status: PromptMemoryStatus,
  options: PromptMemoryProjectionOptions,
  recordInjection = false,
): void {
  const memory = ctx.memory
  if (memory === undefined) return
  const files = projectedFiles(status, options)
  const projectedTargets = new Set(files.map(({ file }) => file.target))
  for (const target of ['soul', 'brief', 'user'] as const) {
    if (!projectedTargets.has(target)) {
      removeMemoryProjectionSource(memory, 'prompt-memory', 'prompt-memory:' + target)
    }
  }
  const items = files.map(({ file, content }) => syncMemoryProjection(memory, {
    id: `prompt-memory:${file.target}`,
    projection: 'prompt-memory',
    kind: 'prompt',
    content,
    visibility: 'model',
    source: {
      id: `prompt-memory:${file.target}`,
      kind: 'file',
      uri: `prompt-memory/${file.filename}`,
      label: file.target,
    },
    metadata: { target: file.target, projected: true },
  }))
  if (!recordInjection || items.length === 0) return
  memory.recordInjection({
    surface: 'system-prompt',
    memoryIds: items.map(item => item.id),
    memoryVersions: Object.fromEntries(items.map(item => [item.id, item.version])),
    metadata: { projection: 'prompt-memory', section: PROMPT_MEMORY_SECTION_NAME },
  })
}
