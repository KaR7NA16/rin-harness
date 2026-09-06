/**
 * rin prompt-memory — system prompt seam projection (structural, cordis-free).
 *
 * Projects the canonical cognition workspace into an ordered system prompt
 * section and keeps that section in sync on every assembly through the
 * `system-prompt/assemble` waterfall. The seam is structural: it consumes only
 * the minimal context surface declared here, so the wiring is strip-types
 * smoke-testable without @deepseek-ai/cordis.
 *
 * @module @rin/memory/prompt
 */
import { randomUUID } from 'node:crypto'

import { PROMPT_MEMORY_TOTAL_CHAR_LIMIT } from './types.ts'
import type { MemoryMaterializedState, MemoryProjectionCheckpoint } from '@rin/memory'
import { renderMemoryWorkspace } from '../recall.ts'
import type { MemoryRecallInput, MemoryRecallResult } from '../recall.ts'

import {
  buildCanonicalPromptMemorySectionText,
  hashCanonicalPromptMemoryProjection,
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
  effect(execute: () => void | (() => void), label?: string): void
  /** The canonical cognition surface that owns the projected model input. */
  memory?: {
    recall?: (input?: MemoryRecallInput) => Promise<MemoryRecallResult>
    readCognitionState?: () => MemoryMaterializedState
    getProjectionCheckpoint?: (projection: 'prompt-memory') => MemoryProjectionCheckpoint
    requireProjectionReady?: (projection: 'prompt-memory') => MemoryProjectionCheckpoint
    markProjectionDirty?: (projection: 'prompt-memory') => MemoryProjectionCheckpoint
    markProjectionCleanAtCurrent?: (
      projection: 'prompt-memory',
      materializedVersion: number,
      stateHash: string,
      updatedAt?: string,
    ) => MemoryProjectionCheckpoint
  }
}

/**
 * Project prompt memory into the system prompt.
 *
 * Registers an ordered section backed by the canonical cognition workspace,
 * then keeps its text in sync on every `system-prompt/assemble`. All
 * registrations are disposed together when the owning context is disposed.
 *
 * @param ctx - the structural context surface (systemPrompt + memory).
 * @param options - which memory components to include.
 */
export async function registerPromptMemorySeam(
  ctx: PromptMemorySeam,
  options: PromptMemoryProjectionOptions,
): Promise<void> {
  const canonical = getCanonicalMemorySurface(ctx)
  if (canonical === undefined) {
    throw new Error('rin prompt-memory: the canonical cognition surface is required for the prompt projection')
  }
  const initialText = await ensureCanonicalMemoryWorkspace(canonical, undefined, options)
  const disposeSection = ctx.systemPrompt.section({
    name: PROMPT_MEMORY_SECTION_NAME,
    order: PROMPT_MEMORY_SECTION_ORDER,
    text: initialText,
  })

  const disposeListener = ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    const text = await ensureCanonicalMemoryWorkspace(canonical, context, options)
    return {
      ...assembled,
      sections: assembled.sections.map(section =>
        section.name === PROMPT_MEMORY_SECTION_NAME ? { ...section, text } : section,
      ),
    }
  })

  ctx.effect(() => () => {
    disposeListener()
    disposeSection()
  }, 'prompt-memory.seam')
}

type CanonicalMemorySurface = {
  recall?: (input?: MemoryRecallInput) => Promise<MemoryRecallResult>
  readCognitionState(): MemoryMaterializedState
  getProjectionCheckpoint(projection: 'prompt-memory'): MemoryProjectionCheckpoint
  requireProjectionReady(projection: 'prompt-memory'): MemoryProjectionCheckpoint
  markProjectionDirty(projection: 'prompt-memory'): MemoryProjectionCheckpoint
  markProjectionCleanAtCurrent(
    projection: 'prompt-memory',
    materializedVersion: number,
    stateHash: string,
    updatedAt?: string,
  ): MemoryProjectionCheckpoint
}

function getCanonicalMemorySurface(ctx: PromptMemorySeam): CanonicalMemorySurface | undefined {
  const memory = ctx.memory
  if (
    memory === undefined
    || typeof memory.readCognitionState !== 'function'
    || typeof memory.getProjectionCheckpoint !== 'function'
    || typeof memory.requireProjectionReady !== 'function'
    || typeof memory.markProjectionDirty !== 'function'
    || typeof memory.markProjectionCleanAtCurrent !== 'function'
  ) {
    return undefined
  }
  return memory as CanonicalMemorySurface
}

async function ensureCanonicalMemoryWorkspace(
  surface: CanonicalMemorySurface,
  context: unknown,
  options: PromptMemoryProjectionOptions,
): Promise<string> {
  if (surface.recall === undefined) return ensureCanonicalPromptMemoryProjection(surface, options)
  const cycleId = 'recall-' + randomUUID()
  const input: MemoryRecallInput = { cycleId }
  const sessionId = promptContextSessionId(context)
  if (sessionId !== undefined) input.query = { sessionId }
  const result = await surface.recall(input)
  const text = renderMemoryWorkspace(result.workspace, PROMPT_MEMORY_TOTAL_CHAR_LIMIT)
  const state = surface.readCognitionState()
  const checkpoint = surface.getProjectionCheckpoint('prompt-memory')
  if (
    checkpoint.status !== 'clean'
    || checkpoint.materializedVersion !== state.version
    || checkpoint.stateHash !== result.workspace.hash
  ) {
    surface.markProjectionCleanAtCurrent('prompt-memory', state.version, result.workspace.hash)
  }
  surface.requireProjectionReady('prompt-memory')
  return text
}

function promptContextSessionId(context: unknown): string | undefined {
  if (context === null || typeof context !== 'object' || Array.isArray(context)) return undefined
  const record = context as { agent?: unknown }
  const agent = record.agent
  if (agent === null || typeof agent !== 'object' || Array.isArray(agent)) return undefined
  const id = (agent as { id?: unknown }).id
  return typeof id === 'string' && id.trim() !== '' ? id : undefined
}

function ensureCanonicalPromptMemoryProjection(
  surface: CanonicalMemorySurface,
  options: PromptMemoryProjectionOptions,
): string {
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const state = surface.readCognitionState()
      const text = buildCanonicalPromptMemorySectionText(state, options)
      const stateHash = hashCanonicalPromptMemoryProjection(state, text)
      const checkpoint = surface.getProjectionCheckpoint('prompt-memory')
      const needsRefresh = checkpoint.status !== 'clean'
        || checkpoint.materializedVersion !== state.version
        || checkpoint.stateHash !== stateHash
      if (needsRefresh) {
        surface.markProjectionCleanAtCurrent('prompt-memory', state.version, stateHash)
      }
      surface.requireProjectionReady('prompt-memory')
      return text
    } catch (error: unknown) {
      lastError = error
      try {
        surface.markProjectionDirty('prompt-memory')
      } catch {
        // Preserve the projection error; the next attempt can still observe a new state.
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}
