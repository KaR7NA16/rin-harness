# Changelog

All notable changes to rin-harness will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Version note:** rin-harness is pre-release and has no Git tags yet. The
> `@rin/*` packages are versioned `0.1.0`. The `[0.1.0]` section below
> summarizes the accumulated baseline, and `[Unreleased]` lists the hardening
> and publish-readiness rounds that will fold into the first tagged release.

## [Unreleased]

### Added

- Phase 9 seam projection: project all `@rin/*` host plugins into the dsh
  capability seams (systemPrompt, shell, session events, toolResultPruner,
  tools, agent presets, skills). See `rin/SEAM-PROJECTION.md`.
- Legacy desktop endpoint landing: legacy API routes for repository, notes,
  prompt-memory, skills, search, and token controls; session list/create/history
  wired to dsh sessions; a WebSocket chat bridge over the dsh agent runtime;
  sandbox and agent-workspace endpoints; provider presets with CRUD persistence;
  and postponed pages rendered with empty or disabled states.
- Gate infrastructure: rin gates assembled from dsh tooling and discipline
  (`rin/scripts/rin-gates.ts`, `verify-rin-*` leaves, smoke scripts).
- Memory-domain write paths: knowledge, prompt-memory, skill-memory, and
  session-search write/query paths wired end to end.

### Changed

- Web UI defaults to the rin host port `8320`.
- Publish readiness (audit batch 2+2.5): manifest entry points aligned, the
  three release forms declared (npm `@rin/*` packages, Tauri Windows exe,
  Tauri Linux deb), and rin release/CI wiring added.

### Fixed

- Host boot after the legacy endpoint landing.
- Legacy chat sockets registered before agent projection attaches; dsh agent
  errors surfaced through the legacy chat socket.
- `@rin/evolution` declares deps on `@rin/prompt-memory` and
  `@rin/skill-memory`.

### Removed

- Committed `src/*.d.ts.map` artifacts removed from source control.
- Terminal label + xterm and dead code removed during the wave 1-3 debt
  cleanup; architecture consolidated.

### Security

- Audit batch 1: web-server authentication, path containment for the
  knowledge/repository/sandbox-execute vectors, and HIGH-vulnerability
  dependency upgrades (fast-uri, ip-address, brace-expansion, undici).

## [0.1.0] - 2026-08-16

### Added

- Initial rin-harness baseline: the `@rin` asset layer on the dsh (DeepSeek
  Harness) base.
- `@rin/environment`: install-plan resolver with topological planning.
- `@rin/repository`: asset-repository reader and writer with validation, path
  containment, migration, and seed data.
- Host/client group restructure with the seam architecture and rin Web UI
  branding.
- Memory domain (`@rin/knowledge`, `@rin/prompt-memory`,
  `@rin/skill-memory`, `@rin/session-search`) plus the token-optimization
  switch.
- `@rin/evolution` and `@rin/smart-pruning` (Phase 3).
- All `@rin` packages brought into the typecheck gate.
- Standalone Web UI on its own port, and a React web UI with 8 pages and
  service read endpoints (Phase 4).
- Assets chain, notes, and knowledge tools (Phases 5-7): `@rin/agents`,
  `@rin/sandboxes`, `@rin/notes`, and knowledge search/stats tools.
- GUI shell, host assembly, and launcher (`@rin/gui`, `@rin/bundle`,
  `@rin/cli`) — Phase 8.
- Web UI rebuilt with shared brand assets and graphite design; the migrated
  desktop frontend replaced the web-ui as the single UI surface.

### Changed

- Web API types pinned and server routes split.
- Folder partition clarified and redundant directories renamed.
- `agents` service renamed to `rinAgents` to avoid a dsh `AgentRegistry`
  collision.

### Fixed

- Version specifiers allowed in validation, with neutral attribution.
- pip/npm range versions quoted in the environment plan.

[Unreleased]: https://github.com/your-name/rin-harness/compare/v0.1.0...main
[0.1.0]: https://github.com/your-name/rin-harness/releases/tag/v0.1.0
