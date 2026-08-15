/**
 * rin notes — domain model.
 *
 * Owns the values crossing the notes module seam: note metadata and documents,
 * search results, the wikilink graph, extracted todos, templates, the tool's
 * model-facing input/output, and the plugin configuration. The file-backed
 * engine owns persistence; this module owns the schema only.
 *
 * @module @rin/notes
 */

/** A wikilink resolved from note content. */
export interface NoteLink {
  /** The literal wikilink text, e.g. `[[target|alias]]`. */
  raw: string
  /** The link target (the first `[[...]]` segment), trimmed. */
  target: string
  /** Optional display alias (the second `[[...|...]]` segment). */
  alias?: string
}

/** One note's metadata, without its content. */
export interface NoteMeta {
  /** POSIX path relative to the vault root, e.g. `work/ideas.md`. */
  path: string
  /** File name without the `.md` extension. */
  name: string
  /** Parent folder as a POSIX path; `''` for the vault root. */
  folder: string
  /** First `#` heading, or the file name when absent. */
  title: string
  sizeBytes: number
  /** ISO-8601 modification timestamp. */
  modifiedAt: string
  tags: string[]
  links: NoteLink[]
}

/** A note with its full markdown content. */
export type NoteDocument = NoteMeta & { content: string }

/** One full-text search hit. */
export interface NoteSearchResult {
  path: string
  name: string
  title: string
  /** A short excerpt around the first body match. */
  snippet: string
  /** Higher scores rank first; name/title hits outrank body hits. */
  score: number
}

/** One node in the note graph. */
export interface NoteGraphNode {
  id: string
  name: string
  folder: string
  /** The note's first tag, or `null` when untagged. */
  tag: string | null
}

/** One directed wikilink edge between two notes. */
export interface NoteGraphEdge {
  from: string
  to: string
}

/** The resolved wikilink graph across the vault. */
export interface NoteGraph {
  nodes: NoteGraphNode[]
  edges: NoteGraphEdge[]
}

/** One checkbox extracted from a note body. */
export interface NoteTodo {
  notePath: string
  noteName: string
  /** 1-based line number in the note. */
  line: number
  text: string
  done: boolean
}

/** One note template under `.templates/`. */
export interface NoteTemplate {
  /** Template name without the `.md` extension. */
  name: string
  /** POSIX path relative to the vault root. */
  path: string
}

/** One history snapshot of a note. */
export interface NoteSnapshotMeta {
  /** Snapshot file name: `<epoch-millis>-<6-digit sequence>.md`. */
  id: string
  /** ISO-8601 timestamp when the snapshot was taken. */
  createdAt: string
  /** Snapshot file size in bytes (UTF-8). */
  sizeBytes: number
}

/** Plugin configuration for `@rin/notes`. */
export interface Config {
  /** Absolute or cwd-relative path to the note vault; defaults to `~/.rin/notes`. */
  vaultRoot?: string
}

/** Validated input of the `notes` tool. */
export interface NotesToolInput {
  action: 'list' | 'search' | 'read'
  /** Search keyword; required for `search`. */
  query?: string
  /** Vault-relative note path; required for `read`. */
  path?: string
}

/** One note listed by the `notes` tool's `list` action. */
export interface NotesToolNote {
  path: string
  name: string
  folder: string
  title: string
  tags: string[]
  modifiedAt: string
}

/** One hit reported by the `notes` tool's `search` action. */
export interface NotesToolSearchResult {
  path: string
  title: string
  snippet: string
}

/** One document returned by the `notes` tool's `read` action. */
export interface NotesToolDocument {
  path: string
  title: string
  tags: string[]
  content: string
}

/** Canonical output of the `notes` tool. */
export interface NotesToolOutput {
  action: 'list' | 'search' | 'read'
  notes?: NotesToolNote[]
  results?: NotesToolSearchResult[]
  document?: NotesToolDocument
  /** Recoverable failure message (missing query/path, note not found). */
  error?: string
}
