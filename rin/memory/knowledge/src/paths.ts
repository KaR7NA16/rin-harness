/**
 * rin knowledge — default storage location.
 *
 * @module @rin/knowledge
 */

import { join } from 'node:path'

export const KNOWLEDGE_DIRNAME = 'knowledge'
export const KNOWLEDGE_DB_FILENAME = 'knowledge.db'

/** Resolve the knowledge directory under a configuration home. */
export function getKnowledgeDir(configHomeDir: string): string {
  return join(configHomeDir, KNOWLEDGE_DIRNAME).normalize('NFC')
}

/** Resolve the knowledge SQLite database path under a configuration home. */
export function getKnowledgeDbPath(configHomeDir: string): string {
  return join(getKnowledgeDir(configHomeDir), KNOWLEDGE_DB_FILENAME).normalize('NFC')
}
