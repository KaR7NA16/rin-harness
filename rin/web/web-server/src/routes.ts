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
import type { FilesystemService } from '@rin/filesystem'
import type { SessionBackupService } from '@rin/session-backup'
import type { KnowledgeStore } from '@rin/knowledge'
import type { SessionSearchStore } from '@rin/session-search'
import type { PromptMemoryService } from '@rin/prompt-memory'
import type { EvolutionService } from '@rin/evolution'
import type { SkillMemoryService } from '@rin/skill-memory'
import type { AgentStore } from '@rin/agents'
import type { NotesStore } from '@rin/notes'
import type { SandboxStore } from '@rin/sandboxes'
import type { TaskStore } from '@rin/tasks'
import type { McpStore } from '@rin/mcp'
import type { ProviderProbeService } from '@rin/provider-probe'
import type { ComputerUseService } from '@rin/computer-use'
import type { AgentMigrationService } from '@rin/agent-migration'
import type { TeamStore } from '@rin/teams'
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
import { handle as handleLegacy } from './routes/legacy.ts'

/**
 * Minimal structural view of the dsh session services the legacy desktop API
 * needs. Kept structural so web-server does not require the dsh package graph.
 */
export interface DshSessionEventLike {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: unknown
}

export interface DshSessionLike {
  readonly id: string
  readonly events: readonly DshSessionEventLike[]
  readonly header?: { readonly cwd?: string }
  readonly seq?: number
}

export interface DshSessionStoreLike {
  list(): DshSessionLike[]
  get(id: string): DshSessionLike | undefined
  create(id?: string, options?: { meta?: { cwd?: string } }): DshSessionLike
  prepare(id?: string, options?: { meta?: { cwd?: string } }): DshSessionLike
}

export interface DshSessionPersistenceLike {
  list(): Promise<Array<{ readonly id: string; readonly createdAt: number; readonly cwd?: string }>>
  prepare(id: string): Promise<void>
}

/** Minimal structural view of the dsh agent registry used by the legacy chat bridge. */
export interface DshAgentLike {
  readonly id: string
  readonly session: { readonly id: string }
  readonly ctx: { on(event: string, listener: (...args: unknown[]) => void): unknown }
  followup(message: unknown): void
  cancel(cause: unknown): void
  whenIdle(): Promise<void>
}

export interface DshAgentHandleLike {
  readonly agent: DshAgentLike
  dispose(): Promise<void>
}

export interface DshAgentRegistryLike {
  create(options: unknown): Promise<DshAgentHandleLike>
  get(id: string): DshAgentHandleLike | undefined
}

export interface DshAgentDefaultModelLike {
  currentSelection(): { provider: string; model: string; reasoningEffort?: string }
  saveSelection(selection: { provider: string; model: string; reasoningEffort?: string }): Promise<void>
}

/** Minimal structural view of the dsh llm service used by the legacy model picker. */
export interface DshLlmLike {
  listProviders(): Array<{ id: string; name: string }>
  listModels(provider: string): Promise<Array<{ id: string; name: string }>>
}

/** Minimal structural view of the dsh settings provider. */
export interface DshSettingsLike {
  get(ns: string): unknown
  update(ns: string, patch: object): Promise<void>
}

/** Minimal structural view of the dsh credential provider. */
export interface DshCredentialsLike {
  describe(ref: string): Promise<{ configured: boolean; source?: string; writable: boolean }>
}

/** Minimal structural view of the dsh workspace registry. */
export interface DshWorkspaceRegistryLike {
  list(): Array<{
    id: string
    path: string
    title: string
    createdAt: string
    updatedAt: string
    sessionIds: readonly string[]
    status(): Promise<string>
  }>
}

/** Minimal structural view of the dsh command runtime. */
export interface DshCommandsLike {
  list(agent: unknown): ReadonlyArray<{ name: string; description: string; input?: { hint: string } }>
}

/** Minimal structural view of the dsh token meter. */
export interface DshTokenMeterLike {
  measure(session: unknown): {
    totalTokens: number
    surfaceTokens: number
    baseline: {
      kind: string
      tokens: number
      usage?: {
        inputTokens: number
        outputTokens: number
        cacheReadTokens?: number
        cacheWriteTokens?: number
      }
    }
  }
}

/** Minimal structural view of the dsh session projection registry. */
export interface DshSessionProjectionsLike {
  snapshot(session: unknown): {
    asOfSeq: number
    values: {
      tokenUsage?: {
        uncachedInputTokens: number
        outputTokens: number
        cacheReadTokens: number
        cacheWriteTokens: number
      }
      contextPressure?: {
        pressureTokens?: number
        projectedTokens?: number
        contextWindow?: number
      }
    }
  }
}

/** Minimal structural view of the dsh shell executor used by the legacy git probes. */
export interface DshShellLike {
  resolve(request: { command: string; workdir?: string }): unknown
  run(spec: unknown): Promise<{ exitCode: number | null; stdout: { text: string } }>
}

/** Lazily-read optional @rin services, resolved at request time. */
export interface RinServiceRefs {
  repository(): RepositoryStore | undefined
  environment(): EnvironmentStore | undefined
  filesystem(): FilesystemService | undefined
  sessionBackup(): SessionBackupService | undefined
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
  sessions(): DshSessionStoreLike | undefined
  sessionPersistence(): DshSessionPersistenceLike | undefined
  dshAgents(): DshAgentRegistryLike | undefined
  agentDefaultModel(): DshAgentDefaultModelLike | undefined
  settings(): DshSettingsLike | undefined
  llm(): DshLlmLike | undefined
  credentials(): DshCredentialsLike | undefined
  workspaceRegistry(): DshWorkspaceRegistryLike | undefined
  commands(): DshCommandsLike | undefined
  tokenMeter(): DshTokenMeterLike | undefined
  sessionProjections(): DshSessionProjectionsLike | undefined
  shell(): DshShellLike | undefined
  mcp(): McpStore | undefined
  providerProbe(): ProviderProbeService | undefined
  teams(): TeamStore | undefined
  tasks(): TaskStore | undefined
  computerUse(): ComputerUseService | undefined
  agentMigration(): AgentMigrationService | undefined
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
}
