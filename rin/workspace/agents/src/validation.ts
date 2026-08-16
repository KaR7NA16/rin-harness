/**
 * rin agents — shared schema validation for authored agent records.
 *
 * @module @rin/agents
 */

import type { AgentPermissionMode } from '@rin/repository'

/** Agent names: one file per record, so the name is a filename segment. */
export const AGENT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

/** Permission modes the repository schema accepts. */
const PERMISSION_MODES = new Set<AgentPermissionMode>(['read-only', 'workspace-write', 'danger-full-access'])

/**
 * Validate an agent name.
 * @param value - the candidate name.
 * @param label - what the value names, for the diagnostic.
 * @returns the trimmed name.
 * @throws when the name is empty or not a usable filename segment.
 */
export function assertAgentName(value: unknown, label: string): string {
  const name = requireText(value, label)
  if (!AGENT_NAME.test(name)) {
    throw new Error(`rin agents: invalid ${label} "${name}" — must match ${AGENT_NAME} (it becomes a file name)`)
  }
  return name
}

/** Whether a value is one of the repository's permission modes. */
export function isAgentPermissionMode(value: unknown): value is AgentPermissionMode {
  return typeof value === 'string' && PERMISSION_MODES.has(value as AgentPermissionMode)
}

/**
 * Require a non-empty string.
 * @param value - the candidate value.
 * @param label - what the value names, for the diagnostic.
 * @returns the trimmed string.
 */
export function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`rin agents: expected a non-empty string for ${label}`)
  }
  return value.trim()
}

/**
 * Require a plain record.
 * @param value - the candidate value.
 * @param label - what the value names, for the diagnostic.
 * @returns the record.
 */
export function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`rin agents: expected an object for ${label}`)
  }
  return value as Record<string, unknown>
}

/**
 * Normalize an optional list of non-empty strings, deduplicating in order.
 * @param value - the candidate list, or undefined for the empty list.
 * @param label - what the list names, for the diagnostic.
 * @returns the deduplicated strings.
 */
export function normalizeTextList(value: unknown, label: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`rin agents: expected an array for ${label}`)
  return [...new Set(value.map((item, index) => requireText(item, `${label} ${index}`)))]
}
