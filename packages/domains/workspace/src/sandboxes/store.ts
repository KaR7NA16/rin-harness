/**
 * rin sandboxes — file-backed profile store.
 *
 * Implements sandbox-profile CRUD against a versioned YAML document (default
 * ~/.rin/sandbox.yaml) plus capability probing and environment-plan execution
 * dispatched to the per-type providers. The class is plain (no Cordis) so the
 * strip-types smoke script can exercise it directly; index.ts binds it into
 * the ctx.sandboxes service.
 *
 * @module @rin/workspace/sandboxes
 */

import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ResolverCapabilities } from '@rin/assets'
import type { InstallRun } from '@rin/workspace/environment'
import {
  SANDBOX_STORE_SCHEMA_VERSION,
  type ResolvedEnvironmentPlan,
  type SandboxProfile,
  type SandboxProfileInput,
  type SandboxProfilePatch,
  type SandboxProviders,
  type StageCommandRunner,
} from './types.ts'
import {
  applySandboxProfilePatch,
  migrateLegacySandboxes,
  newSandboxProfile,
} from './profile.ts'
import { parseSandboxStoreDocument, stringifySandboxStoreDocument } from './yaml.ts'
import { defaultProviders, providerFor } from './providers.ts'
import { executeEnvironmentPlan, type ExecuteEnvironmentPlanOptions } from './exec.ts'
import { resolveStageRunner, type ShellConfig, type ShellExecutorLike } from './seam.ts'

/** The current (v2) store filename. */
export const PROFILES_FILENAME = 'sandbox.yaml'
/** The legacy (v1) JSON filename migrated on first read. */
export const LEGACY_PROFILES_FILENAME = 'sandboxes.json'

/**
 * Resolve the default profile-store path.
 *
 * @param home - the home directory (defaults to the current user's home).
 * @returns the default sandbox.yaml path.
 */
export function defaultSandboxProfilesPath(home = homedir()): string {
  return join(home, '.rin', PROFILES_FILENAME)
}

/** Construction options for a file-backed store. */
export interface SandboxStoreOptions {
  profilesPath: string
  providers?: SandboxProviders
  /** Lazy resolver for the dsh shell seam; resolved at execution time. */
  shell?: () => ShellExecutorLike | undefined
  /** Shell-seam execution options (dryRun, timeout, env). */
  shellConfig?: ShellConfig
}

/**
 * File-backed sandbox-profile store. Reads and writes the versioned YAML
 * document, migrating the legacy sandboxes.json on first read. Probing
 * delegates to the per-type providers; execution runs stage commands through
 * the dsh shell seam when a resolver is supplied, else through the providers.
 */
export class FileSandboxStore {
  private readonly profilesPath: string
  private readonly providers: SandboxProviders
  private readonly shell: (() => ShellExecutorLike | undefined) | undefined
  private readonly shellConfig: ShellConfig | undefined
  private cache: SandboxProfile[] | null = null

  /** @param options - the store path and optional provider / shell overrides. */
  constructor(options: SandboxStoreOptions) {
    this.profilesPath = options.profilesPath
    this.providers = options.providers ?? defaultProviders()
    this.shell = options.shell
    this.shellConfig = options.shellConfig
  }

  /** @returns every profile, copied so callers cannot mutate the cache. */
  async list(): Promise<SandboxProfile[]> {
    return [...(await this.load())]
  }

  /** @param id - the profile id. @returns the profile, or null when unknown. */
  async get(id: string): Promise<SandboxProfile | null> {
    return (await this.load()).find(profile => profile.id === id) ?? null
  }

  /**
   * Create a profile. The first profile becomes the default; an explicit
   * isDefault re-assigns the default from any previous holder.
   *
   * @param input - the profile fields.
   * @returns the created profile.
   */
  async create(input: SandboxProfileInput): Promise<SandboxProfile> {
    const profiles = await this.load()
    const profile = newSandboxProfile(input)
    const makeDefault = input.isDefault ?? profiles.length === 0
    const next = [...profiles, { ...profile, isDefault: makeDefault }]
    if (makeDefault) for (const entry of next) entry.isDefault = entry.id === profile.id
    await this.save(next)
    return next.find(entry => entry.id === profile.id)!
  }

  /**
   * Patch an existing profile by id.
   *
   * @param id - the profile id.
   * @param patch - the fields to merge.
   * @returns the patched profile.
   */
  async update(id: string, patch: SandboxProfilePatch): Promise<SandboxProfile> {
    const profiles = await this.load()
    const index = profiles.findIndex(profile => profile.id === id)
    if (index < 0) throw new Error('rin sandboxes: profile not found: ' + id)
    const next = [...profiles]
    next[index] = applySandboxProfilePatch(next[index]!, patch)
    if (next[index]!.isDefault) for (const entry of next) entry.isDefault = entry.id === id
    await this.save(next)
    return next.find(entry => entry.id === id)!
  }

  /**
   * Remove a profile by id.
   *
   * @param id - the profile id.
   * @returns true when the profile existed and was removed.
   */
  async remove(id: string): Promise<boolean> {
    const profiles = await this.load()
    const index = profiles.findIndex(profile => profile.id === id)
    if (index < 0) return false
    const next = profiles.filter(profile => profile.id !== id)
    if (next.length > 0 && !next.some(profile => profile.isDefault)) {
      next[0] = { ...next[0]!, isDefault: true }
    }
    await this.save(next)
    return true
  }

  /**
   * Make one profile the default, un-setting every other.
   *
   * @param id - the profile id.
   * @returns the now-default profile.
   */
  async setDefault(id: string): Promise<SandboxProfile> {
    const profiles = await this.load()
    if (!profiles.some(profile => profile.id === id)) {
      throw new Error('rin sandboxes: profile not found: ' + id)
    }
    const next = profiles.map(profile => ({ ...profile, isDefault: profile.id === id }))
    await this.save(next)
    return next.find(profile => profile.id === id)!
  }

  /** @param profile - the profile to probe. @returns its runtime capabilities. */
  async probeCapabilities(profile: SandboxProfile): Promise<ResolverCapabilities> {
    return providerFor(profile, this.providers).probeCapabilities(profile)
  }

  /**
   * Run one command inside a profile's sandbox.
   *
   * @param id - the profile id.
   * @param command - the shell command to run.
   * @returns the exit code and captured stdout/stderr.
   */
  async exec(id: string, command: string): Promise<{ code: number; stdout: string; stderr: string }> {
    const profile = await this.get(id)
    if (profile === null) throw new Error('rin sandboxes: profile not found: ' + id)
    return providerFor(profile, this.providers).runCommand(profile, command)
  }

  /**
   * Execute a resolved environment plan inside the profile's sandbox.
   *
   * @param profile - the target profile.
   * @param repositoryId - the repository the plan resolves from.
   * @param environmentProfileId - the environment profile the plan resolves.
   * @param plan - the resolved plan.
   * @param options - execution options; `approve: true` is required for ready plans.
   * @returns the terminal install run.
   */
  async executeEnvironmentPlan(
    profile: SandboxProfile,
    repositoryId: string,
    environmentProfileId: string,
    plan: ResolvedEnvironmentPlan,
    options?: ExecuteEnvironmentPlanOptions,
  ): Promise<InstallRun> {
    const runner: StageCommandRunner = this.shell !== undefined
      ? resolveStageRunner(this.shell(), this.shellConfig ?? {})
      : providerFor(profile, this.providers)
    return executeEnvironmentPlan(profile, repositoryId, environmentProfileId, plan, runner, options)
  }

  private async load(): Promise<SandboxProfile[]> {
    if (this.cache) return this.cache
    await this.migrateLegacyIfNeeded()
    const text = await readFile(this.profilesPath, 'utf8').catch((error: unknown) => {
      if (isMissingFile(error)) return null
      throw error
    })
    this.cache = text === null ? [] : parseSandboxStoreDocument(text).profiles
    return this.cache
  }

  private async save(profiles: SandboxProfile[]): Promise<void> {
    this.cache = profiles
    await mkdir(dirname(this.profilesPath), { recursive: true })
    await writeFile(this.profilesPath, stringifySandboxStoreDocument({
      version: SANDBOX_STORE_SCHEMA_VERSION,
      profiles,
    }), 'utf8')
  }

  private legacyProfilesPath(): string {
    return join(dirname(this.profilesPath), LEGACY_PROFILES_FILENAME)
  }

  private async migrateLegacyIfNeeded(): Promise<void> {
    if (await fileExists(this.profilesPath)) return
    const legacyPath = this.legacyProfilesPath()
    const legacyText = await readFile(legacyPath, 'utf8').catch((error: unknown) => {
      if (isMissingFile(error)) return null
      throw error
    })
    if (legacyText === null) return
    const document = migrateLegacySandboxes(parseLegacyJson(legacyText, legacyPath))
    await mkdir(dirname(this.profilesPath), { recursive: true })
    await writeFile(this.profilesPath, stringifySandboxStoreDocument(document), 'utf8')
    await writeFile(legacyPath + '.bak', legacyText, 'utf8')
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (error) {
    if (isMissingFile(error)) return false
    throw error
  }
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

function parseLegacyJson(text: string, path: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new Error('rin sandboxes: invalid legacy sandbox JSON in ' + path + ': ' + (error instanceof Error ? error.message : String(error)))
  }
}
