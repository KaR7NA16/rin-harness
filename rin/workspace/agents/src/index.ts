/**
 * rin agents — Cordis plugin entry.
 *
 * Exposes a ctx.rinAgents service managing two durable stores — repository agent
 * records (with content revisions) and runtime agent definitions — plus the
 * projection into the dsh agent-presets user root and the AI-proposal helper.
 * The default proposal adapter, when a caller injects none, wraps the dsh llm
 * seam (ctx.get('llm')) when present.
 *
 * @module @rin/agents
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { writableRoot, type PresetRoot } from '@deepseek-ai/dsh-agent-presets'
import {
  createRepositoryAgent as createRepositoryAgentOnDisk,
  deleteRepositoryAgent as deleteRepositoryAgentOnDisk,
  getRepositoryAgent as getRepositoryAgentOnDisk,
  listRepositoryAgents as listRepositoryAgentsOnDisk,
  updateRepositoryAgent as updateRepositoryAgentOnDisk,
} from './repository-agents.ts'
import {
  createRuntimeAgent as createRuntimeAgentOnDisk,
  deleteRuntimeAgent as deleteRuntimeAgentOnDisk,
  getRuntimeAgent as getRuntimeAgentOnDisk,
  listRuntimeAgents as listRuntimeAgentsOnDisk,
  updateRuntimeAgent as updateRuntimeAgentOnDisk,
} from './runtime-agents.ts'
import { projectRepositoryAgents as projectRepositoryAgentsToRoot } from './projection.ts'
import { proposeAgent as proposeAgentCore } from './proposal.ts'
import { registerAgentsSeam, type AgentsSeam } from './seam.ts'
import { expandHome, resolveDefaultPresetRoot } from './paths.ts'
import type {
  AgentGenerate,
  AgentProposal,
  ProjectionResult,
  ProjectOptions,
  RepositoryAgentInput,
  RepositoryAgentRecord,
  RepositoryAgentUpdateInput,
  RuntimeAgentDefinition,
  RuntimeAgentInput,
  RuntimeAgentUpdateInput,
} from './types.ts'

// The smoke-testable, package-root API.
export type * from './types.ts'
export { computeRevision } from './revision.ts'
export {
  createRepositoryAgent,
  deleteRepositoryAgent,
  getRepositoryAgent,
  listRepositoryAgents,
  resolveAgentsRoot,
  updateRepositoryAgent,
} from './repository-agents.ts'
export {
  createRuntimeAgent,
  deleteRuntimeAgent,
  getRuntimeAgent,
  listRuntimeAgents,
  resolveRuntimeAgentPath,
  updateRuntimeAgent,
} from './runtime-agents.ts'
export {
  assertValidPresetId,
  COMPOSITION_FILE,
  PRESET_ID,
  projectRepositoryAgents,
  renderAgentCordisYaml,
} from './projection.ts'
export { buildAgentProposalPrompt, parseAgentProposal, proposeAgent } from './proposal.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    rinAgents: AgentStore
  }
}

/** Plugin configuration. */
export interface Config {
  /** Root for runtime agent definitions; `~` expands. Defaults to ~/.rin/agents. */
  agentsHome?: string
  /** Repository root used when a caller names none; empty means "pass one explicitly". */
  defaultRepositoryRoot?: string
  /** Project repository agents into the preset root on each `agent/created`. Defaults to true. */
  autoProject?: boolean
}

/** Default runtime-agent home, expanded against the OS home at use time. */
export const DEFAULT_AGENTS_HOME = '~/.rin/agents'

/** Resolved configuration with defaults applied. */
interface ResolvedConfig {
  agentsHome: string
  defaultRepositoryRoot: string
}

/** The minimal dsh llm seam surface the default proposal adapter consumes. */
interface LlmSeam {
  stream(options: {
    provider: string
    model: string
    messages: Array<{ role: string; content: string }>
  }): AsyncIterable<{ type: string; text?: string }>
  listProviders?(): Array<{ id: string }>
  listModels?(provider: string): Promise<Array<{ id: string }>>
}

/** The agent service exposed on the shared context. */
export abstract class AgentStore extends Service {
  constructor(ctx: Context) {
    super(ctx, 'rinAgents')
  }

  /** The repository root used when a caller names none ('' when unset). */
  abstract readonly defaultRepositoryRoot: string

  abstract listRepositoryAgents(repositoryRoot?: string): Promise<RepositoryAgentRecord[]>
  abstract getRepositoryAgent(repositoryRoot: string | undefined, id: string): Promise<RepositoryAgentRecord | undefined>
  abstract createRepositoryAgent(repositoryRoot: string | undefined, input: RepositoryAgentInput): Promise<RepositoryAgentRecord>
  abstract updateRepositoryAgent(repositoryRoot: string | undefined, id: string, input: RepositoryAgentUpdateInput): Promise<RepositoryAgentRecord>
  abstract deleteRepositoryAgent(repositoryRoot: string | undefined, id: string): Promise<void>

  abstract listRuntimeAgents(): Promise<RuntimeAgentDefinition[]>
  abstract getRuntimeAgent(name: string): Promise<RuntimeAgentDefinition | undefined>
  abstract createRuntimeAgent(input: RuntimeAgentInput): Promise<RuntimeAgentDefinition>
  abstract updateRuntimeAgent(name: string, input: RuntimeAgentUpdateInput): Promise<RuntimeAgentDefinition>
  abstract deleteRuntimeAgent(name: string): Promise<void>

  abstract projectRepositoryAgents(repositoryRoot?: string, options?: ProjectOptions): Promise<ProjectionResult>
  abstract proposeAgent(instructions: string, generate?: AgentGenerate): Promise<AgentProposal>
}

/** File-backed implementation delegating to the smoke-testable modules. */
export class FileAgentStore extends AgentStore {
  private readonly config: ResolvedConfig

  constructor(ctx: Context, config: ResolvedConfig) {
    super(ctx)
    this.config = config
  }

  get defaultRepositoryRoot(): string {
    return this.config.defaultRepositoryRoot
  }

  override listRepositoryAgents(repositoryRoot?: string) {
    return listRepositoryAgentsOnDisk(this.requireRepositoryRoot(repositoryRoot))
  }

  override getRepositoryAgent(repositoryRoot: string | undefined, id: string) {
    return getRepositoryAgentOnDisk(this.requireRepositoryRoot(repositoryRoot), id)
  }

  override createRepositoryAgent(repositoryRoot: string | undefined, input: RepositoryAgentInput) {
    return createRepositoryAgentOnDisk(this.requireRepositoryRoot(repositoryRoot), input)
  }

  override updateRepositoryAgent(repositoryRoot: string | undefined, id: string, input: RepositoryAgentUpdateInput) {
    return updateRepositoryAgentOnDisk(this.requireRepositoryRoot(repositoryRoot), id, input)
  }

  override deleteRepositoryAgent(repositoryRoot: string | undefined, id: string) {
    return deleteRepositoryAgentOnDisk(this.requireRepositoryRoot(repositoryRoot), id)
  }

  override listRuntimeAgents() {
    return listRuntimeAgentsOnDisk(expandHome(this.config.agentsHome))
  }

  override getRuntimeAgent(name: string) {
    return getRuntimeAgentOnDisk(expandHome(this.config.agentsHome), name)
  }

  override createRuntimeAgent(input: RuntimeAgentInput) {
    return createRuntimeAgentOnDisk(expandHome(this.config.agentsHome), input)
  }

  override updateRuntimeAgent(name: string, input: RuntimeAgentUpdateInput) {
    return updateRuntimeAgentOnDisk(expandHome(this.config.agentsHome), name, input)
  }

  override deleteRuntimeAgent(name: string) {
    return deleteRuntimeAgentOnDisk(expandHome(this.config.agentsHome), name)
  }

  override projectRepositoryAgents(repositoryRoot?: string, options?: ProjectOptions) {
    return projectRepositoryAgentsToRoot(this.requireRepositoryRoot(repositoryRoot), this.resolvePresetRoot(options?.presetRoot))
  }

  override async proposeAgent(instructions: string, generate?: AgentGenerate): Promise<AgentProposal> {
    const adapter = generate ?? await this.defaultGenerate()
    if (adapter === undefined) {
      throw new Error('rin agents: no proposal adapter — pass one or compose a dsh llm seam (ctx.get("llm"))')
    }
    return proposeAgentCore(instructions, adapter)
  }

  /** Resolve the repository root from the argument or the configured default. */
  private requireRepositoryRoot(repositoryRoot: string | undefined): string {
    const root = repositoryRoot ?? this.config.defaultRepositoryRoot
    if (root.trim() === '') {
      throw new Error('rin agents: repository root not configured; pass an explicit root or set config.defaultRepositoryRoot')
    }
    return root
  }

  /** Resolve the user preset root, honouring an explicit root over the default. */
  private resolvePresetRoot(explicit: string | undefined): string {
    const path = explicit ?? resolveDefaultPresetRoot()
    const roots: PresetRoot[] = [{ path, trust: 'user' }]
    return writableRoot(roots)
  }

  /**
   * Build a proposal adapter from the dsh llm seam, when one is composed.
   *
   * Best-effort: it resolves the first registered provider and model, then
   * collects text deltas from a one-shot stream. The exact seam surface must
   * be confirmed on the real machine (see README Known Limitations).
   * @returns the adapter, or undefined when no usable llm seam is present.
   */
  private async defaultGenerate(): Promise<AgentGenerate | undefined> {
    const llm = this.ctx.get('llm') as LlmSeam | undefined
    if (llm === undefined || typeof llm.stream !== 'function') return undefined
    const provider = llm.listProviders?.()[0]?.id
    if (provider === undefined) return undefined
    const model = (await llm.listModels?.(provider))?.[0]?.id
    if (model === undefined) return undefined
    return async (prompt: string): Promise<string> => {
      const text: string[] = []
      for await (const chunk of llm.stream({ provider, model, messages: [{ role: 'user', content: prompt }] })) {
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text.push(chunk.text)
      }
      return text.join('')
    }
  }
}

export const name = 'agents'
export const inject = []

/** Install the file-backed agent service and register the auto-projection seam. */
export function apply(ctx: Context, config: Config = {}): void {
  ctx.plugin(FileAgentStore, resolveConfig(config))
  registerAgentsSeam(ctx as unknown as AgentsSeam, config)
}

/** Apply defaults to the plugin configuration. */
function resolveConfig(config: Config): ResolvedConfig {
  return {
    agentsHome: typeof config.agentsHome === 'string' && config.agentsHome.trim() !== ''
      ? config.agentsHome
      : DEFAULT_AGENTS_HOME,
    defaultRepositoryRoot: typeof config.defaultRepositoryRoot === 'string' ? config.defaultRepositoryRoot : '',
  }
}
