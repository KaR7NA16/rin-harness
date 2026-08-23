# @rin/notes

rin notes — a file-backed, Obsidian-style markdown note vault. It owns note
storage, parsing (wikilinks, tags, frontmatter), history snapshots, full-text
search, the wikilink graph, todo extraction, templates, and session-backup
notes. The Cordis plugin entry exposes `ctx.notes` and registers the
model-visible `notes` tool on the dsh tool seam.

Module ownership:

- `types.ts` — the pure domain model.
- `parse.ts` — wikilink / tag / frontmatter / title / inline-field / task-field parsing (pure; `yaml` + `node:`).
- `query.ts` — the live-query DSL parser and evaluator (Dataview/Tasks subset; pure).
- `vault.ts` — `NotesVault`, the pure file engine (path containment, snapshots, search, graph, todos, query).
- `schema.ts` — the `notes` tool's model-facing description, schemas, and result renderer.
- `index.ts` — the Cordis plugin: `NotesStore` (Service abstraction) + `FileNotesStore` + tool registration.

The only external runtime dependency is `yaml` (frontmatter parsing);
`@deepseek-ai/dsh-tools` supplies `defineTool`, `@deepseek-ai/cordis` is a
peer dependency, and `@deepseek-ai/schemastery` types the `Config` schema.
`@rin/memory` records each model-visible note as a provenance-aware projection.

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
// ctx.notes.todos()                    -> NoteTodo[]            (line-level checkboxes + task fields)
// ctx.notes.query(dsl)                 -> NoteQueryResult       (live query: notes or tasks)
// ctx.notes.templates()                -> NoteTemplate[]        ({ name, path })
// ctx.notes.backupSession(title, body) -> NoteDocument          (note under backups/)
// ctx.notes.saveAsset(fileName, buf)   -> NoteAssetRef          ({ path, url } under assets/)
// ctx.notes.readAsset(path)            -> NoteAsset             ({ content, mimeType })
```

`Config` has one optional field, `vaultRoot` (absolute or cwd-relative); it
defaults to `~/.rin/notes` via `node:os` homedir.
## Canonical memory projection

When `ctx.memory` is composed, note writes, property updates, tag renames,
session-backup notes, and deletes update the canonical `notes` projection.
The Markdown vault remains the editable source of truth; the memory catalog
stores identity, version, source URI, and lifecycle state rather than replacing
the vault or copying its search index.


Guards: every path is resolved and must remain inside the vault (traversal and
absolute paths fail loud); a single note body is capped at 4 MiB. Updates
snapshot the previous content into `.history/<path>/` and keep the latest 10
snapshots per note. Assets live under `assets/` with sanitized, timestamped
file names; `saveAsset` returns the vault path (for markdown references) and
the `/api/notes/assets/...` URL. PDF assets are served inline as
`application/pdf` so the web-ui can preview them with the native browser
viewer.

## Model Experience

### What the model sees

One tool joins prompt assembly through the dsh tools seam: `notes`, with
`action` (`list` | `search` | `read` | `query`), an optional `query` (a
search keyword or the live-query DSL), and an optional `path` (for `read`).
The description is bilingual (Chinese + English). Output is
`{ action, notes | results | document | queryNotes | queryTasks | error }`:

- `list` → `notes: [{ path, name, folder, title, tags, modifiedAt }]`
- `search` → `results: [{ path, title, snippet }]`, ranked with name/title hits above body hits
- `read` → `document: { path, title, tags, content }`
- `query` → `queryNotes: [{ path, title, fields, ... }]` or
  `queryTasks: [{ notePath, text, done, due, priority, ... }]`; the DSL is a
  Dataview/Tasks subset — `FROM #tag | "folder"`, `WHERE field op value AND ...`,
  `SORT field ASC|DESC`, and the `TASKS` keyword.
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

- **Live-query DSL is a minimal subset.** `WHERE` supports `=`, `!=`, `<`,
  `<=`, `>`, `>=`, and `contains` over inline fields plus built-in fields
  (path/name/folder/title/tags/done/due/start/scheduled/recurrence/priority);
  `date(today)` resolves to the current date. Dataview expression functions,
  `GROUP BY`, `FLATTEN`, and multi-field inline values are deferred.
- **Inline fields are one per line** (`key:: value` takes the rest of the
  line); multiple fields on one line and `[key:: value]` list syntax are
  deferred.
- **Session backups share the 4 MiB cap.** Long session transcripts over 4 MiB
  are rejected; a separate backup-size budget is deferred.
- **No dedicated service methods for move/template/daily/checkbox toggle.**
  The `NotesStore` API keeps `move` / `createFromTemplate` / `daily` /
  `setTodo` out of scope; the web-server legacy routes already compose
  `move` / `from-template` / `daily` from `read`/`write`/`delete`, and the
  web-ui Notes page drives them. Formalizing the service methods is deferred
  (see `rin/DEFERRED-ITEMS.md` §A2).
- **Inline tags are matched anywhere in the body**, including inside fenced code
  blocks, so a `#word` in a code sample becomes a tag.
- **Task dates use Obsidian Tasks emoji syntax only** (`📅`/`🛫`/`⏳`/`🔁`
  plus the five priority emoji); inline `key:: due` fields are separate.
