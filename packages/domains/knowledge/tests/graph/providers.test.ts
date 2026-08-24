import { describe, expect, test } from 'vitest'
import { codeGraphRows, filesystemGraphRows, knowledgeGraphRows, notesGraphRows, repositoryGraphRows, sessionGraphRows } from '../../src/graph/providers.ts'

describe('notesGraphRows', () => {
  test('projects notes, tags, wikilinks, and tag edges', () => {
    const rows = notesGraphRows([
      {
        path: 'a.md',
        name: 'a',
        folder: '',
        title: 'Alpha',
        sizeBytes: 1,
        modifiedAt: '2026-01-01T00:00:00.000Z',
        tags: ['project'],
        links: [],
      },
      {
        path: 'b.md',
        name: 'b',
        folder: '',
        title: 'Beta',
        sizeBytes: 1,
        modifiedAt: '2026-01-01T00:00:00.000Z',
        tags: [],
        links: [],
      },
    ], {
      nodes: [],
      edges: [{ from: 'a.md', to: 'b.md' }],
    })

    expect(rows.nodes.map(node => node.id)).toEqual(['note:a.md', 'note:b.md', 'tag:project'])
    expect(rows.edges).toEqual([
      { from: 'note:a.md', to: 'note:b.md', kind: 'wikilink', confidence: 1, provenance: 'rin notes wikilink graph' },
      { from: 'note:a.md', to: 'tag:project', kind: 'tag', confidence: 1, provenance: 'rin notes frontmatter or inline tag' },
    ])
  })
})

describe('knowledgeGraphRows', () => {
  test('projects sources, documents, and contains edges', () => {
    const rows = knowledgeGraphRows([
      {
        id: 'src-1',
        path: '/papers',
        name: 'papers',
        kind: 'folder',
        status: 'ready',
        error: null,
        documentCount: 1,
        chunkCount: 1,
        sizeBytes: 10,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        indexedAt: null,
      },
    ], [
      {
        id: 'doc-1',
        sourceId: 'src-1',
        path: '/papers/a.md',
        relativePath: 'a.md',
        title: 'A',
        extension: 'md',
        indexMode: 'text',
        sizeBytes: 5,
        modifiedAt: '2026-01-01T00:00:00.000Z',
        indexedAt: '2026-01-01T00:00:00.000Z',
        links: [],
        error: null,
      },
    ])

    expect(rows.nodes.map(node => node.id)).toEqual(['knowledge_source:src-1', 'knowledge_document:doc-1'])
    expect(rows.edges).toEqual([
      { from: 'knowledge_source:src-1', to: 'knowledge_document:doc-1', kind: 'contains', confidence: 1, provenance: 'rin knowledge source index' },
    ])
  })

  test('creates cites edges when a document wikilink resolves to a note', () => {
    const rows = knowledgeGraphRows(
      [{ id: 'src-1', path: '/papers', name: 'papers', kind: 'folder', indexContent: true, status: 'ready', error: null, documentCount: 1, chunkCount: 1, sizeBytes: 10, createdAt: 'x', updatedAt: 'x', indexedAt: null }],
      [{
        id: 'doc-1',
        sourceId: 'src-1',
        path: '/papers/a.md',
        relativePath: 'a.md',
        title: 'A',
        extension: 'md',
        indexMode: 'text',
        sizeBytes: 5,
        modifiedAt: 'x',
        indexedAt: 'x',
        links: ['work/ideas', 'missing'],
        error: null,
      }],
      ['work/ideas.md', 'other.md'],
    )

    expect(rows.edges).toContainEqual({
      from: 'knowledge_document:doc-1',
      to: 'note:work/ideas.md',
      kind: 'cites',
      confidence: 1,
      provenance: 'rin knowledge wikilink to note',
    })
    expect(rows.edges.filter(edge => edge.kind === 'cites')).toHaveLength(1)
  })
})

describe('repositoryGraphRows', () => {
  test('projects agents, environments, packages, and their relations', () => {
    const repository = {
      rootPath: '/repo',
      manifestPath: '/repo/repository.yaml',
      manifest: {},
      environmentCatalogs: [],
      environmentPackages: [
        { id: 'pkg-a', name: 'pkg-a', ecosystem: 'python', dependencies: ['pkg-b'] },
        { id: 'pkg-b', name: 'pkg-b', ecosystem: 'python' },
      ],
      environmentProfiles: [{
        apiVersion: 'rin.dev/v1',
        kind: 'EnvironmentProfile',
        metadata: { id: 'profile-1', name: 'base', version: '1.0.0' },
        spec: { packages: ['pkg-a', 'pkg-b'] },
      }],
      agents: [{
        version: 2,
        kind: 'AgentConfiguration',
        name: 'rin-base',
        description: 'base agent',
        systemPrompt: '...',
        tools: [],
        resources: { environmentProfileId: 'profile-1', skillIds: [], workflowIds: [] },
        source: 'agents/rin-base.agent.yaml',
      }],
    }

    const rows = repositoryGraphRows(repository as never)

    expect(rows.nodes.map(node => node.kind)).toEqual(expect.arrayContaining([
      'repository_agent', 'repository_environment', 'repository_package',
    ]))
    expect(rows.edges).toContainEqual({
      from: 'repository_agent:rin-base', to: 'repository_environment:profile-1',
      kind: 'uses', confidence: 1, provenance: 'rin repository agent resource',
    })
    expect(rows.edges).toContainEqual({
      from: 'repository_environment:profile-1', to: 'repository_package:pkg-a',
      kind: 'contains', confidence: 1, provenance: 'rin repository environment profile',
    })
    expect(rows.edges).toContainEqual({
      from: 'repository_package:pkg-a', to: 'repository_package:pkg-b',
      kind: 'depends_on', confidence: 1, provenance: 'rin repository package dependency',
    })
  })
})

describe('codeGraphRows', () => {
  test('projects code files, symbols, defined_in, and code_ref edges', () => {
    const visualization = {
      nodes: [
        { id: 'n1', kind: 'function', name: 'runA', qualifiedName: 'mod.runA', filePath: '/proj/src/a.ts', language: 'typescript', startLine: 1, endLine: 5, degree: 2, communityId: 'c1', communityLabel: 'core', role: 'hub' },
        { id: 'n2', kind: 'function', name: 'helperB', qualifiedName: 'mod.helperB', filePath: '/proj/src/a.ts', language: 'typescript', startLine: 8, endLine: 10, degree: 1, communityId: 'c1', communityLabel: 'core', role: 'member' },
      ],
      edges: [
        { source: 'n1', target: 'n2', kind: 'calls', line: 3, provenance: 'tree-sitter', confidence: 'extracted', crossCommunity: false },
      ],
      architecture: {},
    }

    const rows = codeGraphRows(visualization as never, '/proj')

    expect(rows.nodes.map(node => node.kind)).toEqual(['code_file', 'code_symbol', 'code_symbol'])
    expect(rows.edges).toContainEqual({
      from: 'code_symbol:n1', to: 'code_file:/proj/src/a.ts',
      kind: 'defined_in', confidence: 1, provenance: 'rin codegraph index',
    })
    expect(rows.edges).toContainEqual({
      from: 'code_symbol:n1', to: 'code_symbol:n2',
      kind: 'code_ref', confidence: 1, provenance: 'rin codegraph calls',
    })
  })

  test('creates low-confidence mentions edges from note links to code entities', () => {
    const visualization = {
      nodes: [
        { id: 'n1', kind: 'function', name: 'runA', qualifiedName: 'mod.runA', filePath: '/proj/src/a.ts', language: 'typescript', startLine: 1, endLine: 5, degree: 1, communityId: 'c1', communityLabel: 'core', role: 'member' },
      ],
      edges: [],
      architecture: {},
    }

    const rows = codeGraphRows(visualization as never, '/proj', [{ notePath: 'notes/idea.md', target: 'runA' }])

    expect(rows.edges).toContainEqual({
      from: 'note:notes/idea.md', to: 'code_symbol:n1',
      kind: 'mentions', confidence: 0.5, provenance: 'rin notes wikilink to code entity',
    })
  })
})

describe('sessionGraphRows', () => {
  test('projects session nodes and derived_from edges for backup notes', () => {
    const rows = sessionGraphRows(
      [
        { sessionId: 's1', title: 'Research meeting', projectPath: '/proj' },
        { sessionId: 's2', title: 'No backup note', projectPath: '/other' },
      ],
      new Map([['Research meeting', 'backups/Research meeting.md']]),
    )

    expect(rows.nodes.map(node => node.id)).toEqual(['session:s1', 'session:s2'])
    expect(rows.nodes[0]).toMatchObject({
      kind: 'session',
      label: 'Research meeting',
      path: '/proj',
      source: 'session',
    })
    expect(rows.edges).toEqual([{
      from: 'note:backups/Research meeting.md',
      to: 'session:s1',
      kind: 'derived_from',
      confidence: 1,
      provenance: 'rin session backup note',
    }])
  })
})

describe('filesystemGraphRows', () => {
  test('projects a browsed root into file nodes with child edges', () => {
    const rows = filesystemGraphRows([
      {
        rootPath: '/home/me/notes',
        entries: [
          { name: 'a.md', path: '/home/me/notes/a.md', isDirectory: false },
          { name: 'work', path: '/home/me/notes/work', isDirectory: true },
        ],
      },
    ])

    expect(rows.nodes.map(node => node.id)).toEqual([
      'filesystem_root:/home/me/notes',
      'file:/home/me/notes/a.md',
      'file:/home/me/notes/work',
    ])
    expect(rows.nodes[0]).toMatchObject({ kind: 'file', source: 'filesystem', metadata: { isDirectory: true } })
    expect(rows.edges).toEqual([
      { from: 'filesystem_root:/home/me/notes', to: 'file:/home/me/notes/a.md', kind: 'child', confidence: 1, provenance: 'rin filesystem browse' },
      { from: 'filesystem_root:/home/me/notes', to: 'file:/home/me/notes/work', kind: 'child', confidence: 1, provenance: 'rin filesystem browse' },
    ])
  })
})
