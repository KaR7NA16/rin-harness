# @rin/knowledge

rin knowledge — the host-side knowledge base. It owns local knowledge-source
registration, incremental indexing, SQLite persistence, and full-text search.

It owns the domain model (`types.ts`), the default storage location
(`paths.ts`), the SQLite adapter and schema (`db.ts`), and the
indexing/search behavior (`service.ts`). The Cordis plugin entry
(`index.ts`) exposes `ctx.knowledge` with an `open(dbPath)` service that
returns a `KnowledgeService`.

The database runs on Node's built-in `node:sqlite` (FTS5 with trigram
tokenizer), so this package has zero external runtime dependencies.

## Service API

```ts
import type { Context } from '@deepseek-ai/cordis'
// const service = ctx.knowledge.open(dbPath)
// await service.addSources(['/path/to/notes'], { waitForIndex: true })
// service.search('query')         // KnowledgeSearchResult[]
// service.listSources()           // KnowledgeSource[]
// service.listDocuments()         // KnowledgeDocument[]
// service.getStats()              // KnowledgeStats
```

The host resolves its configuration home and injects the resulting database
path via `getKnowledgeDbPath(configHome)`. The service never imports
application configuration.

## Model Experience

### What the model sees

None directly. This plugin contributes no model-visible prose in its current
form; it is a host-side service. Later milestones will register tools (e.g.
`knowledge_search`) whose schemas then join prompt assembly.

### Token effect

Zero direct token effect.

### KV Cache effect

Independent — no interaction with the model prefix.

## Known Limitations and Deferred Work

- **No tool registration.** The service is host-side only; a
  `knowledge_search` tool and its prompt-assembly wiring are the next
  milestone.
- **Text-only content indexing.** Binary and oversized files are indexed by
  filename and path only (`metadata` mode); no PDF/office extraction.
- **Single-process SQLite.** The database is opened per `KnowledgeService`;
  cross-process coordination (locks, shared config home) is deferred.
