/**
 * rin agent-migration — Cordis plugin entry.
 *
 * Exposes a ctx.agentMigration service whose scan and item operations use the
 * same DTO consumed by the Host API and the Web page.
 *
 * @module @rin/agent-migration
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_TARGET_AGENT_ID, scanAgentMigration as scanAgentMigrationOnDisk } from './scan.ts'
import {
  discoverItems,
  migrateItems,
  previewItem,
  toAgentMigrationItem,
} from './items.ts'
import type { MigrationItem } from './items.ts'
import type {
  AgentMigrationPreview,
  ExternalAgentId,
  AgentMigrationRequest,
  AgentMigrationResult,
  AgentMigrationScan,
} from './types.ts'

export type * from './types.ts'
export { AGENT_SOURCES, DEFAULT_TARGET_AGENT_ID, scanAgentMigration } from './scan.ts'
export type { AgentSource } from './scan.ts'
export {
  discoverItems,
  migrateItems,
  previewItem,
  toAgentMigrationItem,
} from './items.ts'
export type { MigrationItem, MigrationResult } from './items.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentMigration: AgentMigrationService
  }
}

/** Plugin configuration. */
export interface Config {
  /** Home directory to scan for external agent configs; defaults to the OS home. */
  homeDir?: string
  /** Destination agent id reported by scan(); defaults to 'claude-code'. */
  targetAgentId?: string
}

/** The agent-migration service exposed on the shared context. */
export abstract class AgentMigrationService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'agentMigration')
  }

  /** @param targetAgentId - destination reported in the scan. @returns detected agents. */
  abstract scan(targetAgentId?: string): Promise<AgentMigrationScan>

  /** @param agentId - detected external agent id. @returns discovered internal items. */
  abstract listItems(agentId: ExternalAgentId): Promise<MigrationItem[]>

  /** @param agentId - source agent. @param itemId - item id. @returns the item and preview text. */
  abstract preview(agentId: ExternalAgentId, itemId: string): Promise<AgentMigrationPreview>

  /** @param request - source, destination, and selected items. @returns migration counts. */
  abstract migrate(request: AgentMigrationRequest): Promise<AgentMigrationResult>
}

/** File-backed implementation delegating to the smoke-testable scan and item cores. */
export class FileAgentMigrationService extends AgentMigrationService {
  private readonly config: Config

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.config = config
  }

  override async scan(targetAgentId = this.targetAgentId()): Promise<AgentMigrationScan> {
    const basic = await scanAgentMigrationOnDisk(this.homeDir(), targetAgentId)
    const agents = await Promise.all(basic.agents.map(async agent => {
      const items = await discoverItems(agent.id, agent.source)
      const richItems = items.map(item => toAgentMigrationItem(item, this.skillsRoot(), this.rulesRoot()))
      return {
        ...agent,
        counts: {
          skills: richItems.filter(item => item.kind === 'skill').length,
          memories: richItems.filter(item => item.kind === 'memory').length,
          instructions: richItems.filter(item => item.kind === 'instruction').length,
          projects: 0,
        },
        items: richItems,
        projects: [],
      }
    }))
    return { ...basic, targetAgentId, agents }
  }

  override async listItems(agentId: ExternalAgentId): Promise<MigrationItem[]> {
    const root = await this.findRoot(agentId)
    return discoverItems(agentId, root)
  }

  override async preview(agentId: ExternalAgentId, itemId: string): Promise<AgentMigrationPreview> {
    const item = (await this.listItems(agentId)).find(entry => entry.id === itemId)
    if (item === undefined) throw new Error('Migration item was not found')
    return {
      item: toAgentMigrationItem(item, this.skillsRoot(), this.rulesRoot()),
      ...(await previewItem(item)),
    }
  }

  override async migrate(request: AgentMigrationRequest): Promise<AgentMigrationResult> {
    if (request.projectIds !== undefined && request.projectIds.length > 0) {
      throw new Error('project migration is not supported by the current adapter')
    }
    const all = await this.listItems(request.agentId)
    const selected = request.allRecommended
      ? all.filter(item => item.sizeBytes <= 2 * 1024 * 1024)
      : all.filter(item => (request.itemIds ?? []).includes(item.id))
    const result = await migrateItems(selected, this.skillsRoot(), this.rulesRoot())
    return { ...result, registeredProjects: [] }
  }

  private homeDir(): string {
    return typeof this.config.homeDir === 'string' && this.config.homeDir.trim() !== ''
      ? this.config.homeDir
      : homedir()
  }

  private targetAgentId(): string {
    return typeof this.config.targetAgentId === 'string' && this.config.targetAgentId.trim() !== ''
      ? this.config.targetAgentId
      : DEFAULT_TARGET_AGENT_ID
  }

  private rinHome(): string {
    return process.env.RIN_HOME !== undefined && process.env.RIN_HOME.trim() !== ''
      ? process.env.RIN_HOME
      : join(homedir(), '.rin')
  }

  private skillsRoot(): string {
    return join(this.rinHome(), 'skill-memory', 'skills')
  }

  private rulesRoot(): string {
    return join(this.rinHome(), 'rules')
  }

  private async findRoot(agentId: string): Promise<string> {
    const scan = await scanAgentMigrationOnDisk(this.homeDir(), this.targetAgentId())
    const agent = scan.agents.find(entry => entry.id === agentId)
    if (agent === undefined) throw new Error('External agent was not detected')
    return agent.source
  }
}

export const name = 'agent-migration'
export const inject = []

/** Install the file-backed agent-migration service into the shared context. */
export function apply(ctx: Context, config: Config = {}): void {
  ctx.plugin(FileAgentMigrationService, config)
}
