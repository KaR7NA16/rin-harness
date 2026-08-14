/**
 * rin knowledge — Cordis plugin entry.
 *
 * Exposes a ctx.knowledge service that opens a KnowledgeService bound to a
 * SQLite database. The KnowledgeService owns source registration, incremental
 * indexing, and full-text search; registering tools over this service is the
 * NEXT milestone.
 *
 * @module @rin/knowledge
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { KnowledgeService } from './service.ts'

export type * from './types.ts'
export { KnowledgeService } from './service.ts'
export { getKnowledgeDbPath, getKnowledgeDir } from './paths.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    knowledge: KnowledgeStore
  }
}

/** The knowledge service exposed on the shared context. */
export abstract class KnowledgeStore extends Service {
  constructor(ctx: Context) {
    super(ctx, 'knowledge')
  }

  /** @param dbPath - absolute path to the SQLite database file. */
  abstract open(dbPath: string): KnowledgeService
}

/** SQLite-backed implementation opening a KnowledgeService on demand. */
export class FileKnowledgeStore extends KnowledgeStore {
  constructor(ctx: Context) {
    super(ctx)
  }

  override open(dbPath: string): KnowledgeService {
    return new KnowledgeService(dbPath)
  }
}

export const name = 'knowledge'
export const inject = []

/** Install the SQLite-backed knowledge service into the shared context. */
export function apply(ctx: Context): void {
  ctx.plugin(FileKnowledgeStore)
}
