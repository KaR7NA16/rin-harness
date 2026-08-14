/**
 * rin web-server — agents routes.
 *
 * Repository-agent listing/creation/update/delete plus projection and AI
 * proposal over ctx.agents. All @rin/agents imports are type-only, so this
 * module stays runtime-dependency-free. Returns null for any pathname it does
 * not claim.
 *
 * @module @rin/web-server
 */

import type { AgentPermissionMode } from '@rin/repository'
import type { RepositoryAgentInput, RepositoryAgentUpdateInput } from '@rin/agents'
import type { Config, JsonResponse } from '../types.ts'
import {
  asRecord,
  error,
  errorMessage,
  mountedValue,
  notMounted,
  queryParam,
  stringField,
} from '../http.ts'
import type { RinServiceRefs } from '../routes.ts'

/** The per-agent pathname actions keyed by agent name. */
const AGENT_ACTION_RE = /^\/api\/agents\/([^/]+)\/(update|delete)$/

/** Dispatch the agents pathnames; null for anything else. */
export async function handle(
  pathname: string,
  search: string,
  method: string,
  body: unknown,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse | null> {
  switch (pathname) {
    case '/api/agents':
      return method === 'POST'
        ? agentsCreateRoute(body, services, config)
        : agentsListRoute(search, services, config)
    case '/api/agents/runtime':
      return agentsRuntimeRoute(services)
    case '/api/agents/project':
      return agentsProjectRoute(method, body, services, config)
    case '/api/agents/propose':
      return agentsProposeRoute(method, body, services)
    default:
      break
  }
  const match = AGENT_ACTION_RE.exec(pathname)
  if (match === null) return null
  const name = match[1]
  const verb = match[2]
  if (name === undefined || verb === undefined) return null
  return agentsActionRoute(method, verb, name, body, services, config)
}

async function agentsListRoute(
  search: string,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse> {
  const agents = services.agents()
  if (agents === undefined) return notMounted()
  const root = queryParam(search, 'root') ?? config.repositoryRoot
  try {
    return mountedValue('agents', await agents.listRepositoryAgents(root))
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function agentsRuntimeRoute(services: RinServiceRefs): Promise<JsonResponse> {
  const agents = services.agents()
  if (agents === undefined) return notMounted()
  try {
    return mountedValue('agents', await agents.listRuntimeAgents())
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function agentsCreateRoute(
  body: unknown,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse> {
  const agents = services.agents()
  if (agents === undefined) return notMounted()
  const fields = asRecord(body)
  if (fields === undefined) return error(400, 'request body must be a JSON object')
  const root = stringField(fields, 'root') ?? config.repositoryRoot
  const parsed = parseRepositoryAgentInput(fields.input)
  if (!parsed.ok) return error(400, parsed.message)
  try {
    return mountedValue('agent', await agents.createRepositoryAgent(root, parsed.input))
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function agentsActionRoute(
  method: string,
  verb: string,
  name: string,
  body: unknown,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse> {
  const agents = services.agents()
  if (agents === undefined) return notMounted()
  if (method !== 'POST') return error(405, 'method not allowed; POST /api/agents/' + name + '/' + verb)
  const fields = asRecord(body)
  if (fields === undefined) return error(400, 'request body must be a JSON object')
  const root = stringField(fields, 'root') ?? config.repositoryRoot
  try {
    if (verb === 'update') {
      const parsed = parseRepositoryAgentUpdateInput(fields.input)
      if (!parsed.ok) return error(400, parsed.message)
      return mountedValue('agent', await agents.updateRepositoryAgent(root, name, parsed.input))
    }
    await agents.deleteRepositoryAgent(root, name)
    return mountedValue('deleted', true)
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function agentsProjectRoute(
  method: string,
  body: unknown,
  services: RinServiceRefs,
  config: Config,
): Promise<JsonResponse> {
  const agents = services.agents()
  if (agents === undefined) return notMounted()
  if (method !== 'POST') return error(405, 'method not allowed; POST /api/agents/project')
  const fields = asRecord(body)
  if (fields === undefined) return error(400, 'request body must be a JSON object')
  const root = stringField(fields, 'root') ?? config.repositoryRoot
  const presetRoot = stringField(fields, 'presetRoot')
  try {
    const result = await agents.projectRepositoryAgents(root, {
      ...(presetRoot !== undefined ? { presetRoot } : {}),
    })
    return mountedValue('ids', result.ids)
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

async function agentsProposeRoute(
  method: string,
  body: unknown,
  services: RinServiceRefs,
): Promise<JsonResponse> {
  const agents = services.agents()
  if (agents === undefined) return notMounted()
  if (method !== 'POST') return error(405, 'method not allowed; POST /api/agents/propose')
  const fields = asRecord(body)
  if (fields === undefined) return error(400, 'request body must be a JSON object')
  const instructions = stringField(fields, 'instructions')
  if (instructions === undefined || instructions.trim() === '') {
    return error(400, 'instructions is required and must be a non-empty string')
  }
  try {
    // The repository root is accepted for forward-compatibility but the store's
    // proposeAgent() adapter is repository-agnostic today.
    return mountedValue('proposal', await agents.proposeAgent(instructions))
  } catch (err) {
    return error(500, errorMessage(err))
  }
}

/** Shared, name-less agent fields parsed from a wire input. */
interface ParsedAgentFields {
  description: string
  systemPrompt: string
  model?: string
  permissionMode?: AgentPermissionMode
  tools?: string[]
  resources?: NonNullable<RepositoryAgentInput['resources']>
}

/** Validate the shared (non-name) fields of a create/update input. */
function parseAgentFields(
  raw: Record<string, unknown>,
): { ok: true; fields: ParsedAgentFields } | { ok: false; message: string } {
  const description = stringField(raw, 'description')
  const systemPrompt = stringField(raw, 'systemPrompt')
  if (description === undefined) return { ok: false, message: 'description is required' }
  if (systemPrompt === undefined) return { ok: false, message: 'systemPrompt is required' }
  const model = stringField(raw, 'model')
  const permissionMode = parsePermissionMode(raw.permissionMode)
  if (raw.permissionMode !== undefined && permissionMode === undefined) {
    return { ok: false, message: 'permissionMode must be default, acceptEdits, plan, or bypassPermissions' }
  }
  const tools = parseStringArray(raw.tools)
  if (raw.tools !== undefined && tools === undefined) {
    return { ok: false, message: 'tools must be an array of strings' }
  }
  const resources = parseAgentResources(raw.resources)
  if (raw.resources !== undefined && resources === undefined) {
    return { ok: false, message: 'resources must be an object with optional environmentProfileId, skillIds, workflowIds' }
  }
  return {
    ok: true,
    fields: {
      description,
      systemPrompt,
      ...(model !== undefined ? { model } : {}),
      ...(permissionMode !== undefined ? { permissionMode } : {}),
      ...(tools !== undefined ? { tools } : {}),
      ...(resources !== undefined ? { resources } : {}),
    },
  }
}

/** Validate and coerce a wire payload into a RepositoryAgentInput. */
function parseRepositoryAgentInput(
  value: unknown,
): { ok: true; input: RepositoryAgentInput } | { ok: false; message: string } {
  const raw = asRecord(value)
  if (raw === undefined) return { ok: false, message: 'input is required and must be an object' }
  const name = stringField(raw, 'name')
  if (name === undefined) return { ok: false, message: 'input.name is required' }
  const parsed = parseAgentFields(raw)
  if (!parsed.ok) return parsed
  return { ok: true, input: { name, ...parsed.fields } }
}

/** Validate and coerce a wire payload into a RepositoryAgentUpdateInput. */
function parseRepositoryAgentUpdateInput(
  value: unknown,
): { ok: true; input: RepositoryAgentUpdateInput } | { ok: false; message: string } {
  const raw = asRecord(value)
  if (raw === undefined) return { ok: false, message: 'input is required and must be an object' }
  const parsed = parseAgentFields(raw)
  if (!parsed.ok) return parsed
  return { ok: true, input: parsed.fields }
}

function parsePermissionMode(value: unknown): AgentPermissionMode | undefined {
  return value === 'default' || value === 'acceptEdits' || value === 'plan' || value === 'bypassPermissions'
    ? value
    : undefined
}

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  if (value.some(item => typeof item !== 'string')) return undefined
  return value as string[]
}

function parseAgentResources(value: unknown): NonNullable<RepositoryAgentInput['resources']> | undefined {
  const raw = asRecord(value)
  if (raw === undefined) return undefined
  const environmentProfileId = stringField(raw, 'environmentProfileId')
  const skillIds = parseStringArray(raw.skillIds)
  const workflowIds = parseStringArray(raw.workflowIds)
  if (raw.skillIds !== undefined && skillIds === undefined) return undefined
  if (raw.workflowIds !== undefined && workflowIds === undefined) return undefined
  return {
    ...(environmentProfileId !== undefined ? { environmentProfileId } : {}),
    skillIds: skillIds ?? [],
    workflowIds: workflowIds ?? [],
  }
}
