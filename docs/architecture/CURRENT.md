# rin-harness 当前架构

> 状态：Current implementation snapshot — canonical repository layout is in place; runtime and release evidence remain in progress
>
> 日期：2026-08-24

本文只记录已存在于代码、manifest 或已执行门禁中的当前事实。目标架构见
[TARGET.md](TARGET.md)，当前批次与证据边界见
[ACTIVE.md](../roadmap/ACTIVE.md)。历史迁移材料统一位于
[docs/archive/](../archive/)，不承担当前结构、命令或完成状态的权威性。

## 根级权威

根级 `package.json`、`pnpm-workspace.yaml`、`tsconfig.base.json`、
`tsconfig.json`、`vitest.config.ts`、`.oxlintrc.json` 与 `tooling/`
是唯一工程入口。当前仓库不维护 dsh 源码副本；dsh 基座由 registry
dependencies 解析。`patches/` 只保存有明确来源和决策记录的第三方依赖补丁。

## 当前目录与 package census

当前 canonical workspace 共有 21 个 package manifest：3 个应用入口和 18 个
可复用包。物理上的 `rin/` 过渡外壳已经移除；新的 package 只能出现在下表的
`apps/<name>/` 或 `packages/<role>/<name>/`。

| 层 | 目录 | package |
|---|---|---|
| apps | `apps/` | `@rin/cli`、`@rin/web`、`@rin/desktop` |
| runtime | `packages/runtime/` | `@rin/host`、`@rin/contracts`、`@rin/health`、`@rin/backup` |
| domains | `packages/domains/` | `@rin/assets`、`@rin/workspace`、`@rin/memory`、`@rin/knowledge`、`@rin/notes`、`@rin/automation`、`@rin/collaboration` |
| features | `packages/features/` | `@rin/authoring`、`@rin/evolution`、`@rin/context`、`@rin/computer-use`、`@rin/agent-migration` |
| integrations | `packages/integrations/` | `@rin/mcp`、`@rin/providers` |

合并包的公开子路径保持能力边界，但不再拥有独立 workspace manifest：

- `@rin/workspace/environment`、`filesystem`、`agents`、
  `plugins`、`sandboxes`；
- `@rin/memory/prompt`、`skill`、`session-search`；
- `@rin/knowledge/graph`；
- `@rin/health/doctor`、`monitor`；
- `@rin/authoring/brief`、`review`；
- `@rin/context/token-optimization`、`smart-pruning`、`codegraph`；
- `@rin/mcp/client`；
- `@rin/host/web-server`。

## Host 与应用入口

- `apps/cli` 是薄启动器，解析默认命令或 `web` 别名并调用
  `@rin/host/launcher`。
- `packages/runtime/host` 是唯一 composition root，持有 Cordis 装配、provider
  roster、路径 helper、Host start/stop 生命周期以及 `web-server`。
- `apps/web` 是独立 React SPA；共享 memory DTO 已抽到纯
  `@rin/contracts`，不从领域包导入运行时实现。
- `apps/desktop` 是 Tauri 2 壳；frontendDist 指向 `apps/web/dist`，
  builtin assets 指向 `packages/domains/assets/builtin`。开发态通过
  `rin web` 启动 host，发布态通过 `rin-sidecar web` 启动 sidecar；
  真正的 Cargo 构建、安装、签名、升级和干净机器 E2E 仍需独立证据。
- `@rin/host/web-server` 是 `@rin/host` 的公开子路径，不是独立 package；
  默认服务 8320，并与 `apps/web` 的静态产物共用 host。

Host 的 Cordis 文件位于
`packages/runtime/host/src/cordis.yml`，patch 位于
`packages/runtime/host/cordis.patch.yml`。Cordis 门禁验证配置行解析、
Host manifest 依赖闭包、roster 顺序、JS helpers 与 dsh patch 一致性。

## 数据与恢复边界

`@rin/memory` 拥有 canonical memory store；prompt、skill 和 session-search 是
同一包内的投影/检索模块。审计与 DTO 位于 `@rin/contracts`，不实现存储或
Cordis 装配。

`@rin/knowledge` 负责知识索引，`@rin/knowledge/graph` 是跨来源的只读
graph read model。它可以读取 memory、notes、assets 与 codegraph 的公开投影，
但不替代各自的写入所有者。

`@rin/backup` 的 rolling backup 以 `RIN_HOME` 为根。dsh 默认位于
`RIN_HOME/dsh`，也可由 `DSH_HOME` / `RIN_SESSION_ROOT` 独立迁移。
归档默认排除 credentials、`.env`、secrets 与 backups，不复制 manifest
之外的外部来源。

`packages/domains/assets/builtin/` 是内置 AssetRepository 数据，不是源码目录。

## 编译、解析与门禁链路

- `pnpm-workspace.yaml` 只发现 `apps/*` 与 `packages/*/*`；不存在
  `rin/*/*` workspace glob。
- `pnpm sync:references` 从 21 个 workspace manifest 生成 package project
  references、根 solution references 与 `tsconfig.base.json` paths。
- 结构门禁检查 21 个 package 的 census、根 references、paths、manifest entry、
  源码产物污染与 Cordis 依赖规则；`apps/cli` 和纯 contracts 包是明确的
  非 Cordis package。
- Vitest 的 Node lane 覆盖 canonical package paths，Web lane 只收集
  `apps/web/src`；smoke runner 也只发现 `apps/` 与 `packages/`。
- lint、readme、publint、依赖和 Cordis checks 均从根级 `tooling/` 入口运行。
- 跨 package import 使用 `@rin/*` 包名，package 内部使用相对 import。静态检查和
  测试通过 paths 解析到 `src/`；只有明确消费构建产物的检查读取 `lib/` 或
  `dist/`。

## 尚未证明

布局迁移本身已由 manifest census、`rin/` 缺失检查、references/path 同步以及
结构/Cordis/README/publint/dependency gates 证明。以下项目仍必须以新鲜命令或真机
产物证明，不能从静态文档或迁移结果推断：

- 本轮迁移后的完整 test、smoke、lint、Web build 与 coverage 结果；
- coverage threshold 是否在故意降低覆盖率时确实阻断 CI；
- React 异步 warning 和 unhandled rejection 的治理；
- 真 provider、container、remote、install 生命周期；
- Tauri sidecar 目标 triple 产物、Cargo.lock、安装包、签名、升级、回滚和干净机器 E2E；
- SBOM、构建 provenance 和 artifact attestation；
- Companion/Relationship 产品域、安全流程和消费者生命周期 UI。

## 文档权威

- [文档索引](../README.md)
- [目标架构](TARGET.md)
- [Seam 矩阵](SEAMS.md)
- [Web Client](WEB-CLIENT.md)
- [活动路线](../roadmap/ACTIVE.md)
- [Backlog](../roadmap/BACKLOG.md)
- [ADR-0001](../decisions/ADR-0001-repository-layout.md)
