/**
 * Index path derivation. The runtime supplies the configuration root; this
 * module derives the index directory and database file under it.
 *
 * @module @rin/memory/session-search
 */

import { join } from 'node:path'
import type { SessionSearchRoots } from './types.ts'

export const SESSION_SEARCH_INDEX_DIRNAME = 'indexes'
export const SESSION_SEARCH_DB_FILENAME = 'session-search.db'

export function getSessionSearchIndexDir(roots: SessionSearchRoots): string {
  return join(roots.configRoot, SESSION_SEARCH_INDEX_DIRNAME).normalize('NFC')
}

export function getSessionSearchDbPath(roots: SessionSearchRoots): string {
  return join(getSessionSearchIndexDir(roots), SESSION_SEARCH_DB_FILENAME).normalize('NFC')
}
