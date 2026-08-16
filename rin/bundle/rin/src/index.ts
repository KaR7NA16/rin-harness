/**
 * @rin/bundle — the rin assembly layer.
 *
 * Pure assembly metadata: the ordered package roster (dsh-base + the full @rin
 * host plugin family, without dsh-web-app), the resolved web-server default
 * configuration, and the path helpers the launcher needs to boot the assembly.
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

/** The dsh core bundle every rin assembly composes over. */
export const BASE_BUNDLE = '@deepseek-ai/dsh-base'

/** The dsh Web bundle rin deliberately leaves out (MIGRATION.md §8 decision 10). */
export const EXCLUDED_BUNDLE = '@deepseek-ai/dsh-web-app'

/** The seventeen @rin host plugins, in assembly order. */
export const RIN_HOST_PLUGINS = [
  '@rin/repository',
  '@rin/environment',
  '@rin/filesystem',
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
  '@rin/tasks',
  '@rin/mcp',
  '@rin/provider-probe',
  '@rin/computer-use',
  '@rin/agent-migration',
  '@rin/teams',
] as const

/** The rin Web server plugin (the independent 8320 surface). */
export const RIN_WEB_SERVER = '@rin/web-server' as const

/** All eighteen @rin plugins this assembly mounts. */
export const RIN_PLUGINS = [...RIN_HOST_PLUGINS, RIN_WEB_SERVER] as const

/** The full assembly roster: dsh-base first, then every @rin plugin. */
export const ASSEMBLY_LAYERS = [BASE_BUNDLE, ...RIN_PLUGINS] as const

/** Default configuration for the @rin plugin the launcher overrides. */
export interface RinDefaultConfig {
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
    : join(homedir(), '.rin')
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

/** Resolved default configuration for the @rin plugin the launcher overrides. */
export const defaultConfig: RinDefaultConfig = {
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
