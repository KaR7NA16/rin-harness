# Rin

English | [中文](README.zh.md)

> **Rin** is a local-first runtime and developer platform for building auditable, long-lived AI companions.

> **Status: developer preview.** The repository contains a runnable host, Web UI, desktop shell, memory and provenance foundations, provider/MCP integration, and cross-platform install/start evidence. It does **not** yet claim to be a complete consumer companion product: relationship lifecycle, companion safety, user-facing relationship controls, signed release, and longitudinal user evaluation remain in progress.

## Why Rin

Long-lived AI companions need more than a chat screen. They need memory that can be inspected and revoked, data that can be exported, provider boundaries that are explicit, and runtime behaviour that can be tested.

Rin is being built as that local-first foundation. Its current scope is a composable runtime and a developer preview; its next product boundary is an auditable relationship runtime with consent, safety, portability, and evaluation built in.

The project is intentionally honest about its boundary: an installed desktop binary and a passing test suite are evidence of engineering paths, not proof of a finished companion experience.

## What is available today

| Area | Current capability |
| --- | --- |
| Runtime composition | A single host composition root with Cordis services, provider roster, lifecycle wiring, path helpers, and the Web server |
| Memory and knowledge | Canonical memory, projections, retrieval, provenance, injection audit, knowledge and notes |
| Workspace and recovery | Asset/environment projections, path-contained filesystem access, session backup and restore |
| Integrations | Provider probes, MCP configuration and client bridge, automation, computer-use policy, collaboration and migration seams |
| Interfaces | Thin CLI launcher, standalone Web UI, and a Tauri desktop shell |
| Quality gates | Metadata, repository hygiene, typecheck, lint, unit/integration tests, release verification and smoke gates |
| Distribution evidence | Clean-machine install/start/health/watchdog E2E for Linux, Windows, macOS Apple Silicon and macOS Intel |

The current workspace has 21 package manifests. Applications live under apps/; reusable first-party code lives under role-specific directories inside packages/.

## Architecture at a glance

~~~text
apps/
  cli/       thin source launcher
  web/       React Web UI
  desktop/   Tauri shell and native sidecar

packages/
  runtime/       host, contracts, health, backup
  domains/       memory, knowledge, notes, workspace, assets, automation
  features/      context, authoring, evolution, migration, computer-use
  integrations/  MCP and provider bridges
~~~

packages/runtime/host is the composition root. The former transition wrapper under rin/ is not part of the canonical layout.

## Run from source

Requirements:

- Node.js 22.19 or newer (or Node.js 24+)
- pnpm 11.7.0

~~~sh
pnpm install
pnpm run start
~~~

The host serves the Web UI at http://127.0.0.1:8320 by default. The same host assembly can also be embedded in the desktop shell.

For the complete command surface, start with the [documentation index](docs/README.md), then read the [current architecture](docs/architecture/CURRENT.md) and [active roadmap](docs/roadmap/ACTIVE.md).

## Verify the checkout

~~~sh
pnpm run check
pnpm run smoke
~~~

pnpm run check runs metadata and hygiene gates, TypeScript project checks, lint, the Vitest suite, desktop release verification, and smoke tests.

Recent evidence:

- [CI #8](https://github.com/KaR7NA16/rin-harness/actions/runs/32685813652): 193 test files and 1695 test results passed.
- [Desktop clean-machine E2E #5](https://github.com/KaR7NA16/rin-harness/actions/runs/32685813649): Linux, Windows, macOS Apple Silicon, and macOS Intel install/start paths passed.

These runs verify the exercised paths. They do not yet prove signed/notarized distribution, real updater rollback, every provider/container lifecycle, or a finished companion product.

## Product boundary and roadmap

The next product layer is tracked in the [active roadmap](docs/roadmap/ACTIVE.md). The planned domains are:

- relationship events, consent, boundaries, pause/end/reset/export;
- companion safety, AI identity disclosure, age modes and crisis routing;
- a user-facing memory centre, relationship settings, privacy controls and “why this memory?” explanations;
- relationship and safety evaluation suites, red-team scenarios and a closed alpha;
- signed release, updater and rollback evidence.

Until those items have independent implementation and evidence, Rin should be described as a developer preview and runtime foundation—not as a production-ready human–machine relationship service.

## Upstream runtime dependency

Rin consumes the dsh/Cordis runtime from registry packages under the @deepseek-ai/* scope. Those package names are implementation dependencies; they are not Rin's product identity and do not require a separate upstream checkout.

The copyright and license terms of external dependencies remain applicable. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the dependency boundary and [LICENSE](LICENSE) for first-party Rin source.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a change. The repository is in pre-release development, so interfaces and package boundaries can change. Changes should include the smallest relevant test or evidence update and should preserve the distinction between implemented behaviour, planned work, and unverified claims.

Security reports belong in [SECURITY.md](SECURITY.md). The documentation index is the entry point for architecture decisions, audits, migration records, and the active execution route.

## License

First-party Rin source is released under the [MIT License](LICENSE). External packages and any upstream material retain their own notices; consult [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
