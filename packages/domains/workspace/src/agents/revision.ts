/**
 * rin agents — content revisions.
 *
 * @module @rin/workspace/agents
 */

import { createHash } from 'node:crypto'

/**
 * Content revision for one agent record: the first 12 hex digits of the
 * file's SHA-256 digest. Two files with the same revision have identical
 * content, so a caller can tell whether a record changed without comparing
 * the files byte-for-byte.
 * @param content - the raw file contents.
 * @returns the 12-character lowercase-hex revision.
 */
export function computeRevision(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 12)
}
