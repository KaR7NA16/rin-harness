import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  createRepositoryAgent,
  deleteRepositoryAgent,
  getRepositoryAgent,
  listRepositoryAgents,
  updateRepositoryAgent,
} from '../src/repository-agents.ts'

const manifest = [
  'apiVersion: rin.dev/v1',
  'kind: AssetRepository',
  'metadata: { id: "t", name: "T", version: "1.0.0" }',
  'spec:',
  '  mutable: true',
  '  roots:',
  '    agents: agents',
].join('\n')

describe('repository agents', () => {
  test('creates, reads, updates, and deletes a record with a revision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-agents-'))
    await writeFile(join(root, 'repository.yaml'), manifest)

    const created = await createRepositoryAgent(root, {
      name: 'coder',
      description: 'A coding agent',
      systemPrompt: 'You are a coding agent.',
      tools: ['bash', 'bash', 'fs'],
    })
    expect(created.name).toBe('coder')
    expect(created.tools).toEqual(['bash', 'fs'])
    expect(created.revision).toMatch(/^[0-9a-f]{12}$/)

    expect(await getRepositoryAgent(root, 'coder')).toEqual(created)
    expect(await listRepositoryAgents(root)).toHaveLength(1)

    const updated = await updateRepositoryAgent(root, 'coder', {
      description: 'Updated',
      systemPrompt: 'Updated prompt.',
      tools: [],
    })
    expect(updated.revision).not.toBe(created.revision)

    await deleteRepositoryAgent(root, 'coder')
    expect(await getRepositoryAgent(root, 'coder')).toBeUndefined()
  })

  test('refuses to overwrite an existing record', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-agents-'))
    await writeFile(join(root, 'repository.yaml'), manifest)
    await createRepositoryAgent(root, { name: 'coder', description: 'D', systemPrompt: 'S' })
    await expect(
      createRepositoryAgent(root, { name: 'coder', description: 'D2', systemPrompt: 'S2' }),
    ).rejects.toThrow(/already exists/)
  })

  test('update and delete of a missing record throw', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-agents-'))
    await writeFile(join(root, 'repository.yaml'), manifest)
    await expect(
      updateRepositoryAgent(root, 'ghost', { description: 'D', systemPrompt: 'S' }),
    ).rejects.toThrow(/not found/)
    await expect(deleteRepositoryAgent(root, 'ghost')).rejects.toThrow(/not found/)
  })
})
