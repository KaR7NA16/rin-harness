/**
 * rin repository — dsh tools seam registration.
 *
 * Registers the model-visible `repository_search` and `repository_read`
 * tools over the file-backed repository service. This module is the only
 * consumer of the real `@deepseek-ai/dsh-tools` runtime; the tool
 * definitions and browse logic live in tools.ts / browse.ts so the smoke test
 * stays free of dsh-* runtime imports.
 *
 * @module @rin/assets
 */

import { fileURLToPath } from 'node:url'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import { buildRepositoryTools } from './tools.ts'
import type { RepositoryConfig } from './types.ts'

/**
 * Resolve the repository root the tools read.
 *
 * An explicit config wins; otherwise the built-in asset repository shipped
 * beside this package is used.
 * @param config - the resolved plugin configuration.
 * @returns the repository root path (the reader resolves relative paths).
 */
export function resolveRepositoryRoot(config: RepositoryConfig = {}): string {
  const configured = config.repositoryRoot?.trim()
  if (configured !== undefined && configured !== '') return configured
  return fileURLToPath(new URL('../builtin/', import.meta.url))
}

/**
 * Register the two asset browsing tools on the dsh tools seam.
 *
 * Each tool call re-reads the repository from disk, so no resource is held
 * between calls. The returned disposer unregisters both tools.
 * @param ctx - the plugin context (must inject tools).
 * @param config - the resolved plugin configuration.
 * @returns a disposer that unregisters both tools.
 */
export function registerRepositorySeam(ctx: Context, config: RepositoryConfig = {}): () => void {
  const root = resolveRepositoryRoot(config)
  // The concrete options records are structurally compatible; the union through
  // any keeps defineTool's schema generics from recursing (TS2321 on the wide
  // DefineToolOptions instantiation). Shape is enforced by tools.ts + smoke.
  const disposers = buildRepositoryTools(() => ctx.repository.read(root))
    // oxlint-disable-next-line no-explicit-any -- structural seam: TS2321 on the wide DefineToolOptions union
    .map(options => ctx.tools.register(defineTool(options as any)))
  return () => disposers.forEach(dispose => dispose())
}
