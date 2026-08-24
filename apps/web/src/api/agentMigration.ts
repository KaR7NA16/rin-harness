import { api } from './client'
import type {
  AgentMigrationItem,
  ExternalAgentId,
  AgentMigrationPreview,
  AgentMigrationRequest,
  AgentMigrationResult,
  AgentMigrationScan,
  AgentMigrationProject,
  DetectedExternalAgent,
  ExternalAgentStatus,
} from '@rin/agent-migration'

export type {
  AgentMigrationItem,
  ExternalAgentId,
  AgentMigrationPreview,
  AgentMigrationRequest,
  AgentMigrationResult,
  AgentMigrationScan,
  AgentMigrationProject,
  DetectedExternalAgent,
  ExternalAgentStatus,
}

export const agentMigrationApi = {
  scan: (targetAgentId: ExternalAgentId = 'claude-code') =>
    api.get<AgentMigrationScan>(
      `/api/agent-migration?targetAgentId=${encodeURIComponent(targetAgentId)}`,
      { timeout: 120_000 },
    ),

  preview: (agentId: ExternalAgentId, itemId: string, targetAgentId: ExternalAgentId = 'claude-code') =>
    api.get<AgentMigrationPreview>(
      `/api/agent-migration/items/${encodeURIComponent(itemId)}?agentId=${encodeURIComponent(agentId)}&targetAgentId=${encodeURIComponent(targetAgentId)}`,
      { timeout: 120_000 },
    ),

  migrate: (input: {
    agentId: ExternalAgentId
    targetAgentId?: ExternalAgentId
    itemIds?: string[]
    projectIds?: string[]
    allRecommended?: boolean
  }) => api.post<AgentMigrationResult>('/api/agent-migration/migrate', input, { timeout: 120_000 }),
}
