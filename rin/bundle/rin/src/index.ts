/**
 * @rin/bundle — the rin assembly layer.
 *
 * Pure assembly metadata: the ordered package roster (dsh-base + the full @rin
 * host plugin family, without dsh-web-app), the resolved default configuration
 * per plugin, and the path helpers the launcher needs to boot the assembly.
 * This module registers no Cordis plugin — it is data plus path resolution; the
 * declarative counterpart is the cordis.yml beside this module.
 *
 * Path scheme: rin keeps its mutable state under a single configuration home,
 * RIN_HOME when set, else ~/.rin, so a user can relocate every rin working
 * directory with one variable. The built-in asset repository lives beside this
 * package in the rin source tree, resolved relative to this module so the
 * checkout works from any working directory.
 *
 * @module @rin/bundle
 */

import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Default port of the rin Web server (8320). */
export const DEFAULT_PORT = 8320

/** Default listen host of the rin Web server (loopback). */
export const DEFAULT_HOST = '127.0.0.1'

/** Directory name of the rin configuration home under the OS home. */
export const RIN_HOME_DIR = '.rin'

/** The dsh core bundle every rin assembly composes over. */
export const BASE_BUNDLE = '@deepseek-ai/dsh-base'

/** The dsh Web bundle rin deliberately leaves out (MIGRATION.md §8 decision 10). */
export const EXCLUDED_BUNDLE = '@deepseek-ai/dsh-web-app'

/** The twelve @rin host plugins, in assembly order. */
export const RIN_HOST_PLUGINS = [
  '@rin/repository',
  '@rin/environment',
  '@rin/knowledge',
  '@rin/prompt-memory',
  '@rin/skill-memory',
  '@rin/session-search',
  '@rin/evolution',
  '@rin/token-optimization',
  '@rin/smart-pruning',
  '@rin/notes',
  '@rin/agents',
  '@rin/sandboxes',
] as const

/** The rin Web server plugin (the independent 8320 surface). */
export const RIN_WEB_SERVER = '@rin/web-server' as const

/** All thirteen @rin plugins this assembly mounts. */
export const RIN_PLUGINS = [...RIN_HOST_PLUGINS, RIN_WEB_SERVER] as const

/** The full assembly roster: dsh-base first, then every @rin plugin. */
export const ASSEMBLY_LAYERS = [BASE_BUNDLE, ...RIN_PLUGINS] as const

/** A review-model adapter: turns a review prompt into a completion string. */
export type ReviewModel = (prompt: string, model: string) => Promise<string>

/** Default configuration for each @rin plugin that carries one. */
export interface RinDefaultConfig {
  knowledge: { dbPath: string; configHome: string }
  'prompt-memory': { configRoot: string; initialSoul: string }
  'session-search': { configRoot: string }
  evolution: { globalConfigRoot: string; reviewModel: ReviewModel }
  notes: { vaultRoot: string }
  agents: { agentsHome: string; defaultRepositoryRoot: string }
  sandboxes: { profilesPath: string }
  'web-server': {
    port: number
    host: string
    enabled: boolean
    repositoryRoot: string
    staticRoot: string
    knowledgeDbPath: string
    skillMemoryRoots: { globalConfigRoot: string; projectConfigRoot: string }
  }
}

/**
 * Resolve the rin configuration home, honoring a RIN_HOME override.
 *
 * A blank override is treated as unset, matching the dsh home-path precedence.
 * @param subpath - optional path joined under the home; omit for the home itself.
 * @returns the absolute (or override-resolved) path.
 */
export function rinHome(subpath?: string): string {
  const fromEnv = process.env.RIN_HOME
  const root = fromEnv !== undefined && fromEnv.trim() !== ''
    ? fromEnv
    : join(homedir(), RIN_HOME_DIR)
  return subpath === undefined || subpath === '' ? root : join(root, subpath)
}

/**
 * Resolve the built-in asset repository root relative to this package.
 *
 * The repository lives under the rin source tree (a stable sibling of the
 * bundle), so the path resolves from the checkout rather than from the working
 * directory or the process home.
 * @returns the absolute built-in repository root (contains repository.yaml).
 */
export function builtinRepositoryRoot(): string {
  return fileURLToPath(new URL('../../../core/repository/builtin/', import.meta.url))
}

/**
 * Resolve the @rin/web-ui production bundle root relative to this package.
 *
 * The web-ui SPA builds to rin/web/web-ui/dist; @rin/web-server serves that
 * directory as its staticRoot so the 8320 Web UI and the @rin/gui WebView are
 * always the exact same frontend (one UI, two surfaces).
 * @returns the absolute @rin/web-ui dist directory.
 */
export function webUiDistRoot(): string {
  return fileURLToPath(new URL('../../../web/web-ui/dist/', import.meta.url))
}

/**
 * Resolve this bundle's declarative assembly file (cordis.yml).
 * @returns the absolute path of the @rin plugin entry list.
 */
export function configPath(): string {
  return fileURLToPath(new URL('./cordis.yml', import.meta.url))
}

/**
 * Resolve the dsh-base bundle patch layer through its public export.
 *
 * The dsh-base package carries no runtime API; its substance is the
 * cordis.patch.yml declared by the dsh.bundle.patch manifest and exported under
 * ./cordis.patch.yml. Resolution is lazy so importing this module (and the
 * strip-types smoke test) never depends on a built dsh tree.
 * @returns the absolute path of @deepseek-ai/dsh-base's patch layer.
 */
export function baseBundlePatchPath(): string {
  return createRequire(import.meta.url).resolve('@deepseek-ai/dsh-base/cordis.patch.yml')
}

/** Default SOUL identity written by @rin/prompt-memory when none exists yet. */
export const DEFAULT_INITIAL_SOUL = `# Rin

A harness assistant built on the DeepSeek Harness base with the @rin asset layer.
`

/**
 * The programmatic default review-model is a fail-loud stub: it needs the dsh
 * llm seam, which only exists at boot time. The launcher mounts a working !!js
 * adapter from cordis.yml; a programmatic assembler must supply its own
 * reviewModel instead of this placeholder.
 * @returns a review-model adapter that always throws.
 */
export function placeholderReviewModel(): ReviewModel {
  return async () => {
    throw new Error(
      '@rin/bundle: evolution reviewModel is a boot-time adapter; '
      + 'supply one (see src/cordis.yml) or override defaultConfig.evolution.reviewModel',
    )
  }
}

/** Resolved default configuration for every @rin plugin that carries one. */
export const defaultConfig: RinDefaultConfig = {
  knowledge: {
    dbPath: rinHome('knowledge/knowledge.db'),
    configHome: rinHome(),
  },
  'prompt-memory': {
    configRoot: rinHome('prompt-memory'),
    initialSoul: DEFAULT_INITIAL_SOUL,
  },
  'session-search': {
    configRoot: rinHome('session-search'),
  },
  evolution: {
    globalConfigRoot: rinHome('evolution'),
    reviewModel: placeholderReviewModel(),
  },
  notes: {
    vaultRoot: rinHome('notes'),
  },
  agents: {
    agentsHome: rinHome('agents'),
    defaultRepositoryRoot: builtinRepositoryRoot(),
  },
  sandboxes: {
    profilesPath: rinHome('sandbox.yaml'),
  },
  'web-server': {
    port: DEFAULT_PORT,
    host: DEFAULT_HOST,
    enabled: true,
    repositoryRoot: builtinRepositoryRoot(),
    staticRoot: webUiDistRoot(),
    knowledgeDbPath: rinHome('knowledge/knowledge.db'),
    skillMemoryRoots: {
      globalConfigRoot: rinHome('skill-memory'),
      projectConfigRoot: rinHome(),
    },
  },
}
