/**
 * rin repository — asset browsing logic.
 *
 * Pure functions behind the `repository_search` and `repository_read`
 * tools. This module imports only the package's own domain types, so the
 * strip-types smoke test can exercise the behavior without pulling in the
 * Cordis or dsh-tools import graph. The plugin seam (seam.ts) owns
 * registration and wires a freshly read repository into these functions on
 * every tool call.
 *
 * @module @rin/assets
 */

import type {
  AssetRepository,
  EnvironmentProfile,
  RepositoryAgentConfiguration,
} from './types.ts'

/** The nine asset categories a repository root can hold. */
export const REPOSITORY_CATEGORIES = [
  'environments', 'agents', 'skills', 'workflows', 'tools', 'knowledge', 'policies', 'outputs', 'bundles',
] as const

/** One asset category key. */
export type RepositoryCategory = typeof REPOSITORY_CATEGORIES[number]

/** Categories the reader parses into structured assets today. */
export const READABLE_CATEGORIES = ['environments', 'agents'] as const

/** Result count returned by `repository_search` when the model omits `limit`. */
export const SEARCH_LIMIT_DEFAULT = 20

/** Hard cap on `repository_search` results kept model-facing. */
export const SEARCH_LIMIT_MAX = 100

/** Hard cap on a single asset's body text returned by `repository_read`. */
export const READ_MAX_CHARS = 20000

const READABLE_CATEGORY_SET = new Set<RepositoryCategory>(READABLE_CATEGORIES)

/** One model-facing search hit. */
export interface RepositorySearchHit {
  category: RepositoryCategory
  name: string
  title: string
  path: string
  description: string
}

/** Canonical `repository_search` value: hits with a total, or an explicit error. */
export type RepositorySearchValue =
  | { results: RepositorySearchHit[]; total: number }
  | { error: string }

/** Identity metadata returned as a read asset's frontmatter. */
export interface RepositoryAssetFrontmatter {
  kind: string
  id: string
  name: string
  version: string
  description?: string
}

/** Canonical `repository_read` value: a full asset, or an explicit error. */
export type RepositoryReadValue =
  | {
      category: RepositoryCategory
      name: string
      path: string
      frontmatter: RepositoryAssetFrontmatter
      body: string
      truncated: boolean
    }
  | { error: string }

/**
 * Clamp a model-supplied result limit into the tool's bounds.
 * @param limit - raw limit argument; defaults to SEARCH_LIMIT_DEFAULT.
 * @returns an integer in [1, SEARCH_LIMIT_MAX].
 */
export function clampSearchLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return SEARCH_LIMIT_DEFAULT
  return Math.min(SEARCH_LIMIT_MAX, Math.max(1, Math.floor(limit)))
}

/**
 * Enumerate every asset the reader parses: environment profiles then agents.
 * @param repo - the asset repository read from disk.
 * @returns hits in deterministic order.
 */
export function listRepositoryAssets(repo: AssetRepository): RepositorySearchHit[] {
  return [
    ...repo.environmentProfiles.map(toProfileHit),
    ...repo.agents.map(toAgentHit),
  ]
}

/**
 * Search repository assets by optional category and free-text keyword.
 *
 * The keyword matches case-insensitively against the stable id, display name,
 * and description. An unknown category is an explicit error; a valid category
 * the reader does not yet parse (skills, workflows, ...) yields no results.
 * @param repo - the asset repository read from disk.
 * @param args - optional category, query, and result limit.
 * @returns the matched hits (bounded by the limit) with their total, or an error.
 */
export function searchRepository(
  repo: AssetRepository,
  args: { category?: string; query?: string; limit?: number },
): RepositorySearchValue {
  const category = normalizeCategory(args.category)
  if (args.category !== undefined && args.category.trim() !== '' && category === undefined) {
    return { error: `unknown category "${args.category}"; expected one of ${REPOSITORY_CATEGORIES.join(', ')}` }
  }
  const query = (args.query ?? '').trim().toLowerCase()
  let hits = listRepositoryAssets(repo)
  if (category !== undefined) hits = hits.filter(hit => hit.category === category)
  if (query !== '') {
    hits = hits.filter(hit =>
      hit.name.toLowerCase().includes(query)
      || hit.title.toLowerCase().includes(query)
      || hit.description.toLowerCase().includes(query))
  }
  const limit = clampSearchLimit(args.limit)
  return { results: hits.slice(0, limit), total: hits.length }
}

/**
 * Read one asset's full structured content.
 *
 * The asset is located by category plus its stable id (an agent name or an
 * environment profile id). `frontmatter` carries the identity metadata and
 * `body` the serialized content, truncated to READ_MAX_CHARS.
 * @param repo - the asset repository read from disk.
 * @param category - the asset category (agents or environments).
 * @param name - the stable asset id.
 * @returns the asset document, or an explicit error.
 */
export function readRepositoryAsset(
  repo: AssetRepository,
  category: string,
  name: string,
): RepositoryReadValue {
  const normalized = normalizeCategory(category)
  if (normalized === undefined) {
    return { error: `unknown category "${category}"; expected one of ${REPOSITORY_CATEGORIES.join(', ')}` }
  }
  if (!READABLE_CATEGORY_SET.has(normalized)) {
    return { error: `category "${normalized}" has no readable assets in this repository version` }
  }
  const trimmed = name.trim()
  if (trimmed === '') return { error: 'name is required and must not be blank' }

  if (normalized === 'agents') {
    const agent = repo.agents.find(candidate => candidate.name === trimmed)
    return agent === undefined
      ? { error: `no agent named "${trimmed}"` }
      : readAgentAsset(agent)
  }

  const profile = repo.environmentProfiles.find(candidate => candidate.metadata.id === trimmed)
  return profile === undefined
    ? { error: `no environment profile named "${trimmed}"` }
    : readProfileAsset(profile)
}

function normalizeCategory(value: string | undefined): RepositoryCategory | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return (REPOSITORY_CATEGORIES as readonly string[]).includes(trimmed)
    ? trimmed as RepositoryCategory
    : undefined
}

function toProfileHit(profile: EnvironmentProfile): RepositorySearchHit {
  return {
    category: 'environments',
    name: profile.metadata.id,
    title: profile.metadata.name,
    path: profile.metadata.source ?? `environments/profiles/${profile.metadata.id}.environment.yaml`,
    description: `Environment profile with ${profile.spec.packages.length} package(s).`,
  }
}

function toAgentHit(agent: RepositoryAgentConfiguration): RepositorySearchHit {
  return {
    category: 'agents',
    name: agent.name,
    title: agent.name,
    path: agent.source ?? `agents/${agent.name}.agent.yaml`,
    description: agent.description,
  }
}

function readProfileAsset(profile: EnvironmentProfile): RepositoryReadValue {
  const body = JSON.stringify(profile.spec, null, 2)
  const truncated = body.length > READ_MAX_CHARS
  return {
    category: 'environments',
    name: profile.metadata.id,
    path: profile.metadata.source ?? `environments/profiles/${profile.metadata.id}.environment.yaml`,
    frontmatter: {
      kind: 'EnvironmentProfile',
      id: profile.metadata.id,
      name: profile.metadata.name,
      version: profile.metadata.version,
    },
    body: truncated ? body.slice(0, READ_MAX_CHARS) : body,
    truncated,
  }
}

function readAgentAsset(agent: RepositoryAgentConfiguration): RepositoryReadValue {
  const body = JSON.stringify({
    description: agent.description,
    systemPrompt: agent.systemPrompt,
    ...(agent.model === undefined ? {} : { model: agent.model }),
    ...(agent.permissionMode === undefined ? {} : { permissionMode: agent.permissionMode }),
    tools: agent.tools,
    resources: agent.resources,
  }, null, 2)
  const truncated = body.length > READ_MAX_CHARS
  return {
    category: 'agents',
    name: agent.name,
    path: agent.source ?? `agents/${agent.name}.agent.yaml`,
    frontmatter: {
      kind: 'AgentConfiguration',
      id: agent.name,
      name: agent.name,
      version: String(agent.version),
      description: agent.description,
    },
    body: truncated ? body.slice(0, READ_MAX_CHARS) : body,
    truncated,
  }
}
