/**
 * rin repository — model-visible tool contract.
 *
 * Owns the tool names, bilingual model-visible descriptions, parameter and
 * output schemas, the pure result renderers, and the tool-definition builder.
 * The schemas are plain objects (asserted against the `@deepseek-ai/dsh-tools`
 * value-schema DSL) and the only dsh-tools import is type-only, so the
 * strip-types smoke test can build and register the two tools without loading
 * the dsh-tools runtime.
 *
 * @module @rin/repository
 */

import type { DefineToolOptions, ParameterSchemaSpec, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { AssetRepository } from './types.ts'
import {
  READ_MAX_CHARS,
  READABLE_CATEGORIES,
  readRepositoryAsset,
  REPOSITORY_CATEGORIES,
  SEARCH_LIMIT_DEFAULT,
  SEARCH_LIMIT_MAX,
  searchRepository,
  type RepositoryReadValue,
  type RepositorySearchValue,
} from './browse.ts'

/** The tool name registered on the dsh tool seam for listing assets. */
export const REPOSITORY_SEARCH_TOOL_NAME = 'repository_search'

/** The tool name registered on the dsh tool seam for reading one asset. */
export const REPOSITORY_READ_TOOL_NAME = 'repository_read'

/**
 * Model-visible tool description, one sentence in Chinese and one in English.
 */
export const REPOSITORY_SEARCH_DESCRIPTION =
  '浏览资产仓库（agents/environments/skills/workflows/tools/knowledge/policies/outputs/bundles），'
  + '按类目与关键词列出资产的名称、路径与描述。'
  + ' Browse the asset repository: list assets by category and keyword with their name, path, and description.'

/**
 * Model-visible tool description, one sentence in Chinese and one in English.
 */
export const REPOSITORY_READ_DESCRIPTION =
  '读取资产仓库中单个资产的完整内容（按类目与名称定位），返回 frontmatter 与正文。'
  + ' Read one repository asset in full (located by category and name), returning its frontmatter and body.'

/** Input schema for repository_search. */
export const repositorySearchParameters = {
  category: {
    type: 'string',
    enum: REPOSITORY_CATEGORIES,
    description: '资产类目；省略则跨全部类目检索。The asset category; omit to search across all categories.',
  },
  query: {
    type: 'string',
    description: '按名称、标题或描述匹配的关键词。Keyword matched against name, title, and description.',
  },
  limit: {
    type: 'number',
    description: `返回结果上限，默认 ${SEARCH_LIMIT_DEFAULT}，上限 ${SEARCH_LIMIT_MAX}。Maximum results; defaults to ${SEARCH_LIMIT_DEFAULT}, capped at ${SEARCH_LIMIT_MAX}.`,
  },
} as const satisfies ParameterSchemaSpec

/** Input schema for repository_read. */
export const repositoryReadParameters = {
  category: {
    type: 'string',
    required: true,
    enum: READABLE_CATEGORIES,
    description: '资产类目（agents 或 environments）。The asset category (agents or environments).',
  },
  name: {
    type: 'string',
    required: true,
    description: '资产稳定 id（agent 名称或 environment profile id）。The stable asset id (agent name or environment profile id).',
  },
} as const satisfies ParameterSchemaSpec

/** Output schema for repository_search. */
export const repositorySearchOutputSchema = {
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
              category: { type: 'string', required: true },
              name: { type: 'string', required: true },
              title: { type: 'string', required: true },
              path: { type: 'string', required: true },
              description: { type: 'string', required: true },
            },
          },
        },
        total: { type: 'integer', required: true },
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
} as const satisfies ValueSchemaSpec

/** Output schema for repository_read. */
export const repositoryReadOutputSchema = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        category: { type: 'string', required: true },
        name: { type: 'string', required: true },
        path: { type: 'string', required: true },
        frontmatter: {
          type: 'object',
          required: true,
          additionalProperties: false,
          properties: {
            kind: { type: 'string', required: true },
            id: { type: 'string', required: true },
            name: { type: 'string', required: true },
            version: { type: 'string', required: true },
            description: { type: 'string' },
          },
        },
        body: { type: 'string', required: true },
        truncated: { type: 'boolean', required: true },
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
} as const satisfies ValueSchemaSpec

/**
 * Render a validated search value into model-facing text.
 * @param value - the canonical output value (already schema-validated).
 * @returns the plain-text model-facing result.
 */
export function renderRepositorySearch(value: RepositorySearchValue): string {
  if ('error' in value) return value.error
  if (value.results.length === 0) return 'No repository assets matched.'
  const lines = value.results.map(hit =>
    `- [${hit.category}] ${hit.name} (${hit.path})\n  ${hit.description}`)
  return `Found ${value.total} asset(s), showing ${value.results.length}:\n${lines.join('\n')}`
}

/**
 * Render a validated read value into model-facing text.
 * @param value - the canonical output value (already schema-validated).
 * @returns the plain-text model-facing result.
 */
export function renderRepositoryRead(value: RepositoryReadValue): string {
  if ('error' in value) return value.error
  const header = `${value.frontmatter.kind} "${value.name}" (${value.path})`
  const truncatedNote = value.truncated ? `\n\n[content truncated to ${READ_MAX_CHARS} chars]` : ''
  return `${header}\n\n${value.body}${truncatedNote}`
}

/** Tool options for repository_search. */
export type RepositorySearchToolOptions = DefineToolOptions<
  typeof repositorySearchParameters,
  typeof repositorySearchOutputSchema
>

/** Tool options for repository_read. */
export type RepositoryReadToolOptions = DefineToolOptions<
  typeof repositoryReadParameters,
  typeof repositoryReadOutputSchema
>

/**
 * Build the two repository browsing tool definitions.
 *
 * `readRepo` is injected by the seam so this module stays free of the Cordis
 * service graph; each execute re-reads the repository from disk.
 * @param readRepo - opens a fresh parsed repository for one tool call.
 * @returns the search tool options followed by the read tool options.
 */
export function buildRepositoryTools(
  readRepo: () => Promise<AssetRepository>,
): [RepositorySearchToolOptions, RepositoryReadToolOptions] {
  const search: RepositorySearchToolOptions = {
    name: REPOSITORY_SEARCH_TOOL_NAME,
    description: REPOSITORY_SEARCH_DESCRIPTION,
    parameters: repositorySearchParameters,
    output: {
      schema: repositorySearchOutputSchema,
      render: (_args, value) => [{ type: 'text', text: renderRepositorySearch(value as RepositorySearchValue) }],
    },
    isConcurrencySafe: () => true,
    execute: async args => searchRepository(await readRepo(), args),
    presentCall: args => ({
      card: 'generic',
      title: 'Search asset repository',
      kind: 'search',
      rawInput: args.query ?? args.category ?? '',
    }),
  }
  const read: RepositoryReadToolOptions = {
    name: REPOSITORY_READ_TOOL_NAME,
    description: REPOSITORY_READ_DESCRIPTION,
    parameters: repositoryReadParameters,
    output: {
      schema: repositoryReadOutputSchema,
      render: (_args, value) => [{ type: 'text', text: renderRepositoryRead(value as RepositoryReadValue) }],
    },
    isConcurrencySafe: () => true,
    execute: async args => readRepositoryAsset(await readRepo(), args.category, args.name),
    presentCall: args => ({
      card: 'generic',
      title: 'Read repository asset',
      kind: 'read',
      rawInput: `${args.category}/${args.name}`,
    }),
  }
  return [search, read]
}
