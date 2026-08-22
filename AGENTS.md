# AGENTS.md

rin-harness is a registry-based extension layer on the DeepSeek Harness (dsh) plugin runtime: **everything is a plugin**. The dsh base is consumed as exact `@deepseek-ai/*` registry dependencies; this checkout has no authoritative `vendor/` or upstream `packages/` tree. Read [rin/README.md](rin/README.md) and [rin/AGENTS.md](rin/AGENTS.md) before changing `rin/`; the nested file supplies rin-specific constraints.

## Pre-release stance: foundation over blast radius

**Remove this section at the first tagged release.** With no external consumers, prefer the correct foundation over compatibility shims: rename or repackage freely and update every reference together. Backends reject old on-disk formats. SQLite uses monotonic `SCHEMA_VERSION`; `dsh-session` keeps `SESSION_FORMAT_VERSION` at `0` with no compatibility promise.

## Repository layout

```
rin/          project-owned `@rin/*` workspace packages at `rin/<group>/<name>/`
  core/       repository, environment, filesystem, session-backup
  workspace/  agents, plugins, sandboxes
  memory/     knowledge, knowledge-graph, prompt-memory, session-search, skill-memory
  notes/      notes and session-backup projections
  optimization/ token-optimization, smart-pruning, codegraph
  learning/   evolution
  capability/ brief, review
  automation/ agent-migration, computer-use, mcp, mcp-client, provider-probe, tasks
  collaboration/ teams
  web/        web-server, web-ui
  gui/        Tauri desktop shell
  cli/        rin launcher
  bundle/     dsh-base plus the assembled @rin host plugins
patches/      local patches applied to registry dependencies
.github/      CI workflows, including the rin gates
package.json  root scripts and selected workspace development dependencies
pnpm-workspace.yaml / pnpm-lock.yaml  workspace discovery and registry resolution
tsconfig.base.json / rin/tsconfig.json  TypeScript paths and rin project references
node_modules/, package lib/, coverage/  generated artifacts; not source authority
```

The dsh source is resolved from the public registry. Do not create or edit a local vendored `vendor/` or upstream `packages/` source tree.

@rin group semantics and package-level constraints are documented in [rin/README.md](rin/README.md) and [rin/AGENTS.md](rin/AGENTS.md).

## Commands

```sh
pnpm install
pnpm run rin
pnpm run rin:typecheck
pnpm run rin:build
pnpm run rin:test
pnpm run rin:test:coverage
pnpm run rin:lint
pnpm run rin:hygiene
pnpm run rin:smoke
pnpm run check
```

### Host sandbox failures

When required `gh`, `pnpm`, build, test, or generator commands fail because the agent sandbox blocks credentials, network, IPC, file watching, or nested `sandbox-exec`, retry unchanged with the narrowest host escalation before diagnosing authentication or project failure. Require sandbox evidence; never bypass genuine test failures or the product sandbox under test.

### Run relevant checks locally

Run checks before pushes using the relevant gates in [rin/AGENTS.md](rin/AGENTS.md) and [rin/GATES-PLAN.md](rin/GATES-PLAN.md); report only commands run. For registry dependency changes, also verify `pnpm install --frozen-lockfile` when applicable.

- Match evidence to the surface: focused tests for behavior, `rin:test` for package behavior, `rin:hygiene` for documentation and workspace gates, `rin:smoke` for assembled host paths, and snapshots when model-visible behavior changes.
- Never default to the full suite or repeat a passing check for commit or push. CI owns exhaustive coverage and the platform matrix; rehearse all locally only by explicit request, for CI diagnosis, or for an irreducibly repository-wide change.
- `rin:test:coverage` is the progressive coverage gate for rin packages; [rin/AGENTS.md](rin/AGENTS.md) and [rin/GATES-PLAN.md](rin/GATES-PLAN.md) own its thresholds.

## Secrets / .env

Real-API tests and demos read `DEEPSEEK_API_KEY`, optional `DEEPSEEK_BASE_URL`, and root `.env`. cordis.yml allows `!!js` (never `!js`) under plugin `config` and entry `disabled`; other metadata stays literal, so conditional composition also uses overlays ([primer](docs/cordis-primer.md#loader-configuration)). Never commit credentials. CI e2e skips without a key; [testing.md](docs/testing.md) owns key policy.

## Conventions

- The dsh runtime is consumed as exact `@deepseek-ai/*` registry dependencies recorded in the root manifests and lockfile; `@rin` packages are private workspace packages under `rin/<group>/<name>/`; `@deepseek-ai/cordis` remains a peer/dev dependency where package manifests require it.
- ESM everywhere (`"type": "module"`). Use package names across packages and `.ts` in local relative imports. Config subprocesses run built `lib/` under plain Node; source regressions use their declared launcher ([testing policy](docs/testing.md#test-subprocess-launch-modes)). The `dsh` CLI source launch runs through tsx's ESM-only hook (`node --import tsx/esm`); modules it reaches must stay ESM (no CJS-only exports) — Node's native TypeScript modes are unavailable across the engines range. Raw/Web `cordis.yml` bare plugins must appear in their resolver manifest's `dependencies`; `verify-cordis-config` enforces it.
- **Registrations are effects**: every contribution goes through `ctx.effect()` / `ctx.on()`; a registry's `register()` returns the disposer.
- **Runtime invariants assert owned relationships.** Check authoritative event streams or mutable data, not service or method presence, plugin metadata or effects, or fixed pure examples. Without a plausible relationship, an explained empty companion is correct ([rin invariant rules](rin/AGENTS.md)).
- **Typed events use declaration merging** and merge-extensible maps. Event JSDoc needs `@mode` and payload `@param`; scoped keys absent from payloads need `@dshScopeScan unsupported`. Public service methods document parameters and non-void returns. A `SessionEventMap` member is required-on-read by default — builds that do not know its type refuse the log unless the event carries the envelope's `ignorable: true`; only structural format changes bump `SESSION_FORMAT_VERSION`.
- **Switch on discriminant tags.** Closed unions end in `assertNever`; merge-extensible unions fall through a documented default.
- **Waterfall listeners MUST call `next()`** to delegate; returning without it short-circuits the chain ([semantics](docs/cordis-primer.md#cordis-waterfall-semantics)).
- **Model-visible ⟺ logged**: anything that reaches a model request must be reconstructable from the session log; a new model-visible input requires a session event.
- **Plugins, not loop changes**: new behavior goes on documented extension points; changing `agent-loop` requires updating docs/architecture.md.
- **A capability seam comprises Service Definition / Service Provider / Consumer roles.** It is complete, never one role; split only when roles evolve independently ([glossary](docs/glossary.md#capability-seam)).
- **Prefer maintained dependencies over hand-rolling** when they genuinely delete owned code and tests.
- **Explicit > implicit at package boundaries**: defaulting is an explicit `resolve(request): Spec` step in the owning implementation, never a hidden `?? default` inside `run()` (the `dsh-shell` request/spec split is the template).
- **No hardcoded tunables in plugins**: deployment-varying choices are validated `Config` fields changeable from cordis.yml; a `DEFAULT_*` constant or test hook is not configurability. Protocol constants, external specs, and security invariants stay fixed.
- **Misconfiguration fails loud** at load when self-contained, otherwise at the earliest resolvable point; never silently skip a missing referent.
- **Opaque cross-boundary ids are branded** (`Branded<B>` from `dsh-brand`), never bare `string`.
- **Trust TypeScript at typed same-process boundaries.** Do not add runtime validation, fallback behavior, or hostile-input tests solely for values the static interface requires; validate at parser/config, queued, model/tool JSON, durable/file, worker, process, and wire boundaries.
- **Source plane vs artifact plane, never mixed.** Static gates and tests resolve workspace imports through tsconfig `paths` to `src` and pass on a clean tree; gates consuming built `lib/` declare that dependency ([layout](docs/development.md#typescript-project-layout)).
- **Keep compiler faces explicit.** Each package uses one aggregate except `api/remotes`; repo-wide programs seed a face config, never the root solution ([layout](docs/development.md#typescript-project-layout)).
- **An empty `catch` names what it swallows** and why nothing else can reach it; keep the `try` to one statement.
- Do not comment on facts obvious from code.
- **Prefer symmetry for parallel values**; unexplained asymmetry usually signals a missed extraction.
- **Tests describe behavior, not correctness.** Change obsolete behavior with its tests; explain why in the PR.
- **Testing policy** — [docs/testing.md](docs/testing.md). Every non-trivial model- or product-user-visible behavior change adds or updates a keyless snapshot through a real runnable example in the same PR; package tests, e2e-only assertions, and mock-only fixtures do not substitute for the assembled application transcript. Fixtures must replay on macOS/Linux; fix fixtures, not normalizers.
- **A tool's UI render intent is part of its design**, decided up front (`generic`/`terminal`/`diff`, `locations`); presentation methods are pure functions of `args` ([cookbook](docs/cookbook/adding-a-tool.md)).
- **Plan unit, e2e, and snapshot coverage** for capability seams, lifecycle paths, and transcript output; include missing snapshot-harness support in the same change.
- **Choose PR history deliberately.** Split independent changes; fix the introducing PR before propagation. Standalone PRs and official stacks may merge-forward or rebase after review. Rewrites use `--force-with-lease`, abort on remote movement, never raw `--force`; an in-progress merge-forward preserves its checkpoint before taking a newer base.
- **Labels:** one PR `kind/*`, all material `area/*`, and native Issue Type.
- TODO markers: `FIXME`/`TODO`/`XXX` by urgency ([semantics](docs/development.md)).
- Files end with exactly one trailing newline; `git diff --cached --check` (pre-commit) gates it.

## Defensive patterns

Read [docs/defensive-patterns.md](docs/defensive-patterns.md) before lifecycle, concurrency, subprocess, or teardown work.

## Type safety and documentation

Everything compiles under `strict: true` with `noImplicitAny`; every remaining `any` explains why narrowing is infeasible. Every module and export has concise JSDoc for its non-obvious contract; function-like exports include `@param`/`@returns`, as enforced by `verify-export-jsdoc`. Heritage-declared members, plugin-protocol slots, and constructors keep their docs at the declaring Service Definition, protocol, or class.

Comments and docs state complete contracts and context, not reasoning transcripts. Use direct, concrete terms. Do not use metaphors. Before writing `contract`, `boundary`, or `shape`, ask whether a more exact term names the subject: write `response fields`, `JSON validation`, or `ESM exports` instead of `response shape`, `validation boundary`, or `module shape`. Keep `contract` for preconditions, postconditions, invariants, compatibility promises, and other obligations that callers, callees, implementers, providers, producers, or consumers rely on. Keep a literal process, wire, security, transaction, or lifecycle boundary. Do not narrate control flow or tests, preserve review history, or restate code. Keep behavior, failure, timing, ownership, and safe-use facts; link the rationale. Wire mechanically checkable invariants into an executed top-level gate and prove each changed acceptance path rejects an invalid case. Use narrow, justified exceptions instead of disabling a rule globally.

Docs accompany every code change: update affected README and JSDoc contracts together. For current rin documentation, package README limitations, and migration status, follow [rin/AGENTS.md](rin/AGENTS.md) and [rin/README.md](rin/README.md).

## Editing these instructions

`CLAUDE.md` is a compatibility entry point to the root instructions, not a second copy; [rin/AGENTS.md](rin/AGENTS.md) is the nested authority for `rin/`. Edit the real `AGENTS.md` file. Keep each rule self-contained while linking high-level docs. Condense when clarity survives.

## dsh dependency policy

The dsh base is resolved from the public registry. Keep exact `@deepseek-ai/*` versions, overrides, and peer-resolution changes in the root manifests and `pnpm-lock.yaml`; verify registry installs with the relevant rin gates.

`patches/` contains only explicit local patches for registry dependencies. Do not reintroduce a vendored sync tree without an explicit architecture decision.
