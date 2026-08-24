# @rin/assets

rin Asset Repository — the file-backed **single source of truth** for agent assets.

It owns the domain schema (`types.ts`) and the reader (`reader.ts`) for a
declarative, versioned repository of nine asset partitions: `environments`,
`agents`, `skills`, `workflows`, `tools`, `knowledge`, `policies`,
`outputs`, `bundles`. The Cordis plugin entry (`index.ts`) exposes
`ctx.repository` with a `read(rootPath)` service, and the writer
(`writer.ts`) creates repositories and writes environment package catalogs.
`builtin/` ships the factory-seeded repository (five ecosystem catalogs, three
environment profiles, one starter agent); see its README for provenance and
data fixes.

## Service API

```ts
import type { Context } from '@deepseek-ai/cordis'
// ctx.repository.read(rootPath) => Promise<AssetRepository>
```

The plugin also registers two model-visible tools on the dsh `tools` seam:

- `repository_search` — list assets by optional `category` (one of the nine
  roots) and free-text `query`, returning each hit's name, path, and
  description (bounded by `limit`).
- `repository_read` — read one asset's full content by `category` +
  `name` (an agent name or environment profile id), returning `frontmatter`
  plus a truncated `body`.

Configuration (optional):

```ts
interface Config {
  /** Absolute or cwd-relative repository root; defaults to builtin/. */
  repositoryRoot?: string
}
```

## Model Experience

### Request context and condition

#### What the model sees

The `repository_search` and `repository_read` tool schemas (descriptions,
parameters, output schemas) join prompt assembly. No fixed prose section is
added.

#### Token effect

Tool schema text is emitted in the prompt's tool band and is bounded,
independent of repository size. Search and read results enter context only when
the model calls the tools, bounded by `limit` (search) and `READ_MAX_CHARS`
(read).

#### KV Cache effect

Independent — no interaction with the model prefix.

## Known Limitations and Deferred Work

- **Browsing covers parsed partitions only.** The reader parses environments
  (catalogs/profiles) and agents; the other seven partitions have no schema
  yet, so `repository_search` lists only environments and agents and
  `repository_read` rejects the unparsed categories.
- **Read-only projection.** The reader parses the manifest, environment
  catalogs/profiles and agents, but other dsh seams (agent-presets, sandbox,
  skill, workflow) are still projected by their owning packages (@rin/workspace/agents,
  @rin/workspace/sandboxes).
- **Writer scope.** The writer creates skeletons and environment catalogs;
  agent/skill/workflow asset writing is owned by @rin/workspace/agents.
- **No lock/digest resolution.** `repository.lock.yaml` resolution, digest
  verification and install-plan generation are deferred.
- **YAML validation is structural only.** Full schema validation (zod/
  schemastery) is not yet applied; unknown fields pass through.
