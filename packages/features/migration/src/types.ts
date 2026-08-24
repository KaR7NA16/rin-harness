/**
 * rin agent-migration — shared wire types.
 *
 * The same DTO is consumed by the Host routes and the Web page. Unsupported
 * project and multi-format migration remains explicit in the empty collections
 * and item compatibility fields rather than being advertised by the service.
 *
 * @module @rin/agent-migration
 */

/** Supported external-agent identifiers. */
export type ExternalAgentId =
  | 'openclaw'
  | 'claude-code'
  | 'codex'
  | 'cursor'
  | 'hermes-agent'
  | 'deepseek-tui'

/** Detection state of one external agent config root. */
export type ExternalAgentStatus = 'detected' | 'empty'

/** One supported item kind. */
export type AgentMigrationItemKind = 'skill' | 'memory' | 'instruction'

/** Scope of a migratable item. */
export type AgentMigrationItemScope = 'global' | 'project'

/** One item exposed to the migration UI. */
export type AgentMigrationItem = {
  id: string
  agentId: ExternalAgentId
  kind: AgentMigrationItemKind
  scope: AgentMigrationItemScope
  name: string
  sourcePath: string
  destinationPath: string
  destinationRoot: string
  projectPath: string | null
  sizeBytes: number
  modifiedAt: string
  previewable: boolean
  recommended: boolean
  selectable: boolean
  selectionIssue?: 'size-limit' | 'destination-conflict'
  destinationState: 'ready' | 'merge' | 'exists' | 'conflict'
  adaptation: 'native' | 'converted'
  destinationFormat: string
  writeMode:
    | 'skill-copy'
    | 'markdown-file'
    | 'markdown-merge'
    | 'agent-skill'
    | 'cursor-mdc'
    | 'hermes-memory'
    | 'codewhale-memory'
  compatibilityNote?: string
}

/** One project grouping returned by a future project-aware adapter. */
export type AgentMigrationProject = {
  id: string
  agentId: ExternalAgentId
  name: string
  path: string
  exists: boolean
  itemIds: string[]
  lastSeenAt: string | null
}

/** One external agent detected on disk. */
export type DetectedExternalAgent = {
  id: ExternalAgentId
  name: string
  source: string
  status: ExternalAgentStatus
  installed: boolean
  executablePath: string | null
  dataRoots: string[]
  counts: {
    skills: number
    memories: number
    instructions: number
    projects: number
  }
  items: AgentMigrationItem[]
  projects: AgentMigrationProject[]
}

/** Result of scanning all supported external agents. */
export type AgentMigrationScan = {
  scannedAt: string
  targetAgentId: string
  agents: DetectedExternalAgent[]
}

/** Preview response for one item. */
export type AgentMigrationPreview = {
  item: AgentMigrationItem
  content: string
  truncated: boolean
}

/** Migration request accepted by the Host route. */
export type AgentMigrationRequest = {
  agentId: ExternalAgentId
  targetAgentId?: ExternalAgentId
  itemIds?: string[]
  projectIds?: string[]
  allRecommended?: boolean
}

/** One item result from a migration attempt. */
export type AgentMigrationResultItem = {
  id: string
  status: 'imported' | 'skipped' | 'failed'
  destinationPath?: string
  message?: string
}

/** Aggregate migration result. */
export type AgentMigrationResult = {
  imported: number
  skipped: number
  failed: number
  registeredProjects: string[]
  items: AgentMigrationResultItem[]
}
