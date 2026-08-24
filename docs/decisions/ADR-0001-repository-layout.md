# ADR-0001 — Repository layout and authority model

Status: Accepted

Date: 2026-08-24

## Decision

The repository will remove the transitional rin/ wrapper and converge on:

- apps/ for distributable entry points;
- packages/runtime, packages/domains, packages/features, and packages/integrations for reusable runtime code;
- tooling/ for repository-only gates, scripts, libraries, and generators;
- docs/ for current architecture, decisions, roadmap, audits, and archived migration evidence;
- .artifacts/ for ignored generated output.

The migration is incremental. Current rin packages remain runnable until each vertical slice moves with its imports, TypeScript references, tests, documentation, and host assembly updated together.

## Authority

- docs/architecture/CURRENT.md states implemented facts.
- docs/architecture/TARGET.md states the accepted target.
- docs/roadmap/ACTIVE.md is the only active execution plan.
- docs/roadmap/BACKLOG.md contains uncommitted work.
- docs/archive contains historical evidence and is not current authority.

## Consequences

- Root configuration and commands become the canonical tool entry points.
- Package census must equal TypeScript solution references.
- Only packages/runtime/host may compose the complete application.
- New packages require a separate ADR proving an independent lifecycle and public API.
- Historical migration documents remain available but cannot override current architecture or accepted decisions.

## Rollback

Each migration batch must retain a working source path and pass its relevant gates. A batch that cannot update all consumers is reverted as a unit rather than leaving compatibility paths without an owner.
