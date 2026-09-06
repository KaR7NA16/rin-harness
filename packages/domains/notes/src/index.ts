/**
 * rin notes — Cordis plugin entry.
 *
 * Exposes a `ctx.notes` service over a file-backed Obsidian-style markdown
 * vault and registers the `notes` tool on the dsh tool seam. Session backup
 * is merged here: a session exports as a markdown note under `backups/`.
 *
 * @module @rin/notes
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { NotesVault, resolveVaultRoot } from './vault.ts'
import {
  NOTES_TOOL_DESCRIPTION,
  NOTES_TOOL_NAME,
  notesToolParameters,
  notesToolOutputSchema,
  renderNotesResult,
} from './schema.ts'
import type { Config as NotesConfig } from './types.ts'
import type {
  NoteAsset,
  NoteAssetRef,
  NoteDocument,
  NoteGraph,
  NoteMeta,
  NoteQueryResult,
  NoteSearchResult,
  NoteSnapshotMeta,
  NoteTemplate,
  NotesToolOutput,
  NoteTodo,
} from './types.ts'

export type * from './types.ts'
export {
  ASSETS_DIRNAME,
  ASSET_URL_PREFIX,
  BACKUPS_DIRNAME,
  HISTORY_DIRNAME,
  HISTORY_KEEP,
  MAX_NOTE_BYTES,
  NotesVault,
  TEMPLATES_DIRNAME,
  assertAssetPath,
  assertMarkdownPath,
  assertSafeRelPath,
  defaultVaultRoot,
  resolveLinkTarget,
  resolveVaultRoot,
} from './vault.ts'
export { TAG_RE, TRANSCLUSION_RE, WIKILINK_RE, extractInlineFields, extractLinks, extractTags, extractTaskFields, extractTitle, extractTransclusions, normalizeDateValue, parseWikilinkTarget, replaceInlineTagOutsideCode, splitFrontmatter } from './parse.ts'
export type { NoteTaskFields, WikilinkTarget } from './parse.ts'
export { evaluateNoteQuery, evaluateTaskQuery, parseQuery } from './query.ts'
export type { NoteQueryRow, ParsedQuery, QueryCondition, QueryMode, QueryOperator, QuerySortField, QuerySource, TaskQueryRow } from './query.ts'
export { NotesIndex, ensureNotesIndexSchema, NOTES_INDEX_DIRNAME, NOTES_INDEX_FILENAME } from './notes-index.ts'
export type { IndexedNote, NoteBacklink, NoteBlock, NoteHeading } from './notes-index.ts'
export {
  NOTES_TOOL_DESCRIPTION,
  NOTES_TOOL_NAME,
  notesToolOutputSchema,
  notesToolParameters,
  renderNotesResult,
} from './schema.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    notes: NotesStore
  }
}

/** The notes service exposed on the shared context. */
export abstract class NotesStore extends Service {
  constructor(ctx: Context) {
    super(ctx, 'notes')
  }

  /** Absolute path to the vault root owned by this service. */
  abstract vaultRoot(): string

  /** List every note's metadata, newest first. */
  abstract list(): Promise<NoteMeta[]>

  /** Read one note by its POSIX vault-relative path. */
  abstract read(path: string): Promise<NoteDocument>

  /** Read one note's YAML frontmatter properties. */
  abstract properties(path: string): Promise<Record<string, unknown> | null>

  /** Replace one note's YAML frontmatter properties. */
  abstract updateProperties(path: string, properties: Record<string, unknown>): Promise<NoteDocument>

  /** Rename one tag across note frontmatter and inline tags. */
  abstract renameTag(from: string, to: string): Promise<{ renamed: number; paths: string[] }>

  /** Create or update a note, snapshotting the previous version first. */
  abstract write(path: string, content: string): Promise<NoteDocument>

  /** Delete a note and its history snapshots. */
  abstract delete(path: string): Promise<void>

  /** List a note's history snapshots, newest first. */
  abstract listSnapshots(path: string): Promise<NoteSnapshotMeta[]>

  /** Read one history snapshot of a note by its snapshot id. */
  abstract readSnapshot(path: string, snapshotId: string): Promise<NoteDocument>

  /** Full-text search across names, titles, and bodies. */
  abstract search(query: string): Promise<NoteSearchResult[]>

  /** Resolve the wikilink graph across the vault. */
  abstract graph(): Promise<NoteGraph>

  /** Extract line-level checkboxes from every note. */
  abstract todos(): Promise<NoteTodo[]>

  /** Execute a live query (Dataview/Tasks subset) over notes or tasks. */
  abstract query(dsl: string): Promise<NoteQueryResult>

  /** List templates under `.templates/`. */
  abstract templates(): Promise<NoteTemplate[]>

  /** Export one session as a backup note under `backups/`. */
  abstract backupSession(title: string, content: string): Promise<NoteDocument>

  /**
   * Store one binary attachment under `assets/`.
   * @param fileName - the original file name; sanitized before writing.
   * @param content - the attachment bytes.
   * @returns the vault path and web URL of the stored asset.
   */
  abstract saveAsset(fileName: string, content: Buffer): Promise<NoteAssetRef>

  /**
   * Read one stored asset with its extension-derived mime type.
   * @param path - the POSIX vault-relative asset path (under `assets/`).
   * @returns the asset bytes and mime type.
   */
  abstract readAsset(path: string): Promise<NoteAsset>
}

/** File-backed notes service delegating to a `NotesVault`. */
export class FileNotesStore extends NotesStore {
  private readonly vault: NotesVault
  private readonly vaultPath: string

  constructor(ctx: Context, config: NotesConfig = {}) {
    super(ctx)
    this.vaultPath = resolveVaultRoot(config.vaultRoot)
    this.vault = new NotesVault(this.vaultPath)
  }

  override vaultRoot() {
    return this.vaultPath
  }

  override list() {
    return this.vault.list()
  }

  override read(path: string) {
    return this.vault.read(path)
  }

  override properties(path: string) {
    return this.vault.properties(path)
  }

  override async updateProperties(path: string, properties: Record<string, unknown>) {
    return this.vault.updateProperties(path, properties)
  }

  override async renameTag(from: string, to: string) {
    return this.vault.renameTag(from, to)
  }

  override async write(path: string, content: string) {
    return this.vault.write(path, content)
  }

  override async delete(path: string) {
    await this.vault.delete(path)
  }

  override listSnapshots(path: string) {
    return this.vault.listSnapshots(path)
  }

  override readSnapshot(path: string, snapshotId: string) {
    return this.vault.readSnapshot(path, snapshotId)
  }

  override search(query: string) {
    return this.vault.search(query)
  }

  override graph() {
    return this.vault.graph()
  }

  override todos() {
    return this.vault.todos()
  }

  override query(dsl: string) {
    return this.vault.query(dsl)
  }

  override templates() {
    return this.vault.templates()
  }

  override async backupSession(title: string, content: string) {
    return this.vault.backupSession(title, content)
  }

  override saveAsset(fileName: string, content: Buffer) {
    return this.vault.saveAsset(fileName, content)
  }

  override readAsset(path: string) {
    return this.vault.readAsset(path)
  }
}

export const name = 'notes'
export const inject = ['tools']

/** Stable knowledge-graph node id for a note (mirrored by @rin/knowledge/graph). */
export function noteNodeId(path: string): string {
  return `note:${path}`
}

/** Plugin configuration: an optional vault root (defaults to `~/.rin/notes`). */
export const Config: z<NotesConfig> = z.object({
  vaultRoot: z.string(),
})

/**
 * Install the file-backed notes service and register the `notes` tool.
 * @param ctx - the plugin context (must inject `tools`).
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: NotesConfig): void {
  ctx.plugin(FileNotesStore, config)
  ctx.tools.register(defineTool({
    name: NOTES_TOOL_NAME,
    description: NOTES_TOOL_DESCRIPTION,
    parameters: notesToolParameters,
    output: {
      schema: notesToolOutputSchema,
      render: (_args, value) => [{ type: 'text', text: renderNotesResult(value as NotesToolOutput) }],
    },
    isConcurrencySafe: () => true,
    execute: async (args): Promise<NotesToolOutput> => {
      const notes = ctx.notes
      if (args.action === 'list') {
        const list = await notes.list()
        return {
          action: 'list',
          notes: list.map(note => ({
            path: note.path,
            nodeId: noteNodeId(note.path),
            name: note.name,
            folder: note.folder,
            title: note.title,
            tags: note.tags,
            modifiedAt: note.modifiedAt,
          })),
        }
      }
      if (args.action === 'search') {
        const query = args.query?.trim()
        if (!query) return { action: 'search', error: 'query is required for the search action' }
        const results = await notes.search(query)
        return {
          action: 'search',
          results: results.map(result => ({
            path: result.path,
            nodeId: noteNodeId(result.path),
            title: result.title,
            snippet: result.snippet,
          })),
        }
      }
      if (args.action === 'query') {
        const dsl = args.query?.trim()
        if (!dsl) return { action: 'query', error: 'query DSL is required for the query action' }
        const result = await notes.query(dsl)
        if (result.kind === 'tasks') {
          return {
            action: 'query',
            query: dsl,
            queryTasks: result.tasks.map(task => ({
              notePath: task.notePath,
              noteName: task.noteName,
              line: task.line,
              text: task.text,
              done: task.done,
              ...(task.due ? { due: task.due } : {}),
              priority: task.priority,
            })),
          }
        }
        return {
          action: 'query',
          query: dsl,
          queryNotes: result.notes.map(note => ({
            path: note.path,
            name: note.name,
            folder: note.folder,
            title: note.title,
            fields: note.fields,
            modifiedAt: note.modifiedAt,
          })),
        }
      }
      // args.action === 'read'
      const path = args.path?.trim()
      if (!path) return { action: 'read', error: 'path is required for the read action' }
      try {
        const doc = await notes.read(path)
        return {
          action: 'read',
          document: {
            path: doc.path,
            nodeId: noteNodeId(doc.path),
            title: doc.title,
            tags: doc.tags,
            links: doc.links.map(link => link.target),
            content: doc.content,
          },
        }
      } catch (error) {
        // A failed read is a recoverable model error: report it in-band so the
        // model can list first and retry with a real path.
        return { action: 'read', error: error instanceof Error ? error.message : String(error) }
      }
    },
  }))
}
