/**
 * rin notes — live-query DSL contract tests.
 *
 * @module @rin/notes
 */

import { describe, expect, test } from 'vitest'
import { evaluateNoteQuery, evaluateTaskQuery, parseQuery } from '../src/query.ts'
import type { NoteQueryRow, TaskQueryRow } from '../src/query.ts'

function note(overrides: Partial<NoteQueryRow> & Pick<NoteQueryRow, 'path'>): NoteQueryRow {
  return {
    name: 'n',
    folder: '',
    title: 'T',
    tags: [],
    fields: [],
    modifiedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function task(overrides: Partial<TaskQueryRow> & Pick<TaskQueryRow, 'notePath' | 'text'>): TaskQueryRow {
  return {
    noteName: 'n',
    line: 1,
    done: false,
    priority: 'medium',
    ...overrides,
  }
}

describe('parseQuery', () => {
  test('parses FROM, WHERE, and SORT clauses', () => {
    const query = parseQuery('FROM #project, "work" WHERE status = active AND due < date(today) SORT due ASC')
    expect(query.mode).toBe('notes')
    expect(query.sources).toEqual([
      { kind: 'tag', value: 'project' },
      { kind: 'folder', value: 'work' },
    ])
    expect(query.conditions).toEqual([
      { field: 'status', op: '=', value: 'active' },
      { field: 'due', op: '<', value: 'date(today)' },
    ])
    expect(query.sort).toEqual([{ field: 'due', direction: 'asc' }])
  })

  test('switches to tasks mode with the TASKS keyword', () => {
    const query = parseQuery('TASKS FROM #project WHERE not done SORT priority DESC')
    expect(query.mode).toBe('tasks')
    expect(query.conditions).toEqual([{ field: 'done', op: '=', value: 'false' }])
    expect(query.sort).toEqual([{ field: 'priority', direction: 'desc' }])
  })

  test('strips a query fence and treats no source as all notes', () => {
    const query = parseQuery('```query\nWHERE title contains report\n```')
    expect(query.sources).toEqual([])
    expect(query.conditions).toEqual([{ field: 'title', op: 'contains', value: 'report' }])
  })
})

describe('evaluateNoteQuery', () => {
  test('filters by tag source and inline-field condition, then sorts', () => {
    const rows = [
      note({ path: 'a.md', tags: ['project'], fields: [{ key: 'status', value: 'active' }] }),
      note({ path: 'b.md', tags: ['project'], fields: [{ key: 'status', value: 'done' }] }),
      note({ path: 'c.md', tags: [], fields: [{ key: 'status', value: 'active' }] }),
    ]
    const result = evaluateNoteQuery(
      parseQuery('FROM #project WHERE status = active'),
      rows,
    )
    expect(result.map(row => row.path)).toEqual(['a.md'])
  })

  test('supports folder sources and date comparisons', () => {
    const rows = [
      note({ path: 'work/x.md', folder: 'work', fields: [{ key: 'due', value: '2026-01-01' }] }),
      note({ path: 'work/y.md', folder: 'work', fields: [{ key: 'due', value: '2099-01-01' }] }),
      note({ path: 'notes/z.md', folder: 'notes', fields: [{ key: 'due', value: '2026-01-01' }] }),
    ]
    const result = evaluateNoteQuery(
      parseQuery('FROM "work" WHERE due < date(today)'),
      rows,
    )
    expect(result.map(row => row.path)).toEqual(['work/x.md'])
  })
})

describe('evaluateTaskQuery', () => {
  const notes = new Map([
    ['project/a.md', { tags: ['project'], folder: 'project' }],
    ['other/b.md', { tags: [], folder: 'other' }],
  ])

  test('filters open tasks by note tag and sorts by due date', () => {
    const tasks = [
      task({ notePath: 'project/a.md', text: 'later', done: false, due: '2026-02-01' }),
      task({ notePath: 'project/a.md', text: 'sooner', done: false, due: '2026-01-01' }),
      task({ notePath: 'project/a.md', text: 'done one', done: true, due: '2026-01-01' }),
      task({ notePath: 'other/b.md', text: 'other', done: false }),
    ]
    const result = evaluateTaskQuery(
      parseQuery('TASKS FROM #project WHERE not done SORT due ASC'),
      tasks,
      notePath => notes.get(notePath),
    )
    expect(result.map(item => item.text)).toEqual(['sooner', 'later'])
  })

  test('sorts by priority descending', () => {
    const tasks = [
      task({ notePath: 'project/a.md', text: 'low', priority: 'low' }),
      task({ notePath: 'project/a.md', text: 'high', priority: 'high' }),
      task({ notePath: 'project/a.md', text: 'med', priority: 'medium' }),
    ]
    const result = evaluateTaskQuery(
      parseQuery('TASKS SORT priority DESC'),
      tasks,
      notePath => notes.get(notePath),
    )
    expect(result.map(item => item.text)).toEqual(['high', 'med', 'low'])
  })
})
