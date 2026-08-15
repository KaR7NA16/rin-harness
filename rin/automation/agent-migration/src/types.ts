/**
 * rin agent-migration — shared types.
 *
 * @module @rin/agent-migration
 */

/** Detection state of one external agent's config directories. */
export type ExternalAgentStatus = 'detected' | 'empty'

/** One external agent whose config directory exists under the scanned home. */
export type DetectedExternalAgent = {
  /** Stable agent id, e.g. 'claude-code'. */
  id: string
  /** Human-readable agent name, e.g. 'Claude Code'. */
  name: string
  /** Absolute path of the first config root that exists for this agent. */
  source: string
  /** Whether the root holds agents/skills entries, or exists but is empty. */
  status: ExternalAgentStatus
}

/** Result of a single external-agent scan. */
export type AgentMigrationScan = {
  /** ISO timestamp of when the scan ran. */
  scannedAt: string
  /** Destination agent id the detected config would migrate into. */
  targetAgentId: string
  /** Detected external agents; empty when none of their directories exist. */
  agents: DetectedExternalAgent[]
}
