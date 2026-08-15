import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  createRuntimeAgent,
  deleteRuntimeAgent,
  getRuntimeAgent,
  listRuntimeAgents,
  resolveRuntimeAgentPath,
  updateRuntimeAgent,
} from '../src/runtime-agents.ts'

async function home() {
  return mkdtemp(join(tmpdir(), 'rin-rt-agents-'))
}

describe('resolveRuntimeAgentPath', () => {
  test('joins the home with <name>.agent.yaml', () => {
    expect(resolveRuntimeAgentPath('/home/agents', 'coder')).toBe(join('/home/agents', 'coder.agent.yaml'))
  })
})

describe('runtime agent CRUD', () => {
  test('creates, reads, updates, and deletes a definition', async () => {
    const root = await home()
    const created = await createRuntimeAgent(root, {
      name: 'reviewer',
      description: 'A code reviewer',
      systemPrompt: 'You review code.',
      tools: ['fs', 'fs', 'bash'],
      model: 'deepseek-chat',
      color: '#ff0000',
    })
    expect(created).toEqual({
      name: 'reviewer',
      description: 'A code reviewer',
      systemPrompt: 'You review code.',
      model: 'deepseek-chat',
      tools: ['fs', 'bash'],
      color: '#ff0000',
    })

    expect(await getRuntimeAgent(root, 'reviewer')).toEqual(created)
    expect(await listRuntimeAgents(root)).toEqual([created])

    const updated = await updateRuntimeAgent(root, 'reviewer', {
      description: 'A stricter reviewer',
      systemPrompt: 'You review strictly.',
      tools: [],
    })
    expect(updated.description).toBe('A stricter reviewer')
    expect(updated.tools).toEqual([])
    expect(updated.model).toBeUndefined()
    expect(updated.color).toBeUndefined()

    await deleteRuntimeAgent(root, 'reviewer')
    expect(await getRuntimeAgent(root, 'reviewer')).toBeUndefined()
    expect(await listRuntimeAgents(root)).toEqual([])
  })

  test('defaults tools to an empty list when omitted', async () => {
    const root = await home()
    const created = await createRuntimeAgent(root, {
      name: 'bare',
      description: 'Bare',
      systemPrompt: 'Prompt.',
    })
    expect(created.tools).toEqual([])
  })

  test('refuses to overwrite an existing definition', async () => {
    const root = await home()
    await createRuntimeAgent(root, { name: 'coder', description: 'D', systemPrompt: 'S' })
    await expect(
      createRuntimeAgent(root, { name: 'coder', description: 'D2', systemPrompt: 'S2' }),
    ).rejects.toThrow(/already exists/)
  })

  test('update and delete of a missing definition throw', async () => {
    const root = await home()
    await expect(updateRuntimeAgent(root, 'ghost', { description: 'D', systemPrompt: 'S' })).rejects.toThrow(/not found/)
    await expect(deleteRuntimeAgent(root, 'ghost')).rejects.toThrow(/not found/)
  })

  test('rejects an invalid definition name', async () => {
    const root = await home()
    await expect(createRuntimeAgent(root, { name: 'bad name', description: 'D', systemPrompt: 'S' })).rejects.toThrow(/invalid agent name/)
  })
})

describe('listing and markdown frontmatter', () => {
  test('lists definitions ordered by name', async () => {
    const root = await home()
    await createRuntimeAgent(root, { name: 'beta', description: 'B', systemPrompt: 'B.' })
    await createRuntimeAgent(root, { name: 'alpha', description: 'A', systemPrompt: 'A.' })
    const listed = await listRuntimeAgents(root)
    expect(listed.map(item => item.name)).toEqual(['alpha', 'beta'])
  })

  test('reads a markdown definition through its YAML frontmatter', async () => {
    const root = await home()
    await writeFile(join(root, 'notes.md'), [
      '---',
      'name: md-agent',
      'description: From markdown',
      'systemPrompt: You are md.',
      'tools: [fs]',
      '---',
      '# Body',
    ].join('\n'))
    const listed = await listRuntimeAgents(root)
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ name: 'md-agent', description: 'From markdown', tools: ['fs'] })
    // getRuntimeAgent only resolves .agent.yaml files, not .md files.
    expect(await getRuntimeAgent(root, 'md-agent')).toBeUndefined()
  })

  test('ignores non-definition files and directories', async () => {
    const root = await home()
    await writeFile(join(root, 'readme.txt'), 'nothing here')
    await mkdir(join(root, 'subdir'))
    expect(await listRuntimeAgents(root)).toEqual([])
  })
})
