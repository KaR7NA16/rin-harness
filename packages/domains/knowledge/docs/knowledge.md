# @rin/knowledge

rin knowledge — local knowledge base. It owns local knowledge-source
registration, incremental indexing, SQLite persistence, and full-text search.

It owns the domain model (`types.ts`), the default storage location
(`paths.ts`), the SQLite adapter and schema (`db.ts`), and the
indexing/search behavior (`service.ts`). The Cordis plugin entry
(`index.ts`) exposes `ctx.knowledge` with an `open(dbPath)` service that
returns a `KnowledgeService`, and registers the model-visible
`knowledge_search` and `knowledge_stats` tools over that service. The
pure tool logic lives in `tools.ts` so the strip-types smoke test can run it
without the Cordis/dsh-tools import graph.

The database runs on Node's built-in `node:sqlite` (FTS5 with trigram
tokenizer); the workspace runtime dependencies are `@deepseek-ai/dsh-tools`
for tool registration.
`@rin/memory` supplies provenance-aware canonical projection writes.

## Service API

```ts
import type { Context } from '@deepseek-ai/cordis'
// const service = ctx.knowledge.open(dbPath)
// await service.addSources(['/path/to/notes'], { waitForIndex: true })
// await service.addSources(['~/.rin/notes'], { waitForIndex: true, indexContent: false })
// service.search('query')         // KnowledgeSearchResult[] (each has nodeId + links)
// service.listSources()           // KnowledgeSource[] (each has indexContent)
// service.listDocuments()         // KnowledgeDocument[] (each has links)
// service.getStats()              // KnowledgeStats
```

## Entity projection

Markdown documents are projected into graph-navigable entities during
indexing: wikilink targets (`[[target]]`) are extracted into `links` (on both
`KnowledgeDocument` and `KnowledgeSearchResult`), and search results carry a
stable `nodeId` (`knowledge_document:<id>`). The stable node-id vocabulary —
`knowledge_source:<id>` and `knowledge_document:<id>` — lives in `entities.ts`
(`knowledgeSourceNodeId` / `knowledgeDocumentNodeId`). A source registered with
`indexContent: false` (e.g. the Notes Vault) skips full-text content while
still extracting links for graph projection.

The plugin's `Config` offers two optional fields: `dbPath` (an explicit
database path) and `configHome` (a home used to derive the default path via
`getKnowledgeDbPath()`). `dbPath` wins when both are set. When neither is
set, the tools report a clear error instead of opening nothing. The service
itself never imports application configuration.

## Model Experience

### What the model sees

Two tools join prompt assembly through the dsh tools seam:

- `knowledge_search` — parameters `query` (required), `limit` (optional,
  default 10, capped at 50), `sourceId` (optional). Returns
  `{ results: [{ path, title, snippet, score }] }` ordered by relevance, or
  `{ error }` when the base is empty or the service is unavailable.
- `knowledge_stats` — no parameters. Returns
  `{ stats: { sourceCount, documentCount, chunkCount, sizeBytes } }`, or
  `{ error }` when the service is unavailable.

The tool names, descriptions, and parameter schemas are model-visible.

### Token effect

A small fixed cost: the two tool schemas and their descriptions join the
system prompt. Result text scales with the result count and is bounded by the
50-result cap.

### KV Cache effect

Independent beyond the ordinary tool-set assembly: the schemas enter the
prompt prefix and change only when the tool set does.

## Known Limitations and Deferred Work

- **Text-only content indexing.** Binary and oversized files are indexed by
  filename and path only (`metadata` mode); no PDF/office extraction.
- **Single-process SQLite.** The database is opened per `KnowledgeService`;
  cross-process coordination (locks, shared config home) is deferred.
- **Per-call database open.** Each tool call opens a fresh `KnowledgeService`
  and closes it afterwards (mirroring the web-server routes); a long-lived
  handle is deferred.
- **No implicit default location.** When `dbPath` is unset the tools derive
  the path from `configHome`; the host must inject one of the two via
  cordis.yml.
