/**
 * rin notes — the file-backed note vault engine.
 *
 * `NotesVault` is the pure implementation behind `ctx.notes`: it owns all file
 * I/O, path containment, history snapshots, parsing, search, graph resolution,
 * todo extraction, templates, and session-backup notes. It depends only on
 * `node:` builtins and the `yaml` parser (via parse.ts), so it stays
 * smoke-testable without the Cordis runtime.
 *
 * @module @rin/notes
 */

import { homedir } from 'node:os'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { extractLinks, extractTags, extractTitle } from './parse.ts'
import type {
  NoteDocument,
  NoteGraph,
  NoteGraphEdge,
  NoteGraphNode,
  NoteMeta,
  NoteSearchResult,
  NoteSnapshotMeta,
  NoteTemplate,
  NoteTodo,
} from './types.ts'

/** Directory holding retained snapshots of each overwritten or deleted note. */
export const HISTORY_DIRNAME = '.history'
/** Directory holding note templates. */
export const TEMPLATES_DIRNAME = '.templates'
/** Directory holding session-backup notes. */
export const BACKUPS_DIRNAME = 'backups'
/** Maximum byte size (UTF-8) of a single note body. */
export const MAX_NOTE_BYTES = 4 * 1024 * 1024
/** Number of snapshots retained per note before the oldest is pruned. */
export const HISTORY_KEEP = 10

/** Directories excluded from the note walk: internal plus dependency folders. */
const INTERNAL_DIRNAMES = new Set([HISTORY_DIRNAME, TEMPLATES_DIRNAME, BACKUPS_DIRNAME, 'node_modules'])

/** Monotonic per-process counter guaranteeing unique, sortable snapshot ids. */
let snapshotSequence = 0

/** Match a list-item checkbox: `- [ ]`, `- [x]`, `* [X]`, and `+` variants. */
const TODO_LINE_RE = /^\s*[-*+]\s*\[([ xX])\]\s+(.*)$/

/** Match a snapshot file name: `<epoch-millis>-<6-digit sequence>.md`. */
const SNAPSHOT_ID_RE = /^\d+-\d{6}\.md$/

/** The default note vault: `~/.rin/notes`. */
export function defaultVaultRoot(): string {
  return join(homedir(), '.rin', 'notes')
}

/**
 * Resolve the configured vault root, falling back to `~/.rin/notes`.
 *
 * @param configured - the `Config.vaultRoot` value, when set.
 * @returns the absolute vault root path.
 */
export function resolveVaultRoot(configured?: string): string {
  return configured && configured.trim() ? resolve(configured) : defaultVaultRoot()
}

/**
 * Reject a vault-relative path that names an absolute path or walks upward.
 * The caller still re-checks containment after `resolve`.
 *
 * @param relPath - the requested POSIX vault-relative path.
 */
export function assertSafeRelPath(relPath: string): void {
  if (!relPath) throw new Error('rin notes: note path is required')
  const normalized = relPath.replace(/\\/g, '/')
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`rin notes: absolute note path: ${relPath}`)
  }
  if (normalized.split('/').some(segment => segment === '..')) {
    throw new Error(`rin notes: path escapes the vault: ${relPath}`)
  }
}

/** Require a markdown file name for note reads and writes. */
export function assertMarkdownPath(relPath: string): void {
  if (!relPath.toLowerCase().endsWith('.md')) {
    throw new Error(`rin notes: note path must end with .md: ${relPath}`)
  }
}

/** Convert a platform path to POSIX form (forward slashes). */
function toPosix(p: string): string {
  return p.split(sep).join('/')
}

/** Derive a note name (file name without `.md`) from a POSIX path. */
function noteNameOf(posixPath: string): string {
  return basename(posixPath, '.md')
}

/** Derive the parent folder of a POSIX path (`''` at the root). */
function folderOf(posixPath: string): string {
  const index = posixPath.lastIndexOf('/')
  return index < 0 ? '' : posixPath.slice(0, index)
}

/** Whether an error is a missing-file (ENOENT) error. */
function isMissingPathError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

/** Derive a snapshot's ISO-8601 creation time from its file name. */
function snapshotCreatedAt(name: string): string {
  return new Date(Number(name.slice(0, name.indexOf('-')))).toISOString()
}

/** Require a snapshot file name before reading it from the history directory. */
function assertSnapshotId(snapshotId: string): void {
  if (!SNAPSHOT_ID_RE.test(snapshotId)) {
    throw new Error(`rin notes: invalid snapshot id: ${snapshotId}`)
  }
}

/** Slugify a title into a filesystem-safe name segment. */
function slugify(text: string): string {
  return text
    .replace(/[\\/:*?"<>|#\[\]]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

/**
 * Resolve a wikilink target to the note it names. Accepts `name`,
 * `folder/name`, and `path.md` forms; same-named notes prefer the shortest
 * folder, then the newest modification.
 *
 * @param target - the wikilink target text.
 * @param notes - the complete note list to resolve against.
 * @returns the resolved note, or `null` when nothing matches.
 */
export function resolveLinkTarget(target: string, notes: readonly NoteMeta[]): NoteMeta | null {
  const normalized = target.replace(/\.md$/, '').replace(/^\/+|\/+$/g, '')
  const exact = notes.find(note => note.path.replace(/\.md$/, '') === normalized)
  if (exact) return exact
  const byName = notes.filter(note => note.name === normalized)
  if (byName.length === 0) return null
  return byName.sort((a, b) =>
    a.folder.length !== b.folder.length
      ? a.folder.length - b.folder.length
      : b.modifiedAt.localeCompare(a.modifiedAt),
  )[0] ?? null
}

/** The pure file-backed markdown note vault. */
export class NotesVault {
  readonly vaultRoot: string

  /** @param vaultRoot - absolute or cwd-relative path to the vault. */
  constructor(vaultRoot: string) {
    this.vaultRoot = resolve(vaultRoot)
  }

  /** Resolve a vault-relative path, failing loud on any escape. */
  private resolveSafe(relPath: string): string {
    assertSafeRelPath(relPath)
    const abs = resolve(this.vaultRoot, relPath)
    const rel = relative(this.vaultRoot, abs)
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`rin notes: path escapes the vault: ${relPath}`)
    }
    return abs
  }

  /** The snapshot directory holding a note's retained history. */
  private historyDirFor(relPath: string): string {
    return join(this.vaultRoot, HISTORY_DIRNAME, relPath)
  }

  /** Whether a file exists at the given absolute path. */
  private async fileExists(abs: string): Promise<boolean> {
    try {
      await stat(abs)
      return true
    } catch (error) {
      if (isMissingPathError(error)) return false
      throw error
    }
  }

  /** Recursively collect markdown note files, skipping internal directories. */
  private async walkMarkdown(dir: string, out: string[]): Promise<void> {
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      if (isMissingPathError(error)) return
      throw error
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (INTERNAL_DIRNAMES.has(entry.name) || entry.name.startsWith('.')) continue
        await this.walkMarkdown(join(dir, entry.name), out)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        out.push(join(dir, entry.name))
      }
    }
  }

  /** Build a note's metadata from its absolute path and already-read content. */
  private async buildMeta(abs: string, content: string): Promise<NoteMeta> {
    const st = await stat(abs)
    const relPath = toPosix(relative(this.vaultRoot, abs))
    const name = noteNameOf(relPath)
    return {
      path: relPath,
      name,
      folder: folderOf(relPath),
      title: extractTitle(content, name),
      sizeBytes: st.size,
      modifiedAt: st.mtime.toISOString(),
      tags: extractTags(content),
      links: extractLinks(content),
    }
  }

  /** Read one note's metadata, skipping files that vanished mid-walk. */
  private async metaFor(abs: string): Promise<NoteMeta | null> {
    try {
      const content = await readFile(abs, 'utf8')
      return await this.buildMeta(abs, content)
    } catch (error) {
      if (isMissingPathError(error)) return null // raced a concurrent delete
      throw error
    }
  }

  /** Snapshot a note's current content into `.history/`, pruning past the cap. */
  private async snapshot(relPath: string): Promise<void> {
    const abs = this.resolveSafe(relPath)
    const content = await readFile(abs, 'utf8')
    const dir = this.historyDirFor(relPath)
    await mkdir(dir, { recursive: true })
    const sequence = (snapshotSequence++).toString().padStart(6, '0')
    await writeFile(join(dir, `${Date.now()}-${sequence}.md`), content, 'utf8')
    const entries = (await readdir(dir)).filter(name => name.endsWith('.md')).sort()
    while (entries.length > HISTORY_KEEP) {
      const oldest = entries.shift()
      if (oldest) await rm(join(dir, oldest), { force: true })
    }
  }

  /**
   * List every note's metadata, newest first.
   * @returns the note metadata list.
   */
  async list(): Promise<NoteMeta[]> {
    await mkdir(this.vaultRoot, { recursive: true })
    const files: string[] = []
    await this.walkMarkdown(this.vaultRoot, files)
    const metas = await Promise.all(files.map(abs => this.metaFor(abs)))
    return metas
      .filter((meta): meta is NoteMeta => meta !== null)
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
  }

  /**
   * Read one note, including its full content.
   * @param relPath - the POSIX vault-relative note path.
   * @returns the note document.
   */
  async read(relPath: string): Promise<NoteDocument> {
    assertMarkdownPath(relPath)
    const abs = this.resolveSafe(relPath)
    const content = await readFile(abs, 'utf8')
    const meta = await this.buildMeta(abs, content)
    return { ...meta, content }
  }

  /**
   * Create or update a note. Updates snapshot the previous content first.
   * @param relPath - the POSIX vault-relative note path (must end in `.md`).
   * @param content - the new markdown body (at most 4 MiB).
   * @returns the written note document.
   */
  async write(relPath: string, content: string): Promise<NoteDocument> {
    assertMarkdownPath(relPath)
    if (Buffer.byteLength(content, 'utf8') > MAX_NOTE_BYTES) {
      throw new Error('rin notes: note exceeds the 4 MiB limit')
    }
    const abs = this.resolveSafe(relPath)
    if (await this.fileExists(abs)) await this.snapshot(relPath)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, content, 'utf8')
    return this.read(relPath)
  }

  /**
   * Delete a note and all of its history snapshots.
   * @param relPath - the POSIX vault-relative note path.
   */
  async delete(relPath: string): Promise<void> {
    assertMarkdownPath(relPath)
    const abs = this.resolveSafe(relPath)
    await rm(abs, { force: true })
    await rm(this.historyDirFor(relPath), { recursive: true, force: true })
  }

  /**
   * List a note's history snapshots, newest first.
   * @param relPath - the POSIX vault-relative note path (must end in `.md`).
   * @returns the snapshot metadata list.
   */
  async listSnapshots(relPath: string): Promise<NoteSnapshotMeta[]> {
    assertMarkdownPath(relPath)
    this.resolveSafe(relPath)
    const dir = this.historyDirFor(relPath)
    let names: string[]
    try {
      names = (await readdir(dir)).filter(name => SNAPSHOT_ID_RE.test(name))
    } catch (error) {
      if (isMissingPathError(error)) return []
      throw error
    }
    const snapshots = await Promise.all(
      names.map(async id => ({
        id,
        createdAt: snapshotCreatedAt(id),
        sizeBytes: (await stat(join(dir, id))).size,
      })),
    )
    return snapshots.sort((a, b) => b.id.localeCompare(a.id))
  }

  /**
   * Read one history snapshot of a note.
   * @param relPath - the POSIX vault-relative note path (must end in `.md`).
   * @param snapshotId - the snapshot file name returned by `listSnapshots`.
   * @returns the note document as of that snapshot.
   */
  async readSnapshot(relPath: string, snapshotId: string): Promise<NoteDocument> {
    assertMarkdownPath(relPath)
    assertSnapshotId(snapshotId)
    this.resolveSafe(relPath)
    const abs = join(this.historyDirFor(relPath), snapshotId)
    const content = await readFile(abs, 'utf8')
    const st = await stat(abs)
    return {
      path: relPath,
      name: noteNameOf(relPath),
      folder: folderOf(relPath),
      title: extractTitle(content, noteNameOf(relPath)),
      sizeBytes: st.size,
      modifiedAt: snapshotCreatedAt(snapshotId),
      tags: extractTags(content),
      links: extractLinks(content),
      content,
    }
  }

  /**
   * Full-text search over names, titles, and bodies. Name and title hits
   * outrank body hits; matching is case-insensitive and snippets are truncated.
   * @param query - the search keyword.
   * @param limit - the maximum result count (default 30).
   * @returns the ranked search results.
   */
  async search(query: string, limit = 30): Promise<NoteSearchResult[]> {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const results: NoteSearchResult[] = []
    for (const meta of await this.list()) {
      const nameScore = meta.name.toLowerCase().includes(q) ? 3 : 0
      const titleScore = meta.title.toLowerCase().includes(q) ? 2 : 0
      let snippet = ''
      let contentScore = 0
      if (nameScore === 0 && titleScore === 0) {
        const content = await readFile(this.resolveSafe(meta.path), 'utf8')
        const index = content.toLowerCase().indexOf(q)
        if (index >= 0) {
          contentScore = 1
          snippet = content
            .slice(Math.max(0, index - 60), index + q.length + 60)
            .replace(/\s+/g, ' ')
            .trim()
        }
      }
      const score = nameScore + titleScore + contentScore
      if (score > 0) results.push({ path: meta.path, name: meta.name, title: meta.title, snippet, score })
    }
    return results.sort((a, b) => b.score - a.score).slice(0, limit)
  }

  /**
   * Resolve the wikilink graph: one node per note and one edge per resolved link.
   * @returns the note graph.
   */
  async graph(): Promise<NoteGraph> {
    const notes = await this.list()
    const nodes: NoteGraphNode[] = notes.map(note => ({
      id: note.path,
      name: note.name,
      folder: note.folder,
      tag: note.tags[0] ?? null,
    }))
    const edges: NoteGraphEdge[] = []
    const seen = new Set<string>()
    for (const note of notes) {
      for (const link of note.links) {
        const target = resolveLinkTarget(link.target, notes)
        if (target && target.path !== note.path) {
          const key = `${note.path}\u0000${target.path}`
          if (!seen.has(key)) {
            seen.add(key)
            edges.push({ from: note.path, to: target.path })
          }
        }
      }
    }
    return { nodes, edges }
  }

  /**
   * Extract line-level checkboxes (`[ ]` / `[x]`) from every note.
   * @returns the todos, unfinished first.
   */
  async todos(): Promise<NoteTodo[]> {
    const out: NoteTodo[] = []
    for (const meta of await this.list()) {
      const content = await readFile(this.resolveSafe(meta.path), 'utf8')
      const lines = content.split('\n')
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index]
        if (line === undefined) continue
        const match = TODO_LINE_RE.exec(line)
        if (match) {
          out.push({
            notePath: meta.path,
            noteName: meta.name,
            line: index + 1,
            text: (match[2] ?? '').trim(),
            done: (match[1] ?? ' ').toLowerCase() === 'x',
          })
        }
      }
    }
    return out.sort((a, b) => Number(a.done) - Number(b.done))
  }

  /**
   * List templates under `.templates/`.
   * @returns the template list, sorted by name.
   */
  async templates(): Promise<NoteTemplate[]> {
    const dir = join(this.vaultRoot, TEMPLATES_DIRNAME)
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch (error) {
      if (isMissingPathError(error)) return []
      throw error
    }
    return entries
      .filter(name => name.endsWith('.md'))
      .map(name => ({ name: noteNameOf(name), path: `${TEMPLATES_DIRNAME}/${name}` }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * Export one session as a backup note under `backups/`, with the title as
   * its first heading.
   * @param title - the session title (used for the heading and file name).
   * @param content - the session markdown body.
   * @returns the written backup note document.
   */
  async backupSession(title: string, content: string): Promise<NoteDocument> {
    const heading = title.trim()
    const slug = slugify(heading) || 'session'
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const relPath = `${BACKUPS_DIRNAME}/${stamp}-${slug}.md`
    const body = heading ? `# ${heading}\n\n${content}` : content
    return this.write(relPath, body)
  }
}
