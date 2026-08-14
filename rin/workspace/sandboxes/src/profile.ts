/**
 * rin sandboxes — profile construction, validation, and migration.
 *
 * Pure profile operations: building a new profile, applying a patch,
 * attaching a repository mount to a container configuration, migrating the
 * legacy sandboxes.json shape into the v2 store document, and validating a
 * profile read from the file boundary. No filesystem or process access, so
 * the module is directly unit-testable and strip-types smoke-testable.
 *
 * @module @rin/sandboxes
 */

import { randomUUID } from 'node:crypto'
import {
  SANDBOX_STORE_SCHEMA_VERSION,
  type ContainerConfig,
  type ContainerMount,
  type ContainerPort,
  type ContainerRuntime,
  type RemoteConfig,
  type SandboxProfile,
  type SandboxProfileInput,
  type SandboxProfilePatch,
  type SandboxStoreDocument,
  type SandboxType,
} from './types.ts'

const WORKSPACE_GUEST_PATH = '/workspace'
const SANDBOX_TYPES = new Set<SandboxType>(['local-sandbox', 'container', 'remote'])
const CONTAINER_RUNTIMES = new Set<ContainerRuntime>(['docker', 'podman', 'auto'])

/**
 * Build a new profile from caller input, assigning a stable id and timestamps.
 *
 * @param input - the caller-supplied profile fields.
 * @param now - optional clock override for deterministic tests.
 * @returns the new profile.
 */
export function newSandboxProfile(input: SandboxProfileInput, now?: string): SandboxProfile {
  const name = input.name.trim()
  if (!name) throw new Error('rin sandboxes: profile name is required')
  if (!SANDBOX_TYPES.has(input.type)) throw new Error('rin sandboxes: unknown sandbox type "' + String(input.type) + '"')
  const timestamp = now ?? new Date().toISOString()
  return {
    id: randomUUID(),
    name,
    type: input.type,
    isDefault: input.isDefault ?? false,
    ...(input.repositoryId ? { repositoryId: input.repositoryId } : {}),
    ...(input.repositoryPath ? { repositoryPath: input.repositoryPath } : {}),
    ...(input.environmentProfileId ? { environmentProfileId: input.environmentProfileId } : {}),
    ...(input.container ? { container: input.container } : {}),
    ...(input.remote ? { remote: input.remote } : {}),
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

/**
 * Merge a patch into an existing profile, preserving id and createdAt.
 *
 * @param profile - the profile to patch.
 * @param patch - the caller-mutable fields to merge.
 * @param now - optional clock override for deterministic tests.
 * @returns the patched profile.
 */
export function applySandboxProfilePatch(profile: SandboxProfile, patch: SandboxProfilePatch, now?: string): SandboxProfile {
  const name = patch.name === undefined ? profile.name : patch.name.trim()
  if (!name) throw new Error('rin sandboxes: profile name is required')
  const type = patch.type ?? profile.type
  if (!SANDBOX_TYPES.has(type)) throw new Error('rin sandboxes: unknown sandbox type "' + String(type) + '"')
  return {
    ...profile,
    ...patch,
    id: profile.id,
    name,
    type,
    createdAt: profile.createdAt,
    updatedAt: now ?? new Date().toISOString(),
  }
}

/**
 * Attach a repository path as the container's /workspace mount.
 *
 * A container that already mounts /workspace is returned unchanged; otherwise
 * the repository is appended as a /workspace bind mount and the workdir
 * defaults to /workspace when unset.
 *
 * @param container - the container configuration.
 * @param repositoryPath - the host repository path to mount.
 * @returns the (possibly extended) container configuration.
 */
export function attachRepositoryToContainer(container: ContainerConfig, repositoryPath?: string): ContainerConfig {
  const hostPath = repositoryPath?.trim()
  if (!hostPath || container.mounts?.some(mount => mount.guest === WORKSPACE_GUEST_PATH)) return container
  return {
    ...container,
    workdir: container.workdir ?? WORKSPACE_GUEST_PATH,
    mounts: [...(container.mounts ?? []), { host: hostPath, guest: WORKSPACE_GUEST_PATH }],
  }
}

/**
 * Migrate the legacy sandboxes.json shape into the v2 store document.
 *
 * Accepts either a bare profile array or an object with a profiles array.
 * Missing legacy fields are defaulted: type → 'container', timestamps → now,
 * and the first profile becomes the default.
 *
 * @param input - the parsed legacy JSON.
 * @param now - optional clock override for deterministic tests.
 * @returns the v2 store document.
 */
export function migrateLegacySandboxes(input: unknown, now?: string): SandboxStoreDocument {
  const raw = Array.isArray(input)
    ? input
    : isRecord(input) && Array.isArray(input.profiles)
      ? input.profiles
      : []
  const timestamp = now ?? new Date().toISOString()
  return {
    version: SANDBOX_STORE_SCHEMA_VERSION,
    profiles: raw.map((entry, index) => {
      const value = isRecord(entry) ? entry : {}
      return parseSandboxProfile({
        ...value,
        id: typeof value.id === 'string' && value.id ? value.id : randomUUID(),
        name: typeof value.name === 'string' && value.name ? value.name : 'profile-' + (index + 1),
        type: isSandboxType(value.type) ? value.type : 'container',
        isDefault: value.isDefault === true || index === 0,
        createdAt: typeof value.createdAt === 'string' && value.createdAt ? value.createdAt : timestamp,
        updatedAt: typeof value.updatedAt === 'string' && value.updatedAt ? value.updatedAt : timestamp,
      }, index)
    }),
  }
}

/**
 * Validate and normalize one profile read from the v2 store file.
 *
 * Fails loud on a malformed profile (missing id/name/type/timestamps, or a
 * container without an image).
 *
 * @param input - the parsed profile value.
 * @param index - the profile's position in the document, for error messages.
 * @returns the normalized profile.
 */
export function parseSandboxProfile(input: unknown, index: number): SandboxProfile {
  const value = requireRecord(input, 'sandbox profile ' + index)
  const id = requireText(value.id, 'sandbox profile ' + index + ' id')
  const name = requireText(value.name, 'sandbox profile ' + index + ' name')
  if (!isSandboxType(value.type)) throw new Error('rin sandboxes: invalid sandbox type for profile ' + index)
  return {
    id,
    name,
    type: value.type,
    isDefault: value.isDefault === true,
    ...(typeof value.repositoryId === 'string' && value.repositoryId.trim() ? { repositoryId: value.repositoryId.trim() } : {}),
    ...(typeof value.repositoryPath === 'string' && value.repositoryPath.trim() ? { repositoryPath: value.repositoryPath.trim() } : {}),
    ...(typeof value.environmentProfileId === 'string' && value.environmentProfileId.trim() ? { environmentProfileId: value.environmentProfileId.trim() } : {}),
    ...(isRecord(value.container) ? { container: parseContainerConfig(value.container, index) } : {}),
    ...(isRecord(value.remote) ? { remote: parseRemoteConfig(value.remote, index) } : {}),
    createdAt: requireText(value.createdAt, 'sandbox profile ' + index + ' createdAt'),
    updatedAt: requireText(value.updatedAt, 'sandbox profile ' + index + ' updatedAt'),
  }
}

function parseContainerConfig(input: Record<string, unknown>, index: number): ContainerConfig {
  const image = requireText(input.image, 'sandbox profile ' + index + ' container image')
  return {
    ...(isContainerRuntime(input.runtime) ? { runtime: input.runtime } : {}),
    image,
    ...(typeof input.workdir === 'string' && input.workdir.trim() ? { workdir: input.workdir.trim() } : {}),
    ...(Array.isArray(input.mounts) ? { mounts: input.mounts.map((mount, mountIndex) => parseMount(mount, index, mountIndex)) } : {}),
    ...(isRecord(input.env) ? { env: parseStringMap(input.env) } : {}),
    ...(Array.isArray(input.ports) ? { ports: input.ports.map((port, portIndex) => parsePort(port, index, portIndex)) } : {}),
    ...(typeof input.shell === 'string' && input.shell.trim() ? { shell: input.shell.trim() } : {}),
  }
}

function parseRemoteConfig(input: Record<string, unknown>, index: number): RemoteConfig {
  return {
    host: requireText(input.host, 'sandbox profile ' + index + ' remote host'),
    user: requireText(input.user, 'sandbox profile ' + index + ' remote user'),
    ...(typeof input.port === 'number' && Number.isFinite(input.port) ? { port: input.port } : {}),
    ...(typeof input.identityFile === 'string' && input.identityFile.trim() ? { identityFile: input.identityFile.trim() } : {}),
    ...(input.useDocker === true ? { useDocker: true } : {}),
  }
}

function parseMount(input: unknown, profileIndex: number, mountIndex: number): ContainerMount {
  const value = requireRecord(input, 'sandbox profile ' + profileIndex + ' mount ' + mountIndex)
  return {
    host: requireText(value.host, 'sandbox profile ' + profileIndex + ' mount ' + mountIndex + ' host'),
    guest: requireText(value.guest, 'sandbox profile ' + profileIndex + ' mount ' + mountIndex + ' guest'),
    ...(value.ro === true ? { ro: true } : {}),
  }
}

function parsePort(input: unknown, profileIndex: number, portIndex: number): ContainerPort {
  const value = requireRecord(input, 'sandbox profile ' + profileIndex + ' port ' + portIndex)
  const host = requireNumber(value.host, 'sandbox profile ' + profileIndex + ' port ' + portIndex + ' host')
  const guest = requireNumber(value.guest, 'sandbox profile ' + profileIndex + ' port ' + portIndex + ' guest')
  return { host, guest }
}

function parseStringMap(input: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') result[key] = value
  }
  return result
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('rin sandboxes: expected object for ' + label)
  return value
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('rin sandboxes: expected non-empty string for ' + label)
  return value.trim()
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('rin sandboxes: expected number for ' + label)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSandboxType(value: unknown): value is SandboxType {
  return typeof value === 'string' && SANDBOX_TYPES.has(value as SandboxType)
}

function isContainerRuntime(value: unknown): value is ContainerRuntime {
  return typeof value === 'string' && CONTAINER_RUNTIMES.has(value as ContainerRuntime)
}
