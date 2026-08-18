/**
 * rin notes — the `notes` tool's model-facing schema and result rendering.
 *
 * Owns the tool name, the bilingual model-visible description, the parameter
 * and output schemas, and the pure result renderer. The schemas are plain
 * objects (asserted against the `@deepseek-ai/dsh-tools` value-schema DSL)
 * so the smoke test can inspect them without loading the Cordis runtime; the
 * type-only import is erased by type stripping.
 *
 * @module @rin/notes
 */

import type { ParameterSchemaSpec, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { NotesToolOutput } from './types.ts'

/** The tool name registered on the dsh tool seam. */
export const NOTES_TOOL_NAME = 'notes'

/**
 * Model-visible tool description, one sentence in Chinese and one in English.
 */
export const NOTES_TOOL_DESCRIPTION =
  '访问并检索用户的个人 Markdown 笔记库：list 列出全部笔记、search 全文搜索、read 读取单篇、'
  + 'query 执行活查询（Dataview/Tasks 子集，如 FROM #tag WHERE due < date(today) SORT due ASC）。'
  + ' Read and search the user\'s personal markdown notes vault — list all notes, search full text, read one note,'
  + ' or run a live query (a Dataview/Tasks subset such as FROM #tag WHERE due < date(today) SORT due ASC).'

/** Input schema: one of the read-only actions plus optional query/path. */
export const notesToolParameters = {
  action: {
    type: 'string',
    required: true,
    enum: ['list', 'search', 'read', 'query'],
    description: '要执行的动作：list 列出全部笔记；search 全文搜索；read 读取单篇；query 执行活查询 DSL。The action: list all notes, search full text, read one note, or run a live query DSL.',
  },
  query: {
    type: 'string',
    description: 'search 动作的检索关键词，或 query 动作的查询 DSL（如 FROM #tag WHERE due < date(today) SORT due ASC）。Search keyword for the search action, or the query DSL for the query action.',
  },
  path: {
    type: 'string',
    description: 'read 动作的笔记路径，相对库根目录的 POSIX 路径（如 work/ideas.md）。Note path relative to the vault root for the read action (e.g. work/ideas.md).',
  },
} as const satisfies ParameterSchemaSpec

/** Output schema: the action plus exactly one result group, or an error. */
export const notesToolOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', required: true },
    notes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          nodeId: { type: 'string', required: true },
          name: { type: 'string', required: true },
          folder: { type: 'string', required: true },
          title: { type: 'string', required: true },
          tags: { type: 'array', required: true, items: { type: 'string' } },
          modifiedAt: { type: 'string', required: true },
        },
      },
    },
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          nodeId: { type: 'string', required: true },
          title: { type: 'string', required: true },
          snippet: { type: 'string', required: true },
        },
      },
    },
    document: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string', required: true },
        nodeId: { type: 'string', required: true },
        title: { type: 'string', required: true },
        tags: { type: 'array', required: true, items: { type: 'string' } },
        links: { type: 'array', required: true, items: { type: 'string' } },
        content: { type: 'string', required: true },
      },
    },
    query: { type: 'string' },
    queryNotes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          name: { type: 'string', required: true },
          folder: { type: 'string', required: true },
          title: { type: 'string', required: true },
          fields: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                key: { type: 'string', required: true },
                value: { type: 'string', required: true },
              },
            },
          },
          modifiedAt: { type: 'string', required: true },
        },
      },
    },
    queryTasks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          notePath: { type: 'string', required: true },
          noteName: { type: 'string', required: true },
          line: { type: 'number', required: true },
          text: { type: 'string', required: true },
          done: { type: 'boolean', required: true },
          due: { type: 'string' },
          priority: { type: 'string', required: true },
        },
      },
    },
    error: { type: 'string' },
  },
} as const satisfies ValueSchemaSpec

/**
 * Render a validated tool output into the model-facing text content.
 * @param value - the canonical output value (already schema-validated).
 * @returns the plain-text model-facing result.
 */
export function renderNotesResult(value: NotesToolOutput): string {
  if (value.error) return `notes ${value.action} failed: ${value.error}`
  if (value.action === 'list' && value.notes) {
    const lines = value.notes.map(note =>
      `- ${note.path} — ${note.title}${note.tags.length ? ` [${note.tags.join(', ')}]` : ''}`)
    return `Listed ${value.notes.length} note(s):\n` + lines.join('\n')
  }
  if (value.action === 'search' && value.results) {
    const lines = value.results.map(result =>
      `- ${result.path} — ${result.title}\n  ${result.snippet}`)
    return `Search results (${value.results.length}):\n` + lines.join('\n')
  }
  if (value.action === 'read' && value.document) {
    return value.document.content
  }
  if (value.action === 'query' && value.queryTasks) {
    const lines = value.queryTasks.map(task =>
      `- [${task.done ? 'x' : ' '}] ${task.text}${task.due ? ` (due ${task.due})` : ''} — ${task.notePath}:${task.line}`)
    return `Query matched ${value.queryTasks.length} task(s):\n` + lines.join('\n')
  }
  if (value.action === 'query' && value.queryNotes) {
    const lines = value.queryNotes.map(note => {
      const fields = note.fields.map(field => `${field.key}=${field.value}`).join(', ')
      return `- ${note.path} — ${note.title}${fields ? ` [${fields}]` : ''}`
    })
    return `Query matched ${value.queryNotes.length} note(s):\n` + lines.join('\n')
  }
  return `notes ${value.action}: no results`
}
