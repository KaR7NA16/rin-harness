/**
 * rin knowledge-graph — Cordis plugin entry.
 *
 * Exposes `ctx.knowledgeGraph`, a read-only projection of notes and knowledge
 * entities into one SQLite graph. Providers are refreshed on each query; no
 * source store is ever written by this plugin.
 *
 * @module @rin/knowledge-graph
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import type { CodeGraphService } from '@rin/codegraph'
import type { FilesystemService } from '@rin/filesystem'
import type { KnowledgeStore } from '@rin/knowledge'
import type { NotesStore } from '@rin/notes'
import type { RepositoryStore } from '@rin/repository'
import type { SessionSearchStore } from '@rin/session-search'
import { codeGraphRows, filesystemGraphRows, knowledgeGraphRows, notesGraphRows, repositoryGraphRows, sessionGraphRows } from './providers.ts'
import { KnowledgeGraphStore } from './store.ts'
import { atlasGraph, ATLAS_GRAPH_DEPTH_MAX, ATLAS_SEARCH_LIMIT_DEFAULT, ATLAS_SEARCH_LIMIT_MAX, searchAtlas } from './tools.ts'
import type { GraphEdge, GraphNode, GraphQuery, GraphSnapshot } from './types.ts'

export type * from './types.ts'
export { KnowledgeGraphStore } from './store.ts'
export { codeGraphRows, filesystemGraphRows, knowledgeGraphRows, notesGraphRows, repositoryGraphRows, sessionGraphRows } from './providers.ts'
export { atlasGraph, clampDepth, clampSearchLimit, graphNeighborhood, searchAtlas, searchAtlasNodes } from './tools.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    knowledgeGraph: KnowledgeGraphService
  }
}

/** Plugin configuration. */
export interface Config {
  /** Projection database path; defaults to `~/.rin/knowledge-graph.db`. */
  dbPath?: string
  /** Knowledge database path to project from. */
  knowledgeDbPath?: string
  /** Asset repository root the repository provider projects; absent skips the provider. */
  repositoryRoot?: string
  /** Filesystem roots the filesystem provider browses one level deep. */
  filesystemRoots?: string[]
}

/** Schemastery schema for the plugin configuration. */
export const Config: z<Config> = z.object({
  dbPath: z.string().required(false),
  knowledgeDbPath: z.string().required(false),
  repositoryRoot: z.string().required(false),
  filesystemRoots: z.array(z.string()).required(false),
})

/** The unified graph service exposed on the shared context. */
export abstract class KnowledgeGraphService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'knowledgeGraph')
  }

  /** Refresh providers and return the filtered graph. */
  abstract graph(query?: GraphQuery): Promise<GraphSnapshot>

  /** Return one node and its neighbours up to `depth`. */
  abstract related(nodeId: string, depth?: number): Promise<GraphSnapshot>
}

/** File-backed implementation using node:sqlite. */
export class FileKnowledgeGraphService extends KnowledgeGraphService {
  private readonly store: KnowledgeGraphStore
  private readonly knowledgeDbPath: string | undefined
  private readonly repositoryRoot: string | undefined
  private readonly filesystemRoots: string[]

  constructor(ctx: Context, config: Config = {}) {
    super(ctx)
    this.store = new KnowledgeGraphStore(resolveGraphDbPath(config.dbPath))
    this.knowledgeDbPath = config.knowledgeDbPath?.trim() || undefined
    this.repositoryRoot = config.repositoryRoot?.trim() || undefined
    this.filesystemRoots = (config.filesystemRoots ?? []).map(root => root.trim()).filter(root => root !== '')
  }

  override async graph(query: GraphQuery = {}): Promise<GraphSnapshot> {
    await this.refresh()
    return this.store.query(query)
  }

  override async related(nodeId: string, depth = 1): Promise<GraphSnapshot> {
    await this.refresh()
    return this.store.related(nodeId, depth)
  }

  private async refresh(): Promise<void> {
    let notePaths: string[] = []
    const backupNotes = new Map<string, string>()
    const noteLinks: Array<{ notePath: string; target: string }> = []
    const notes = this.ctx.get('notes') as NotesStore | undefined
    if (notes !== undefined) {
      const [metas, graph] = await Promise.all([notes.list(), notes.graph()])
      notePaths = metas.map(meta => meta.path)
      for (const meta of metas) {
        for (const link of meta.links) noteLinks.push({ notePath: meta.path, target: link.target })
        if (meta.folder === 'backups') backupNotes.set(meta.title, meta.path)
      }
      const rows = notesGraphRows(metas, graph)
      this.store.replaceProvider('notes', rows.nodes, rows.edges)
    } else {
      this.store.replaceProvider('notes', [], [])
    }

    const knowledge = this.ctx.get('knowledge') as KnowledgeStore | undefined
    if (knowledge !== undefined && this.knowledgeDbPath !== undefined) {
      try {
        const service = knowledge.open(this.knowledgeDbPath)
        try {
          const sources = service.listSources()
          const documents = service.listDocuments({ limit: 2000 })
          const rows = knowledgeGraphRows(sources, documents, notePaths)
          this.store.replaceProvider('knowledge', rows.nodes, rows.edges)
        } finally {
          service.close()
        }
      } catch {
        // Knowledge projection is best-effort; notes stay available.
        this.store.replaceProvider('knowledge', [], [])
      }
    } else {
      this.store.replaceProvider('knowledge', [], [])
    }

    await this.refreshRepository()
    await this.refreshCodeGraph(noteLinks)
    await this.refreshSession(backupNotes)
    await this.refreshFilesystem()
  }

  private async refreshRepository(): Promise<void> {
    const repository = this.ctx.get('repository') as RepositoryStore | undefined
    if (repository === undefined || this.repositoryRoot === undefined) {
      this.store.replaceProvider('repository', [], [])
      return
    }
    try {
      const rows = repositoryGraphRows(await repository.read(this.repositoryRoot))
      this.store.replaceProvider('repository', rows.nodes, rows.edges)
    } catch {
      // Repository projection is best-effort; other providers stay available.
      this.store.replaceProvider('repository', [], [])
    }
  }

  private async refreshCodeGraph(noteLinks: ReadonlyArray<{ notePath: string; target: string }>): Promise<void> {
    const projectPaths = new Set<string>()
    if (this.repositoryRoot !== undefined) projectPaths.add(this.repositoryRoot)
    const repository = this.ctx.get('repository') as RepositoryStore | undefined
    if (repository !== undefined) {
      try {
        for (const connection of await repository.listConnections()) {
          if (connection.rootPath.trim() !== '') projectPaths.add(connection.rootPath)
        }
      } catch {
        // The connection list is best-effort; the repository root still runs.
      }
    }

    const nodes: GraphNode[] = []
    const edges: GraphEdge[] = []
    const codegraph = this.ctx.get('codegraph') as CodeGraphService | undefined
    if (codegraph !== undefined) {
      for (const projectPath of projectPaths) {
        try {
          const rows = codeGraphRows(codegraph.visualization(projectPath, 120), projectPath, noteLinks)
          nodes.push(...rows.nodes)
          edges.push(...rows.edges)
        } catch {
          // No code-graph database for this project; skip it.
        }
      }
    }
    this.store.replaceProvider('codegraph', nodes, edges)
  }

  private async refreshSession(backupNotes: ReadonlyMap<string, string>): Promise<void> {
    const sessionSearch = this.ctx.get('sessionSearch') as SessionSearchStore | undefined
    if (sessionSearch === undefined) {
      this.store.replaceProvider('session', [], [])
      return
    }
    try {
      const result = await sessionSearch.browse({ limit: 50 })
      const rows = sessionGraphRows(
        result.results.map(hit => ({
          sessionId: hit.sessionId,
          title: hit.title,
          projectPath: hit.projectPath,
        })),
        backupNotes,
      )
      this.store.replaceProvider('session', rows.nodes, rows.edges)
    } catch {
      // Session projection is best-effort; other providers stay available.
      this.store.replaceProvider('session', [], [])
    }
  }

  private async refreshFilesystem(): Promise<void> {
    const filesystem = this.ctx.get('filesystem') as FilesystemService | undefined
    if (filesystem === undefined || this.filesystemRoots.length === 0) {
      this.store.replaceProvider('filesystem', [], [])
      return
    }
    const roots: Array<{ rootPath: string; entries: ReadonlyArray<{ name: string; path: string; isDirectory: boolean }> }> = []
    for (const root of this.filesystemRoots) {
      try {
        const result = await filesystem.browse({ path: root, includeFiles: true, maxResults: 100 })
        roots.push({ rootPath: result.currentPath, entries: result.entries })
      } catch {
        // An unreadable root is skipped; other roots still project.
      }
    }
    const rows = filesystemGraphRows(roots)
    this.store.replaceProvider('filesystem', rows.nodes, rows.edges)
  }
}

export const name = 'knowledge-graph'
export const inject = ['tools']

/** Install the file-backed graph service into the shared context. */
export function apply(ctx: Context, config: Config = {}): void {
  ctx.plugin(FileKnowledgeGraphService, config)
  registerAtlasTools(ctx)
}

const ATLAS_SEARCH_DESCRIPTION =
  'Search the unified local knowledge graph (notes, tags, knowledge documents, repository assets, code symbols, sessions) '
  + 'by free text and return the matching entities with their graph neighbors. Use this to find entities and how they relate '
  + 'before reading any source file.'

const ATLAS_GRAPH_DESCRIPTION =
  'Return one knowledge-graph node and its neighborhood: the related nodes with their edge kinds. '
  + 'Use this to explore connections around a specific entity id returned by atlas_search.'

/** Register atlas_search and atlas_graph on the tools seam. */
function registerAtlasTools(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'atlas_search',
    description: ATLAS_SEARCH_DESCRIPTION,
    parameters: {
      query: { type: 'string', required: true, description: 'Free-text query matched against entity labels, paths, and ids.' },
      sources: { type: 'string', description: 'Comma-separated sources: notes, knowledge, repository, codegraph, session.' },
      kinds: { type: 'string', description: 'Comma-separated node kinds: note, tag, knowledge_source, knowledge_document, repository_agent, repository_environment, repository_package, code_file, code_symbol, session.' },
      limit: { type: 'number', description: `Maximum results. Defaults to ${ATLAS_SEARCH_LIMIT_DEFAULT}, capped at ${ATLAS_SEARCH_LIMIT_MAX}.` },
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              results: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    id: { type: 'string', required: true },
                    kind: { type: 'string', required: true },
                    label: { type: 'string', required: true },
                    path: { type: 'string', required: true },
                    source: { type: 'string', required: true },
                    neighbors: {
                      type: 'array',
                      required: true,
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          id: { type: 'string', required: true },
                          kind: { type: 'string', required: true },
                          label: { type: 'string', required: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: { error: { type: 'string', required: true } },
          },
        ],
      },
      render: (_args, value) => {
        if ('error' in value) return [{ type: 'text', text: value.error }]
        const hits = value.results
        if (hits.length === 0) return [{ type: 'text', text: 'No graph entities matched.' }]
        const lines = hits.map(hit => {
          const location = hit.path !== '' ? ` (${hit.path})` : ''
          const neighbors = hit.neighbors.length > 0
            ? `; neighbors: ${hit.neighbors.map(neighbor => `${neighbor.label} (${neighbor.kind})`).join(', ')}`
            : ''
          return `- ${hit.label} [${hit.kind}]${location}${neighbors}`
        })
        return [{ type: 'text', text: `Matched ${hits.length} entity(ies):\n\n${lines.join('\n')}` }]
      },
    },
    execute: (args) => searchAtlas(ctx.knowledgeGraph, args),
    presentCall: args => ({ card: 'generic', title: 'Search knowledge graph', kind: 'search', rawInput: args.query }),
  }))

  ctx.tools.register(defineTool({
    name: 'atlas_graph',
    description: ATLAS_GRAPH_DESCRIPTION,
    parameters: {
      node: { type: 'string', required: true, description: 'The graph node id (e.g. note:work/ideas.md or repository_agent:rin-base).' },
      depth: { type: 'number', description: `Neighborhood depth. Defaults to 1, capped at ${ATLAS_GRAPH_DEPTH_MAX}.` },
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              node: {
                type: 'object',
                required: true,
                additionalProperties: false,
                properties: {
                  id: { type: 'string', required: true },
                  kind: { type: 'string', required: true },
                  label: { type: 'string', required: true },
                  path: { type: 'string', required: true },
                  source: { type: 'string', required: true },
                },
              },
              related: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    id: { type: 'string', required: true },
                    kind: { type: 'string', required: true },
                    label: { type: 'string', required: true },
                    path: { type: 'string', required: true },
                    source: { type: 'string', required: true },
                    edgeKind: { type: 'string', required: true },
                  },
                },
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: { error: { type: 'string', required: true } },
          },
        ],
      },
      render: (_args, value) => {
        if ('error' in value) return [{ type: 'text', text: value.error }]
        if (value.related.length === 0) return [{ type: 'text', text: `${value.node.label} [${value.node.kind}] has no graph neighbors.` }]
        const lines = value.related.map(related =>
          `- ${related.label} [${related.kind}] (${related.edgeKind})${related.path !== '' ? ` — ${related.path}` : ''}`)
        return [{ type: 'text', text: `${value.node.label} [${value.node.kind}]:\n\n${lines.join('\n')}` }]
      },
    },
    execute: (args) => atlasGraph(ctx.knowledgeGraph, args),
    presentCall: args => ({ card: 'generic', title: 'Read graph node', kind: 'read', rawInput: args.node }),
  }))
}

/** Resolve the projection database path. */
export function resolveGraphDbPath(configured?: string): string {
  if (configured !== undefined && configured.trim() !== '') return configured
  const home = process.env.RIN_HOME !== undefined && process.env.RIN_HOME.trim() !== ''
    ? process.env.RIN_HOME
    : join(homedir(), '.rin')
  return join(home, 'knowledge-graph.db')
}
