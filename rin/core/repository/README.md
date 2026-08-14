# @rin/repository

rin Asset Repository — the file-backed **single source of truth** for agent assets.

It owns the domain schema (`types.ts`) and the reader (`reader.ts`) for a
declarative, versioned repository of nine asset partitions: `environments`,
`agents`, `skills`, `workflows`, `tools`, `knowledge`, `policies`, `outputs`,
`bundles`. The Cordis plugin entry (`index.ts`) exposes `ctx.repository` with
a `read(rootPath)` service, and the writer (`writer.ts`) creates repositories
and writes environment package catalogs. `builtin/` ships the factory-seeded
repository (five ecosystem catalogs, three environment profiles, one starter
agent); see its README for provenance and data fixes.

## Service API

```ts
import type { Context } from '@deepseek-ai/cordis'
// ctx.repository.read(rootPath) => Promise<AssetRepository>
```

## Model Experience

### Request context and condition

#### What the model sees

None directly. This plugin contributes no model-visible prose in its current
form; it is a host-side service. Later milestones will register tools (e.g.
`repository_search`) whose schemas then join prompt assembly.

#### Token effect

Zero direct token effect.

#### KV Cache effect

Independent — no interaction with the model prefix.

## Known Limitations and Deferred Work

- **Read-only projection.** The reader parses the manifest, environment
  catalogs/profiles and agents, but does not yet project them into dsh seams
  (agent-presets, sandbox, skill, workflow). Projection lands in
  @rin/agents (agent-presets) and @rin/sandboxes (sandbox profiles).
- **Writer scope.** The writer creates skeletons and environment catalogs;
  agent/skill/workflow asset writing is owned by @rin/agents.
- **No lock/digest resolution.** `repository.lock.yaml` resolution, digest
  verification and install-plan generation are deferred.
- **YAML validation is structural only.** Full schema validation (zod/
  schemastery) is not yet applied; unknown fields pass through.
