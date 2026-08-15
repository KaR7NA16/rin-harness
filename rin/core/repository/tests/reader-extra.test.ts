import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { readAssetRepository, readAssetRepositoryManifest } from '../src/reader.ts'

async function tempRepo() {
  return mkdtemp(join(tmpdir(), 'rin-reader-'))
}

const manifest = (roots: Record<string, string> = { environments: 'environments', agents: 'agents' }) => [
  'apiVersion: rin.dev/v1',
  'kind: AssetRepository',
  'metadata: { id: built-in, name: Built-in, version: 1.0.0 }',
  'spec:',
  '  mutable: true',
  '  roots:',
  ...Object.entries(roots).map(([key, value]) => '    ' + key + ': ' + value),
].join('\n')

describe('readAssetRepositoryManifest', () => {
  test('parses a valid manifest', async () => {
    const root = await tempRepo()
    await writeFile(join(root, 'repository.yaml'), manifest())
    const parsed = await readAssetRepositoryManifest(root)
    expect(parsed.apiVersion).toBe('rin.dev/v1')
    expect(parsed.kind).toBe('AssetRepository')
    expect(parsed.metadata.id).toBe('built-in')
    expect(parsed.spec.mutable).toBe(true)
    expect(parsed.spec.roots.environments).toBe('environments')
  })

  test('rejects a missing manifest file', async () => {
    const root = await tempRepo()
    await expect(readAssetRepositoryManifest(root)).rejects.toThrow()
  })

  test('rejects an unsupported apiVersion and a wrong kind', async () => {
    const wrongVersion = await tempRepo()
    await writeFile(join(wrongVersion, 'repository.yaml'), manifest().replace('rin.dev/v1', 'other/v1'))
    await expect(readAssetRepositoryManifest(wrongVersion)).rejects.toThrow(/unsupported apiVersion/)

    const wrongKind = await tempRepo()
    await writeFile(join(wrongKind, 'repository.yaml'), manifest().replace('kind: AssetRepository', 'kind: NotARepo'))
    await expect(readAssetRepositoryManifest(wrongKind)).rejects.toThrow(/expected AssetRepository/)
  })

  test('rejects unknown, blank, and missing root entries', async () => {
    const unknown = await tempRepo()
    await writeFile(join(unknown, 'repository.yaml'), manifest({ environments: 'environments', bogus: 'x' }))
    await expect(readAssetRepositoryManifest(unknown)).rejects.toThrow(/unknown root "bogus"/)

    const blank = await tempRepo()
    await writeFile(join(blank, 'repository.yaml'), manifest({ environments: ' ' }))
    await expect(readAssetRepositoryManifest(blank)).rejects.toThrow(/invalid root "environments"/)

    const missing = await tempRepo()
    await writeFile(join(missing, 'repository.yaml'), manifest({ agents: 'agents' }))
    await expect(readAssetRepositoryManifest(missing)).rejects.toThrow(/missing environments root/)
  })
})

describe('readAssetRepository partitions', () => {
  test('parses profile verify blocks and agent resource references', async () => {
    const root = await tempRepo()
    await writeFile(join(root, 'repository.yaml'), manifest())
    const envDir = join(root, 'environments', 'packages')
    await mkdir(envDir, { recursive: true })
    await writeFile(join(envDir, 'python.yaml'), [
      'apiVersion: rin.dev/v1',
      'kind: EnvironmentPackageCatalog',
      'metadata: { id: python, name: Python, version: 1.0.0 }',
      'spec:',
      '  ecosystem: python',
      '  packages:',
      '    - { id: numpy, name: numpy, version: ">=2.0", description: Numeric }',
    ].join('\n'))
    const profilesDir = join(root, 'environments', 'profiles')
    await mkdir(profilesDir, { recursive: true })
    await writeFile(join(profilesDir, 'sci.environment.yaml'), [
      'apiVersion: rin.dev/v1',
      'kind: EnvironmentProfile',
      'metadata: { id: sci, name: Scientific, version: 1.0.0 }',
      'spec:',
      '  packages: [numpy]',
      '  verify:',
      '    pythonImports: [numpy]',
      '    rPackages: [ggplot2]',
      '    commands: ["python -c \'import numpy\'"]',
    ].join('\n'))
    const agentsDir = join(root, 'agents')
    await mkdir(agentsDir, { recursive: true })
    await writeFile(join(agentsDir, 'coder.agent.yaml'), [
      'version: 2',
      'kind: AgentConfiguration',
      'name: coder',
      'description: A coding agent',
      'systemPrompt: You code.',
      'model: deepseek-chat',
      'permissionMode: plan',
      'tools: [bash, bash, fs]',
      'resources:',
      '  environmentProfileId: sci',
      '  skillIds: [a, a, b]',
      '  workflowIds: [w]',
    ].join('\n'))

    const repo = await readAssetRepository(root)
    expect(repo.environmentPackages[0]).toMatchObject({ id: 'numpy', version: '>=2.0', description: 'Numeric', ecosystem: 'python' })
    expect(repo.environmentProfiles[0]?.spec.verify).toEqual({
      pythonImports: ['numpy'],
      rPackages: ['ggplot2'],
      commands: ["python -c 'import numpy'"],
    })
    expect(repo.agents[0]).toMatchObject({
      name: 'coder',
      model: 'deepseek-chat',
      permissionMode: 'plan',
      tools: ['bash', 'fs'],
      resources: { environmentProfileId: 'sci', skillIds: ['a', 'b'], workflowIds: ['w'] },
    })
    expect(repo.agents[0]?.source).toBe('agents/coder.agent.yaml')
  })

  test('rejects a duplicate package id', async () => {
    const root = await tempRepo()
    await writeFile(join(root, 'repository.yaml'), manifest())
    const envDir = join(root, 'environments', 'packages')
    await mkdir(envDir, { recursive: true })
    await writeFile(join(envDir, 'a.yaml'), [
      'apiVersion: rin.dev/v1',
      'kind: EnvironmentPackageCatalog',
      'metadata: { id: a, name: A, version: 1.0.0 }',
      'spec:',
      '  ecosystem: python',
      '  packages:',
      '    - { id: numpy, name: numpy }',
    ].join('\n'))
    await writeFile(join(envDir, 'b.yaml'), [
      'apiVersion: rin.dev/v1',
      'kind: EnvironmentPackageCatalog',
      'metadata: { id: b, name: B, version: 1.0.0 }',
      'spec:',
      '  ecosystem: python',
      '  packages:',
      '    - { id: numpy, name: other }',
    ].join('\n'))
    await expect(readAssetRepository(root)).rejects.toThrow(/duplicate asset id/)
  })

  test('rejects unsafe package names and invalid ecosystems', async () => {
    const badName = await tempRepo()
    await writeFile(join(badName, 'repository.yaml'), manifest())
    const badNameDir = join(badName, 'environments', 'packages')
    await mkdir(badNameDir, { recursive: true })
    await writeFile(join(badNameDir, 'python.yaml'), [
      'apiVersion: rin.dev/v1',
      'kind: EnvironmentPackageCatalog',
      'metadata: { id: python, name: Python, version: 1.0.0 }',
      'spec:',
      '  ecosystem: python',
      '  packages:',
      '    - { id: bad, name: "bad;name" }',
    ].join('\n'))
    await expect(readAssetRepository(badName)).rejects.toThrow(/unsafe python package name/)

    const badEcosystem = await tempRepo()
    await writeFile(join(badEcosystem, 'repository.yaml'), manifest())
    const ecoDir = join(badEcosystem, 'environments', 'packages')
    await mkdir(ecoDir, { recursive: true })
    await writeFile(join(ecoDir, 'x.yaml'), [
      'apiVersion: rin.dev/v1',
      'kind: EnvironmentPackageCatalog',
      'metadata: { id: x, name: X, version: 1.0.0 }',
      'spec:',
      '  ecosystem: bogus',
      '  packages: []',
    ].join('\n'))
    await expect(readAssetRepository(badEcosystem)).rejects.toThrow(/invalid ecosystem/)
  })

  test('rejects an invalid agent name and a missing system prompt', async () => {
    const badName = await tempRepo()
    await writeFile(join(badName, 'repository.yaml'), manifest())
    const agentsDir = join(badName, 'agents')
    await mkdir(agentsDir, { recursive: true })
    await writeFile(join(agentsDir, 'bad.agent.yaml'), [
      'version: 2',
      'kind: AgentConfiguration',
      'name: "bad name"',
      'description: D',
      'systemPrompt: S',
    ].join('\n'))
    await expect(readAssetRepository(badName)).rejects.toThrow(/invalid Agent name/)

    const noPrompt = await tempRepo()
    await writeFile(join(noPrompt, 'repository.yaml'), manifest())
    const noPromptDir = join(noPrompt, 'agents')
    await mkdir(noPromptDir, { recursive: true })
    await writeFile(join(noPromptDir, 'coder.agent.yaml'), [
      'version: 2',
      'kind: AgentConfiguration',
      'name: coder',
      'description: D',
      'systemPrompt: "   "',
    ].join('\n'))
    await expect(readAssetRepository(noPrompt)).rejects.toThrow(/instructions are required/)
  })

  test('rejects an invalid agent permission mode', async () => {
    const root = await tempRepo()
    await writeFile(join(root, 'repository.yaml'), manifest())
    const agentsDir = join(root, 'agents')
    await mkdir(agentsDir, { recursive: true })
    await writeFile(join(agentsDir, 'coder.agent.yaml'), [
      'version: 2',
      'kind: AgentConfiguration',
      'name: coder',
      'description: D',
      'systemPrompt: S',
      'permissionMode: bogus',
    ].join('\n'))
    await expect(readAssetRepository(root)).rejects.toThrow(/invalid Agent permission mode/)
  })
})

describe('readAssetRepository malformed documents', () => {
  const manifestLocal = (roots: Record<string, string> = { environments: 'environments', agents: 'agents' }) => [
    'apiVersion: rin.dev/v1',
    'kind: AssetRepository',
    'metadata: { id: built-in, name: Built-in, version: 1.0.0 }',
    'spec:',
    '  mutable: true',
    '  roots:',
    ...Object.entries(roots).map(([key, value]) => '    ' + key + ': ' + value),
  ].join('\n')

  test('rejects a catalog document that is not an object', async () => {
    const root = await tempRepo()
    await writeFile(join(root, 'repository.yaml'), manifestLocal())
    const envDir = join(root, 'environments', 'packages')
    await mkdir(envDir, { recursive: true })
    await writeFile(join(envDir, 'list.yaml'), '- just\n- a list\n')
    await expect(readAssetRepository(root)).rejects.toThrow(/expected object for/)
  })

  test('rejects a catalog package with a non-string id', async () => {
    const root = await tempRepo()
    await writeFile(join(root, 'repository.yaml'), manifestLocal())
    const envDir = join(root, 'environments', 'packages')
    await mkdir(envDir, { recursive: true })
    await writeFile(join(envDir, 'python.yaml'), [
      'apiVersion: rin.dev/v1',
      'kind: EnvironmentPackageCatalog',
      'metadata: { id: python, name: Python, version: 1.0.0 }',
      'spec:',
      '  ecosystem: python',
      '  packages:',
      '    - { id: 123, name: numpy }',
    ].join('\n'))
    await expect(readAssetRepository(root)).rejects.toThrow(/expected non-empty string for/)
  })
})
