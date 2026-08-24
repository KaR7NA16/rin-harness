/**
 * rin notes — SQLite-backed vault index.
 *
 * Indexes note pages, headings, block anchors, tasks, tags, wikilinks, and
 * full-text search into `<vault>/.index/notes.db`. The index is a derived
 * projection: every read validates the on-disk signature and rebuilds when a
 * file count, path set, or mtime changes.
 *
 * Uses only node:sqlite and node: builtins.
 *
 * @module @rin/notes
 */

import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { extractInlineFields, extractLinks, extractTags, extractTaskFields, extractTitle, splitFrontmatter } from './parse.ts'
import { evaluateNoteQuery, evaluateTaskQuery, parseQuery } from './query.ts'
import type { NoteGraph, NoteGraphEdge, NoteGraphNode, NoteQueryNote, NoteQueryResult, NoteQueryTask, NoteSearchResult, NoteTaskPriority, NoteTodo } from './types.ts'

export const NOTES_INDEX_DIRNAME = '.index'
export const NOTES_INDEX_FILENAME = 'notes.db'

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/
const BLOCK_ID_RE = /^(.*?)\s*\^([A-Za-z0-9_-]+)\s*$/
const TODO_LINE_RE = /^\s*[-*+]\s*\[([ xX])\]\s+(.*)$/

export interface IndexedNote {
  path: string
  name: string
  folder: string
  title: string
  sizeBytes: number
  modifiedAt: string
  tags: string[]
  aliases: string[]
  links: Array<{ target: string; alias?: string }>
}

export interface NoteHeading {
  notePath: string
  line: number
  level: number
  text: string
  slug: string
}

export interface NoteBlock {
  notePath: string
  blockId: string
  line: number
  text: string
}

export interface NoteBacklink {
  path: string
  name: string
  folder: string
  title: string
}

/** SQLite-backed derived index for one notes vault. */
export class NotesIndex {
  private readonly vaultRoot: string

  /** @param vaultRoot - absolute vault root path. */
  constructor(vaultRoot: string) {
    this.vaultRoot = vaultRoot
  }

  private get dbPath(): string {
    return join(this.vaultRoot, NOTES_INDEX_DIRNAME, NOTES_INDEX_FILENAME)
  }

  /** Open the index database, creating the schema on demand. */
  private openDb(): DatabaseSync {
    mkdirSync(join(this.vaultRoot, NOTES_INDEX_DIRNAME), { recursive: true })
    const db = new DatabaseSync(this.dbPath)
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = NORMAL')
    ensureNotesIndexSchema(db)
    return db
  }

  /** Force a full re-index of every markdown note. */
  rebuild(): number {
    const db = this.openDb()
    try {
      const notes = collectIndexedNotes(this.vaultRoot)
      db.exec('BEGIN')
      try {
        db.exec(`
          DELETE FROM note_headings;
          DELETE FROM note_blocks;
          DELETE FROM note_tasks;
          DELETE FROM note_links;
          DELETE FROM notes_index_meta;
          DELETE FROM notes_fts;
        `)
        const insertMeta = db.prepare(`
          INSERT INTO notes_index_meta(
            path, name, folder, title, size_bytes, mtime_ms,
            tags_json, aliases_json, links_json, fields_json, frontmatter_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        const insertHeading = db.prepare(`
          INSERT INTO note_headings(note_path, line, level, text, slug)
          VALUES (?, ?, ?, ?, ?)
        `)
        const insertBlock = db.prepare(`
          INSERT INTO note_blocks(note_path, block_id, line, text)
          VALUES (?, ?, ?, ?)
        `)
        const insertTask = db.prepare(`
          INSERT INTO note_tasks(note_path, line, text, done, due, start, scheduled, recurrence, priority)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        const insertLink = db.prepare(`
          INSERT INTO note_links(source_path, target, alias)
          VALUES (?, ?, ?)
        `)
        const insertFts = db.prepare(`
          INSERT INTO notes_fts(path, name, title, tags, content)
          VALUES (?, ?, ?, ?, ?)
        `)

        for (const note of notes) {
          const frontmatter = note.frontmatter
          insertMeta.run(
            note.path,
            note.name,
            note.folder,
            note.title,
            note.sizeBytes,
            note.mtimeMs,
            JSON.stringify(note.tags),
            JSON.stringify(note.aliases),
            JSON.stringify(note.links.map(link => ({ target: link.target, alias: link.alias }))),
            JSON.stringify(note.fields),
            JSON.stringify(frontmatter ?? {}),
          )
          for (const heading of note.headings) {
            insertHeading.run(note.path, heading.line, heading.level, heading.text, heading.slug)
          }
          for (const block of note.blocks) {
            insertBlock.run(note.path, block.blockId, block.line, block.text)
          }
          for (const todo of note.todos) {
            insertTask.run(
              note.path, todo.line, todo.text, todo.done ? 1 : 0,
              todo.due ?? null, todo.start ?? null, todo.scheduled ?? null,
              todo.recurrence ?? null, todo.priority,
            )
          }
          for (const link of note.links) {
            insertLink.run(note.path, link.target, link.alias ?? null)
          }
          insertFts.run(note.path, note.name, note.title, note.tags.join(' '), note.content)
        }
        db.exec('COMMIT')
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
      return notes.length
    } finally {
      db.close()
    }
  }

  /** Rebuild when the vault changed, then return the indexed note count. */
  refresh(): number {
    if (!needsRebuild(this.vaultRoot, this.dbPath)) return countIndexedNotes(this.dbPath)
    return this.rebuild()
  }

  /** Full-text search over indexed names, titles, tags, and bodies. */
  search(query: string, limit = 30): NoteSearchResult[] {
    const q = query.trim()
    if (!q) return []
    const db = this.openDb()
    try {
      const ftsQuery = escapeFtsQuery(q)
      const nameHits = new Set((db.prepare(`SELECT path FROM notes_fts WHERE name MATCH ?`).all(nameQuery(q)) as Array<{ path: string }>).map(row => row.path))
      const titleHits = new Set((db.prepare(`SELECT path FROM notes_fts WHERE title MATCH ?`).all(titleQuery(q)) as Array<{ path: string }>).map(row => row.path))
      const bodyHits = new Set((db.prepare(`SELECT path FROM notes_fts WHERE content MATCH ?`).all(bodyQuery(q)) as Array<{ path: string }>).map(row => row.path))
      const candidates = new Set([...nameHits, ...titleHits, ...bodyHits])
      const base = db.prepare(`
        SELECT path, name, title, snippet(notes_fts, 4, '[', ']', '…', 18) AS snippet
        FROM notes_fts WHERE notes_fts MATCH ?
      `).all(ftsQuery) as Array<{ path: string; name: string; title: string; snippet: string }>
      const results = base
        .filter(row => candidates.has(row.path))
        .map(row => {
          const nameScore = nameHits.has(row.path) ? 3 : 0
          const titleScore = titleHits.has(row.path) ? 2 : 0
          const bodyScore = nameScore === 0 && titleScore === 0 && bodyHits.has(row.path) ? 1 : 0
          return {
            path: row.path,
            name: row.name,
            title: row.title,
            snippet: bodyScore > 0 ? row.snippet.replace(/\s+/g, ' ').trim() : '',
            score: nameScore + titleScore + bodyScore,
          }
        })
      return results
        .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
        .slice(0, Math.min(Math.max(Math.trunc(limit), 1), 100))
    } finally {
      db.close()
    }
  }

  /** Resolve the wikilink graph from indexed links and titles. */
  graph(): NoteGraph {
    const db = this.openDb()
    try {
      const metas = db.prepare(`
        SELECT path, name, folder, title, tags_json FROM notes_index_meta
      `).all() as Array<{ path: string; name: string; folder: string; title: string; tags_json: string }>
      const links = db.prepare(`SELECT source_path, target FROM note_links`).all() as Array<{
        source_path: string
        target: string
      }>
      const byPath = new Map(metas.map(meta => [meta.path, meta]))
      const byName = new Map<string, string[]>()
      for (const meta of metas) {
        const paths = byName.get(meta.name) ?? []
        paths.push(meta.path)
        byName.set(meta.name, paths)
      }
      const nodes: NoteGraphNode[] = metas.map(meta => ({
        id: meta.path,
        name: meta.name,
        folder: meta.folder,
        tag: (JSON.parse(meta.tags_json) as string[])[0] ?? null,
      }))
      const edges: NoteGraphEdge[] = []
      const seen = new Set<string>()
      for (const link of links) {
        const target = resolveIndexedLink(link.target, byPath, byName)
        if (target === null || target === link.source_path) continue
        const key = `${link.source_path}\u0000${target}`
        if (seen.has(key)) continue
        seen.add(key)
        edges.push({ from: link.source_path, to: target })
      }
      return { nodes, edges }
    } finally {
      db.close()
    }
  }

  /** Extract todos from indexed task rows. */
  todos(): NoteTodo[] {
    const db = this.openDb()
    try {
      const rows = db.prepare(`
        SELECT t.note_path, m.name, t.line, t.text, t.done, t.due, t.start, t.scheduled, t.recurrence, t.priority
        FROM note_tasks t
        JOIN notes_index_meta m ON m.path = t.note_path
        ORDER BY t.done ASC, t.note_path ASC, t.line ASC
      `).all() as TaskRow[]
      return rows.map(mapTask)
    } finally {
      db.close()
    }
  }

  /** Execute a live query over indexed notes or tasks. */
  query(dsl: string): NoteQueryResult {
    const parsed = parseQuery(dsl)
    const db = this.openDb()
    try {
      if (parsed.mode === 'tasks') {
        const tasks = db.prepare(`
          SELECT t.note_path, m.name, m.folder, m.tags_json, t.line, t.text, t.done, t.due, t.start, t.scheduled, t.recurrence, t.priority
          FROM note_tasks t
          JOIN notes_index_meta m ON m.path = t.note_path
          ORDER BY t.note_path ASC, t.line ASC
        `).all() as TaskRow[]
        const noteByPath = new Map(tasks.map(row => [row.note_path, {
          tags: JSON.parse(row.tags_json ?? '[]') as string[],
          folder: row.folder ?? '',
        }]))
        return {
          kind: 'tasks',
          tasks: evaluateTaskQuery(parsed, tasks.map(mapTask), notePath => noteByPath.get(notePath)),
        }
      }
      const rows = db.prepare(`
        SELECT path, name, folder, title, tags_json, fields_json, mtime_ms
        FROM notes_index_meta
      `).all() as MetaRow[]
      return { kind: 'notes', notes: evaluateNoteQuery(parsed, rows.map(mapQueryNote)) }
    } finally {
      db.close()
    }
  }

  /** List notes whose wikilinks resolve to the given note. */
  backlinks(path: string): NoteBacklink[] {
    const db = this.openDb()
    try {
      const rows = db.prepare(`
        SELECT m.path, m.name, m.folder, m.title
        FROM note_links l
        JOIN notes_index_meta m ON m.path = l.source_path
        JOIN notes_index_meta target ON target.path = ?
        WHERE l.target = target.name
           OR l.target = target.path
           OR l.target = ? || '/' || target.name
        ORDER BY m.title ASC
      `).all(path, targetFolder(path)) as Array<{ path: string; name: string; folder: string; title: string }>
      return rows
    } finally {
      db.close()
    }
  }

  /** List headings for one note. */
  headings(path: string): NoteHeading[] {
    const db = this.openDb()
    try {
      const rows = db.prepare(`
        SELECT note_path, line, level, text, slug
        FROM note_headings WHERE note_path = ? ORDER BY line ASC
      `).all(path) as Array<{ note_path: string; line: number; level: number; text: string; slug: string }>
      return rows.map(row => ({
        notePath: row.note_path,
        line: row.line,
        level: row.level,
        text: row.text,
        slug: row.slug,
      }))
    } finally {
      db.close()
    }
  }

  /** List block anchors for one note. */
  blocks(path: string): NoteBlock[] {
    const db = this.openDb()
    try {
      const rows = db.prepare(`
        SELECT note_path, block_id, line, text
        FROM note_blocks WHERE note_path = ? ORDER BY line ASC
      `).all(path) as Array<{ note_path: string; block_id: string; line: number; text: string }>
      return rows.map(row => ({
        notePath: row.note_path,
        blockId: row.block_id,
        line: row.line,
        text: row.text,
      }))
    } finally {
      db.close()
    }
  }
}

/** Create the notes index schema when absent. */
export function ensureNotesIndexSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes_index_meta (
      path TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      folder TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      mtime_ms REAL NOT NULL DEFAULT 0,
      tags_json TEXT NOT NULL DEFAULT '[]',
      aliases_json TEXT NOT NULL DEFAULT '[]',
      links_json TEXT NOT NULL DEFAULT '[]',
      fields_json TEXT NOT NULL DEFAULT '[]',
      frontmatter_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS note_headings (
      note_path TEXT NOT NULL,
      line INTEGER NOT NULL,
      level INTEGER NOT NULL,
      text TEXT NOT NULL,
      slug TEXT NOT NULL,
      PRIMARY KEY(note_path, line)
    );

    CREATE TABLE IF NOT EXISTS note_blocks (
      note_path TEXT NOT NULL,
      block_id TEXT NOT NULL,
      line INTEGER NOT NULL,
      text TEXT NOT NULL,
      PRIMARY KEY(note_path, block_id)
    );

    CREATE TABLE IF NOT EXISTS note_tasks (
      note_path TEXT NOT NULL,
      line INTEGER NOT NULL,
      text TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      due TEXT,
      start TEXT,
      scheduled TEXT,
      recurrence TEXT,
      priority TEXT NOT NULL DEFAULT 'medium',
      PRIMARY KEY(note_path, line)
    );

    CREATE TABLE IF NOT EXISTS note_links (
      source_path TEXT NOT NULL,
      target TEXT NOT NULL,
      alias TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_note_links_target ON note_links(target);

    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      path UNINDEXED,
      name,
      title,
      tags,
      content
    );
  `)
  migrateNotesSchema(db)
}

/** Add the task-field and inline-field columns to databases created before them. */
function migrateNotesSchema(db: DatabaseSync): void {
  const columns = (table: string): Set<string> => {
    const rows = db.prepare(`SELECT name FROM pragma_table_info(?)`).all(table) as Array<{ name: string }>
    return new Set(rows.map(row => row.name))
  }
  const metaColumns = columns('notes_index_meta')
  if (!metaColumns.has('fields_json')) {
    db.exec(`ALTER TABLE notes_index_meta ADD COLUMN fields_json TEXT NOT NULL DEFAULT '[]'`)
  }
  const taskColumns = columns('note_tasks')
  for (const [column, definition] of [
    ['due', 'TEXT'],
    ['start', 'TEXT'],
    ['scheduled', 'TEXT'],
    ['recurrence', 'TEXT'],
    ['priority', "TEXT NOT NULL DEFAULT 'medium'"],
  ] as const) {
    if (!taskColumns.has(column)) {
      db.exec(`ALTER TABLE note_tasks ADD COLUMN ${column} ${definition}`)
    }
  }
}

interface CollectedNote extends IndexedNote {
  mtimeMs: number
  frontmatter: Record<string, unknown> | null
  content: string
  fields: Array<{ key: string; value: string }>
  headings: NoteHeading[]
  blocks: NoteBlock[]
  todos: NoteTodo[]
}

const INTERNAL_NAMES = new Set(['.history', '.templates', 'backups', 'assets', 'node_modules', NOTES_INDEX_DIRNAME])

function collectIndexedNotes(vaultRoot: string): CollectedNote[] {
  const notes: CollectedNote[] = []
  const walk = (dir: string, relDir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') && entry.name !== '.index') continue
      if (entry.isDirectory()) {
        if (INTERNAL_NAMES.has(entry.name) || entry.name.startsWith('.')) continue
        walk(join(dir, entry.name), relDir ? `${relDir}/${entry.name}` : entry.name)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const relPath = relDir ? `${relDir}/${entry.name}` : entry.name
        notes.push(collectOneNote(vaultRoot, relPath))
      }
    }
  }
  walk(vaultRoot, '')
  return notes.sort((a, b) => a.path.localeCompare(b.path))
}

function collectOneNote(vaultRoot: string, relPath: string): CollectedNote {
  const abs = join(vaultRoot, relPath)
  const content = readFileSync(abs, 'utf8')
  const stat = statSync(abs)
  const { frontmatter, body } = splitFrontmatter(content)
  const bodyPrefix = content.slice(0, content.length - body.length)
  const bodyLineOffset = bodyPrefix === '' ? 0 : bodyPrefix.split('\n').length - 1
  const name = basename(relPath, '.md')
  const folder = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : ''
  const tags = extractTags(content)
  const aliases = normalizeAliases(frontmatter?.aliases)
  const links = extractLinks(content)
  const fields = extractInlineFields(content)
  const headings: NoteHeading[] = []
  const blocks: NoteBlock[] = []
  const todos: NoteTodo[] = []
  const lines = body.split('\n')
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? ''
    const lineNumber = index + 1 + bodyLineOffset
    const heading = HEADING_RE.exec(line)
    if (heading) {
      const text = (heading[2] ?? '').trim()
      headings.push({ notePath: relPath, line: lineNumber, level: heading[1]!.length, text, slug: slugifyHeading(text) })
      continue
    }
    const block = BLOCK_ID_RE.exec(line)
    if (block && block[2]) {
      blocks.push({ notePath: relPath, blockId: block[2], line: lineNumber, text: (block[1] ?? '').trim() })
    }
    const todo = TODO_LINE_RE.exec(line)
    if (todo) {
      const text = (todo[2] ?? '').trim()
      const taskFields = extractTaskFields(text)
      todos.push({
        notePath: relPath,
        noteName: name,
        line: lineNumber,
        text,
        done: (todo[1] ?? ' ').toLowerCase() === 'x',
        ...(taskFields.due ? { due: taskFields.due } : {}),
        ...(taskFields.start ? { start: taskFields.start } : {}),
        ...(taskFields.scheduled ? { scheduled: taskFields.scheduled } : {}),
        ...(taskFields.recurrence ? { recurrence: taskFields.recurrence } : {}),
        priority: taskFields.priority,
      })
    }
  }
  return {
    path: relPath,
    name,
    folder,
    title: extractTitle(content, name),
    sizeBytes: stat.size,
    mtimeMs: stat.mtimeMs,
    modifiedAt: stat.mtime.toISOString(),
    tags,
    aliases,
    links: links.map(link => ({ target: link.target, ...(link.alias ? { alias: link.alias } : {}) })),
    frontmatter,
    content,
    fields,
    headings,
    blocks,
    todos,
  }
}

function normalizeAliases(value: unknown): string[] {
  if (typeof value === 'string') return [value.trim()].filter(Boolean)
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean)
  }
  return []
}

function slugifyHeading(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s+/g, '-')
}

function escapeFtsQuery(query: string): string {
  return query
    .replace(/"/g, '""')
    .split(/\s+/)
    .filter(Boolean)
    .map(term => `"${term}"`)
    .join(' AND ')
}

function scopedFtsQuery(column: string, query: string): string {
  return query
    .replace(/"/g, '""')
    .split(/\s+/)
    .filter(Boolean)
    .map(term => `${column}:"${term}"`)
    .join(' AND ')
}

function nameQuery(query: string): string { return scopedFtsQuery('name', query) }
function titleQuery(query: string): string { return scopedFtsQuery('title', query) }
function bodyQuery(query: string): string { return scopedFtsQuery('content', query) }

function diskSignature(vaultRoot: string): { count: number; maxMtime: number } {
  let count = 0
  let maxMtime = 0
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || INTERNAL_NAMES.has(entry.name)) continue
        walk(join(dir, entry.name))
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        count += 1
        maxMtime = Math.max(maxMtime, statSync(join(dir, entry.name)).mtimeMs)
      }
    }
  }
  walk(vaultRoot)
  return { count, maxMtime }
}

function indexSignature(dbPath: string): { count: number; maxMtime: number } | null {
  let db: DatabaseSync
  try {
    db = new DatabaseSync(dbPath, { readOnly: true })
  } catch {
    return null
  }
  try {
    const row = db.prepare(`
      SELECT COUNT(*) AS count, COALESCE(MAX(mtime_ms), 0) AS max_mtime
      FROM notes_index_meta
    `).get() as { count: number; max_mtime: number }
    return { count: row.count, maxMtime: row.max_mtime }
  } finally {
    db.close()
  }
}

function needsRebuild(vaultRoot: string, dbPath: string): boolean {
  const disk = diskSignature(vaultRoot)
  const indexed = indexSignature(dbPath)
  if (indexed === null) return true
  return disk.count !== indexed.count || disk.maxMtime > indexed.maxMtime + 1
}

function countIndexedNotes(dbPath: string): number {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    return (db.prepare('SELECT COUNT(*) AS count FROM notes_index_meta').get() as { count: number }).count
  } finally {
    db.close()
  }
}

function resolveIndexedLink(
  target: string,
  byPath: ReadonlyMap<string, unknown>,
  byName: ReadonlyMap<string, string[]>,
): string | null {
  const normalized = target.replace(/\.md$/, '').replace(/^\/+|\/+$/g, '')
  if (byPath.has(normalized)) return normalized
  if (byPath.has(normalized + '.md')) return normalized + '.md'
  const names = byName.get(normalized)
  return names?.[0] ?? null
}

function targetFolder(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}

type TaskRow = {
  note_path: string
  name: string
  folder?: string
  tags_json?: string
  line: number
  text: string
  done: number
  due: string | null
  start: string | null
  scheduled: string | null
  recurrence: string | null
  priority: NoteTaskPriority
}

type MetaRow = {
  path: string
  name: string
  folder: string
  title: string
  tags_json: string
  fields_json: string
  mtime_ms: number
}

function mapTask(row: TaskRow): NoteQueryTask {
  return {
    notePath: row.note_path,
    noteName: row.name,
    line: row.line,
    text: row.text,
    done: row.done === 1,
    ...(row.due ? { due: row.due } : {}),
    ...(row.start ? { start: row.start } : {}),
    ...(row.scheduled ? { scheduled: row.scheduled } : {}),
    ...(row.recurrence ? { recurrence: row.recurrence } : {}),
    priority: row.priority,
  }
}

function mapQueryNote(row: MetaRow): NoteQueryNote {
  return {
    path: row.path,
    name: row.name,
    folder: row.folder,
    title: row.title,
    tags: JSON.parse(row.tags_json) as string[],
    fields: JSON.parse(row.fields_json) as Array<{ key: string; value: string }>,
    modifiedAt: new Date(row.mtime_ms).toISOString(),
  }
}
