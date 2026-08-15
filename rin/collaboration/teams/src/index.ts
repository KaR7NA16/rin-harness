/**
 * rin teams — Cordis plugin entry.
 *
 * Exposes a `ctx.teams` service over a file-backed named-team store. Teams
 * hold members with roles; persistence lives in the pure `TeamsStore` engine
 * so the storage layer stays smoke-testable without the Cordis runtime. This
 * milestone manages team configuration only — no dsh multi-agent orchestration
 * binding (see README Known Limitations).
 *
 * @module @rin/teams
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { TeamsStore, resolveTeamsHome } from './storage.ts'
import type {
  Config,
  TeamCreateInput,
  TeamDetail,
  TeamMember,
  TeamMemberInput,
  TeamSummary,
  TeamUpdateInput,
} from './types.ts'

export type * from './types.ts'
export { CONFIG_FILENAME, DEFAULT_TEAMS_HOME_DIRNAME, TeamsStore, defaultTeamsHome, resolveTeamsHome } from './storage.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    teams: TeamStore
  }
}

/** The team service exposed on the shared context. */
export abstract class TeamStore extends Service {
  constructor(ctx: Context) {
    super(ctx, 'teams')
  }

  /** List every team's summary, sorted by name. */
  abstract list(): Promise<TeamSummary[]>

  /** Read one team, including its member list. */
  abstract get(name: string): Promise<TeamDetail>

  /** Create a team. */
  abstract create(input: TeamCreateInput): Promise<TeamDetail>

  /** Update a team's description and/or lead. */
  abstract update(name: string, input: TeamUpdateInput): Promise<TeamDetail>

  /** Delete a team. Missing teams are a no-op. */
  abstract delete(name: string): Promise<void>

  /** Add one member to a team. */
  abstract addMember(name: string, input: TeamMemberInput): Promise<TeamDetail>

  /** Remove one member from a team. */
  abstract removeMember(name: string, agentId: string): Promise<TeamDetail>

  /** List one team's members. */
  abstract listMembers(name: string): Promise<TeamMember[]>
}

/** File-backed team service delegating to a `TeamsStore`. */
export class FileTeamStore extends TeamStore {
  private readonly store: TeamsStore

  constructor(ctx: Context, config: Config = {}) {
    super(ctx)
    this.store = new TeamsStore(resolveTeamsHome(config.teamsHome))
  }

  override list() {
    return this.store.list()
  }

  override get(name: string) {
    return this.store.get(name)
  }

  override create(input: TeamCreateInput) {
    return this.store.create(input)
  }

  override update(name: string, input: TeamUpdateInput) {
    return this.store.update(name, input)
  }

  override delete(name: string) {
    return this.store.delete(name)
  }

  override addMember(name: string, input: TeamMemberInput) {
    return this.store.addMember(name, input)
  }

  override removeMember(name: string, agentId: string) {
    return this.store.removeMember(name, agentId)
  }

  override listMembers(name: string) {
    return this.store.listMembers(name)
  }
}

export const name = 'teams'
export const inject: string[] = []

/**
 * Install the file-backed team service on the shared context.
 *
 * @param ctx - the plugin context.
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  ctx.plugin(FileTeamStore, config)
}
