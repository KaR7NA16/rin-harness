/**
 * rin filesystem — Cordis plugin entry.
 *
 * Exposes a ctx.filesystem service for path-contained directory browsing. The
 * containment + listing core lives in browse.ts (node: builtins only); this
 * module owns the Cordis registration.
 *
 * @module @rin/filesystem
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { browseDirectory } from './browse.ts'
import type { BrowseInput, BrowseResult } from './browse.ts'

export { browseDirectory } from './browse.ts'
export type * from './browse.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    filesystem: FilesystemService
  }
}

/** The filesystem service exposed on the shared context. */
export abstract class FilesystemService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'filesystem')
  }

  /** List a directory (path-contained), optionally filtered by filename search. */
  abstract browse(input: BrowseInput): Promise<BrowseResult>
}

/** Synchronous-core implementation wrapping browseDirectory. */
export class LocalFilesystemService extends FilesystemService {
  override browse(input: BrowseInput) {
    return Promise.resolve(browseDirectory(input))
  }
}

export const name = 'filesystem'
export const inject: string[] = []

/** Install the local filesystem service into the shared context. */
export function apply(ctx: Context): void {
  ctx.plugin(LocalFilesystemService)
}
