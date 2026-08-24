/**
 * rin teams — domain model.
 *
 * Owns the values crossing the teams module seam: team summaries and details,
 * members with roles, and the create/update inputs plus plugin configuration.
 * The file-backed engine (storage.ts) owns persistence; this module owns the
 * types only.
 *
 * @module @rin/collaboration
 */

/** A member's role within a team. */
export type MemberRole = 'lead' | 'member'

/** A member's lifecycle status. */
export type MemberStatus = 'running' | 'completed' | 'idle' | 'failed'

/** One team member. */
export interface TeamMember {
  /** Stable identifier unique within the team. */
  agentId: string
  /** Human-readable member name. */
  name: string
  /** The member's role; `lead` marks the team lead. */
  role: MemberRole
  /** Optional agent kind this member runs as. */
  agentType?: string
  /** Optional model this member is configured with. */
  model?: string
  /** Optional display color. */
  color?: string
  /** Lifecycle status; only `running` counts toward `activeMemberCount`. */
  status: MemberStatus
  /** Epoch-milliseconds the member joined the team. */
  joinedAt: number
  /** The member's working directory. */
  cwd: string
  /** Optional session id backing this member's transcript. */
  sessionId?: string
}

/** One team's summary, without its member list. */
export interface TeamSummary {
  /** Team name; unique within the store. */
  name: string
  /** Optional free-text description. */
  description?: string
  /** Epoch-milliseconds the team was created. */
  createdAt: number
  /** Epoch-milliseconds the team was last modified. */
  updatedAt: number
  /** Number of members. */
  memberCount: number
  /** Number of members whose status is `running`. */
  activeMemberCount: number
}

/** A team with its full member list. */
export interface TeamDetail extends TeamSummary {
  /** The lead member's `agentId` ('' when the team has no members). */
  leadAgentId: string
  /** Every member, in join order. */
  members: TeamMember[]
}

/** Input for creating or adding one team member. */
export interface TeamMemberInput {
  /** Stable identifier unique within the team. */
  agentId: string
  /** Human-readable member name. */
  name: string
  /** Defaults to `lead` for the lead member, otherwise `member`. */
  role?: MemberRole
  agentType?: string
  model?: string
  color?: string
  /** Defaults to `idle`. */
  status?: MemberStatus
  /** Defaults to '' (empty string). */
  cwd?: string
  sessionId?: string
}

/** Input for `create`. */
export interface TeamCreateInput {
  /** Team name; must be a single safe path segment. */
  name: string
  description?: string
  /**
   * Defaults to the first member whose role is `lead`, else the first
   * member's `agentId`, else '' (empty string).
   */
  leadAgentId?: string
  members?: TeamMemberInput[]
}

/** Input for `update`. */
export interface TeamUpdateInput {
  description?: string
  /** Re-points the lead and re-syncs the lead/member roles. */
  leadAgentId?: string
}

/** Plugin configuration for `@rin/collaboration`. */
export interface Config {
  /** Absolute or cwd-relative path to the team store; defaults to `~/.rin/collaboration`. */
  teamsHome?: string
}
