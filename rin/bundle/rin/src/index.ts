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
 * RIN_HOME when set, else ~/.rin. dsh-owned mutable state is nested under
 * <RIN_HOME>/dsh unless DSH_HOME is explicitly supplied, so a user can relocate
 * the integrated runtime without losing the option to keep dsh independent.
 * The built-in asset repository lives beside this
 * package in the rin source tree, resolved relative to this module so the
 * checkout works from any working directory.
 *
 * @module @rin/bundle
 */

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Default port of the rin Web server (8320). */
export const DEFAULT_PORT = 8320

/** Default listen host of the rin Web server (loopback). */
export const DEFAULT_HOST = '127.0.0.1'

/** The dsh core bundle every rin assembly composes over. */
export const BASE_BUNDLE = '@deepseek-ai/dsh-base'

/** The dsh Web bundle rin deliberately leaves out (MIGRATION.md §8 decision 10). */
export const EXCLUDED_BUNDLE = '@deepseek-ai/dsh-web-app'

/** The @rin host plugins, in assembly order. */
export const RIN_HOST_PLUGINS = [
  '@rin/repository',
  '@rin/environment',
  '@rin/filesystem',
  '@rin/session-backup',
  '@rin/memory',
  '@rin/knowledge',
  '@rin/knowledge-graph',
  '@rin/prompt-memory',
  '@rin/skill-memory',
  '@rin/session-search',
  '@rin/evolution',
  '@rin/token-optimization',
  '@rin/codegraph',
  '@rin/smart-pruning',
  '@rin/notes',
  '@rin/agents',
  '@rin/plugins',
  '@rin/sandboxes',
  '@rin/tasks',
  '@rin/mcp',
  '@rin/mcp-client',
  '@rin/provider-probe',
  '@rin/computer-use',
  '@rin/agent-migration',
  '@rin/teams',
  '@rin/brief',
  '@rin/review',
  '@rin/monitor',
  '@rin/doctor',
] as const

/** The rin Web server plugin (the independent 8320 surface). */
export const RIN_WEB_SERVER = '@rin/web-server' as const

/** All @rin plugins this assembly mounts. */
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
 * Resolve dsh mutable state for the integrated rin host.
 *
 * An explicit non-blank DSH_HOME remains authoritative for users who need to
 * share or isolate dsh state independently. Otherwise dsh state is placed
 * under RIN_HOME/dsh, keeping sessions, settings, and credentials in one
 * relocatable product archive root.
 * @param subpath - optional path joined under the resolved dsh home.
 * @returns the resolved dsh home or a child path.
 */
export function dshHome(subpath?: string): string {
  const fromEnv = process.env.DSH_HOME
  const root = fromEnv !== undefined && fromEnv.trim() !== ''
    ? fromEnv
    : rinHome('dsh')
  return subpath === undefined || subpath === '' ? root : join(root, subpath)
}

function configuredPath(name: string, fallback: string): string {
  const value = process.env[name]
  return value !== undefined && value.trim() !== '' ? value : fallback
}

/**
 * Resolve the durable dsh session root used by both dsh and rin session APIs.
 *
 * RIN_SESSION_ROOT is useful when sessions must live outside either home
 * while the rest of the application state remains colocated.
 * @returns the configured session directory.
 */
export function sessionRoot(): string {
  return configuredPath('RIN_SESSION_ROOT', dshHome('sessions'))
}

/**
 * Resolve the dsh settings document path.
 *
 * RIN_SETTINGS_PATH is an explicit file override; otherwise the document
 * follows the resolved dsh home.
 * @returns the settings document path.
 */
export function settingsPath(): string {
  return configuredPath('RIN_SETTINGS_PATH', dshHome('settings.yaml'))
}

/**
 * Resolve the dsh managed credentials document path.
 *
 * RIN_CREDENTIALS_PATH is an explicit file override; otherwise the document
 * follows the resolved dsh home.
 * @returns the credentials document path.
 */
export function credentialsPath(): string {
  return configuredPath('RIN_CREDENTIALS_PATH', dshHome('.credentials.yaml'))
}

/**
 * The @rin/bundle package root, located by climbing from this module.
 *
 * This module can be reached through any of three layouts — source (tsconfig
 * path alias, `rin/bundle/rin/src`), in-checkout build (`rin/bundle/rin/lib/
 * types`), or an installed copy under the pnpm virtual store
 * (`node_modules/.pnpm/@rin+bundle-.../node_modules/@rin/bundle/lib/types`) —
 * so every sibling-path helper resolves from the nearest `@rin/bundle`
 * package.json instead of a fixed `new URL(...)` step count.
 * @returns the absolute @rin/bundle package root.
 */
function bundlePackageRoot(): string {
  let dir = fileURLToPath(new URL('.', import.meta.url))
  for (let depth = 0; depth < 10; depth += 1) {
    const manifestPath = join(dir, 'package.json')
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: unknown }
      if (manifest.name === '@rin/bundle') return dir
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(`@rin/bundle package root not found above ${fileURLToPath(import.meta.url)}`)
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
  return join(bundlePackageRoot(), '../../core/repository/builtin')
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
  return join(bundlePackageRoot(), '../../web/web-ui/dist')
}

/**
 * Resolve this bundle's declarative assembly file (cordis.yml).
 * @returns the absolute path of the @rin plugin entry list.
 */
export function configPath(): string {
  return join(bundlePackageRoot(), 'src/cordis.yml')
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
      globalConfigRoot: rinHome(),
      projectConfigRoot: rinHome(),
    },
  },
}
