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
  NoteDocument,
  NoteGraph,
  NoteMeta,
  NoteSearchResult,
  NoteTemplate,
  NotesToolOutput,
  NoteTodo,
} from './types.ts'

export type * from './types.ts'
export {
  BACKUPS_DIRNAME,
  HISTORY_DIRNAME,
  HISTORY_KEEP,
  MAX_NOTE_BYTES,
  NotesVault,
  TEMPLATES_DIRNAME,
  assertMarkdownPath,
  assertSafeRelPath,
  defaultVaultRoot,
  resolveLinkTarget,
  resolveVaultRoot,
} from './vault.ts'
export { TAG_RE, WIKILINK_RE, extractLinks, extractTags, extractTitle, splitFrontmatter } from './parse.ts'
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

  /** List every note's metadata, newest first. */
  abstract list(): Promise<NoteMeta[]>

  /** Read one note by its POSIX vault-relative path. */
  abstract read(path: string): Promise<NoteDocument>

  /** Create or update a note, snapshotting the previous version first. */
  abstract write(path: string, content: string): Promise<NoteDocument>

  /** Delete a note and its history snapshots. */
  abstract delete(path: string): Promise<void>

  /** Full-text search across names, titles, and bodies. */
  abstract search(query: string): Promise<NoteSearchResult[]>

  /** Resolve the wikilink graph across the vault. */
  abstract graph(): Promise<NoteGraph>

  /** Extract line-level checkboxes from every note. */
  abstract todos(): Promise<NoteTodo[]>

  /** List templates under `.templates/`. */
  abstract templates(): Promise<NoteTemplate[]>

  /** Export one session as a backup note under `backups/`. */
  abstract backupSession(title: string, content: string): Promise<NoteDocument>
}

/** File-backed notes service delegating to a `NotesVault`. */
export class FileNotesStore extends NotesStore {
  private readonly vault: NotesVault

  constructor(ctx: Context, config: NotesConfig = {}) {
    super(ctx)
    this.vault = new NotesVault(resolveVaultRoot(config.vaultRoot))
  }

  override list() {
    return this.vault.list()
  }

  override read(path: string) {
    return this.vault.read(path)
  }

  override write(path: string, content: string) {
    return this.vault.write(path, content)
  }

  override delete(path: string) {
    return this.vault.delete(path)
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

  override templates() {
    return this.vault.templates()
  }

  override backupSession(title: string, content: string) {
    return this.vault.backupSession(title, content)
  }
}

export const name = 'notes'
export const inject = ['tools']

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
          results: results.map(result => ({ path: result.path, title: result.title, snippet: result.snippet })),
        }
      }
      // args.action === 'read'
      const path = args.path?.trim()
      if (!path) return { action: 'read', error: 'path is required for the read action' }
      try {
        const doc = await notes.read(path)
        return {
          action: 'read',
          document: { path: doc.path, title: doc.title, tags: doc.tags, content: doc.content },
        }
      } catch (error) {
        // A failed read is a recoverable model error: report it in-band so the
        // model can list first and retry with a real path.
        return { action: 'read', error: error instanceof Error ? error.message : String(error) }
      }
    },
  }))
}
