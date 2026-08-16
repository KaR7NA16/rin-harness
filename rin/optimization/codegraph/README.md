# @rin/codegraph

SQLite code-graph visualization and architecture analysis exposed as ctx.codegraph.

Reads a per-project graph (<project>/.codegraph/codegraph.db) with nodes/edges/files tables
and derives ranked visualization, Louvain communities, hub/bridge roles, and a model-facing
architecture summary. Ported from cyberpsychosis codeGraphAnalysis (bun:sqlite → node:sqlite).

## API

- visualization(projectPath, limit) — ranked nodes/edges + architecture.
- architecture(projectPath) — architecture + formatted markdown text.
- status(projectPath) — file/node/edge counts and state.

## Known Limitations and Deferred Work

- The tree-sitter indexer that BUILDS the graph is not ported; this package only reads an
  existing graph. Building the graph requires a separate web-tree-sitter indexer.
