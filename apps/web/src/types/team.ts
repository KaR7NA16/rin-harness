// Source: src/server/services/teamService.ts, src/server/ws/events.ts

export type TeamSummary = {
  name: string
  memberCount: number
  createdAt?: string
}

export type TeamMember = {
  agentId: string
  name?: string
  role: string
  status: 'running' | 'idle' | 'completed' | 'error'
  currentTask?: string
  color?: AgentColor
  sessionId?: string
}

export type TeamDetail = {
  name: string
  leadAgentId?: string
  leadSessionId?: string
  members: TeamMember[]
  createdAt?: string
}

export type AgentColor = 'red' | 'blue' | 'green' | 'yellow' | 'purple' | 'orange' | 'pink' | 'cyan'

export const AGENT_COLORS: AgentColor[] = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan']

export const AGENT_COLOR_HEX: Record<AgentColor, string> = {
  red: '#ef4444',
  orange: '#f97316',
  yellow: '#eab308',
  green: '#22c55e',
  blue: '#3b82f6',
  purple: '#a855f7',
  pink: '#ec4899',
  cyan: '#06b6d4',
}

/**
 * Returns a stable agent color for a given key (e.g. an Agent subtask
 * description or subagent type) so the same agent always gets the same
 * color identifier across messages.
 */
export function agentColorForKey(key: string | undefined): AgentColor {
  if (!key) return AGENT_COLORS[0]!
  let hash = 0
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0
  }
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length]!
}

export function agentColorHexForKey(key: string | undefined): string {
  return AGENT_COLOR_HEX[agentColorForKey(key)]
}

/** Lifecycle message types that should be filtered from agent output display */
export const AGENT_LIFECYCLE_TYPES = new Set([
  'shutdown_approved',
  'shutdown_rejected',
  'shutdown_request',
  'teammate_terminated',
  'idle_notification',
])
