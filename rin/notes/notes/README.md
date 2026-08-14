# @rin/notes

rin notes — a file-backed, Obsidian-style markdown note vault. It owns note
storage, parsing (wikilinks, tags, frontmatter), history snapshots, full-text
search, the wikilink graph, todo extraction, templates, and session-backup
notes. The Cordis plugin entry exposes `ctx.notes` and registers the
model-visible `notes` tool on the dsh tool seam.

Module ownership:

- `types.ts` — the pure domain model.
- `parse.ts` — wikilink / tag / frontmatter / title parsing (pure; `yaml` + `node:`).
- `vault.ts` — `NotesVault`, the pure file engine (path containment, snapshots, search, graph, todos).
- `schema.ts` — the `notes` tool's model-facing description, schemas, and result renderer.
- `index.ts` — the Cordis plugin: `NotesStore` (Service abstraction) + `FileNotesStore` + tool registration.

The only external runtime dependency is `yaml` (frontmatter parsing);
`@deepseek-ai/dsh-tools` supplies `defineTool`, `@deepseek-ai/cordis` is a
peer dependency, and `@deepseek-ai/schemastery` types the `Config` schema.

## Service API

`ctx.notes` is a `NotesStore`; the file-backed `FileNotesStore` is
registered when the plugin loads.

```ts
// ctx.notes.list()                     -> NoteMeta[]            (newest first)
// ctx.notes.read(path)                 -> NoteDocument          (meta + content)
// ctx.notes.write(path, content)       -> NoteDocument          (snapshots prior version)
// ctx.notes.delete(path)               -> void                  (removes note + .history)
// ctx.notes.search(query)              -> NoteSearchResult[]    (name/title hits > body hits)
// ctx.notes.graph()                    -> { nodes, edges }      (wikilink reverse-resolution)
// ctx.notes.todos()                    -> NoteTodo[]            (line-level checkboxes)
// ctx.notes.templates()                -> NoteTemplate[]        ({ name, path })
// ctx.notes.backupSession(title, body) -> NoteDocument          (note under backups/)
```

`Config` has one optional field, `vaultRoot` (absolute or cwd-relative); it
defaults to `~/.rin/notes` via `node:os` homedir.

Guards: every path is resolved and must remain inside the vault (traversal and
absolute paths fail loud); a single note body is capped at 4 MiB. Updates
snapshot the previous content into `.history/<path>/` and keep the latest 10
snapshots per note.

## Model Experience

### What the model sees

One tool joins prompt assembly through the dsh tools seam: `notes`, with
`action` (`list` | `search` | `read`), an optional `query` (for
`search`), and an optional `path` (for `read`). The description is
bilingual (Chinese + English). Output is `{ action, notes | results | document | error }`:

- `list` → `notes: [{ path, name, folder, title, tags, modifiedAt }]`
- `search` → `results: [{ path, title, snippet }]`, ranked with name/title hits above body hits
- `read` → `document: { path, title, tags, content }`
- recoverable failures (missing query/path, note not found) return `{ action, error }` in-band so the model can list first and retry.

The tool name, description, and parameter/output schemas are model-visible.

### Token effect

A small fixed cost: one tool schema and its description join the system
prompt. `list` result text scales with the note count; `read` returns the
full note body; `search` is bounded by the 30-result default.

### KV Cache effect

Independent beyond ordinary tool-set assembly: the schema enters the prompt
prefix and changes only when the tool set does.

## Known Limitations and Deferred Work

- **No snapshot listing/reading API.** Snapshots are retained (10 per note) and
  cleaned up on delete, but there is no `listSnapshots`/`readSnapshot`; the
  web-server `snapshots` route and the NotesPage SnapshotPanel will need it.
- **Linear search.** `search` scans every note on each call; no index. A large
  vault (thousands of notes) will be slow — an FTS index (like `@rin/knowledge`)
  is deferred.
- **Session backups share the 4 MiB cap.** Long session transcripts over 4 MiB
  are rejected; a separate backup-size budget is deferred.
- **No move/rename, template instantiation, asset storage, or checkbox
  toggling.** The old notesService's `move`, `createFromTemplate`, `daily`,
  `saveAsset`, and `setTodo` are out of scope for this milestone; callers can
  compose them from `read`/`write`/`delete`.
- **Inline tags are matched anywhere in the body**, including inside fenced code
  blocks, so a `#word` in a code sample becomes a tag.
- **No per-note backlinks API.** `graph()` returns resolved edges, but there is
  no `backlinks(path)` convenience; the UI can derive it from `graph()`.
