/**
 * rin knowledge — indexing and search implementation.
 *
 * Owns knowledge-source lifecycle (add/reindex/remove), incremental indexing
 * of files and folders into SQLite, and full-text search over indexed content.
 * The SQLite adapter (db.ts) owns schema and migrations; this module owns
 * behavior.
 *
 * @module @rin/knowledge
 */

import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, parse, relative, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { openKnowledgeDb } from './db.ts'
import { extractWikilinkTargets, knowledgeDocumentNodeId } from './entities.ts'
import type {
  KnowledgeDocument,
  KnowledgeDocumentIndexMode,
  KnowledgeSearchResult,
  KnowledgeSource,
  KnowledgeSourceKind,
  KnowledgeStats,
} from './types.ts'

const MAX_TEXT_FILE_BYTES = 8 * 1024 * 1024
const MAX_SOURCE_FILES = 5_000
const CHUNK_TARGET_CHARS = 5_000
const CHUNK_OVERLAP_CHARS = 300
const SEARCH_LIMIT_MAX = 100

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.codegraph',
  '.codebase-memory',
  'node_modules',
  'target',
  'dist',
  'build',
  'coverage',
  '__pycache__',
  '.next',
  '.nuxt',
  '.venv',
  'venv',
])

const KNOWN_BINARY_EXTENSIONS = new Set([
  '.7z', '.a', '.avi', '.bin', '.bmp', '.class', '.dll', '.dmg', '.doc',
  '.docx', '.exe', '.flac', '.gif', '.gz', '.ico', '.jar', '.jpeg', '.jpg',
  '.m4a', '.mov', '.mp3', '.mp4', '.o', '.obj', '.otf', '.pdf', '.png',
  '.ppt', '.pptx', '.rar', '.so', '.tar', '.ttf', '.wav', '.webm', '.webp',
  '.woff', '.woff2', '.xls', '.xlsx', '.zip',
])

type SourceRow = {
  id: string
  path: string
  name: string
  kind: KnowledgeSourceKind
  index_content: number
  status: KnowledgeSource['status']
  error: string | null
  document_count: number
  chunk_count: number
  size_bytes: number
  created_at: string
  updated_at: string
  indexed_at: string | null
}

type DocumentRow = {
  id: string
  source_id: string
  path: string
  relative_path: string
  title: string
  extension: string
  index_mode: KnowledgeDocumentIndexMode
  size_bytes: number
  mtime_ms: number
  indexed_at: string
  error: string | null
}

type IndexedFile = {
  path: string
  relativePath: string
}

type ParsedDocument = {
  mode: KnowledgeDocumentIndexMode
  content: string
  links: string[]
  error: string | null
}

/** Indexing and search over a SQLite-backed knowledge base. */
export class KnowledgeService {
  private readonly db: DatabaseSync
  private readonly jobs = new Map<string, Promise<void>>()
  private readonly cancelled = new Set<string>()

  /** @param dbPath - absolute path to the SQLite database file, created on demand. */
  constructor(dbPath: string) {
    this.db = openKnowledgeDb(dbPath)
    this.db.exec(`
      UPDATE knowledge_sources
      SET status = 'pending', error = NULL
      WHERE status = 'indexing'
    `)
  }

  /** List sources by most-recently-updated, rescheduling any pending index. */
  listSources(): KnowledgeSource[] {
    const rows = this.db.prepare(`
      SELECT * FROM knowledge_sources
      ORDER BY updated_at DESC, name COLLATE NOCASE
    `).all() as SourceRow[]

    for (const row of rows) {
      if (row.status === 'pending') this.scheduleIndex(row.id)
    }
    return rows.map(mapSource)
  }

  /** @param id - the stable source id. @returns the source, or null when unknown. */
  getSource(id: string): KnowledgeSource | null {
    const row = this.db.prepare(`
      SELECT * FROM knowledge_sources WHERE id = ?
    `).get(id) as SourceRow | undefined
    return row ? mapSource(row) : null
  }

  /**
   * Register one or more file/folder paths and index them.
   *
   * @param paths - filesystem paths to register as sources.
   * @param options.waitForIndex - resolve only after indexing finishes.
   * @param options.allowedRoots - when non-empty, each path must resolve inside one of these roots.
   * @param options.indexContent - when false, index links/title for graph projection but skip full-text content.
   * @returns the registered sources.
   */
  async addSources(
    paths: string[],
    options: { waitForIndex?: boolean; allowedRoots?: readonly string[]; indexContent?: boolean } = {},
  ): Promise<KnowledgeSource[]> {
    const cleanPaths = [...new Set(paths.map((value) => value.trim()).filter(Boolean))]
    if (cleanPaths.length === 0) throw new Error('rin knowledge: At least one source path is required')
    const indexContent = options.indexContent !== false ? 1 : 0

    const sourceIds: string[] = []
    for (const inputPath of cleanPaths) {
      const normalizedPath = await validateSourcePath(inputPath, options.allowedRoots)
      const sourceStat = await stat(normalizedPath)
      const kind: KnowledgeSourceKind = sourceStat.isDirectory() ? 'folder' : 'file'
      const id = stableId(normalizedPath)
      const now = new Date().toISOString()

      this.cancelled.delete(id)
      this.db.prepare(`
        INSERT INTO knowledge_sources (
          id, path, name, kind, index_content, status, error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', NULL, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
          name = excluded.name,
          kind = excluded.kind,
          index_content = excluded.index_content,
          status = 'pending',
          error = NULL,
          updated_at = excluded.updated_at
      `).run(id, normalizedPath, basename(normalizedPath), kind, indexContent, now, now)
      sourceIds.push(id)
      this.scheduleIndex(id)
    }

    if (options.waitForIndex) {
      await Promise.all(sourceIds.map((id) => this.jobs.get(id)))
    }
    return sourceIds
      .map((id) => this.getSource(id))
      .filter((source): source is KnowledgeSource => source !== null)
  }

  /**
   * Re-index an existing source from disk.
   *
   * @param id - the source id.
   * @param options.waitForIndex - resolve only after indexing finishes.
   * @returns the re-indexed source.
   */
  async reindexSource(
    id: string,
    options: { waitForIndex?: boolean } = {},
  ): Promise<KnowledgeSource> {
    if (!this.getSource(id)) throw new Error('rin knowledge: Knowledge source not found')
    this.cancelled.delete(id)
    this.db.prepare(`
      UPDATE knowledge_sources
      SET status = 'pending', error = NULL, updated_at = ?
      WHERE id = ?
    `).run(new Date().toISOString(), id)
    this.scheduleIndex(id)
    if (options.waitForIndex) await this.jobs.get(id)
    const source = this.getSource(id)
    if (!source) throw new Error('rin knowledge: Knowledge source not found')
    return source
  }

  /**
   * Remove a source and its index. The files on disk are left untouched.
   *
   * @param id - the source id.
   * @returns true when the source existed and was removed.
   */
  removeSource(id: string): boolean {
    const exists = Boolean(this.getSource(id))
    if (!exists) return false
    this.cancelled.add(id)
    this.deleteSourceIndex(id)
    this.db.prepare('DELETE FROM knowledge_sources WHERE id = ?').run(id)
    this.checkpoint()
    return true
  }

  /**
   * List indexed documents, optionally scoped to one source.
   *
   * @param options.sourceId - restrict to a single source.
   * @param options.limit - maximum rows (1..2000, default 500).
   */
  listDocuments(options: { sourceId?: string; limit?: number } = {}): KnowledgeDocument[] {
    const limit = clamp(options.limit ?? 500, 1, 2_000)
    const rows = options.sourceId
      ? this.db.prepare(`
          SELECT * FROM knowledge_documents
          WHERE source_id = ?
          ORDER BY relative_path COLLATE NOCASE
          LIMIT ?
        `).all(options.sourceId, limit) as DocumentRow[]
      : this.db.prepare(`
          SELECT * FROM knowledge_documents
          ORDER BY indexed_at DESC, relative_path COLLATE NOCASE
          LIMIT ?
        `).all(limit) as DocumentRow[]
    return rows.map((row) => ({ ...mapDocument(row), links: this.documentLinks(row.id) }))
  }

  /**
   * Search indexed content: FTS match first, then trigram, then LIKE fallback.
   *
   * @param query - free-text query.
   * @param options.sourceId - restrict to a single source.
   * @param options.limit - maximum results (1..100, default 30).
   * @returns results ordered by relevance (ascending bm25 score).
   */
  search(query: string, options: { sourceId?: string; limit?: number } = {}): KnowledgeSearchResult[] {
    const normalizedQuery = query.trim()
    if (!normalizedQuery) return []
    const limit = clamp(options.limit ?? 30, 1, SEARCH_LIMIT_MAX)
    const resultMap = new Map<number, Omit<KnowledgeSearchResult, 'nodeId' | 'links'>>()

    this.searchFts('knowledge_fts', buildFtsQuery(normalizedQuery), options.sourceId, limit)
      .forEach((result) => resultMap.set(result.chunkId, result))

    if ([...normalizedQuery].length >= 3 && resultMap.size < limit) {
      this.searchFts('knowledge_fts_trigram', quoteFtsPhrase(normalizedQuery), options.sourceId, limit)
        .forEach((result) => {
          if (!resultMap.has(result.chunkId)) resultMap.set(result.chunkId, result)
        })
    }

    if (resultMap.size === 0) {
      this.searchLike(normalizedQuery, options.sourceId, limit)
        .forEach((result) => resultMap.set(result.chunkId, result))
    }

    return [...resultMap.values()]
      .sort((a, b) => a.score - b.score)
      .slice(0, limit)
      .map((result) => ({
        ...result,
        nodeId: knowledgeDocumentNodeId(result.documentId),
        links: this.documentLinks(result.documentId),
      }))
  }

  /** Aggregate counts across all sources. */
  getStats(): KnowledgeStats {
    const row = this.db.prepare(`
      SELECT
        COUNT(*) AS source_count,
        COALESCE(SUM(document_count), 0) AS document_count,
        COALESCE(SUM(chunk_count), 0) AS chunk_count,
        COALESCE(SUM(size_bytes), 0) AS size_bytes,
        COALESCE(SUM(CASE WHEN status IN ('pending', 'indexing') THEN 1 ELSE 0 END), 0) AS indexing_count
      FROM knowledge_sources
    `).get() as {
      source_count: number
      document_count: number
      chunk_count: number
      size_bytes: number
      indexing_count: number
    } | undefined
    return {
      sourceCount: row?.source_count ?? 0,
      documentCount: row?.document_count ?? 0,
      chunkCount: row?.chunk_count ?? 0,
      sizeBytes: row?.size_bytes ?? 0,
      indexingCount: row?.indexing_count ?? 0,
    }
  }

  /** Resolve once every scheduled index job has settled. Test helper only. */
  async waitForIdleForTesting(): Promise<void> {
    while (this.jobs.size > 0) {
      await Promise.all([...this.jobs.values()])
    }
  }

  /** Checkpoint and close the database. */
  close(): void {
    this.checkpoint()
    this.db.close()
  }

  private scheduleIndex(id: string): void {
    if (this.jobs.has(id)) return
    const job = this.indexSource(id)
      .catch((error) => {
        if (this.cancelled.has(id) || !this.getSource(id)) return
        const now = new Date().toISOString()
        this.db.prepare(`
          UPDATE knowledge_sources
          SET status = 'error', error = ?, updated_at = ?
          WHERE id = ?
        `).run(error instanceof Error ? error.message : String(error), now, id)
      })
      .finally(() => {
        this.jobs.delete(id)
        this.cancelled.delete(id)
      })
    this.jobs.set(id, job)
  }

  private async indexSource(id: string): Promise<void> {
    const source = this.getSource(id)
    if (!source || this.cancelled.has(id)) return
    const startedAt = new Date().toISOString()
    this.db.prepare(`
      UPDATE knowledge_sources
      SET status = 'indexing', error = NULL, updated_at = ?
      WHERE id = ?
    `).run(startedAt, id)

    let files: IndexedFile[]
    try {
      files = source.kind === 'file'
        ? [{ path: source.path, relativePath: basename(source.path) }]
        : await collectFiles(source.path)
    } catch (error) {
      throw new Error(`rin knowledge: Unable to scan source: ${error instanceof Error ? error.message : String(error)}`)
    }

    if (this.cancelled.has(id) || !this.getSource(id)) return
    const currentPaths = new Set(files.map((file) => file.path))
    const existingRows = this.db.prepare(`
      SELECT * FROM knowledge_documents WHERE source_id = ?
    `).all(id) as DocumentRow[]
    const existingByPath = new Map(existingRows.map((row) => [row.path, row]))

    for (const existing of existingRows) {
      if (!currentPaths.has(existing.path)) this.deleteDocument(existing.id)
    }

    for (const file of files) {
      if (this.cancelled.has(id) || !this.getSource(id)) return
      await this.indexFile(source, file, existingByPath.get(file.path))
    }

    if (this.cancelled.has(id) || !this.getSource(id)) return
    const counts = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM knowledge_documents WHERE source_id = ?) AS document_count,
        (SELECT COUNT(*) FROM knowledge_chunks WHERE source_id = ?) AS chunk_count,
        (SELECT COALESCE(SUM(size_bytes), 0) FROM knowledge_documents WHERE source_id = ?) AS size_bytes
    `).get(id, id, id) as {
      document_count: number
      chunk_count: number
      size_bytes: number
    } | undefined
    const now = new Date().toISOString()
    const documentCount = counts?.document_count ?? 0
    this.db.prepare(`
      UPDATE knowledge_sources
      SET status = ?, error = NULL, document_count = ?, chunk_count = ?,
          size_bytes = ?, indexed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      documentCount > 0 ? 'ready' : 'empty',
      documentCount,
      counts?.chunk_count ?? 0,
      counts?.size_bytes ?? 0,
      now,
      now,
      id,
    )
    this.checkpoint()
  }

  private async indexFile(
    source: KnowledgeSource,
    file: IndexedFile,
    existing?: DocumentRow,
  ): Promise<void> {
    let fileStat
    try {
      fileStat = await stat(file.path)
    } catch {
      if (existing) this.deleteDocument(existing.id)
      return
    }
    if (!fileStat.isFile()) return
    if (existing && existing.mtime_ms === fileStat.mtimeMs && existing.size_bytes === fileStat.size) return

    const parsed = await parseDocument(file.path, fileStat.size)
    const title = basename(file.path)
    const extension = extname(file.path).toLowerCase()
    const documentId = stableId(`${source.id}\0${file.path}`)
    const indexedAt = new Date().toISOString()
    const indexMode: KnowledgeDocumentIndexMode = source.indexContent ? parsed.mode : 'metadata'
    const contentHash = parsed.content
      ? createHash('sha256').update(parsed.content).digest('hex')
      : `${fileStat.size}:${fileStat.mtimeMs}`

    if (existing) this.deleteDocument(existing.id)
    this.db.prepare(`
      INSERT INTO knowledge_documents (
        id, source_id, path, relative_path, title, extension, index_mode,
        size_bytes, mtime_ms, content_hash, indexed_at, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      documentId,
      source.id,
      file.path,
      file.relativePath,
      title,
      extension,
      indexMode,
      fileStat.size,
      fileStat.mtimeMs,
      contentHash,
      indexedAt,
      parsed.error,
    )
    this.storeDocumentLinks(documentId, parsed.links)

    if (!source.indexContent) return

    const chunks = parsed.content
      ? chunkText(parsed.content)
      : [{ heading: '', content: `${title}\n${file.relativePath}` }]
    const insertChunk = this.db.prepare(`
      INSERT INTO knowledge_chunks (source_id, document_id, ordinal, heading, content)
      VALUES (?, ?, ?, ?, ?)
    `)
    const insertFts = this.db.prepare(`
      INSERT INTO knowledge_fts (
        rowid, chunk_id, source_id, document_id, title, path, content
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    const insertTrigram = this.db.prepare(`
      INSERT INTO knowledge_fts_trigram (
        rowid, chunk_id, source_id, document_id, title, path, content
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    chunks.forEach((chunk, index) => {
      const result = insertChunk.run(source.id, documentId, index, chunk.heading, chunk.content)
      const chunkId = Number(result.lastInsertRowid)
      const searchableContent = chunk.heading
        ? `${chunk.heading}\n${chunk.content}`
        : chunk.content
      insertFts.run(chunkId, chunkId, source.id, documentId, title, file.relativePath, searchableContent)
      insertTrigram.run(chunkId, chunkId, source.id, documentId, title, file.relativePath, searchableContent)
    })
  }

  private searchFts(
    table: 'knowledge_fts' | 'knowledge_fts_trigram',
    matchQuery: string,
    sourceId: string | undefined,
    limit: number,
  ): Omit<KnowledgeSearchResult, 'nodeId' | 'links'>[] {
    try {
      const sourceClause = sourceId ? `AND f.source_id = ?` : ''
      const sql = `
        SELECT
          CAST(f.chunk_id AS INTEGER) AS chunk_id,
          f.source_id,
          f.document_id,
          s.name AS source_name,
          f.title,
          d.path,
          snippet(${table}, 5, '<mark>', '</mark>', '…', 24) AS excerpt,
          bm25(${table}) AS score
        FROM ${table} f
        JOIN knowledge_sources s ON s.id = f.source_id
        JOIN knowledge_documents d ON d.id = f.document_id
        WHERE ${table} MATCH ? ${sourceClause}
        ORDER BY score
        LIMIT ?
      `
      const rows = sourceId
        ? this.db.prepare(sql).all(matchQuery, sourceId, limit) as Record<string, unknown>[]
        : this.db.prepare(sql).all(matchQuery, limit) as Record<string, unknown>[]
      return rows.map(mapSearchResult)
    } catch {
      return []
    }
  }

  private searchLike(query: string, sourceId: string | undefined, limit: number): Omit<KnowledgeSearchResult, 'nodeId' | 'links'>[] {
    const pattern = `%${query.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
    const sourceClause = sourceId ? 'AND c.source_id = ?' : ''
    const sql = `
      SELECT
        c.id AS chunk_id,
        c.source_id,
        c.document_id,
        s.name AS source_name,
        d.title,
        d.path,
        substr(c.content, 1, 360) AS excerpt,
        0 AS score
      FROM knowledge_chunks c
      JOIN knowledge_sources s ON s.id = c.source_id
      JOIN knowledge_documents d ON d.id = c.document_id
      WHERE (c.content LIKE ? ESCAPE '\\' OR d.title LIKE ? ESCAPE '\\' OR d.path LIKE ? ESCAPE '\\')
        ${sourceClause}
      ORDER BY d.indexed_at DESC
      LIMIT ?
    `
    const rows = sourceId
      ? this.db.prepare(sql).all(pattern, pattern, pattern, sourceId, limit) as Record<string, unknown>[]
      : this.db.prepare(sql).all(pattern, pattern, pattern, limit) as Record<string, unknown>[]
    return rows.map(mapSearchResult)
  }

  private deleteSourceIndex(sourceId: string): void {
    const documents = this.db.prepare(`
      SELECT id FROM knowledge_documents WHERE source_id = ?
    `).all(sourceId) as { id: string }[]
    for (const document of documents) this.deleteDocument(document.id)
  }

  private deleteDocument(documentId: string): void {
    const chunks = this.db.prepare(`
      SELECT id FROM knowledge_chunks WHERE document_id = ?
    `).all(documentId) as { id: number }[]
    const deleteFts = this.db.prepare('DELETE FROM knowledge_fts WHERE rowid = ?')
    const deleteTrigram = this.db.prepare('DELETE FROM knowledge_fts_trigram WHERE rowid = ?')
    for (const chunk of chunks) {
      deleteFts.run(chunk.id)
      deleteTrigram.run(chunk.id)
    }
    this.db.prepare('DELETE FROM knowledge_chunks WHERE document_id = ?').run(documentId)
    this.db.prepare('DELETE FROM knowledge_documents WHERE id = ?').run(documentId)
  }

  /** Replace one document's wikilink targets, preserving first-seen order. */
  private storeDocumentLinks(documentId: string, links: readonly string[]): void {
    this.db.prepare('DELETE FROM knowledge_document_links WHERE document_id = ?').run(documentId)
    const insert = this.db.prepare(`
      INSERT INTO knowledge_document_links (document_id, target, ordinal)
      VALUES (?, ?, ?)
    `)
    links.forEach((target, ordinal) => insert.run(documentId, target, ordinal))
  }

  /** Read one document's wikilink targets in first-seen order. */
  private documentLinks(documentId: string): string[] {
    const rows = this.db.prepare(`
      SELECT target FROM knowledge_document_links
      WHERE document_id = ?
      ORDER BY ordinal
    `).all(documentId) as { target: string }[]
    return rows.map(row => row.target)
  }

  private checkpoint(): void {
    try {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    } catch {
      // The active journal mode may not support checkpoints.
    }
  }
}

async function validateSourcePath(inputPath: string, allowedRoots: readonly string[] = []): Promise<string> {
  const resolvedPath = resolve(inputPath).normalize('NFC')
  const normalizedPath = (await realpath(resolvedPath)).normalize('NFC')
  const sourceStat = await stat(normalizedPath)
  if (!sourceStat.isFile() && !sourceStat.isDirectory()) {
    throw new Error('rin knowledge: Knowledge source must be a file or folder')
  }
  if (sourceStat.isDirectory()) {
    const homePath = (await realpath(homedir())).normalize('NFC')
    if (normalizedPath === parse(normalizedPath).root || normalizedPath === homePath) {
      throw new Error('rin knowledge: Choose a project or document folder, not the disk root or entire home folder')
    }
  }
  if (allowedRoots.length > 0 && !allowedRoots.some(root => isPathWithinRoot(normalizedPath, root))) {
    throw new Error('rin knowledge: Knowledge source is outside the allowed sources roots')
  }
  return normalizedPath
}

/** True when `child` resolves to `parent` or a path beneath it. */
function isPathWithinRoot(child: string, parent: string): boolean {
  const relation = relative(resolve(parent), resolve(child))
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation))
}

async function collectFiles(rootPath: string): Promise<IndexedFile[]> {
  const files: IndexedFile[] = []
  const queue = [rootPath]
  while (queue.length > 0 && files.length < MAX_SOURCE_FILES) {
    const directory = queue.shift()!
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      continue
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (files.length >= MAX_SOURCE_FILES) break
      if (entry.isSymbolicLink()) continue
      const entryPath = resolve(directory, entry.name).normalize('NFC')
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) queue.push(entryPath)
      } else if (entry.isFile()) {
        files.push({
          path: entryPath,
          relativePath: relative(rootPath, entryPath).normalize('NFC'),
        })
      }
    }
  }
  return files
}

async function parseDocument(filePath: string, sizeBytes: number): Promise<ParsedDocument> {
  const extension = extname(filePath).toLowerCase()
  if (sizeBytes > MAX_TEXT_FILE_BYTES) {
    return {
      mode: 'metadata',
      content: '',
      links: [],
      error: `Content was not indexed because the file is larger than ${MAX_TEXT_FILE_BYTES / 1024 / 1024} MB`,
    }
  }
  if (KNOWN_BINARY_EXTENSIONS.has(extension)) {
    return {
      mode: 'metadata',
      content: '',
      links: [],
      error: 'Binary content is represented by filename and path only',
    }
  }

  const fileBuffer = await readFile(filePath)
  const sample = fileBuffer.subarray(0, Math.min(fileBuffer.length, 8_192))
  if (sample.includes(0)) {
    return {
      mode: 'metadata',
      content: '',
      links: [],
      error: 'Binary content is represented by filename and path only',
    }
  }
  const content = fileBuffer.toString('utf8').replace(/\r\n?/g, '\n').trim()
  return {
    mode: 'text',
    content,
    links: extractWikilinkTargets(content),
    error: null,
  }
}

function chunkText(content: string): Array<{ heading: string; content: string }> {
  if (!content) return []
  const sections = splitMarkdownSections(content)
  const chunks: Array<{ heading: string; content: string }> = []
  for (const section of sections) {
    let cursor = 0
    while (cursor < section.content.length) {
      let end = Math.min(section.content.length, cursor + CHUNK_TARGET_CHARS)
      if (end < section.content.length) {
        const paragraphBoundary = section.content.lastIndexOf('\n\n', end)
        const lineBoundary = section.content.lastIndexOf('\n', end)
        const boundary = Math.max(paragraphBoundary, lineBoundary)
        if (boundary > cursor + Math.floor(CHUNK_TARGET_CHARS * 0.55)) end = boundary
      }
      const value = section.content.slice(cursor, end).trim()
      if (value) chunks.push({ heading: section.heading, content: value })
      if (end >= section.content.length) break
      cursor = Math.max(cursor + 1, end - CHUNK_OVERLAP_CHARS)
    }
  }
  return chunks
}

function splitMarkdownSections(content: string): Array<{ heading: string; content: string }> {
  const lines = content.split('\n')
  const sections: Array<{ heading: string; content: string }> = []
  let heading = ''
  let body: string[] = []
  const flush = () => {
    const value = body.join('\n').trim()
    if (value) sections.push({ heading, content: value })
    body = []
  }
  for (const line of lines) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line)
    if (match) {
      flush()
      heading = match[2]!.trim()
    } else {
      body.push(line)
    }
  }
  flush()
  return sections.length > 0 ? sections : [{ heading: '', content }]
}

function stableId(value: string): string {
  return createHash('sha256').update(value.normalize('NFC')).digest('hex').slice(0, 24)
}

function buildFtsQuery(value: string): string {
  const tokens = value.split(/\s+/).map((token) => token.trim()).filter(Boolean)
  return tokens.map((token) => `${quoteFtsPhrase(token)}*`).join(' AND ')
}

function quoteFtsPhrase(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)))
}

function mapSource(row: SourceRow): KnowledgeSource {
  return {
    id: row.id,
    path: row.path,
    name: row.name,
    kind: row.kind,
    status: row.status,
    indexContent: row.index_content !== 0,
    error: row.error,
    documentCount: row.document_count,
    chunkCount: row.chunk_count,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    indexedAt: row.indexed_at,
  }
}

function mapDocument(row: DocumentRow): Omit<KnowledgeDocument, 'links'> {
  return {
    id: row.id,
    sourceId: row.source_id,
    path: row.path,
    relativePath: row.relative_path,
    title: row.title,
    extension: row.extension,
    indexMode: row.index_mode,
    sizeBytes: row.size_bytes,
    modifiedAt: new Date(row.mtime_ms).toISOString(),
    indexedAt: row.indexed_at,
    error: row.error,
  }
}

function mapSearchResult(row: Record<string, unknown>): Omit<KnowledgeSearchResult, 'nodeId' | 'links'> {
  return {
    chunkId: Number(row.chunk_id),
    sourceId: String(row.source_id),
    documentId: String(row.document_id),
    sourceName: String(row.source_name),
    title: String(row.title),
    path: String(row.path),
    excerpt: String(row.excerpt ?? ''),
    score: Number(row.score ?? 0),
  }
}