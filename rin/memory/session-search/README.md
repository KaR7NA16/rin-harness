# @rin/session-search

rin session-search — the host plugin that owns the derived, disposable SQLite
full-text search index over historical sessions, transcripts, history logs, and
project memories.

It owns the domain schema (`types.ts`), the SQLite lifecycle and schema
(`db.ts`), index path derivation (`paths.ts`), the deterministic context tag
(`contextTag.ts`), transcript parsing (`transcript.ts`), history projection
(`history.ts`), project-memory derivation (`projectMemory.ts`), index
maintenance (`indexStore.ts`), query semantics (`query.ts`), and the Cordis
plugin entry (`index.ts`) exposing `ctx.sessionSearch`. The package also
re-exports every standalone core function for product-independent use.

The index is derived data: source session JSONL, history, Prompt Memory, and
project-memory Markdown remain owned outside this package, so deleting or
rebuilding the index never deletes those sources. Session rows, message rows,
derived project memories, indexed-file metadata, and their FTS projections are
updated or removed through package-owned transactions.

## Service API

```ts
import type { Context } from '@deepseek-ai/cordis'
// The plugin opens the index at `configRoot/indexes/session-search.db`.
// ctx.sessionSearch.browse({ limit, project, currentSessionId }) => Promise<SessionBrowseResult>
// ctx.sessionSearch.discover({ query, limit, project, currentSessionId, roleFilter }) => Promise<SessionDiscoverResult>
// ctx.sessionSearch.read({ sessionId, projectPath, head, tail }) => Promise<SessionReadResult | null>
// ctx.sessionSearch.scroll({ sessionId, aroundMessageId, projectPath, window }) => Promise<SessionScrollResult | null>
// ctx.sessionSearch.search({ query, sessionId, aroundMessageId, ... }) => Promise<SessionSearchResult | null>
// ctx.sessionSearch.writeSession(parsed, { homeDir }) => void
// ctx.sessionSearch.writeProjectMemoryFile(params) => boolean
// ctx.sessionSearch.deleteSessionByKey(key) => void
// ctx.sessionSearch.deleteSessions({ sessionId, projectPath }) => void
// ctx.sessionSearch.reconcileFiles(liveFilePaths, projectPath?) => void
// ctx.sessionSearch.searchProjectMemories({ query, limit, ... }) => ProjectMemoryEntry[]
```

The SQLite driver is Node's built-in `node:sqlite` (`DatabaseSync`), so the
package has zero runtime dependencies beyond the `@deepseek-ai/cordis` peer.

## Model Experience

### What the model sees

None directly. This plugin contributes no model-visible prose in its current
form; it is a host-side service. Later milestones will register tools (e.g.
`session_search`) whose schemas then join prompt assembly.

### Token effect

Zero direct token effect.

### KV Cache effect

Independent — no interaction with the model prefix.

## Known Limitations and Deferred Work

- **Index-only.** The plugin maintains the derived search index and its query
  surface but does not yet project it into dsh tool seams. Tool registration
  and prompt assembly are the next milestone.
- **Runtime injection is the caller's job.** Source discovery (scanning session
  JSONL, history logs, and memory files) and path normalization live outside
  this package; the runtime must call `writeSession`/`writeProjectMemoryFile`
  and `reconcileFiles` with the values it owns.
- **`node:sqlite` returns `undefined`, not `null`, for missing rows.** The
  port preserves the original behavior contract through truthiness checks and
  explicit `?? null` normalization at the few functions whose return type
  declares `| null`.
