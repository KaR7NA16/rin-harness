import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { readAssetRepository } from '../src/reader.ts'

describe('readAssetRepository', () => {
  test('parses a minimal manifest with an environment profile and an agent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-repo-'))
    await writeFile(join(root, 'repository.yaml'), [
      'apiVersion: rin.dev/v1',
      'kind: AssetRepository',
      'metadata: { id: built-in, name: Built-in, version: 1.0.0 }',
      'spec:',
      '  mutable: true',
      '  roots:',
      '    environments: environments',
      '    agents: agents',
      '    skills: skills',
      '    workflows: workflows',
      '    tools: tools',
      '    knowledge: knowledge',
      '    policies: policies',
      '    outputs: outputs',
      '    bundles: bundles',
    ].join('\n'))

    const envDir = join(root, 'environments', 'packages')
    await mkdir(envDir, { recursive: true })
    await writeFile(join(envDir, 'python.yaml'), [
      'apiVersion: rin.dev/v1',
      'kind: EnvironmentPackageCatalog',
      'metadata: { id: python, name: Python, version: 1.0.0 }',
      'spec:',
      '  ecosystem: python',
      '  packages:',
      '    - { id: numpy, name: numpy, version: ">=2.0" }',
    ].join('\n'))

    const agentsDir = join(root, 'agents')
    await mkdir(agentsDir, { recursive: true })
    await writeFile(join(agentsDir, 'coder.agent.yaml'), [
      'version: 2',
      'kind: AgentConfiguration',
      'name: coder',
      'description: A coding agent',
      'systemPrompt: You are a coding agent.',
      'tools: [bash, fs]',
      'resources: { skillIds: [], workflowIds: [] }',
    ].join('\n'))

    const repo = await readAssetRepository(root)
    expect(repo.manifest.metadata.id).toBe('built-in')
    expect(repo.environmentPackages).toHaveLength(1)
    expect(repo.environmentPackages[0]?.id).toBe('numpy')
    expect(repo.environmentPackages[0]?.ecosystem).toBe('python')
    expect(repo.agents).toHaveLength(1)
    expect(repo.agents[0]?.name).toBe('coder')
  })

  test('throws on a non-AssetRepository manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rin-repo-'))
    await writeFile(join(root, 'repository.yaml'), 'kind: NotARepository\n')
    await expect(readAssetRepository(root)).rejects.toThrow(/expected kind AssetRepository/)
  })
})
