/**
 * rin web-server — JSON API route dispatch.
 *
 * Owns the optional-service accessors (RinServiceRefs) and the pathname
 * dispatcher that fans requests out to the per-service route modules. Each
 * module exports a handle() that returns null for pathnames it does not own.
 *
 * @module @rin/web-server
 */

import type { RepositoryStore } from '@rin/repository'
import type { EnvironmentStore } from '@rin/environment'
import type { KnowledgeStore } from '@rin/knowledge'
import type { SessionSearchStore } from '@rin/session-search'
import type { PromptMemoryService } from '@rin/prompt-memory'
import type { EvolutionService } from '@rin/evolution'
import type { SkillMemoryService } from '@rin/skill-memory'
import type { Config, JsonResponse, SmartPruningRef } from './types.ts'
import { handle as handleCore } from './routes/core.ts'
import { handle as handleKnowledge } from './routes/knowledge.ts'
import { handle as handleSessions } from './routes/sessions.ts'
import { handle as handlePromptMemory } from './routes/prompt-memory.ts'
import { handle as handleEvolution } from './routes/evolution.ts'
import { handle as handleSkillMemory } from './routes/skill-memory.ts'

/** Lazily-read optional @rin services, resolved at request time. */
export interface RinServiceRefs {
  repository(): RepositoryStore | undefined
  environment(): EnvironmentStore | undefined
  smartPruning(): SmartPruningRef | undefined
  knowledge(): KnowledgeStore | undefined
  sessionSearch(): SessionSearchStore | undefined
  promptMemory(): PromptMemoryService | undefined
  evolution(): EvolutionService | undefined
  skillMemory(): SkillMemoryService | undefined
}

/**
 * Dispatch one API pathname to its owning route module.
 * @param pathname - the URL pathname (no query string).
 * @param search - the URL query string (including the leading "?").
 * @param services - thunks that read the optional @rin services.
 * @param config - the resolved plugin configuration.
 * @returns the shaped response, or null when no route claims the pathname.
 */
export async function routeApi(
  pathname: string,
  search: string,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse | null> {
  return (await handleCore(pathname, search, services, config))
    ?? (await handleKnowledge(pathname, search, services, config))
    ?? (await handleSessions(pathname, search, services, config))
    ?? (await handlePromptMemory(pathname, search, services, config))
    ?? (await handleEvolution(pathname, search, services, config))
    ?? (await handleSkillMemory(pathname, search, services, config))
}
