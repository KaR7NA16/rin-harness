import { describe, expect, test } from 'vitest'
import type { RepositoryAgentConfiguration } from '@rin/repository'
import { PRESET_ID, assertValidPresetId, renderAgentCordisYaml } from '../src/projection.ts'

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
