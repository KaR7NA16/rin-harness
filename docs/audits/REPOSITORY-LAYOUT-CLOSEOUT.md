# 仓库目录整理收口审计

> 当前快照：2026-08-24。本文只记录仓库整理完成后的静态目录事实与文档链路检查；不把静态检查升级为运行时、安装包、签名、更新或产品功能证明。

## 结论

- canonical workspace layout 已落地：工作区 glob 只包含 `apps/*` 与 `packages/*/*`。
- 当前发现 21 个工作区 package manifest：3 个应用包与 18 个可复用包。
- 仓库根下的 `rin/` 目录已移除；没有把 `rin/<group>/<name>` 当作当前物理路径继续引用。
- 当前文档已将 CURRENT、TARGET、ACTIVE、根 README、桌面入口文档切换到 `apps/` 与 `packages/<role>/<name>/`。
- 目录结论由 manifest glob、references、paths、Cordis、测试和 coverage 链路共同覆盖；
  Linux/WSL 的 Tauri/Rust、sidecar、`.deb` 安装与崩溃回收另有本轮实测。Windows/macOS
  签名、公证、真实 updater 和 clean-machine CI 仍须单独验收。

## 只读证据

在 `/home/syoou/rin-harness` 执行：

```sh
find apps packages -mindepth 2 -maxdepth 3 -name package.json -print | sort | wc -l
# 21

test ! -e rin
# pass

sed -n '1,4p' pnpm-workspace.yaml
# - apps/*
# - packages/*/*
```

当前 package census：

- apps：`@rin/cli`、`@rin/web`、`@rin/desktop`。
- runtime：`@rin/host`、`@rin/contracts`、`@rin/health`、`@rin/backup`。
- domains：`@rin/assets`、`@rin/workspace`、`@rin/memory`、`@rin/knowledge`、`@rin/notes`、`@rin/automation`、`@rin/collaboration`。
- features：`@rin/authoring`、`@rin/evolution`、`@rin/context`、`@rin/computer-use`、`@rin/agent-migration`。
- integrations：`@rin/mcp`、`@rin/providers`。

## 文档链路收口

本次整理同步了以下当前文档：

- `AGENTS.md`：明确 `apps/`、`packages/`、`tooling/` 为 canonical implementation，说明旧 `rin/` wrapper 已移除。
- `README.md`、`README.zh.md`：更新 workspace 数量、包职责和开发路径。
- `docs/architecture/CURRENT.md`：改为 21 包、`rin/` 缺失、当前 capability subpath 与未验收边界。
- `docs/architecture/TARGET.md`：保留 `rin/<group>/<name>` 作为迁移 source mapping，并标注它不是当前物理路径。
- `docs/roadmap/ACTIVE.md`：将旧包数量与旧路径标为历史基线，当前工作项指向 canonical layout。
- `docs/architecture/WEB-CLIENT.md`、`docs/architecture/SEAMS.md`、`packages/features/evolution/README.md`：修正当前入口和相对路径。
- `apps/desktop/README.md`、`apps/desktop/scripts/build-sidecar.md`、`apps/desktop/docs/verification.md`：切换到 `apps/desktop`、`../../web/dist`、`web` 子命令与 Tauri shell plugin 事实。
- `docs/audits/AUDIT-OPENSOURCE.md`、`docs/audits/AUDIT-REPORT.md`：加历史快照边界，避免迁移前 `rin/` 路径被误读为现状。

## 旧路径审计口径

由于本 WSL 会话中的 `rg` 解析到 Windows 安装路径且无法执行，使用等价的 `find + grep` 对 Markdown、README 和 `AGENTS.md` 做扫描。审计模式包括：

```sh
find . -type f \( -name '*.md' -o -name 'AGENTS.md' \) \
  ! -path './docs/archive/*' ! -path './node_modules/*' -print0 |
  xargs -0 grep -nH -E \
  'rin/(cli|gui|web|bundle|core|workspace|memory|notes|optimization|capability|automation|host|web-server)|rin/desktop/desktop|web/web/dist|serve --port|rin-sidecar serve'
```

允许保留的命中分为四类：

1. `docs/archive/migration/**`：迁移方案和历史证据，必须保留 provenance，但不能作为现行路径。
2. `docs/architecture/TARGET.md` 中的 `rin/<group>/<name>`：仅表示 source mapping；TARGET 已在表格前明确边界。
3. 当前公开能力名或子路径，例如 `@rin/host/web-server`、`@rin/memory/prompt`、`/api/prompt-memory`；这些不是 `rin/` 物理目录。
4. 产品名、CLI 名和用户数据根，例如 `rin`、`rin-sidecar`、`~/.rin/`；它们不是仓库旧路径。
5. 本报告中的扫描正则和残留分类示例：它们是审计方法文本，不是当前操作路径。

除上述类别外，命中 `rin/desktop/desktop`、`rin/<group>/<name>` 的当前操作路径、`web/web/dist`、`serve --port` 或 `rin-sidecar serve` 都应视为残留并继续修复。

## 非目标与后续验证

目录收口后已经执行并记录：

- apps/packages 全量 test、typecheck、lint、smoke 与 coverage gate；
- manifest/project references/paths/Cordis 门禁；
- Linux/WSL 的 `@rin/desktop` Cargo check、release `.deb`、apt 安装启动、
  8320 health 与 GUI 崩溃后的 sidecar 回收。

仍需由外部平台或凭据提供：

- Windows NSIS 与 macOS DMG 的 clean-machine jobs 已配置，但仍需真实 runner
  成功记录；Authenticode、macOS code signing/notarization 仍需发布凭据；
- 真实 GitHub release updater 签名、发布、旧版本升级；
- SBOM/provenance 与安全门禁；
- 当前目标中的 Companion/Relationship 产品域是否真正实现。
