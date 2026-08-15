/**
 * rin web-server — sandboxes routes.
 *
 * Sandbox-profile CRUD, capability probing, and environment-plan execution
 * over ctx.sandboxes + ctx.environment. All @rin imports are type-only, so
 * this module stays runtime-dependency-free. Returns null for any pathname it
 * does not claim.
 *
 * @module @rin/web-server
 */

import type {
  ContainerConfig,
  ContainerMount,
  ContainerPort,
  ContainerRuntime,
  RemoteConfig,
  SandboxProfileInput,
  SandboxProfilePatch,
  SandboxType,
} from '@rin/sandboxes'
import type { Config, JsonResponse } from '../types.ts'
import {
  asRecord,
  booleanField,
  error,
  errorMessage,
  mountedValue,
  notMounted,
  stringField,
} from '../http.ts'
import type { RinServiceRefs } from '../routes.ts'

/** The per-profile pathname actions keyed by profile id. */
const SANDBOX_ACTION_RE = /^\/api\/sandboxes\/([^/]+)\/(update|remove|default|probe)$/

/** The per-profile action verbs the regex admits. */
type SandboxAction = 'update' | 'remove' | 'default' | 'probe'

/** Dispatch the sandboxes pathnames; null for anything else. */
export async function handle(
  pathname: string,
  _search: string,
  method: string,
  body: unknown,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse | null> {
  if (pathname === '/api/sandboxes') {
    if (method === 'POST') return sandboxesCreateRoute(method, body, services)
    if (method === 'GET' || method === 'HEAD') return sandboxesListRoute(services)
    return error(405, 'method not allowed; GET or POST /api/sandboxes')
  }
  if (pathname === '/api/sandboxes/execute') {
    return sandboxesExecuteRoute(method, body, services, config)
  }
  const match = SANDBOX_ACTION_RE.exec(pathname)
  if (match === null) return null
  const id = match[1]
  // SANDBOX_ACTION_RE restricts the verb, so the regex capture is this union.
  const verb = match[2] as SandboxAction | undefined
  if (id === undefined || verb === undefined) return null
  return sandboxesActionRoute(method, verb, id, body, services)
}

async function sandboxesListRoute(services: RinServiceRefs): Promise<JsonResponse> {
  const sandboxes = services.sandboxes()
  if (sandboxes === undefined) return notMounted()
  try {
    return mountedValue('sandboxes', await sandboxes.list())
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function sandboxesCreateRoute(
  method: string,
  body: unknown,
  services: RinServiceRefs,
): Promise<JsonResponse> {
  const sandboxes = services.sandboxes()
  if (sandboxes === undefined) return notMounted()
  if (method !== 'POST') return error(405, 'method not allowed; POST /api/sandboxes')
  const parsed = parseSandboxProfileInput(body)
  if (!parsed.ok) return error(400, parsed.message)
  try {
    return mountedValue('sandbox', await sandboxes.create(parsed.input))
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function sandboxesActionRoute(
  method: string,
  verb: SandboxAction,
  id: string,
  body: unknown,
  services: RinServiceRefs,
): Promise<JsonResponse> {
  const sandboxes = services.sandboxes()
  if (sandboxes === undefined) return notMounted()
  if (method !== 'POST') return error(405, 'method not allowed; POST /api/sandboxes/{id}/' + verb)
  try {
    switch (verb) {
      case 'update': {
        const parsed = parseSandboxProfilePatch(body)
        if (!parsed.ok) return error(400, parsed.message)
        return mountedValue('sandbox', await sandboxes.update(id, parsed.patch))
      }
      case 'remove':
        return mountedValue('removed', await sandboxes.remove(id))
      case 'default':
        return mountedValue('sandbox', await sandboxes.setDefault(id))
      case 'probe': {
        const profile = await sandboxes.get(id)
        if (profile === null) return error(404, 'sandbox profile not found')
        return mountedValue('capabilities', await sandboxes.probeCapabilities(profile))
      }
    }
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function sandboxesExecuteRoute(
  method: string,
  body: unknown,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse> {
  const sandboxes = services.sandboxes()
  if (sandboxes === undefined) return notMounted()
  if (method !== 'POST') return error(405, 'method not allowed; POST /api/sandboxes/execute')
  const environment = services.environment()
  if (environment === undefined) return error(500, 'environment service is not mounted')
  const fields = asRecord(body)
  if (fields === undefined) return error(400, 'request body must be a JSON object')
  const profileId = stringField(fields, 'profileId')
  const repositoryId = stringField(fields, 'repositoryId')
  const environmentProfileId = stringField(fields, 'environmentProfileId')
  if (profileId === undefined) return error(400, 'profileId is required')
  if (repositoryId === undefined) return error(400, 'repositoryId is required')
  if (environmentProfileId === undefined) return error(400, 'environmentProfileId is required')
  if (booleanField(fields, 'approve') !== true) return error(400, 'approve must be true to execute an environment plan')
  const root = stringField(fields, 'root') ?? config.repositoryRoot
  if (root === undefined) return error(400, 'repository root not configured; pass root in the body or set Config.repositoryRoot')
  try {
    const profile = await sandboxes.get(profileId)
    if (profile === null) return error(404, 'sandbox profile not found')
    const capabilities = await sandboxes.probeCapabilities(profile)
    const plan = await environment.plan(root, environmentProfileId, capabilities)
    const run = await sandboxes.executeEnvironmentPlan(profile, repositoryId, environmentProfileId, plan, { approve: true })
    return mountedValue('run', run)
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

/** Validate and coerce a wire payload into a SandboxProfileInput. */
function parseSandboxProfileInput(
  value: unknown,
): { ok: true; input: SandboxProfileInput } | { ok: false; message: string } {
  const raw = asRecord(value)
  if (raw === undefined) return { ok: false, message: 'request body must be a JSON object' }
  const parsed = parseSandboxFields(raw)
  if (!parsed.ok) return parsed
  const { fields } = parsed
  if (fields.name === undefined || fields.name.trim() === '') return { ok: false, message: 'name is required' }
  if (fields.type === undefined) return { ok: false, message: 'type is required' }
  return {
    ok: true,
    input: {
      name: fields.name,
      type: fields.type,
      ...(fields.isDefault !== undefined ? { isDefault: fields.isDefault } : {}),
      ...(fields.repositoryId !== undefined ? { repositoryId: fields.repositoryId } : {}),
      ...(fields.repositoryPath !== undefined ? { repositoryPath: fields.repositoryPath } : {}),
      ...(fields.environmentProfileId !== undefined ? { environmentProfileId: fields.environmentProfileId } : {}),
      ...(fields.container !== undefined ? { container: fields.container } : {}),
      ...(fields.remote !== undefined ? { remote: fields.remote } : {}),
    },
  }
}

/** Validate and coerce a wire payload into a SandboxProfilePatch. */
function parseSandboxProfilePatch(
  value: unknown,
): { ok: true; patch: SandboxProfilePatch } | { ok: false; message: string } {
  const raw = asRecord(value)
  if (raw === undefined) return { ok: false, message: 'request body must be a JSON object' }
  const parsed = parseSandboxFields(raw)
  if (!parsed.ok) return parsed
  const { fields } = parsed
  return {
    ok: true,
    patch: {
      ...(fields.name !== undefined ? { name: fields.name } : {}),
      ...(fields.type !== undefined ? { type: fields.type } : {}),
      ...(fields.isDefault !== undefined ? { isDefault: fields.isDefault } : {}),
      ...(fields.repositoryId !== undefined ? { repositoryId: fields.repositoryId } : {}),
      ...(fields.repositoryPath !== undefined ? { repositoryPath: fields.repositoryPath } : {}),
      ...(fields.environmentProfileId !== undefined ? { environmentProfileId: fields.environmentProfileId } : {}),
      ...(fields.container !== undefined ? { container: fields.container } : {}),
      ...(fields.remote !== undefined ? { remote: fields.remote } : {}),
    },
  }
}

/** Parsed sandbox fields, all optional. */
interface ParsedSandboxFields {
  name?: string
  type?: SandboxType
  isDefault?: boolean
  repositoryId?: string
  repositoryPath?: string
  environmentProfileId?: string
  container?: ContainerConfig
  remote?: RemoteConfig
}

/** Validate the shared sandbox fields of a create/update payload. */
function parseSandboxFields(
  raw: Record<string, unknown>,
): { ok: true; fields: ParsedSandboxFields } | { ok: false; message: string } {
  const type = stringField(raw, 'type')
  if (type !== undefined && type !== 'local-sandbox' && type !== 'container' && type !== 'remote') {
    return { ok: false, message: 'type must be local-sandbox, container, or remote' }
  }
  const isDefault = booleanField(raw, 'isDefault')
  if (raw.isDefault !== undefined && isDefault === undefined) {
    return { ok: false, message: 'isDefault must be a boolean' }
  }
  const container = parseContainerConfig(raw.container)
  if (raw.container !== undefined && container === undefined) {
    return { ok: false, message: 'container must be an object with a string image' }
  }
  const remote = parseRemoteConfig(raw.remote)
  if (raw.remote !== undefined && remote === undefined) {
    return { ok: false, message: 'remote must be an object with string host and user' }
  }
  const name = stringField(raw, 'name')
  const repositoryId = stringField(raw, 'repositoryId')
  const repositoryPath = stringField(raw, 'repositoryPath')
  const environmentProfileId = stringField(raw, 'environmentProfileId')
  return {
    ok: true,
    fields: {
      ...(name !== undefined ? { name } : {}),
      ...(type !== undefined ? { type } : {}),
      ...(isDefault !== undefined ? { isDefault } : {}),
      ...(repositoryId !== undefined ? { repositoryId } : {}),
      ...(repositoryPath !== undefined ? { repositoryPath } : {}),
      ...(environmentProfileId !== undefined ? { environmentProfileId } : {}),
      ...(container !== undefined ? { container } : {}),
      ...(remote !== undefined ? { remote } : {}),
    },
  }
}

function parseContainerConfig(value: unknown): ContainerConfig | undefined {
  const raw = asRecord(value)
  if (raw === undefined) return undefined
  const image = stringField(raw, 'image')
  if (image === undefined) return undefined
  const runtime = parseContainerRuntime(raw.runtime)
  if (raw.runtime !== undefined && runtime === undefined) return undefined
  const workdir = stringField(raw, 'workdir')
  const shell = stringField(raw, 'shell')
  const mounts = parseContainerMounts(raw.mounts)
  if (raw.mounts !== undefined && mounts === undefined) return undefined
  const env = parseStringRecord(raw.env)
  if (raw.env !== undefined && env === undefined) return undefined
  const ports = parseContainerPorts(raw.ports)
  if (raw.ports !== undefined && ports === undefined) return undefined
  return {
    image,
    ...(runtime !== undefined ? { runtime } : {}),
    ...(workdir !== undefined ? { workdir } : {}),
    ...(shell !== undefined ? { shell } : {}),
    ...(mounts !== undefined ? { mounts } : {}),
    ...(env !== undefined ? { env } : {}),
    ...(ports !== undefined ? { ports } : {}),
  }
}

function parseContainerRuntime(value: unknown): ContainerRuntime | undefined {
  return value === 'docker' || value === 'podman' || value === 'auto' ? value : undefined
}

function parseStringRecord(value: unknown): Record<string, string> | undefined {
  const raw = asRecord(value)
  if (raw === undefined) return undefined
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(raw)) {
    if (typeof item !== 'string') return undefined
    out[key] = item
  }
  return out
}

function parseContainerMounts(value: unknown): ContainerMount[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: ContainerMount[] = []
  for (const item of value) {
    const raw = asRecord(item)
    if (raw === undefined) return undefined
    const host = stringField(raw, 'host')
    const guest = stringField(raw, 'guest')
    if (host === undefined || guest === undefined) return undefined
    const ro = booleanField(raw, 'ro')
    out.push({ host, guest, ...(ro !== undefined ? { ro } : {}) })
  }
  return out
}

function parseContainerPorts(value: unknown): ContainerPort[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: ContainerPort[] = []
  for (const item of value) {
    const raw = asRecord(item)
    if (raw === undefined) return undefined
    const host = raw.host
    const guest = raw.guest
    if (typeof host !== 'number' || typeof guest !== 'number') return undefined
    out.push({ host, guest })
  }
  return out
}

function parseRemoteConfig(value: unknown): RemoteConfig | undefined {
  const raw = asRecord(value)
  if (raw === undefined) return undefined
  const host = stringField(raw, 'host')
  const user = stringField(raw, 'user')
  if (host === undefined || user === undefined) return undefined
  const port = raw.port
  if (raw.port !== undefined && typeof port !== 'number') return undefined
  const identityFile = stringField(raw, 'identityFile')
  const useDocker = booleanField(raw, 'useDocker')
  return {
    host,
    user,
    ...(typeof port === 'number' ? { port } : {}),
    ...(identityFile !== undefined ? { identityFile } : {}),
    ...(useDocker !== undefined ? { useDocker } : {}),
  }
}
