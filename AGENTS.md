# AGENTS.md

rin-harness is a registry-based extension layer on the DeepSeek Harness (dsh) plugin runtime: **everything is a plugin**. The dsh base is consumed as exact `@deepseek-ai/*` registry dependencies; this checkout has no authoritative `vendor/` or upstream dsh source tree. Read [current architecture](docs/architecture/CURRENT.md), [target architecture](docs/architecture/TARGET.md), and this file before changing the repository.

## Pre-release stance: foundation over blast radius

**Remove this section at the first tagged release.** With no external consumers, prefer the correct foundation over compatibility shims: rename or repackage freely and update every reference together. Backends reject old on-disk formats. SQLite uses monotonic `SCHEMA_VERSION`; `dsh-session` keeps `SESSION_FORMAT_VERSION` at `0` with no compatibility promise.

## Repository layout

The canonical implementation lives directly under `apps/`, `packages/`, and
`tooling/`. The former `rin/` transition wrapper has been removed; do not
recreate it or treat archived references to it as live paths. Any future package
move or merge must update its manifest, project references, path aliases, tests,
gates, CI, and documentation in the same change. The current facts and the
approved architecture are maintained in [CURRENT.md](docs/architecture/CURRENT.md)
and [TARGET.md](docs/architecture/TARGET.md).

```
apps/         user-startable and distributable applications
packages/     reusable runtime, domain, feature, and integration code
tooling/      repository-only configuration, gates, scripts, and generators
docs/         current architecture, decisions, roadmap, audits, and archive
patches/      local patches applied to registry dependencies
.github/      CI workflows, issue forms, and pull request template
package.json  root scripts and selected workspace development dependencies
pnpm-workspace.yaml / pnpm-lock.yaml  workspace discovery and registry resolution
tsconfig.base.json / tsconfig.json  shared aliases and solution references
vitest.config.ts / .oxlintrc.json  root test and lint entry points
.artifacts/, node_modules/, lib/, dist/  generated artifacts; not source authority
```

The dsh source is resolved from the public registry. Do not create or edit a local vendored `vendor/` or upstream `packages/` source tree.

The documentation authority index is [docs/README.md](docs/README.md).
Current package facts are in [CURRENT.md](docs/architecture/CURRENT.md);
the approved destination is [TARGET.md](docs/architecture/TARGET.md);
seam rules are in [SEAMS.md](docs/architecture/SEAMS.md); and the active memory execution route is
[MEMORY-IMPLEMENTATION.md](docs/roadmap/MEMORY-IMPLEMENTATION.md); engineering
and release evidence is retained in [ACTIVE.md](docs/roadmap/ACTIVE.md).

## Commands

```sh
pnpm install
pnpm run start
pnpm run typecheck
pnpm run build
pnpm run test
pnpm run test:coverage
pnpm run lint
pnpm run hygiene
pnpm run smoke
pnpm run check
```

### Host sandbox failures

When required `gh`, `pnpm`, build, test, or generator commands fail because the agent sandbox blocks credentials, network, IPC, file watching, or nested `sandbox-exec`, retry unchanged with the narrowest host escalation before diagnosing authentication or project failure. Require sandbox evidence; never bypass genuine test failures or the product sandbox under test.

### Run relevant checks locally

Run checks before pushes using the relevant gates in
[ACTIVE.md](docs/roadmap/ACTIVE.md) and the root hygiene runner; report only
commands run. For registry dependency changes, also verify
`pnpm install --frozen-lockfile` when applicable.

- Match evidence to the surface: focused tests for behavior, `test` for package behavior, `hygiene` for documentation and workspace gates, `smoke` for assembled host paths, and snapshots when model-visible behavior changes.
- Never default to the full suite or repeat a passing check for commit or push. CI owns exhaustive coverage and the platform matrix; rehearse all locally only by explicit request, for CI diagnosis, or for an irreducibly repository-wide change.
- `test:coverage` is the progressive coverage gate; thresholds are stored in
  `tooling/config/coverage-thresholds.json` and consumed by the root Vitest
  configuration.

## Secrets / .env

Real-API tests and demos read `DEEPSEEK_API_KEY`, optional `DEEPSEEK_BASE_URL`,
and root `.env`. cordis.yml allows `!!js` (never `!js`) under plugin
`config` and entry `disabled`; other metadata stays literal, so conditional
composition also uses overlays. Never commit credentials. CI e2e skips without
a key; the current gate policy is documented in
[ACTIVE.md](docs/roadmap/ACTIVE.md).

## Conventions

- The dsh runtime is consumed as exact `@deepseek-ai/*` registry dependencies recorded in the root manifests and lockfile; `@rin` packages are private workspace packages under the canonical `apps/` or `packages/` layout; `@deepseek-ai/cordis` remains a peer/dev dependency where package manifests require it.
- ESM everywhere (`"type": "module"`). Use package names across packages and `.ts` in local relative imports. Config subprocesses run built `lib/` under plain Node; source regressions use their declared launcher. The `dsh` CLI source launch runs through tsx's ESM-only hook (`node --import tsx/esm`); modules it reaches must stay ESM (no CJS-only exports) — Node's native TypeScript modes are unavailable across the engines range. Raw/Web `cordis.yml` bare plugins must appear in their resolver manifest's `dependencies`; `verify-cordis-config` enforces it.
- **Registrations are effects**: every contribution goes through `ctx.effect()` / `ctx.on()`; a registry's `register()` returns the disposer.
- **Runtime invariants assert owned relationships.** Check authoritative event streams or mutable data, not service or method presence, plugin metadata or effects, or fixed pure examples. Without a plausible relationship, an explained empty companion is correct.
- **Typed events use declaration merging** and merge-extensible maps. Event JSDoc needs `@mode` and payload `@param`; scoped keys absent from payloads need `@dshScopeScan unsupported`. Public service methods document parameters and non-void returns. A `SessionEventMap` member is required-on-read by default — builds that do not know its type refuse the log unless the event carries the envelope's `ignorable: true`; only structural format changes bump `SESSION_FORMAT_VERSION`.
- **Switch on discriminant tags.** Closed unions end in `assertNever`; merge-extensible unions fall through a documented default.
- **Waterfall listeners MUST call `next()`** to delegate; returning without it short-circuits the chain.
- **Model-visible ⟺ logged**: anything that reaches a model request must be reconstructable from the session log; a new model-visible input requires a session event.
- **Plugins, not loop changes**: new behavior goes on documented extension points; changing `agent-loop` requires updating [CURRENT.md](docs/architecture/CURRENT.md) and [docs/README.md](docs/README.md).
- **A capability seam comprises Service Definition / Service Provider / Consumer roles.** It is complete, never one role; split only when roles evolve independently. The seam matrix is maintained in [SEAMS.md](docs/architecture/SEAMS.md).
- **Prefer maintained dependencies over hand-rolling** when they genuinely delete owned code and tests.
- **Explicit > implicit at package boundaries**: defaulting is an explicit `resolve(request): Spec` step in the owning implementation, never a hidden `?? default` inside `run()` (the `dsh-shell` request/spec split is the template).
- **No hardcoded tunables in plugins**: deployment-varying choices are validated `Config` fields changeable from cordis.yml; a `DEFAULT_*` constant or test hook is not configurability. Protocol constants, external specs, and security invariants stay fixed.
- **Misconfiguration fails loud** at load when self-contained, otherwise at the earliest resolvable point; never silently skip a missing referent.
- **Opaque cross-boundary ids are branded** (`Branded<B>` from `dsh-brand`), never bare `string`.
- **Trust TypeScript at typed same-process boundaries.** Do not add runtime validation, fallback behavior, or hostile-input tests solely for values the static interface requires; validate at parser/config, queued, model/tool JSON, durable/file, worker, process, and wire boundaries.
- **Source plane vs artifact plane, never mixed.** Static gates and tests resolve workspace imports through tsconfig `paths` to `src` and pass on a clean tree; gates consuming built `lib/` declare that dependency. The current package layout is documented in [CURRENT.md](docs/architecture/CURRENT.md).
- **Keep compiler faces explicit.** Each package uses one aggregate except `api/remotes`; repo-wide programs seed a face config, never the root solution.
- **An empty `catch` names what it swallows** and why nothing else can reach it; keep the `try` to one statement.
- Do not comment on facts obvious from code.
- **Prefer symmetry for parallel values**; unexplained asymmetry usually signals a missed extraction.
- **Tests describe behavior, not correctness.** Change obsolete behavior with its tests; explain why in the PR.
- **Testing policy** — [ACTIVE.md](docs/roadmap/ACTIVE.md). Every non-trivial model- or product-user-visible behavior change adds or updates a keyless snapshot through a real runnable example in the same PR; package tests, e2e-only assertions, and mock-only fixtures do not substitute for the assembled application transcript. Fixtures must replay on macOS/Linux; fix fixtures, not normalizers.
- **A tool's UI render intent is part of its design**, decided up front (`generic`/`terminal`/`diff`, `locations`); presentation methods are pure functions of `args`. Keep the implementation and its package README aligned.
- **Plan unit, e2e, and snapshot coverage** for capability seams, lifecycle paths, and transcript output; include missing snapshot-harness support in the same change.
- **Choose PR history deliberately.** Split independent changes; fix the introducing PR before propagation. Standalone PRs and official stacks may merge-forward or rebase after review. Rewrites use `--force-with-lease`, abort on remote movement, never raw `--force`; an in-progress merge-forward preserves its checkpoint before taking a newer base.
- **Labels:** one PR `kind/*`, all material `area/*`, and native Issue Type.
- TODO markers: `FIXME`/`TODO`/`XXX` by urgency; keep them searchable from this [conventions section](#conventions).
- Files end with exactly one trailing newline; `git diff --cached --check` (pre-commit) gates it.

## Defensive patterns

Read the [Defensive patterns](#defensive-patterns) section before lifecycle, concurrency, subprocess, or teardown work.

## Type safety and documentation

Everything compiles under `strict: true` with `noImplicitAny`; every remaining `any` explains why narrowing is infeasible. Every module and export has concise JSDoc for its non-obvious contract; function-like exports include `@param`/`@returns`, as enforced by `verify-export-jsdoc`. Heritage-declared members, plugin-protocol slots, and constructors keep their docs at the declaring Service Definition, protocol, or class.

Comments and docs state complete contracts and context, not reasoning transcripts. Use direct, concrete terms. Do not use metaphors. Before writing `contract`, `boundary`, or `shape`, ask whether a more exact term names the subject: write `response fields`, `JSON validation`, or `ESM exports` instead of `response shape`, `validation boundary`, or `module shape`. Keep `contract` for preconditions, postconditions, invariants, compatibility promises, and other obligations that callers, callees, implementers, providers, producers, or consumers rely on. Keep a literal process, wire, security, transaction, or lifecycle boundary. Do not narrate control flow or tests, preserve review history, or restate code. Keep behavior, failure, timing, ownership, and safe-use facts; link the rationale. Wire mechanically checkable invariants into an executed top-level gate and prove each changed acceptance path rejects an invalid case. Use narrow, justified exceptions instead of disabling a rule globally.

Docs accompany every code change: update affected README and JSDoc contracts
together. For current architecture, package README limitations, and migration
status, follow [docs/README.md](docs/README.md),
[CURRENT.md](docs/architecture/CURRENT.md), and
[ACTIVE.md](docs/roadmap/ACTIVE.md).

## Editing these instructions

`CLAUDE.md` is a compatibility entry point to the root instructions, not a
second copy. The root `AGENTS.md` is the only repository instruction authority;
edit this file and keep links to the current docs. Keep each rule self-contained
while linking high-level docs. Condense when clarity survives.

## dsh dependency policy

The dsh base is resolved from the public registry. Keep exact `@deepseek-ai/*` versions, overrides, and peer-resolution changes in the root manifests and `pnpm-lock.yaml`; verify registry installs with the relevant root gates.

`patches/` contains only explicit local patches for registry dependencies. Do not reintroduce a vendored sync tree without an explicit architecture decision.

## Rin-specific extension rules

- **Structural seams:** `systemPrompt`, `shell`, session events, and
  `toolResultPruner` seams define their minimal interfaces in `seam.ts` without
  adding dependencies. `tools`, `agentPresets`, and `skills` use their actual
  workspace dependencies (`@deepseek-ai/dsh-tools`,
  `@deepseek-ai/dsh-agent-presets`, and `@deepseek-ai/dsh-skill`) when real
  types or helpers are needed. See [SEAMS.md](docs/architecture/SEAMS.md).
- **One seam file per package:** seam registration is concentrated in
  `src/seam.ts`; `index.ts` keeps a thin `apply()` containing the plugin/store
  setup and `registerSeam(ctx, config)`. Injection, indexing, pruning, and
  other logic belong in pure modules so strip-types smoke tests can exercise
  them.
- **Known limitations:** every package README includes a
  `## Known Limitations and Deferred Work` section with at least one
  top-level `- ` bullet. The root hygiene gate enforces this requirement.
- **Gate composition:** root `hygiene` invokes `tooling/gates/runner.ts`; its
  leaf checks cover dependencies, Cordis metadata, structure/solution
  references, package READMEs, and publint. Root `smoke` invokes
  `tooling/gates/run-smokes.mjs`, which runs `*.smoke.ts` scripts serially with
  Node's strip-types mode. Vitest collects only `*.test.ts` files through
  `vitest.config.ts`.
- **Package structure:** applications use `apps/<name>/` and reusable packages
  use `packages/<role>/<name>/`. Keep `package.json`, `tsconfig.json`,
  `README.md`, `src/`, and `tests/` explicit; cross-package imports use package
  names and project references, never deep relative paths. Historical
  `rin/<group>/<name>/` references are valid only in documents under
  `docs/archive/` or in the source-to-target mapping in
  `docs/architecture/TARGET.md`.
