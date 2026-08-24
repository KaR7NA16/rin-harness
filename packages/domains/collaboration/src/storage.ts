/**
 * rin teams — the file-backed team store engine.
 *
 * `TeamsStore` is the pure implementation behind `ctx.teams`: it owns all
 * file I/O, team-name validation, and member normalization. It depends only on
 * `node:` builtins, so it stays smoke-testable without the Cordis runtime.
 *
 * Storage layout: one directory per team under the store root, each holding a
 * single `config.json` (name, description, timestamps, leadAgentId, members).
 *
 * @module @rin/collaboration
 */

import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type {
  TeamCreateInput,
  TeamDetail,
  TeamMember,
  TeamMemberInput,
  TeamSummary,
  TeamUpdateInput,
} from './types.ts'

/** Directory name for the default teams store under the rin home. */
export const DEFAULT_TEAMS_HOME_DIRNAME = 'teams'
/** File name of a team's persisted config inside its directory. */
export const CONFIG_FILENAME = 'config.json'

/** A team name must be a single safe path segment. */
const TEAM_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** The persisted record, without the derived summary counts. */
interface StoredTeam {
  name: string
  description?: string
  createdAt: number
  updatedAt: number
  leadAgentId: string
  members: TeamMember[]
}

/** Whether an error means the path is simply absent. */
function isMissingPathError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT')
}

/** The default team store: `~/.rin/collaboration`. */
export function defaultTeamsHome(): string {
  return join(homedir(), '.rin', DEFAULT_TEAMS_HOME_DIRNAME)
}

/**
 * Resolve the configured teams root, falling back to `~/.rin/collaboration`.
 *
 * @param configured - the `Config.teamsHome` value, when set.
 * @returns the absolute teams root path.
 */
export function resolveTeamsHome(configured?: string): string {
  return configured && configured.trim() ? resolve(configured) : defaultTeamsHome()
}

/** Reject team names that are empty, too long, or unsafe as a path segment. */
function assertValidName(name: string): void {
  if (!name) throw new Error('rin teams: team name is required')
  if (!TEAM_NAME_RE.test(name)) {
    throw new Error(`rin teams: invalid team name: ${name}`)
  }
}

/**
 * Normalize one member input into a stored member, applying defaults.
 *
 * @param input - the member input to normalize.
 * @param leadAgentId - the team's lead; the matching member defaults to `lead`.
 * @param now - epoch-milliseconds assigned as the member's `joinedAt`.
 * @returns the stored member.
 */
function normalizeMember(input: TeamMemberInput, leadAgentId: string, now: number): TeamMember {
  if (!input.agentId || !input.name) throw new Error('rin teams: member agentId and name are required')
  return {
    agentId: input.agentId,
    name: input.name,
    role: input.role ?? (input.agentId === leadAgentId ? 'lead' : 'member'),
    ...(input.agentType !== undefined ? { agentType: input.agentType } : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.color !== undefined ? { color: input.color } : {}),
    status: input.status ?? 'idle',
    joinedAt: now,
    cwd: input.cwd ?? '',
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
  }
}

/** The pure file-backed named-team store. */
export class TeamsStore {
  readonly root: string

  /** @param root - absolute or cwd-relative path to the team store. */
  constructor(root: string) {
    this.root = resolve(root)
  }

  /** Resolve the directory holding one team, validating its name first. */
  private teamDir(name: string): string {
    assertValidName(name)
    return join(this.root, name)
  }

  /** Resolve the config file path for one team. */
  private configPath(name: string): string {
    return join(this.teamDir(name), CONFIG_FILENAME)
  }

  /** Whether a file exists at the given absolute path. */
  private async fileExists(path: string): Promise<boolean> {
    try {
      await stat(path)
      return true
    } catch (error) {
      if (isMissingPathError(error)) return false
      throw error
    }
  }

  /** Read and validate one team's persisted record. */
  private async readRecord(name: string): Promise<StoredTeam> {
    let raw: string
    try {
      raw = await readFile(this.configPath(name), 'utf8')
    } catch (error) {
      if (isMissingPathError(error)) throw new Error(`rin teams: team not found: ${name}`)
      throw error
    }
    const parsed = JSON.parse(raw) as Partial<StoredTeam>
    if (typeof parsed.name !== 'string' || parsed.name !== name) {
      throw new Error(`rin teams: malformed team config: ${name}`)
    }
    return {
      name: parsed.name,
      ...(parsed.description !== undefined ? { description: parsed.description } : {}),
      createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now(),
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
      leadAgentId: typeof parsed.leadAgentId === 'string' ? parsed.leadAgentId : '',
      members: Array.isArray(parsed.members) ? parsed.members : [],
    }
  }

  /** Persist one team's record, creating its directory as needed. */
  private async writeRecord(record: StoredTeam): Promise<void> {
    await mkdir(join(this.root, record.name), { recursive: true })
    await writeFile(this.configPath(record.name), JSON.stringify(record, null, 2) + '\n', 'utf8')
  }

  /** Derive a summary from a stored record. */
  private toSummary(record: StoredTeam): TeamSummary {
    const members = record.members
    return {
      name: record.name,
      ...(record.description !== undefined ? { description: record.description } : {}),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      memberCount: members.length,
      activeMemberCount: members.filter(member => member.status === 'running').length,
    }
  }

  /** Derive a detail from a stored record. */
  private toDetail(record: StoredTeam): TeamDetail {
    return { ...this.toSummary(record), leadAgentId: record.leadAgentId, members: record.members }
  }

  /**
   * List every team's summary, sorted by name.
   *
   * @returns the team summaries.
   */
  async list(): Promise<TeamSummary[]> {
    await mkdir(this.root, { recursive: true })
    const entries = await readdir(this.root, { withFileTypes: true })
    const summaries: TeamSummary[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        summaries.push(this.toSummary(await this.readRecord(entry.name)))
      } catch {
        // Skip malformed team directories so one bad config never hides the rest.
      }
    }
    return summaries.sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * Read one team, including its member list.
   *
   * @param name - the team name.
   * @returns the team detail.
   */
  async get(name: string): Promise<TeamDetail> {
    return this.toDetail(await this.readRecord(name))
  }

  /**
   * List one team's members.
   *
   * @param name - the team name.
   * @returns the members, in join order.
   */
  async listMembers(name: string): Promise<TeamMember[]> {
    return (await this.readRecord(name)).members
  }

  /**
   * Create a team.
   *
   * @param input - the team name, optional description, and optional members.
   * @returns the created team detail.
   */
  async create(input: TeamCreateInput): Promise<TeamDetail> {
    assertValidName(input.name)
    if (await this.fileExists(this.configPath(input.name))) {
      throw new Error(`rin teams: team already exists: ${input.name}`)
    }
    const now = Date.now()
    const leadAgentId = input.leadAgentId
      ?? input.members?.find(member => member.role === 'lead')?.agentId
      ?? input.members?.[0]?.agentId
      ?? ''
    const members = (input.members ?? []).map(member => normalizeMember(member, leadAgentId, now))
    const record: StoredTeam = {
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
      createdAt: now,
      updatedAt: now,
      leadAgentId,
      members,
    }
    await this.writeRecord(record)
    return this.toDetail(record)
  }

  /**
   * Update a team's description and/or lead.
   *
   * @param name - the team name.
   * @param input - the fields to change.
   * @returns the updated team detail.
   */
  async update(name: string, input: TeamUpdateInput): Promise<TeamDetail> {
    const record = await this.readRecord(name)
    if (input.description !== undefined) {
      record.description = input.description
    }
    if (input.leadAgentId !== undefined) {
      const lead = input.leadAgentId
      record.leadAgentId = lead
      record.members = record.members.map(member =>
        member.agentId === lead
          ? { ...member, role: 'lead' }
          : member.role === 'lead'
            ? { ...member, role: 'member' }
            : member,
      )
    }
    record.updatedAt = Date.now()
    await this.writeRecord(record)
    return this.toDetail(record)
  }

  /**
   * Delete a team and all of its files. Missing teams are a no-op.
   *
   * @param name - the team name.
   */
  async delete(name: string): Promise<void> {
    await rm(this.teamDir(name), { recursive: true, force: true })
  }

  /**
   * Add one member to a team.
   *
   * @param name - the team name.
   * @param input - the member to add.
   * @returns the updated team detail.
   */
  async addMember(name: string, input: TeamMemberInput): Promise<TeamDetail> {
    const record = await this.readRecord(name)
    if (record.members.some(member => member.agentId === input.agentId)) {
      throw new Error(`rin teams: member already exists: ${input.agentId}`)
    }
    const member = normalizeMember(input, record.leadAgentId, Date.now())
    record.members = [...record.members, member]
    record.updatedAt = Date.now()
    await this.writeRecord(record)
    return this.toDetail(record)
  }

  /**
   * Remove one member from a team. Removing the lead re-points `leadAgentId`
   * to the first remaining member and promotes it.
   *
   * @param name - the team name.
   * @param agentId - the member's agentId.
   * @returns the updated team detail.
   */
  async removeMember(name: string, agentId: string): Promise<TeamDetail> {
    const record = await this.readRecord(name)
    const remaining = record.members.filter(member => member.agentId !== agentId)
    if (remaining.length === record.members.length) {
      throw new Error(`rin teams: member not found: ${agentId}`)
    }
    if (record.leadAgentId === agentId) {
      const next = remaining[0]
      record.leadAgentId = next?.agentId ?? ''
      if (next !== undefined) {
        record.members = remaining.map(member => (member === next ? { ...member, role: 'lead' as const } : member))
      } else {
        record.members = remaining
      }
    } else {
      record.members = remaining
    }
    record.updatedAt = Date.now()
    await this.writeRecord(record)
    return this.toDetail(record)
  }
}
