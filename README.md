# rin-harness

English | [中文](README.zh.md)

> **rin-harness** (`rin`) is a harness migrated and developed on the base of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`), an open-source agent harness by [DeepSeek AI](https://deepseek.com).
>
> This project keeps DeepSeek Harness's MIT license and third-party notices (see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)). The name "rin" was chosen by one of the author's agents when it named itself while using the DeepSeek API.

It uses an architecture where **everything is a plugin**, and is powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

## Developer preview

rin-harness inherits DeepSeek Harness's _developer preview_ status and is iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

## Features

rin layers a set of `@rin/*` packages on top of the `dsh` base:

- **Asset repository and environments** (`@rin/assets`, `@rin/workspace/environment`, `@rin/workspace/agents`, `@rin/workspace/sandboxes`) — read the asset repository, project agents, and environment installation plans into runnable sandbox profiles.
- **Filesystem and session backup** (`@rin/workspace/filesystem`, `@rin/backup`) — path-contained directory browsing and gzip session export/import.
- **Memory** (`@rin/memory` with `prompt`, `skill`, and `session-search` subpaths; `@rin/knowledge`) — canonical memory, projections, and retrieval.
- **Notes** (`@rin/notes`) — Obsidian-style notes with session backup.
- **Optimization and code graph** (`@rin/context/token-optimization`, `@rin/context/smart-pruning`, `@rin/context/codegraph`) — token/output controls and SQLite code-graph visualization.
- **Evolution** (`@rin/evolution`) — self-evolution state and configuration.
- **Diagnostics** (`@rin/health/monitor`, `@rin/health/doctor`) — Linux host metrics snapshots and honest host self-diagnostics.
- **Automation and collaboration** (`@rin/automation`, `@rin/mcp`, `@rin/mcp/client`, `@rin/providers`, `@rin/computer-use`, `@rin/agent-migration`, `@rin/collaboration`) — tasks, MCP configuration and model-facing MCP bridging, provider probes, desktop computer-use policy, agent migration, and teams.
- **LLM capabilities** (`@rin/authoring/brief`, `@rin/authoring/review`) — LLM-generated session briefs and artifact review.
- **Web** (`@rin/host/web-server`, `@rin/web`) — a standalone Web UI served on its own port (default `8320`), including a browser terminal over `/ws/terminal/<id>`.
- **Desktop shell** (`@rin/desktop`) — a Tauri shell embedding the same Web UI.

## Run

### Run from source

rin's `dsh` base is installed as `@deepseek-ai/*` dependencies from the **public npm registry** — you do not need a separate DeepSeek Harness checkout. Cloning this repository and running `pnpm install` pulls the entire `dsh` base automatically (pinned to `0.1.0-rc.8`):

```sh
pnpm install
pnpm run start
```

The `rin` host serves the Web UI at `http://127.0.0.1:8320` by default (standalone launch via `@rin/cli`).

rin can also be launched hosted by the `dsh` CLI: create a `dsh` profile whose `dsh.profile.bundles` lists `@rin/host` (it declares `dsh.bundle.patch`), then `dsh --profile <name>` assembles the exact same assembly on `dsh`'s own launcher.

### Distribution status

rin is not published yet. The intended distribution surfaces are:

- **npm package** — the `@rin/*` packages, including the `@rin/cli` binary.
- **Windows executable** — a Tauri installer (`nsis`) built from `@rin/desktop`.
- **Linux deb** — a Tauri `deb` package built from `@rin/desktop`.

Release URLs and package repository metadata will be added when rin has a
dedicated public repository. The `deepseek-ai/deepseek-harness` repository is
the upstream dsh base, not rin's release repository.

## Community and support

There is no public issue tracker or discussion forum for rin yet. Do not infer
one from the dsh upstream repository; use the private project channel while
this product remains pre-release.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [documentation index](docs/README.md), then read the
[current architecture](docs/architecture/CURRENT.md), the
[approved target architecture](docs/architecture/TARGET.md), and the
[active execution route](docs/roadmap/ACTIVE.md). The canonical workspace has
21 package manifests: applications are under `apps/` and reusable code is
under `packages/<role>/<name>/`. The former `rin/` transition wrapper is
absent; historical migration paths are retained only in clearly marked archive
and source-mapping documents.

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
