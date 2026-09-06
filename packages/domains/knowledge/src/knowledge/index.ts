/**
 * rin knowledge — Cordis plugin entry.
 *
 * Exposes a ctx.knowledge service that opens a KnowledgeService bound to a
 * SQLite database. The KnowledgeService owns source registration, incremental
 * indexing, and full-text search; the plugin also registers the model-visible
 * `knowledge_search` and `knowledge_stats` tools over that service.
 *
 * @module @rin/knowledge
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { KnowledgeService } from './service.ts'
import {
  knowledgeStats,
  resolveKnowledgeDbPath,
  searchKnowledge,
  SEARCH_LIMIT_DEFAULT,
  SEARCH_LIMIT_MAX,
} from './tools.ts'

export type * from './types.ts'
export { KnowledgeService } from './service.ts'
export { getKnowledgeDbPath, getKnowledgeDir } from './paths.ts'
export { extractWikilinkTargets, knowledgeDocumentNodeId, knowledgeSourceNodeId } from './entities.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    knowledge: KnowledgeStore
  }
}

/** The knowledge service exposed on the shared context. */
export abstract class KnowledgeStore extends Service {
  constructor(ctx: Context) {
    super(ctx, 'knowledge')
  }

  /** @param dbPath - absolute path to the SQLite database file. */
  abstract open(dbPath: string): KnowledgeService
}

/** SQLite-backed implementation opening a KnowledgeService on demand. */
export class FileKnowledgeStore extends KnowledgeStore {
  override open(dbPath: string): KnowledgeService {
    return new KnowledgeService(dbPath)
  }
}

export const name = 'knowledge'
export const inject = ['tools']

/** Plugin configuration: explicit database location with a derived default. */
export interface Config {
  /** Absolute path to the knowledge SQLite database file. */
  dbPath?: string
  /** Configuration home used to derive the default database path via getKnowledgeDbPath(). */
  configHome?: string
}

/** Schemastery schema for the knowledge plugin configuration. */
export const Config: z<Config> = z.object({
  dbPath: z.string().required(false),
  configHome: z.string().required(false),
})

const SEARCH_DESCRIPTION =
  'Search the local knowledge base by free text and return the best-matching passages with their '
  + 'source paths, titles, snippets, and relevance scores. Use this to recall previously indexed '
  + 'project or document content. Returns an explicit error when the knowledge base is empty or unavailable.'

const STATS_DESCRIPTION =
  'Report aggregate counts for the local knowledge base: how many sources, documents, chunks, and '
  + 'total bytes are indexed. Use this to check whether the knowledge base has any content before searching.'

/**
 * Install the SQLite-backed knowledge service and register its model-visible tools.
 * @param ctx - the plugin context (must inject tools).
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.plugin(FileKnowledgeStore)
  registerTools(ctx, config)
}

/** Register knowledge_search and knowledge_stats on the tools seam. */
function registerTools(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'knowledge_search',
    description: SEARCH_DESCRIPTION,
    parameters: {
      query: { type: 'string', required: true, description: 'Free-text search query.' },
      limit: {
        type: 'number',
        description: `Maximum number of results to return. Defaults to ${SEARCH_LIMIT_DEFAULT}, capped at ${SEARCH_LIMIT_MAX}.`,
      },
      sourceId: { type: 'string', description: 'Restrict the search to a single registered source id.' },
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
                    path: { type: 'string', required: true },
                    title: { type: 'string', required: true },
                    snippet: { type: 'string', required: true },
                    score: { type: 'number', required: true },
                  },
                },
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              error: { type: 'string', required: true },
            },
          },
        ],
      },
      render: (_args, value) => {
        if ('error' in value) return [{ type: 'text', text: value.error }]
        const hits = value.results
        if (hits.length === 0) return [{ type: 'text', text: 'No matching knowledge found.' }]
        const lines = hits.map((hit, index) => `${index + 1}. ${hit.title} (${hit.path})\n   ${hit.snippet}`)
        return [{ type: 'text', text: `Found ${hits.length} result(s):\n\n${lines.join('\n\n')}` }]
      },
    },
    execute(args) {
      const service = openToolService(ctx, config)
      try {
        return Promise.resolve(searchKnowledge(service, args))
      } finally {
        service?.close()
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Search knowledge base', kind: 'search', rawInput: args.query }),
  }))

  ctx.tools.register(defineTool({
    name: 'knowledge_stats',
    description: STATS_DESCRIPTION,
    parameters: {},
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              stats: {
                type: 'object',
                required: true,
                additionalProperties: false,
                properties: {
                  sourceCount: { type: 'integer', required: true },
                  documentCount: { type: 'integer', required: true },
                  chunkCount: { type: 'integer', required: true },
                  sizeBytes: { type: 'integer', required: true },
                },
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              error: { type: 'string', required: true },
            },
          },
        ],
      },
      render: (_args, value) => {
        if ('error' in value) return [{ type: 'text', text: value.error }]
        const s = value.stats
        return [{ type: 'text', text: `${s.sourceCount} source(s), ${s.documentCount} document(s), ${s.chunkCount} chunk(s), ${s.sizeBytes} byte(s)` }]
      },
    },
    execute() {
      const service = openToolService(ctx, config)
      try {
        return Promise.resolve(knowledgeStats(service))
      } finally {
        service?.close()
      }
    },
    presentCall: () => ({ card: 'generic', title: 'Read knowledge stats', kind: 'read' }),
  }))
}

/** Open a KnowledgeService for one tool call, or null when unavailable. */
function openToolService(ctx: Context, config: Config): KnowledgeService | null {
  const store = ctx.get('knowledge')
  if (store === undefined) return null
  const dbPath = resolveKnowledgeDbPath(config.configHome, config.dbPath)
  if (dbPath === undefined) return null
  try {
    return store.open(dbPath)
  } catch {
    // The database could not be opened; the tool reports a clear error instead.
    return null
  }
}

