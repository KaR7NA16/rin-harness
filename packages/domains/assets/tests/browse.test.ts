import { describe, expect, test } from 'vitest'
import type { AssetRepository, EnvironmentProfile, RepositoryAgentConfiguration } from '../src/types.ts'
import {
  clampSearchLimit,
  listRepositoryAssets,
  readRepositoryAsset,
  READ_MAX_CHARS,
  SEARCH_LIMIT_DEFAULT,
  SEARCH_LIMIT_MAX,
  searchRepository,
} from '../src/browse.ts'

function profile(id: string, name = 'Profile Name', packages: string[] = ['pkg-a', 'pkg-b']): EnvironmentProfile {
  return {
    apiVersion: 'rin.dev/v1',
    kind: 'EnvironmentProfile',
    metadata: { id, name, version: '1.0.0', source: `environments/profiles/${id}.environment.yaml` },
    spec: { packages },
  }
}

function agent(name: string, description = 'An agent', systemPrompt = 'You are an agent.'): RepositoryAgentConfiguration {
  return {
    version: 2,
    kind: 'AgentConfiguration',
    name,
    description,
    systemPrompt,
    model: 'deepseek-chat',
    permissionMode: 'default',
    source: `agents/${name}.agent.yaml`,
    tools: ['bash', 'fs'],
    resources: { environmentProfileId: 'scientific-base', skillIds: [], workflowIds: [] },
  }
}

function repo(profiles: EnvironmentProfile[], agents: RepositoryAgentConfiguration[]): AssetRepository {
  return {
    rootPath: '/repo',
    manifestPath: '/repo/repository.yaml',
    manifest: {
      apiVersion: 'rin.dev/v1',
      kind: 'AssetRepository',
      metadata: { id: 'built-in', name: 'Built-in', version: '1.0.0' },
      spec: { mutable: true, roots: { environments: 'environments', agents: 'agents' } },
    },
    environmentCatalogs: [],
    environmentPackages: [],
    environmentProfiles: profiles,
    agents,
  }
}

describe('clampSearchLimit', () => {
  test('defaults to SEARCH_LIMIT_DEFAULT for undefined and non-finite values', () => {
    expect(clampSearchLimit(undefined)).toBe(SEARCH_LIMIT_DEFAULT)
    expect(clampSearchLimit(Number.NaN)).toBe(SEARCH_LIMIT_DEFAULT)
    expect(clampSearchLimit(Number.POSITIVE_INFINITY)).toBe(SEARCH_LIMIT_DEFAULT)
    expect(clampSearchLimit(Number.NEGATIVE_INFINITY)).toBe(SEARCH_LIMIT_DEFAULT)
  })

  test('floors and clamps to [1, SEARCH_LIMIT_MAX]', () => {
    expect(clampSearchLimit(0)).toBe(1)
    expect(clampSearchLimit(-5)).toBe(1)
    expect(clampSearchLimit(2.7)).toBe(2)
    expect(clampSearchLimit(50)).toBe(50)
    expect(clampSearchLimit(SEARCH_LIMIT_MAX)).toBe(SEARCH_LIMIT_MAX)
    expect(clampSearchLimit(9999)).toBe(SEARCH_LIMIT_MAX)
  })
})

describe('listRepositoryAssets', () => {
  test('returns an empty list for an empty repository', () => {
    expect(listRepositoryAssets(repo([], []))).toEqual([])
  })

  test('lists environment profiles before agents in deterministic order', () => {
    const hits = listRepositoryAssets(repo([profile('sci'), profile('bio')], [agent('coder'), agent('reviewer')]))
    expect(hits.map(hit => hit.category)).toEqual(['environments', 'environments', 'agents', 'agents'])
    expect(hits.map(hit => hit.name)).toEqual(['sci', 'bio', 'coder', 'reviewer'])
  })

  test('shapes a profile hit with title, path, and package-count description', () => {
    const [hit] = listRepositoryAssets(repo([profile('sci', 'Scientific', ['a', 'b', 'c'])], []))
    expect(hit).toEqual({
      category: 'environments',
      name: 'sci',
      title: 'Scientific',
      path: 'environments/profiles/sci.environment.yaml',
      description: 'Environment profile with 3 package(s).',
    })
  })

  test('shapes an agent hit with its description and default path when source is absent', () => {
    const agentWithoutSource = { ...agent('coder', 'Codes'), source: undefined }
    const [hit] = listRepositoryAssets(repo([], [agentWithoutSource]))
    expect(hit).toEqual({
      category: 'agents',
      name: 'coder',
      title: 'coder',
      path: 'agents/coder.agent.yaml',
      description: 'Codes',
    })
  })

  test('falls back to the conventional profile path when source is absent', () => {
    const profileWithoutSource = { ...profile('sci'), metadata: { ...profile('sci').metadata, source: undefined } }
    const [hit] = listRepositoryAssets(repo([profileWithoutSource], []))
    expect(hit.path).toBe('environments/profiles/sci.environment.yaml')
  })
})

describe('searchRepository', () => {
  const profiles = [profile('scientific-base', 'Scientific Base'), profile('bioinformatics-base', 'Bioinformatics Base')]
  const agents = [agent('rin-base', 'Base agent'), agent('coder', 'A coding agent', 'You write code.')]
  const repository = repo(profiles, agents)

  test('returns every asset when no filter is supplied', () => {
    const result = searchRepository(repository, {})
    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.total).toBe(4)
    expect(result.results).toHaveLength(4)
  })

  test('filters by category', () => {
    const result = searchRepository(repository, { category: 'agents' })
    if ('error' in result) throw new Error('unexpected error')
    expect(result.results.map(hit => hit.category)).toEqual(['agents', 'agents'])
    expect(result.total).toBe(2)
  })

  test('rejects an unknown category with an explicit error', () => {
    const result = searchRepository(repository, { category: 'bogus' })
    expect(result).toEqual({ error: expect.stringContaining('unknown category "bogus"') })
  })

  test('treats a blank category as no category filter', () => {
    const result = searchRepository(repository, { category: '   ' })
    if ('error' in result) throw new Error('unexpected error')
    expect(result.total).toBe(4)
  })

  test('matches the query case-insensitively against name, title, and description', () => {
    const byName = searchRepository(repository, { query: 'RIN-BASE' })
    if ('error' in byName) throw new Error('unexpected error')
    expect(byName.results.map(hit => hit.name)).toEqual(['rin-base'])

    const byTitle = searchRepository(repository, { query: 'BIOINFORMATICS' })
    if ('error' in byTitle) throw new Error('unexpected error')
    expect(byTitle.results.map(hit => hit.name)).toEqual(['bioinformatics-base'])

    const byDescription = searchRepository(repository, { query: 'coding agent' })
    if ('error' in byDescription) throw new Error('unexpected error')
    expect(byDescription.results.map(hit => hit.name)).toEqual(['coder'])
  })

  test('returns no results and a zero total when nothing matches', () => {
    const result = searchRepository(repository, { query: 'does-not-exist' })
    if ('error' in result) throw new Error('unexpected error')
    expect(result.results).toEqual([])
    expect(result.total).toBe(0)
  })

  test('bounds results by limit while the total reflects all matches', () => {
    const many = repo([], [agent('a1'), agent('a2'), agent('a3')])
    const result = searchRepository(many, { category: 'agents', limit: 2 })
    if ('error' in result) throw new Error('unexpected error')
    expect(result.results).toHaveLength(2)
    expect(result.total).toBe(3)
  })
})

describe('readRepositoryAsset', () => {
  const repository = repo([profile('scientific-base', 'Scientific Base', ['python-numpy'])], [agent('rin-base', 'Base agent', 'You are base.')])

  test('rejects an unknown category', () => {
    expect(readRepositoryAsset(repository, 'bogus', 'x')).toEqual({
      error: expect.stringContaining('unknown category "bogus"'),
    })
  })

  test('rejects a valid but unreadable category', () => {
    expect(readRepositoryAsset(repository, 'skills', 'x')).toEqual({
      error: expect.stringContaining('category "skills" has no readable assets'),
    })
  })

  test('rejects a blank name', () => {
    expect(readRepositoryAsset(repository, 'agents', '   ')).toEqual({ error: 'name is required and must not be blank' })
  })

  test('rejects a missing agent', () => {
    expect(readRepositoryAsset(repository, 'agents', 'ghost')).toEqual({ error: 'no agent named "ghost"' })
  })

  test('rejects a missing environment profile', () => {
    expect(readRepositoryAsset(repository, 'environments', 'ghost')).toEqual({
      error: 'no environment profile named "ghost"',
    })
  })

  test('reads an agent with its frontmatter and serialized body', () => {
    const result = readRepositoryAsset(repository, 'agents', 'rin-base')
    if ('error' in result) throw new Error('unexpected error')
    expect(result.category).toBe('agents')
    expect(result.path).toBe('agents/rin-base.agent.yaml')
    expect(result.truncated).toBe(false)
    expect(result.frontmatter).toEqual({
      kind: 'AgentConfiguration',
      id: 'rin-base',
      name: 'rin-base',
      version: '2',
      description: 'Base agent',
    })
    expect(result.body).toContain('You are base.')
    expect(result.body).toContain('deepseek-chat')
  })

  test('omits optional model and permissionMode from the agent body', () => {
    const bare = agent('bare', 'Bare', 'Prompt')
    delete (bare as { model?: string }).model
    delete (bare as { permissionMode?: string }).permissionMode
    const result = readRepositoryAsset(repo([], [bare]), 'agents', 'bare')
    if ('error' in result) throw new Error('unexpected error')
    expect(result.body).not.toContain('model')
    expect(result.body).not.toContain('permissionMode')
  })

  test('reads an environment profile body as JSON with its frontmatter', () => {
    const result = readRepositoryAsset(repository, 'environments', 'scientific-base')
    if ('error' in result) throw new Error('unexpected error')
    expect(result.category).toBe('environments')
    expect(result.frontmatter).toEqual({
      kind: 'EnvironmentProfile',
      id: 'scientific-base',
      name: 'Scientific Base',
      version: '1.0.0',
    })
    expect(result.body).toContain('"packages"')
    expect(result.body).toContain('python-numpy')
    expect(result.truncated).toBe(false)
  })

  test('truncates an oversized body to READ_MAX_CHARS', () => {
    const big = agent('big', 'Big', 'x'.repeat(READ_MAX_CHARS + 100))
    const result = readRepositoryAsset(repo([], [big]), 'agents', 'big')
    if ('error' in result) throw new Error('unexpected error')
    expect(result.truncated).toBe(true)
    expect(result.body).toHaveLength(READ_MAX_CHARS)
  })
})
