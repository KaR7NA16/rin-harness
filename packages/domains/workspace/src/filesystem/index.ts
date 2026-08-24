/**
 * rin filesystem — Cordis plugin entry.
 *
 * Exposes a ctx.filesystem service for path-contained directory browsing. The
 * containment + listing core lives in browse.ts (node: builtins only); this
 * module owns the Cordis registration.
 *
 * @module @rin/workspace/filesystem
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { browseDirectory } from './browse.ts'
import type { BrowseInput, BrowseResult } from './browse.ts'
import { readBinaryFile, readTextFile, statFile } from './file.ts'
import type { BinaryFileRead, FileStat, TextFileRead } from './file.ts'

export { browseDirectory } from './browse.ts'
export type * from './browse.ts'
export {
  DEFAULT_TEXT_READ_BYTES,
  MAX_TEXT_READ_BYTES,
  mimeTypeForPath,
  readBinaryFile,
  readTextFile,
  resolveAllowedFile,
  statFile,
} from './file.ts'
export type * from './file.ts'

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

  /** Read metadata for one contained path. */
  abstract stat(path: string): Promise<FileStat>

  /** Read a contained text file with a bounded byte budget. */
  abstract readText(path: string, maxBytes?: number): Promise<TextFileRead>

  /** Read one contained file as raw bytes. */
  abstract readBinary(path: string): Promise<BinaryFileRead>
}

/** Synchronous-core implementation wrapping the path-contained file core. */
export class LocalFilesystemService extends FilesystemService {
  override browse(input: BrowseInput) {
    return Promise.resolve(browseDirectory(input))
  }

  override stat(path: string) {
    return Promise.resolve(statFile(path))
  }

  override readText(path: string, maxBytes?: number) {
    return Promise.resolve(readTextFile(path, maxBytes))
  }

  override readBinary(path: string) {
    return Promise.resolve(readBinaryFile(path))
  }
}

export const name = 'filesystem'
export const inject: string[] = []

/** Install the local filesystem service into the shared context. */
export function apply(ctx: Context): void {
  ctx.plugin(LocalFilesystemService)
}
