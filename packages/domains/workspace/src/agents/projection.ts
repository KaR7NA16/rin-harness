/**
 * rin agents — projection into the dsh agent-presets seam.
 *
 * Materialises each repository AgentConfiguration as a user preset directory
 * under a preset root: `<presetRoot>/<id>/agent.cordis.yml`. The preset id is
 * the repository agent's name, validated against the same pattern the dsh
 * agent-presets package uses (PRESET_ID) because the id becomes a directory
 * name. Projection never overwrites a preset whose content differs — it fails
 * loud and leaves that file untouched.
 *
 * @module @rin/workspace/agents
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { stringify } from 'yaml'
import type { RepositoryAgentConfiguration } from '@rin/assets'
import type { ProjectionResult } from './types.ts'
import { listRepositoryAgents } from './repository-agents.ts'
import { readFileIfExists } from './paths.ts'

/** Preset ids, mirroring @deepseek-ai/dsh-agent-presets' PRESET_ID. */
export const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/

/** The composition file that makes a directory a preset. */
export const COMPOSITION_FILE = 'agent.cordis.yml'

/** Plugin row that installs the agent's complete system prompt. */
const PERSONA_PLUGIN = '@deepseek-ai/dsh-persona'

/** Prefix that turns a repository tool id into its dsh tool plugin name. */
const TOOL_PLUGIN_PREFIX = '@deepseek-ai/dsh-tool-'

/**
 * Validate a repository agent name as a preset id.
 * @param id - the candidate id.
 * @returns the id unchanged.
 * @throws when the id does not match PRESET_ID.
 */
export function assertValidPresetId(id: string): string {
  if (!PRESET_ID.test(id)) {
    throw new Error(
      `rin agents: agent "${id}" cannot be projected — the preset id must match ${PRESET_ID} because it becomes a directory name; rename the agent to lowercase letters, digits, and hyphens`,
    )
  }
  return id
}

/**
 * Render one repository agent as an agent.cordis.yml composition.
 *
 * systemPrompt → a persona row (@deepseek-ai/dsh-persona, complete prompt).
 * tools → one @deepseek-ai/dsh-tool-<id> row each. model and permissionMode
 * have no stable agent-plane row in the shipped presets, so they are recorded
 * as comments, not rows (see README Known Limitations).
 * @param agent - the repository agent to render.
 * @returns the composition file contents.
 */
export function renderAgentCordisYaml(agent: RepositoryAgentConfiguration): string {
  const rows = [
    {
      id: 'persona',
      name: PERSONA_PLUGIN,
      config: {
        text: agent.systemPrompt,
        complete: true,
        includeRuntimeContext: false,
      },
    },
    ...agent.tools.map(tool => ({ id: `tool-${tool}`, name: TOOL_PLUGIN_PREFIX + tool })),
  ]
  const header = [
    `# Projected from repository agent "${agent.name}" by @rin/workspace/agents.`,
    '# Regenerate by re-projecting; hand edits here are overwritten.',
    ...(agent.model !== undefined ? [`# model: ${agent.model}`] : []),
    ...(agent.permissionMode !== undefined ? [`# permissionMode: ${agent.permissionMode}`] : []),
  ].join('\n')
  return `${header}\n${stringify(rows, { lineWidth: -1 })}`
}

/**
 * Project every repository agent into a preset root.
 *
 * Writes `<presetRoot>/<id>/agent.cordis.yml` for each agent. An existing file
 * with identical content is left alone (idempotent); one with different content
 * stops the projection with an error, leaving every other file as it was.
 * @param repositoryRoot - the repository whose agents are projected.
 * @param presetRoot - the user preset root receiving the directories.
 * @returns the preset ids materialised, in repository order.
 */
export async function projectRepositoryAgents(repositoryRoot: string, presetRoot: string): Promise<ProjectionResult> {
  const root = resolve(presetRoot)
  const ids: string[] = []
  for (const agent of await listRepositoryAgents(repositoryRoot)) {
    const id = assertValidPresetId(agent.name)
    const directory = join(root, id)
    const path = join(directory, COMPOSITION_FILE)
    const rendered = renderAgentCordisYaml(agent)
    const existing = await readFileIfExists(path)
    if (existing !== undefined && existing !== rendered) {
      throw new Error(
        `rin agents: preset "${id}" already exists with different content; delete it or reconcile the repository agent before re-projecting`,
      )
    }
    if (existing === undefined) {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, rendered, 'utf8')
    }
    ids.push(id)
  }
  return { ids }
}
