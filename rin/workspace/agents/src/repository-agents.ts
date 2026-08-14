/**
 * rin agents — repository agent records.
 *
 * Reads and writes RepositoryAgentConfiguration records under a repository's
 * agents/ root, using the same file convention @rin/repository's reader
 * consumes: one `<name>.agent.yaml` per record, `version: 2`,
 * `kind: AgentConfiguration`. Every record is returned with a content
 * revision (SHA-256, first 12 hex digits).
 *
 * This module is smoke-testable: it imports only node: builtins, `yaml`, and
 * type-only references into @rin/repository.
 *
 * @module @rin/agents
 */

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { parse as parseYaml, stringify } from 'yaml'
import type { RepositoryAgentConfiguration } from '@rin/repository'
import type { RepositoryAgentInput, RepositoryAgentRecord, RepositoryAgentUpdateInput } from './types.ts'
import { computeRevision } from './revision.ts'
import { readDirectory, readFileIfExists } from './paths.ts'
import {
  assertAgentName,
  isAgentPermissionMode,
  normalizeTextList,
  requireRecord,
  requireText,
} from './validation.ts'

/** Files the repository reader treats as agent records. */
const AGENT_FILE = /[.]agent[.]ya?ml$/i

/** The repository manifest file name, mirroring @rin/repository. */
const MANIFEST_FILENAME = 'repository.yaml'

/** The repository root agents live under when the manifest names none. */
const DEFAULT_AGENTS_ROOT = 'agents'

/**
 * Resolve the directory holding repository agent records.
 *
 * Mirrors @rin/repository's root resolution: the manifest's `spec.roots.agents`
 * (a relative, contained path) wins; absent, the conventional `agents/` directory.
 * @param repositoryRoot - absolute or cwd-relative path to the repository root.
 * @returns the absolute agents directory path.
 */
export async function resolveAgentsRoot(repositoryRoot: string): Promise<string> {
  const root = resolve(repositoryRoot)
  const manifest = await readManifest(root)
  const configured = manifest.spec?.roots?.agents
  if (configured === undefined) return join(root, DEFAULT_AGENTS_ROOT)
  if (typeof configured !== 'string' || configured.trim() === '' || isAbsolute(configured)) {
    throw new Error('rin agents: repository root "agents" must be a non-empty relative path')
  }
  const child = resolve(root, configured)
  const relation = relative(root, child)
  if (relation.startsWith('..') || isAbsolute(relation)) {
    throw new Error('rin agents: repository root "agents" escapes the repository')
  }
  return child
}

/**
 * List every repository agent record with its content revision.
 * @param repositoryRoot - the repository root.
 * @returns records ordered by name.
 */
export async function listRepositoryAgents(repositoryRoot: string): Promise<RepositoryAgentRecord[]> {
  const agentsRoot = await resolveAgentsRoot(repositoryRoot)
  const names = (await readDirectory(agentsRoot))
    .filter(entry => entry.isFile() && AGENT_FILE.test(entry.name))
    .map(entry => entry.name.replace(AGENT_FILE, ''))
    .sort((a, b) => a.localeCompare(b))
  const records: RepositoryAgentRecord[] = []
  for (const name of names) {
    const record = await readAgentRecord(agentsRoot, name)
    if (record === undefined) {
      throw new Error(`rin agents: agent "${name}" disappeared while listing`)
    }
    records.push(record)
  }
  return records
}

/**
 * Read one repository agent by id.
 * @param repositoryRoot - the repository root.
 * @param id - the agent name.
 * @returns the record with its revision, or undefined when absent.
 */
export async function getRepositoryAgent(repositoryRoot: string, id: string): Promise<RepositoryAgentRecord | undefined> {
  const agentsRoot = await resolveAgentsRoot(repositoryRoot)
  return readAgentRecord(agentsRoot, assertAgentName(id, 'agent name'))
}

/**
 * Create one repository agent, refusing to overwrite an existing record.
 * @param repositoryRoot - the repository root.
 * @param input - the agent fields; version/kind are fixed by the schema.
 * @returns the written record with its revision.
 */
export async function createRepositoryAgent(repositoryRoot: string, input: RepositoryAgentInput): Promise<RepositoryAgentRecord> {
  const { name, ...rest } = input
  const normalizedName = assertAgentName(name, 'agent name')
  const agentsRoot = await resolveAgentsRoot(repositoryRoot)
  if (await readAgentRecord(agentsRoot, normalizedName) !== undefined) {
    throw new Error(`rin agents: agent "${normalizedName}" already exists`)
  }
  return writeAgentRecord(agentsRoot, normalizeAgentConfiguration(normalizedName, rest))
}

/**
 * Replace one repository agent's fields.
 * @param repositoryRoot - the repository root.
 * @param id - the agent name to replace.
 * @param input - the replacement fields; the id is the method argument.
 * @returns the written record with its new revision.
 * @throws when the agent does not exist.
 */
export async function updateRepositoryAgent(
  repositoryRoot: string,
  id: string,
  input: RepositoryAgentUpdateInput,
): Promise<RepositoryAgentRecord> {
  const name = assertAgentName(id, 'agent name')
  const agentsRoot = await resolveAgentsRoot(repositoryRoot)
  if (await readAgentRecord(agentsRoot, name) === undefined) {
    throw new Error(`rin agents: agent "${name}" not found`)
  }
  return writeAgentRecord(agentsRoot, normalizeAgentConfiguration(name, input))
}

/**
 * Delete one repository agent.
 * @param repositoryRoot - the repository root.
 * @param id - the agent name to delete.
 * @throws when the agent does not exist.
 */
export async function deleteRepositoryAgent(repositoryRoot: string, id: string): Promise<void> {
  const name = assertAgentName(id, 'agent name')
  const agentsRoot = await resolveAgentsRoot(repositoryRoot)
  const path = agentFilePath(agentsRoot, name)
  try {
    await rm(path)
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`rin agents: agent "${name}" not found`)
    }
    throw error
  }
}

/** The canonical file path for one agent record. */
function agentFilePath(agentsRoot: string, name: string): string {
  return join(agentsRoot, `${name}.agent.yaml`)
}

/** Read the repository manifest, returning an empty shape when absent. */
async function readManifest(root: string): Promise<{ spec?: { roots?: Record<string, unknown> } }> {
  const content = await readFileIfExists(join(root, MANIFEST_FILENAME))
  if (content === undefined) return {}
  return requireRecord(parseYaml(content), 'repository manifest') as { spec?: { roots?: Record<string, unknown> } }
}

/** Read, parse, and stamp one agent record, or undefined when absent. */
async function readAgentRecord(agentsRoot: string, name: string): Promise<RepositoryAgentRecord | undefined> {
  const path = agentFilePath(agentsRoot, name)
  const content = await readFileIfExists(path)
  if (content === undefined) return undefined
  return { ...parseAgentConfiguration(content, path), revision: computeRevision(content) }
}

/** Write one record, then return it stamped with the content just written. */
async function writeAgentRecord(agentsRoot: string, config: RepositoryAgentConfiguration): Promise<RepositoryAgentRecord> {
  const path = agentFilePath(agentsRoot, config.name)
  const content = stringify(config)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, 'utf8')
  return { ...config, revision: computeRevision(content) }
}

/** Parse and validate one AgentConfiguration document, mirroring @rin/repository's reader. */
function parseAgentConfiguration(content: string, source: string): RepositoryAgentConfiguration {
  const value = requireRecord(parseYaml(content), source)
  if (value.version !== 2 || value.kind !== 'AgentConfiguration') {
    throw new Error(`rin agents: expected AgentConfiguration v2 in ${source}`)
  }
  if (value.permissionMode !== undefined && !isAgentPermissionMode(value.permissionMode)) {
    throw new Error(`rin agents: invalid agent permission mode in ${source}`)
  }
  const resources = value.resources === undefined ? {} : requireRecord(value.resources, 'agent resources')
  return {
    version: 2,
    kind: 'AgentConfiguration',
    name: assertAgentName(value.name, 'agent name'),
    description: requireText(value.description, 'agent description'),
    systemPrompt: requireText(value.systemPrompt, 'agent systemPrompt'),
    tools: normalizeTextList(value.tools, 'agent tools'),
    resources: {
      ...(typeof resources.environmentProfileId === 'string' && resources.environmentProfileId.trim() !== ''
        ? { environmentProfileId: resources.environmentProfileId.trim() }
        : {}),
      skillIds: normalizeTextList(resources.skillIds, 'agent skillIds'),
      workflowIds: normalizeTextList(resources.workflowIds, 'agent workflowIds'),
    },
    ...(typeof value.model === 'string' && value.model.trim() !== '' ? { model: value.model.trim() } : {}),
    ...(isAgentPermissionMode(value.permissionMode) ? { permissionMode: value.permissionMode } : {}),
  }
}

/** Normalize authored input into a full, reader-accepted configuration. */
function normalizeAgentConfiguration(name: string, input: RepositoryAgentUpdateInput): RepositoryAgentConfiguration {
  const resources = input.resources === undefined ? {} : requireRecord(input.resources, 'agent resources')
  if (input.permissionMode !== undefined && !isAgentPermissionMode(input.permissionMode)) {
    throw new Error('rin agents: invalid agent permissionMode')
  }
  return {
    version: 2,
    kind: 'AgentConfiguration',
    name: assertAgentName(name, 'agent name'),
    description: requireText(input.description, 'agent description'),
    systemPrompt: requireText(input.systemPrompt, 'agent systemPrompt'),
    tools: normalizeTextList(input.tools, 'agent tools'),
    resources: {
      ...(typeof resources.environmentProfileId === 'string' && resources.environmentProfileId.trim() !== ''
        ? { environmentProfileId: resources.environmentProfileId.trim() }
        : {}),
      skillIds: normalizeTextList(resources.skillIds, 'agent skillIds'),
      workflowIds: normalizeTextList(resources.workflowIds, 'agent workflowIds'),
    },
    ...(typeof input.model === 'string' && input.model.trim() !== '' ? { model: input.model.trim() } : {}),
    ...(input.permissionMode !== undefined ? { permissionMode: input.permissionMode } : {}),
  }
}
