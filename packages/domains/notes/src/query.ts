/**
 * rin notes — live-query DSL parser and evaluator.
 *
 * Implements the minimal Dataview/Tasks query subset from the knowledge
 * integration plan: optional `TASKS` mode, a `FROM` source clause
 * (`#tag` / `"folder"` / `""`), a `WHERE` condition clause
 * (`field op value AND ...`), and a `SORT field ASC|DESC` clause. Pure
 * functions with no runtime dependencies, so the strip-types smoke test can
 * exercise them.
 *
 * @module @rin/notes
 */

import type { NoteInlineField, NoteQueryTask, NoteTaskPriority } from './types.ts'

export type QueryMode = 'notes' | 'tasks'
export type QueryOperator = '=' | '!=' | '<' | '<=' | '>' | '>=' | 'contains'

export interface QuerySource {
  kind: 'tag' | 'folder' | 'all'
  value: string
}

export interface QueryCondition {
  field: string
  op: QueryOperator
  value: string
}

export interface QuerySortField {
  field: string
  direction: 'asc' | 'desc'
}

export interface ParsedQuery {
  mode: QueryMode
  sources: QuerySource[]
  conditions: QueryCondition[]
  sort: QuerySortField[]
}

/** One note row fed to the note evaluator. */
export interface NoteQueryRow {
  path: string
  name: string
  folder: string
  title: string
  tags: string[]
  fields: NoteInlineField[]
  modifiedAt: string
}

/** One task row fed to the task evaluator. */
export interface TaskQueryRow extends NoteQueryTask {}

/**
 * Parse a query DSL string into its clauses.
 * @param dsl - the query text, with or without a ```query fence.
 * @returns the parsed query (unknown clauses are ignored).
 */
export function parseQuery(dsl: string): ParsedQuery {
  let text = dsl.trim().replace(/^```query\s*/i, '').replace(/```\s*$/, '')
  let mode: QueryMode = 'notes'
  if (/^TASKS\b/i.test(text)) {
    mode = 'tasks'
    text = text.replace(/^TASKS\b/i, '').trim()
  }
  const query: ParsedQuery = { mode, sources: [], conditions: [], sort: [] }
  for (const clause of splitClauses(text)) {
    if (clause.clause === 'FROM') query.sources.push(...parseSources(clause.rest))
    else if (clause.clause === 'WHERE') query.conditions.push(...parseConditions(clause.rest))
    else if (clause.clause === 'SORT') query.sort.push(...parseSort(clause.rest))
  }
  return query
}

/**
 * Filter and sort note rows by the parsed query.
 * @param query - the parsed query (notes mode).
 * @param notes - the candidate note rows.
 * @returns the matching notes in query order.
 */
export function evaluateNoteQuery(query: ParsedQuery, notes: NoteQueryRow[]): NoteQueryRow[] {
  return notes
    .filter(note =>
      matchesSources(query.sources, note)
      && query.conditions.every(condition => matchesCondition(condition, field => noteFieldValue(note, field))))
    .sort(compareRows(query.sort, noteFieldValue))
}

/**
 * Filter and sort task rows by the parsed query.
 * @param query - the parsed query (tasks mode).
 * @param tasks - the candidate task rows.
 * @param noteOf - resolve a task's note tags/folder for the FROM clause.
 * @returns the matching tasks in query order.
 */
export function evaluateTaskQuery(
  query: ParsedQuery,
  tasks: TaskQueryRow[],
  noteOf: (notePath: string) => { tags: string[]; folder: string } | undefined,
): TaskQueryRow[] {
  return tasks
    .filter(task =>
      matchesSources(query.sources, { tags: noteOf(task.notePath)?.tags ?? [], folder: noteOf(task.notePath)?.folder ?? '' })
      && query.conditions.every(condition => matchesCondition(condition, field => taskFieldValue(task, field))))
    .sort(compareRows(query.sort, taskFieldValue))
}

const PRIORITY_ORDER: Record<NoteTaskPriority, number> = { lowest: 0, low: 1, medium: 2, high: 3, highest: 4 }

function taskFieldValue(task: TaskQueryRow, field: string): unknown {
  switch (field) {
    case 'done':
      return task.done
    case 'text':
      return task.text
    case 'due':
    case 'start':
    case 'scheduled':
    case 'recurrence':
      return task[field]
    case 'priority':
      return PRIORITY_ORDER[task.priority]
    case 'path':
      return task.notePath
    case 'noteName':
      return task.noteName
    case 'line':
      return task.line
    default:
      return undefined
  }
}

function noteFieldValue(note: NoteQueryRow, field: string): unknown {
  switch (field) {
    case 'path':
      return note.path
    case 'name':
      return note.name
    case 'folder':
      return note.folder
    case 'title':
      return note.title
    case 'modifiedAt':
      return note.modifiedAt
    case 'tags':
      return note.tags.join(' ')
    default:
      return note.fields.find(candidate => candidate.key.toLowerCase() === field.toLowerCase())?.value
  }
}

function matchesSources(
  sources: QuerySource[],
  row: { tags: string[]; folder: string },
): boolean {
  if (sources.length === 0) return true
  return sources.some(source => {
    switch (source.kind) {
      case 'all':
        return true
      case 'tag':
        return row.tags.includes(source.value)
      case 'folder':
        return row.folder === source.value || row.folder.startsWith(`${source.value}/`)
    }
  })
}

function matchesCondition(
  condition: QueryCondition,
  valueOf: (field: string) => unknown,
): boolean {
  const left = valueOf(condition.field)
  const right = resolveValue(condition.value)
  switch (condition.op) {
    case '=':
      return looseEqual(left, right)
    case '!=':
      return !looseEqual(left, right)
    case '<':
      return compareValues(left, right) < 0
    case '<=':
      return compareValues(left, right) <= 0
    case '>':
      return compareValues(left, right) > 0
    case '>=':
      return compareValues(left, right) >= 0
    case 'contains':
      return String(left ?? '').toLowerCase().includes(String(right).toLowerCase())
  }
}

function looseEqual(left: unknown, right: unknown): boolean {
  if (typeof left === 'boolean') return left === (right === 'true' || right === true)
  if (typeof left === 'number') return left === Number(right)
  return String(left ?? '') === String(right)
}

function compareValues(left: unknown, right: unknown): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right
  if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right)
  const l = String(left ?? '')
  const r = String(right ?? '')
  if (l === r) return 0
  return l < r ? -1 : 1
}

function resolveValue(raw: string): string | number {
  if (/^date\(\s*today\s*\)$/i.test(raw)) return new Date().toISOString().slice(0, 10)
  if (/^-?\d+$/.test(raw)) return Number(raw)
  return raw
}

function compareRows<T>(
  sort: QuerySortField[],
  valueOf: (row: T, field: string) => unknown,
): (a: T, b: T) => number {
  return (a, b) => {
    for (const field of sort) {
      const left = valueOf(a, field.field)
      const right = valueOf(b, field.field)
      if (left === undefined && right === undefined) continue
      if (left === undefined) return 1
      if (right === undefined) return -1
      const cmp = compareValues(left, right)
      if (cmp !== 0) return field.direction === 'desc' ? -cmp : cmp
    }
    return 0
  }
}

function splitClauses(text: string): Array<{ clause: string; rest: string }> {
  const clauses: Array<{ clause: string; rest: string }> = []
  const re = /\b(FROM|WHERE|SORT)\b/gi
  let cursor = 0
  for (const match of text.matchAll(re)) {
    const index = match.index ?? 0
    const before = text.slice(cursor, index).trim()
    if (before !== '') {
      const last = clauses[clauses.length - 1]
      if (last) last.rest = before
      else clauses.push({ clause: '', rest: before })
    }
    clauses.push({ clause: match[1]!.toUpperCase(), rest: '' })
    cursor = index + match[0].length
  }
  const tail = text.slice(cursor).trim()
  if (tail !== '') {
    const last = clauses[clauses.length - 1]
    if (last) last.rest = tail
    else clauses.push({ clause: '', rest: tail })
  }
  return clauses
}

function parseSources(raw: string): QuerySource[] {
  const sources: QuerySource[] = []
  for (const part of splitTopLevel(raw)) {
    const trimmed = part.trim()
    if (trimmed === '' || trimmed === '""') {
      sources.push({ kind: 'all', value: '' })
    } else if (trimmed.startsWith('#')) {
      sources.push({ kind: 'tag', value: trimmed.slice(1).trim() })
    } else {
      const quoted = /^"([^"]*)"$/.exec(trimmed)
      sources.push(quoted
        ? { kind: 'folder', value: quoted[1]! }
        : { kind: 'tag', value: trimmed })
    }
  }
  return sources
}

function parseConditions(raw: string): QueryCondition[] {
  const conditions: QueryCondition[] = []
  for (const part of raw.split(/\s+AND\s+/i)) {
    const condition = parseCondition(part.trim())
    if (condition) conditions.push(condition)
  }
  return conditions
}

function parseCondition(raw: string): QueryCondition | null {
  const notField = /^not\s+([A-Za-z][A-Za-z0-9_.-]*)$/i.exec(raw)
  if (notField) return { field: notField[1]!, op: '=', value: 'false' }
  const bareField = /^([A-Za-z][A-Za-z0-9_.-]*)$/.exec(raw)
  if (bareField) return { field: bareField[1]!, op: '=', value: 'true' }
  const opMatch = /^([A-Za-z][A-Za-z0-9_.-]*)\s*(!=|<=|>=|=|<|>|contains)\s*(.+)$/.exec(raw)
  if (!opMatch) return null
  return { field: opMatch[1]!, op: opMatch[2]! as QueryOperator, value: unquote(opMatch[3]!.trim()) }
}

function parseSort(raw: string): QuerySortField[] {
  const fields: QuerySortField[] = []
  for (const part of splitTopLevel(raw)) {
    const match = /^([A-Za-z][A-Za-z0-9_.-]*)(?:\s+(ASC|DESC))?$/i.exec(part.trim())
    if (!match) continue
    fields.push({
      field: match[1]!,
      direction: (match[2] ?? 'ASC').toLowerCase() === 'desc' ? 'desc' : 'asc',
    })
  }
  return fields
}

function splitTopLevel(raw: string): string[] {
  const parts: string[] = []
  let current = ''
  let inQuote = false
  for (const char of raw) {
    if (char === '"') inQuote = !inQuote
    if (char === ',' && !inQuote) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  parts.push(current)
  return parts
}

function unquote(value: string): string {
  const quoted = /^"([^"]*)"$/.exec(value)
  return quoted ? quoted[1]! : value
}
