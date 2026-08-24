/**
 * rin sandboxes — file-store codec.
 *
 * Serializes and parses the versioned sandbox-store document. Parsing
 * validates the document envelope and every profile at the file boundary
 * (delegating per-profile validation to profile.ts).
 *
 * @module @rin/workspace/sandboxes
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { SANDBOX_STORE_SCHEMA_VERSION, type SandboxStoreDocument } from './types.ts'
import { parseSandboxProfile } from './profile.ts'

/**
 * Parse a sandbox-store YAML document and validate its envelope and profiles.
 *
 * @param text - the raw YAML file contents.
 * @returns the parsed store document.
 */
export function parseSandboxStoreDocument(text: string): SandboxStoreDocument {
  const value = parseYaml(text) as unknown
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('rin sandboxes: expected a sandbox-store object')
  }
  const record = value as Record<string, unknown>
  if (record.version !== SANDBOX_STORE_SCHEMA_VERSION) {
    throw new Error('rin sandboxes: unsupported sandbox-store version "' + String(record.version) + '"')
  }
  const profiles = Array.isArray(record.profiles) ? record.profiles : []
  return {
    version: SANDBOX_STORE_SCHEMA_VERSION,
    profiles: profiles.map((entry, index) => parseSandboxProfile(entry, index)),
  }
}

/**
 * Serialize a sandbox-store document to YAML.
 *
 * @param document - the store document to serialize.
 * @returns the YAML text.
 */
export function stringifySandboxStoreDocument(document: SandboxStoreDocument): string {
  return stringifyYaml(document)
}
