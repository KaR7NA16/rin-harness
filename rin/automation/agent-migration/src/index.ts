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
import { DEFAULT_TARGET_AGENT_ID, scanAgentMigration as scanAgentMigrationOnDisk } from './scan.ts'
import type { AgentMigrationScan } from './types.ts'

export type * from './types.ts'
export { AGENT_SOURCES, DEFAULT_TARGET_AGENT_ID, scanAgentMigration } from './scan.ts'
export type { AgentSource } from './scan.ts'

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
}

/** File-backed implementation delegating to the smoke-testable scan core. */
export class FileAgentMigrationService extends AgentMigrationService {
  private readonly config: Config

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.config = config
  }

  override scan(): Promise<AgentMigrationScan> {
    const homeDir = typeof this.config.homeDir === 'string' && this.config.homeDir.trim() !== ''
      ? this.config.homeDir
      : homedir()
    const targetAgentId = typeof this.config.targetAgentId === 'string' && this.config.targetAgentId.trim() !== ''
      ? this.config.targetAgentId
      : DEFAULT_TARGET_AGENT_ID
    return scanAgentMigrationOnDisk(homeDir, targetAgentId)
  }
}

export const name = 'agent-migration'
export const inject = []

/** Install the file-backed agent-migration service into the shared context. */
export function apply(ctx: Context, config: Config = {}): void {
  ctx.plugin(FileAgentMigrationService, config)
}
