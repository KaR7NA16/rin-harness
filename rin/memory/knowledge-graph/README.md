# @rin/knowledge-graph

Read-only unified graph projection over rin's local knowledge entities.

The service owns a SQLite projection database and refreshes it from registered
providers on demand. It does not write back to notes, knowledge, repository,
codegraph, or filesystem stores.

## API

- `ctx.knowledgeGraph.graph(options?)` — replace stale provider projections and return nodes/edges.
- `ctx.knowledgeGraph.related(nodeId, depth?)` — return one node's neighborhood.

## Model Experience

Two tools join prompt assembly through the dsh tools seam:

- `atlas_search` — parameters `query` (required), `sources`, `kinds`, `limit`
  (default 10, capped 30). Returns matching entities (label/path/id match)
  with their matched graph neighbors.
- `atlas_graph` — parameters `node` (required), `depth` (default 1, capped 3).
  Returns one node and its neighborhood with edge kinds.

The tool logic lives in `tools.ts` (pure functions) so the strip-types smoke
test can run it without the Cordis/dsh-tools import graph.

## Config

- `dbPath` — projection database path (default `~/.rin/knowledge-graph.db`).
- `knowledgeDbPath` — knowledge database to project from.
- `repositoryRoot` — asset repository root the repository provider reads; absent
  skips the provider. Code-graph candidates are the configured repository root
  plus every connected repository root.
- `filesystemRoots` — filesystem roots the filesystem provider browses one
  level deep; empty skips the provider.

## Providers

- `notes` — note, tag, wikilink, and tag edges from @rin/notes.
- `knowledge` — source and document entities from @rin/knowledge, plus `cites`
  edges when a document's wikilink resolves to a note.
- `repository` — agent, environment, and package nodes from the asset
  repository, with `uses` (agent → environment), `contains`
  (environment → package), and `depends_on` (package → package) edges.
- `codegraph` — `code_file` and `code_symbol` nodes from each indexed project's
  code graph, with `defined_in` (symbol → file) and `code_ref` (symbol → symbol)
  edges, plus low-confidence `mentions` edges when a note wikilink names a code
  symbol or file.
- `session` — `session` nodes from session-search's recent sessions, with
  `derived_from` edges from session-backup notes (`backups/*.md`) whose title
  matches a session title.
- `filesystem` — `file` nodes from each configured `filesystemRoots` root
  (browsed one level deep), with `child` edges from the root to its entries.

## Known Limitations and Deferred Work

- The filesystem provider browses only one level deep per root, so it projects
  the immediate children of `filesystemRoots` rather than a recursive tree.
- Repository nodes cover agents, environments, and packages only; skills,
  workflows, and tools roots are not yet parsed into the graph.
- Code-graph projection requires an indexed project (`.codegraph` database);
  projects without one are skipped silently.
- Session projection covers the most recent sessions; the `derived_from`
  relation is title-matched, so a renamed backup note loses its edge.
- Graph refresh is full-provider replacement, not incremental.
