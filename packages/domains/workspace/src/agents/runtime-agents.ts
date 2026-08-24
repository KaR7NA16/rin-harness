/**
 * rin agents — runtime agent definitions.
 *
 * Manages AgentDefinition-shaped records under the rin agents home (default
 * ~/.rin/agents/, overridable by config). Records are YAML files
 * (`<name>.agent.yaml`); Markdown files with YAML frontmatter are read too,
 * so a hand-written `.md` definition still joins the list.
 *
 * @module @rin/workspace/agents
 */

import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parse as parseYaml, stringify } from 'yaml'
import type { RuntimeAgentDefinition, RuntimeAgentInput, RuntimeAgentUpdateInput } from './types.ts'
import { isMissingPathError, readDirectory } from './paths.ts'
import { assertAgentName, normalizeTextList, requireRecord, requireText } from './validation.ts'

/** YAML files that carry one runtime definition. */
const RUNTIME_AGENT_FILE = /[.]agent[.]ya?ml$/i

/** Markdown files read through their YAML frontmatter. */
const MARKDOWN_FILE = /[.]md$/i

/**
 * The canonical file path for one runtime definition.
 * @param agentsHome - the rin agents home.
 * @param name - the definition id.
 * @returns the absolute file path.
 */
export function resolveRuntimeAgentPath(agentsHome: string, name: string): string {
  return join(agentsHome, `${name}.agent.yaml`)
}

/**
 * List every runtime definition, ordered by name.
 * @param agentsHome - the rin agents home.
 * @returns the definitions.
 */
export async function listRuntimeAgents(agentsHome: string): Promise<RuntimeAgentDefinition[]> {
  const definitions: RuntimeAgentDefinition[] = []
  for (const entry of await readDirectory(agentsHome)) {
    if (!entry.isFile()) continue
    const isMarkdown = MARKDOWN_FILE.test(entry.name)
    if (!isMarkdown && !RUNTIME_AGENT_FILE.test(entry.name)) continue
    const path = join(agentsHome, entry.name)
    const parsed = parseRuntimeAgentDefinition(await readFile(path, 'utf8'), path, isMarkdown)
    if (parsed === undefined) continue
    definitions.push(parsed)
  }
  return definitions.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Read one runtime definition by id.
 * @param agentsHome - the rin agents home.
 * @param name - the definition id.
 * @returns the definition, or undefined when absent.
 */
export async function getRuntimeAgent(agentsHome: string, name: string): Promise<RuntimeAgentDefinition | undefined> {
  const id = assertAgentName(name, 'agent name')
  const path = resolveRuntimeAgentPath(agentsHome, id)
  const content = await readRuntimeAgentFile(path)
  if (content === undefined) return undefined
  return parseRuntimeAgentDefinition(content, path, false)
}

/**
 * Create one runtime definition, refusing to overwrite an existing file.
 * @param agentsHome - the rin agents home.
 * @param input - the definition fields.
 * @returns the written definition.
 */
export async function createRuntimeAgent(agentsHome: string, input: RuntimeAgentInput): Promise<RuntimeAgentDefinition> {
  const { name, ...rest } = input
  const id = assertAgentName(name, 'agent name')
  const path = resolveRuntimeAgentPath(agentsHome, id)
  if (await fileExists(path)) throw new Error(`rin agents: runtime agent "${id}" already exists`)
  const definition = normalizeRuntimeAgentDefinition(id, rest)
  await writeRuntimeAgent(path, definition)
  return definition
}

/**
 * Replace one runtime definition's fields.
 * @param agentsHome - the rin agents home.
 * @param name - the definition id to replace.
 * @param input - the replacement fields; the id is the method argument.
 * @returns the written definition.
 * @throws when the definition does not exist.
 */
export async function updateRuntimeAgent(
  agentsHome: string,
  name: string,
  input: RuntimeAgentUpdateInput,
): Promise<RuntimeAgentDefinition> {
  const id = assertAgentName(name, 'agent name')
  const path = resolveRuntimeAgentPath(agentsHome, id)
  if (!(await fileExists(path))) throw new Error(`rin agents: runtime agent "${id}" not found`)
  const definition = normalizeRuntimeAgentDefinition(id, input)
  await writeRuntimeAgent(path, definition)
  return definition
}

/**
 * Delete one runtime definition.
 * @param agentsHome - the rin agents home.
 * @param name - the definition id to delete.
 * @throws when the definition does not exist.
 */
export async function deleteRuntimeAgent(agentsHome: string, name: string): Promise<void> {
  const id = assertAgentName(name, 'agent name')
  const path = resolveRuntimeAgentPath(agentsHome, id)
  try {
    await rm(path)
  } catch (error) {
    if (isMissingPathError(error)) throw new Error(`rin agents: runtime agent "${id}" not found`)
    throw error
  }
}

/** Read one definition file's text, or undefined when absent. */
async function readRuntimeAgentFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (isMissingPathError(error)) return undefined
    throw error
  }
}

/** Whether a regular file occupies the path. */
async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (isMissingPathError(error)) return false
    throw error
  }
}

/** Write one definition as YAML, creating the home if needed. */
async function writeRuntimeAgent(path: string, definition: RuntimeAgentDefinition): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, stringify(definition), 'utf8')
}

/** Normalize authored input into a full definition. */
function normalizeRuntimeAgentDefinition(name: string, input: RuntimeAgentUpdateInput): RuntimeAgentDefinition {
  return {
    name: assertAgentName(name, 'agent name'),
    description: requireText(input.description, 'agent description'),
    systemPrompt: requireText(input.systemPrompt, 'agent systemPrompt'),
    tools: normalizeTextList(input.tools, 'agent tools'),
    ...(typeof input.model === 'string' && input.model.trim() !== '' ? { model: input.model.trim() } : {}),
    ...(typeof input.color === 'string' && input.color.trim() !== '' ? { color: input.color.trim() } : {}),
  }
}

/** Parse one YAML (or Markdown-frontmatter) document into a definition. */
function parseRuntimeAgentDefinition(content: string, source: string, fromMarkdown: boolean): RuntimeAgentDefinition | undefined {
  const raw = fromMarkdown ? extractFrontmatter(content) : content
  if (raw === undefined) return undefined
  const value = requireRecord(parseYaml(raw), source)
  return {
    name: assertAgentName(value.name, 'agent name'),
    description: requireText(value.description, 'agent description'),
    systemPrompt: requireText(value.systemPrompt, 'agent systemPrompt'),
    tools: normalizeTextList(value.tools, 'agent tools'),
    ...(typeof value.model === 'string' && value.model.trim() !== '' ? { model: value.model.trim() } : {}),
    ...(typeof value.color === 'string' && value.color.trim() !== '' ? { color: value.color.trim() } : {}),
  }
}

/** Extract YAML frontmatter from a Markdown document, or undefined when absent. */
function extractFrontmatter(content: string): string | undefined {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)
  return match === null ? undefined : match[1]
}
