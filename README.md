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

- **Asset repository and environments** (`@rin/repository`, `@rin/environment`, `@rin/agents`, `@rin/sandboxes`) — read the asset repository, project agents, and environment installation plans into runnable sandbox profiles.
- **Filesystem and session backup** (`@rin/filesystem`, `@rin/session-backup`) — path-contained directory browsing and gzip session export/import.
- **Memory** — four packages: `@rin/knowledge`, `@rin/prompt-memory`, `@rin/skill-memory`, and `@rin/session-search`.
- **Notes** (`@rin/notes`) — Obsidian-style notes with session backup.
- **Optimization and code graph** (`@rin/token-optimization`, `@rin/smart-pruning`, `@rin/codegraph`) — token/output controls and SQLite code-graph visualization.
- **Evolution** (`@rin/evolution`) — self-evolution state and configuration.
- **Diagnostics** (`@rin/monitor`, `@rin/doctor`) — Linux host metrics snapshots and honest host self-diagnostics.
- **Automation and collaboration** (`@rin/tasks`, `@rin/mcp`, `@rin/mcp-client`, `@rin/provider-probe`, `@rin/computer-use`, `@rin/agent-migration`, `@rin/teams`) — tasks, MCP configuration and model-facing MCP bridging, provider probes, desktop computer-use policy, agent migration, and teams.
- **LLM capabilities** (`@rin/brief`, `@rin/review`) — LLM-generated session briefs and artifact review.
- **Web** (`@rin/web-server`, `@rin/web-ui`) — a standalone Web UI served on its own port (default `8320`), including a browser terminal over `/ws/terminal/<id>`.
- **Desktop shell** (`@rin/gui`) — a Tauri shell embedding the same Web UI.

## Run

### Run from source

rin's `dsh` base is installed as `@deepseek-ai/*` dependencies from the **public npm registry** — you do not need a separate DeepSeek Harness checkout. Cloning this repository and running `pnpm install` pulls the entire `dsh` base automatically (pinned to `0.1.0-rc.7`):

```sh
pnpm install
pnpm run rin
```

The `rin` host serves the Web UI at `http://127.0.0.1:8320` by default (standalone launch via `@rin/cli`).

rin can also be launched hosted by the `dsh` CLI: create a `dsh` profile whose `dsh.profile.bundles` lists `@rin/bundle` (it declares `dsh.bundle.patch`), then `dsh --profile <name>` assembles the exact same assembly on `dsh`'s own launcher.

### Distribution

rin ships in three forms, published at the [release page](https://github.com/your-name/rin-harness/releases):

- **npm package** — the `@rin/*` packages, including the `@rin/cli` binary.
- **Windows executable** — a Tauri installer (`nsis`) built from `@rin/gui`.
- **Linux deb** — a Tauri `deb` package built from `@rin/gui`.

<!-- TODO: replace https://github.com/your-name/rin-harness with the actual repository URL before release. -->

## Community and support

- Submit feedback and bug reports through [GitHub Discussions](https://github.com/your-name/rin-harness/discussions).
- Track and file issues through [GitHub Issues](https://github.com/your-name/rin-harness/issues).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
