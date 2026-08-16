# @rin/codegraph

Per-project SQLite code graph with a web-tree-sitter indexer, exposed as ctx.codegraph.

Builds <project>/.codegraph/codegraph.db (nodes/edges/files) by parsing source files with
web-tree-sitter (pure WASM grammars bundled in grammars/), then derives ranked visualization,
Louvain communities, hub/bridge roles, and a model-facing architecture summary. The analysis
layer is ported from the legacy desktop codeGraphAnalysis (bun:sqlite → node:sqlite); the indexer
replaces the legacy native @colbymchenry/codegraph binary.

## API

- visualization(projectPath, limit) — ranked nodes/edges + architecture.
- architecture(projectPath) — architecture + formatted markdown text.
- status(projectPath) — full per-project status (state, progress, stats, error).
- enable(projectPath) / disable(projectPath) / rebuild(projectPath) — index lifecycle.
- globalStatus() / enableGlobal() / disableGlobal() — global enable flag.

## Known Limitations and Deferred Work

- Symbol extraction is a pragmatic subset (definitions + imports + same-name reference edges),
  not the full cross-language query set of the legacy native binary.
- No file watcher: the graph is a point-in-time snapshot rebuilt on demand via enable/rebuild,
  not incrementally synced as files change.
- The legacy codegraph MCP server injection and its per-session patch path are Claude-specific
  and are not ported to this host.
