import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import type { RepositoryAgentConfiguration } from '@rin/repository'
import { COMPOSITION_FILE, PRESET_ID, assertValidPresetId, projectRepositoryAgents, renderAgentCordisYaml } from '../src/projection.ts'
import { createRepositoryAgent } from '../src/repository-agents.ts'

const agent: RepositoryAgentConfiguration = {
  version: 2,
  kind: 'AgentConfiguration',
  name: 'coder',
  description: 'A coding agent',
  systemPrompt: 'You are a coding agent.\nBe concise.',
  model: 'deepseek-chat',
  permissionMode: 'plan',
  tools: ['bash', 'fs'],
  resources: { skillIds: [], workflowIds: [] },
}

describe('preset id validation', () => {
  test('accepts lowercase-hyphen ids', () => {
    expect(assertValidPresetId('coder')).toBe('coder')
    expect(assertValidPresetId('my-agent-2')).toBe('my-agent-2')
  })

  test('rejects uppercase, underscore, leading hyphen, and spaces', () => {
    expect(() => assertValidPresetId('My_Agent')).toThrow(/cannot be projected/)
    expect(() => assertValidPresetId('-bad')).toThrow()
    expect(() => assertValidPresetId('has space')).toThrow()
  })

  test('PRESET_ID mirrors the dsh agent-presets pattern', () => {
    expect(PRESET_ID.source).toBe('^[a-z0-9][a-z0-9-]*$')
  })
})

describe('renderAgentCordisYaml', () => {
  test('maps systemPrompt to a persona row and tools to tool rows', () => {
    const rendered = renderAgentCordisYaml(agent)
    expect(rendered).toContain('id: persona')
    expect(rendered).toContain('dsh-persona')
    expect(rendered).toContain('complete: true')
    expect(rendered).toContain('id: tool-bash')
    expect(rendered).toContain('dsh-tool-bash')
    expect(rendered).toContain('id: tool-fs')
    expect(rendered).toContain('You are a coding agent.')
  })

  test('records model and permissionMode as comments, not rows', () => {
    const rendered = renderAgentCordisYaml(agent)
    expect(rendered).toContain('# model: deepseek-chat')
    expect(rendered).toContain('# permissionMode: plan')
  })
})

describe('projectRepositoryAgents', () => {
  test('materialises each agent as a preset directory and is idempotent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-proj-'))
    const repo = join(root, 'repo')
    const preset = join(root, 'presets')
    await mkdir(repo, { recursive: true })
    await writeFile(join(repo, 'repository.yaml'), "apiVersion: rin.dev/v1\nkind: AssetRepository\nmetadata: { id: \"t\", name: \"T\", version: \"1.0.0\" }\nspec:\n  mutable: true\n  roots:\n    agents: agents")
    await createRepositoryAgent(repo, { name: 'coder', description: 'A coding agent', systemPrompt: 'You are a coding agent.', tools: ['bash'] })

    const result = await projectRepositoryAgents(repo, preset)
    expect(result.ids).toEqual(['coder'])

    const file = await readFile(join(preset, 'coder', COMPOSITION_FILE), 'utf8')
    expect(file).toContain('id: persona')
    expect(file).toContain('id: tool-bash')
    expect(file).toContain('You are a coding agent.')

    // Re-projecting with unchanged content leaves the file untouched.
    const again = await projectRepositoryAgents(repo, preset)
    expect(again.ids).toEqual(['coder'])
  })

  test('fails loud when an existing preset differs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-proj-'))
    const repo = join(root, 'repo')
    const preset = join(root, 'presets')
    await mkdir(repo, { recursive: true })
    await writeFile(join(repo, 'repository.yaml'), "apiVersion: rin.dev/v1\nkind: AssetRepository\nmetadata: { id: \"t\", name: \"T\", version: \"1.0.0\" }\nspec:\n  mutable: true\n  roots:\n    agents: agents")
    await createRepositoryAgent(repo, { name: 'coder', description: 'A', systemPrompt: 'You code.' })
    await projectRepositoryAgents(repo, preset)

    await writeFile(join(preset, 'coder', COMPOSITION_FILE), '# hand-edited')
    await expect(projectRepositoryAgents(repo, preset)).rejects.toThrow(/already exists with different content/)
  })
})
