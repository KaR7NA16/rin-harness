/**
 * rin agent-migration — Cordis plugin entry.
 *
 * Exposes a ctx.agentMigration service whose scan() reports which external
 * agent config directories exist under the host home. The scan core lives in
 * scan.ts and stays cordis-free so it can run under plain node.
 *
 * @module @rin/agent-migration
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_TARGET_AGENT_ID, scanAgentMigration as scanAgentMigrationOnDisk } from './scan.ts'
import { discoverItems, migrateItems, previewItem } from './items.ts'
import type { MigrationItem, MigrationResult } from './items.ts'
import type { AgentMigrationScan } from './types.ts'

export type * from './types.ts'
export { AGENT_SOURCES, DEFAULT_TARGET_AGENT_ID, scanAgentMigration } from './scan.ts'
export type { AgentSource } from './scan.ts'
export { discoverItems, migrateItems, previewItem } from './items.ts'
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

  /** Scan the home directory and report the detected external agents. */
  abstract scan(): Promise<AgentMigrationScan>

  /** Discover migratable items for one detected agent. */
  abstract listItems(agentId: string): Promise<MigrationItem[]>

  /** Preview one item's text prefix. */
  abstract preview(agentId: string, itemId: string): Promise<{ content: string; truncated: boolean }>

  /** Migrate selected items into the rin skill-memory and rules roots. */
  abstract migrate(agentId: string, itemIds: string[]): Promise<MigrationResult>
}

/** File-backed implementation delegating to the smoke-testable scan core. */
export class FileAgentMigrationService extends AgentMigrationService {
  private readonly config: Config

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.config = config
  }

  override scan(): Promise<AgentMigrationScan> {
    return scanAgentMigrationOnDisk(this.homeDir(), this.targetAgentId())
  }

  override async listItems(agentId: string): Promise<MigrationItem[]> {
    const root = await this.findRoot(agentId)
    return discoverItems(agentId, root)
  }

  override async preview(agentId: string, itemId: string): Promise<{ content: string; truncated: boolean }> {
    const item = (await this.listItems(agentId)).find(entry => entry.id === itemId)
    if (item === undefined) throw new Error('Migration item was not found')
    return previewItem(item)
  }

  override async migrate(agentId: string, itemIds: string[]): Promise<MigrationResult> {
    const all = await this.listItems(agentId)
    const selected = all.filter(item => itemIds.includes(item.id))
    return migrateItems(selected, this.skillsRoot(), this.rulesRoot())
  }

  private homeDir(): string {
    return typeof this.config.homeDir === 'string' && this.config.homeDir.trim() !== '' ? this.config.homeDir : homedir()
  }

  private targetAgentId(): string {
    return typeof this.config.targetAgentId === 'string' && this.config.targetAgentId.trim() !== '' ? this.config.targetAgentId : DEFAULT_TARGET_AGENT_ID
  }

  private rinHome(): string {
    return process.env.RIN_HOME !== undefined && process.env.RIN_HOME.trim() !== '' ? process.env.RIN_HOME : join(homedir(), '.rin')
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
