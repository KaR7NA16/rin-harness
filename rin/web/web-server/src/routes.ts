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
import type { AgentStore } from '@rin/agents'
import type { NotesStore } from '@rin/notes'
import type { SandboxStore } from '@rin/sandboxes'
import type { Config, JsonResponse, SmartPruningRef, TokenOptimizationRef } from './types.ts'
import { handle as handleCore } from './routes/core.ts'
import { handle as handleKnowledge } from './routes/knowledge.ts'
import { handle as handleSessions } from './routes/sessions.ts'
import { handle as handlePromptMemory } from './routes/prompt-memory.ts'
import { handle as handleEvolution } from './routes/evolution.ts'
import { handle as handleSkillMemory } from './routes/skill-memory.ts'
import { handle as handleAgents } from './routes/agents.ts'
import { handle as handleNotes } from './routes/notes.ts'
import { handle as handleSandboxes } from './routes/sandboxes.ts'
import { handle as handleToken } from './routes/token.ts'
import { handle as handleLegacy } from './routes/legacy.ts'

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
  agents(): AgentStore | undefined
  notes(): NotesStore | undefined
  sandboxes(): SandboxStore | undefined
  tokenOptimization(): TokenOptimizationRef | undefined
}

/**
 * Dispatch one API pathname to its owning route module.
 * @param pathname - the URL pathname (no query string).
 * @param search - the URL query string (including the leading "?").
 * @param method - the request method (GET/HEAD/POST).
 * @param body - the parsed JSON body for POST requests, or undefined.
 * @param services - thunks that read the optional @rin services.
 * @param config - the resolved plugin configuration.
 * @returns the shaped response, or null when no route claims the pathname.
 */
export async function routeApi(
  pathname: string,
  search: string,
  method: string,
  body: unknown,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse | null> {
  return (await handleLegacy(pathname, search, method, body, services, config))
    ?? (await handleCore(pathname, search, method, body, services, config))
    ?? (await handleKnowledge(pathname, search, method, body, services, config))
    ?? (await handleSessions(pathname, search, method, body, services, config))
    ?? (await handlePromptMemory(pathname, search, method, body, services, config))
    ?? (await handleEvolution(pathname, search, method, body, services, config))
    ?? (await handleSkillMemory(pathname, search, method, body, services, config))
    ?? (await handleAgents(pathname, search, method, body, services, config))
    ?? (await handleNotes(pathname, search, method, body, services, config))
    ?? (await handleSandboxes(pathname, search, method, body, services, config))
    ?? (await handleToken(pathname, search, method, body, services, config))
}
