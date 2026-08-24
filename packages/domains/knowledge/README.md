# @rin/knowledge

The knowledge domain contains two independently mounted Cordis entries:

- `@rin/knowledge` owns local source registration, incremental indexing,
  SQLite persistence, full-text search, and the `knowledge_search` and
  `knowledge_stats` tools.
- `@rin/knowledge/graph` builds a read-only unified graph projection over
  notes, knowledge documents, repository assets, codegraph entities, sessions,
  and filesystem roots.

Implementation and detailed contracts remain separated under `src/knowledge/`
and `src/graph/`; the graph never writes back to its providers.

## Known Limitations and Deferred Work

- Content indexing is text-only; binary and oversized files are metadata-only.
- Graph refresh replaces each provider projection rather than updating it
  incrementally.
- The filesystem projection is one level deep and session-to-note relations use
  title matching.
