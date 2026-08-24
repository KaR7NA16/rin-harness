import { describe, expect, test } from 'vitest'
import type { AssetRepository, EnvironmentProfile, RepositoryAgentConfiguration } from '../src/types.ts'
import {
  READ_MAX_CHARS,
  READABLE_CATEGORIES,
  readRepositoryAsset,
  REPOSITORY_CATEGORIES,
  searchRepository,
  type RepositoryReadValue,
  type RepositorySearchValue,
} from '../src/browse.ts'
import {
  buildRepositoryTools,
  renderRepositoryRead,
  renderRepositorySearch,
  REPOSITORY_READ_DESCRIPTION,
  REPOSITORY_READ_TOOL_NAME,
  REPOSITORY_SEARCH_DESCRIPTION,
  REPOSITORY_SEARCH_TOOL_NAME,
  repositoryReadOutputSchema,
  repositoryReadParameters,
  repositorySearchOutputSchema,
  repositorySearchParameters,
} from '../src/tools.ts'

function profile(): EnvironmentProfile {
  return {
    apiVersion: 'rin.dev/v1',
    kind: 'EnvironmentProfile',
    metadata: { id: 'scientific-base', name: 'Scientific Base', version: '1.0.0', source: 'environments/profiles/scientific-base.environment.yaml' },
    spec: { packages: ['python-numpy'] },
  }
}

function agent(): RepositoryAgentConfiguration {
  return {
    version: 2,
    kind: 'AgentConfiguration',
    name: 'rin-base',
    description: 'Base agent',
    systemPrompt: 'You are base.',
    source: 'agents/rin-base.agent.yaml',
    tools: ['bash', 'fs'],
    resources: { environmentProfileId: 'scientific-base', skillIds: [], workflowIds: [] },
  }
}

function fixture(): AssetRepository {
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
    environmentProfiles: [profile()],
    agents: [agent()],
  }
}

interface TextBlock { type: string; text: string }

interface SearchToolLike {
  name: string
  description: string
  parameters: typeof repositorySearchParameters
  output: { schema: typeof repositorySearchOutputSchema; render: (args: object, value: RepositorySearchValue) => TextBlock[] }
  isConcurrencySafe: () => boolean
  execute: (args: { category?: string; query?: string; limit?: number }) => Promise<RepositorySearchValue>
  presentCall: (args: { category?: string; query?: string; limit?: number }) => { card: string; title: string; kind: string; rawInput: string } | undefined
}

interface ReadToolLike {
  name: string
  description: string
  parameters: typeof repositoryReadParameters
  output: { schema: typeof repositoryReadOutputSchema; render: (args: object, value: RepositoryReadValue) => TextBlock[] }
  isConcurrencySafe: () => boolean
  execute: (args: { category: string; name: string }) => Promise<RepositoryReadValue>
  presentCall: (args: { category: string; name: string }) => { card: string; title: string; kind: string; rawInput: string } | undefined
}

function build() {
  return buildRepositoryTools(async () => fixture()) as unknown as [SearchToolLike, ReadToolLike]
}

describe('renderRepositorySearch', () => {
  test('returns the error message verbatim', () => {
    expect(renderRepositorySearch({ error: 'boom' })).toBe('boom')
  })

  test('reports an empty result set', () => {
    expect(renderRepositorySearch({ results: [], total: 0 })).toBe('No repository assets matched.')
  })

  test('lists hits with a total', () => {
    const text = renderRepositorySearch({
      results: [{ category: 'agents', name: 'coder', title: 'coder', path: 'agents/coder.agent.yaml', description: 'Codes' }],
      total: 1,
    })
    expect(text).toBe(
      'Found 1 asset(s), showing 1:\n- [agents] coder (agents/coder.agent.yaml)\n  Codes',
    )
  })
})

describe('renderRepositoryRead', () => {
  test('returns the error message verbatim', () => {
    expect(renderRepositoryRead({ error: 'boom' })).toBe('boom')
  })

  test('renders a full asset header and body', () => {
    const value = readRepositoryAsset(fixture(), 'agents', 'rin-base')
    if ('error' in value) throw new Error('unexpected error')
    const text = renderRepositoryRead(value)
    expect(text).toContain('AgentConfiguration "rin-base" (agents/rin-base.agent.yaml)')
    expect(text).toContain('You are base.')
    expect(text).not.toContain('content truncated')
  })

  test('appends a truncation note when the body was truncated', () => {
    const value: RepositoryReadValue = {
      category: 'environments',
      name: 'x',
      path: 'environments/profiles/x.environment.yaml',
      frontmatter: { kind: 'EnvironmentProfile', id: 'x', name: 'X', version: '1.0.0' },
      body: 'short',
      truncated: true,
    }
    expect(renderRepositoryRead(value)).toContain(`content truncated to ${READ_MAX_CHARS} chars`)
  })
})

describe('buildRepositoryTools', () => {
  test('names and describes both tools', () => {
    const [search, read] = build()
    expect(search.name).toBe(REPOSITORY_SEARCH_TOOL_NAME)
    expect(read.name).toBe(REPOSITORY_READ_TOOL_NAME)
    expect(search.description).toBe(REPOSITORY_SEARCH_DESCRIPTION)
    expect(read.description).toBe(REPOSITORY_READ_DESCRIPTION)
  })

  test('exposes the declared parameter and output schemas', () => {
    const [search, read] = build()
    expect(search.parameters).toBe(repositorySearchParameters)
    expect(read.parameters).toBe(repositoryReadParameters)
    expect(search.output.schema).toBe(repositorySearchOutputSchema)
    expect(read.output.schema).toBe(repositoryReadOutputSchema)
  })

  test('search parameters enumerate every category and read parameters enumerate readable ones', () => {
    expect(repositorySearchParameters.category.enum).toEqual([...REPOSITORY_CATEGORIES])
    expect(repositoryReadParameters.category.enum).toEqual([...READABLE_CATEGORIES])
    expect(repositoryReadParameters.category.required).toBe(true)
    expect(repositoryReadParameters.name.required).toBe(true)
  })

  test('output schemas describe both the value and error alternatives', () => {
    expect(repositorySearchOutputSchema.oneOf).toHaveLength(2)
    expect(repositoryReadOutputSchema.oneOf).toHaveLength(2)
  })

  test('both tools are concurrency-safe', () => {
    const [search, read] = build()
    expect(search.isConcurrencySafe()).toBe(true)
    expect(read.isConcurrencySafe()).toBe(true)
  })

  test('search.execute runs searchRepository against the read repository', async () => {
    const [search] = build()
    const result = await search.execute({ query: 'rin-base' })
    if ('error' in result) throw new Error('unexpected error')
    expect(result.total).toBe(1)
    expect(result.results[0]?.name).toBe('rin-base')
  })

  test('read.execute runs readRepositoryAsset against the read repository', async () => {
    const [, read] = build()
    const result = await read.execute({ category: 'agents', name: 'rin-base' })
    if ('error' in result) throw new Error('unexpected error')
    expect(result.frontmatter.kind).toBe('AgentConfiguration')
  })

  test('search render wraps renderRepositorySearch in a text block', () => {
    const [search] = build()
    const value = searchRepository(fixture(), { category: 'agents' })
    const blocks = search.output.render({}, value)
    expect(blocks).toEqual([{ type: 'text', text: renderRepositorySearch(value) }])
  })

  test('read render wraps renderRepositoryRead in a text block', () => {
    const [, read] = build()
    const value = readRepositoryAsset(fixture(), 'environments', 'scientific-base')
    const blocks = read.output.render({}, value)
    expect(blocks).toEqual([{ type: 'text', text: renderRepositoryRead(value) }])
  })

  test('search presentCall reports the query or category as raw input', () => {
    const [search] = build()
    expect(search.presentCall({ query: 'x' })).toEqual({
      card: 'generic',
      title: 'Search asset repository',
      kind: 'search',
      rawInput: 'x',
    })
    expect(search.presentCall({ category: 'agents' })).toMatchObject({ rawInput: 'agents' })
    expect(search.presentCall({})).toMatchObject({ rawInput: '' })
  })

  test('read presentCall reports the category/name as raw input', () => {
    const [, read] = build()
    expect(read.presentCall({ category: 'agents', name: 'coder' })).toEqual({
      card: 'generic',
      title: 'Read repository asset',
      kind: 'read',
      rawInput: 'agents/coder',
    })
  })
})
