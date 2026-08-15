# rin — 目录分区权威说明

`rin/` 是 rin-harness 在 dsh 底座之上的自有能力层。分区原则：**两层（group / package），
每个 package 对应一个 `@rin/<name>` 包**，workspace glob 为 `rin/*/*`。

dsh 上游目录（vendor/packages/apps/docs/…）零改动；rin 的一切落在 `rin/`。完整结构设计见根级
MIGRATION.md §1.1，更新迭代契约见 §9。

## group 语义

| group | 语义 | 已建 package |
|---|---|---|
| `core/` | 资产主轴：仓库读取 + 环境安装计划（+ 执行，Phase 5） | `repository`（含 `builtin/` 内置仓库）、`environment` |
| `workspace/` | 仓库 → agent / sandbox 装配（Phase 5，未建） | `agents`、`sandboxes` |
| `memory/` | 记忆域（文件 / SQLite 持久化） | `knowledge`、`prompt-memory`、`skill-memory`、`session-search` |
| `notes/` | 笔记（Obsidian 风格 + 会话备份，Phase 6，未建） | `notes` |
| `optimization/` | token 与输出优化（三控件：开关 + 滑块） | `token-optimization`、`smart-pruning` |
| `learning/` | 自我进化 | `evolution` |
| `web/` | 独立 Web UI（独立端口 8320，不并入 dsh Web UI） | `web-server`、`web-ui` |
| `gui/` | 桌面壳（Tauri 2 内嵌 web-ui，Phase 8，未建） | `gui` |
| `cli/` | `rin` 启动器（profile 自举，Phase 8，未建） | `rin` |
| `bundle/` | rin profile 装配层（cordis.patch.yml，Phase 8，未建） | `rin` |

规划后置（见 MIGRATION.md §10 value tiering）：`collaboration/`（team/remote/im）、
`automation/`（computer-use / agent-migration / schedule / worktree）。

## package 结构约定

每个 package（`rin/<group>/<name>/`）统一：

- `package.json`：`name` = `@rin/<name>`，`private: true`，`type: module`，peerDep `@deepseek-ai/cordis`。
- `tsconfig.json`：extends `tsconfig.base.json`，`rootDir: src`，`outDir: lib/types`，references 每个 workspace 依赖。
- `src/`：`types.ts`（纯类型）+ `index.ts`（Cordis 插件入口）+ 领域模块。
- `tests/`：vitest 单测 + 可 strip-types 跑的冒烟脚本。
- `README.md`：包职责 + API + 已知限制（`## Known Limitations and Deferred Work`）。
- `web-server` 的 `staticRoot` 默认指向 `web-ui/dist`（`@rin/bundle` 的 `webUiDistRoot()`）；浏览器 8320 与 `@rin/gui` 共用这同一套 React SPA。构建前端：`pnpm run rin:build`，启动 host：`pnpm run rin`。
- `core/repository/builtin/` 为内置 AssetRepository（repository.yaml + 九根种子资产），是仓库资产数据而非包代码。

## 约定

- 跨 @rin 依赖用**包名 import**（`@rin/repository`）+ tsconfig project references，绝不用相对路径 `../../../`。
- host 包零外部运行时依赖：只用 `node:` 内置；`@deepseek-ai/cordis` 是 peerDep，`@deepseek-ai/schemastery` 是 devDep。
- 可选 host 服务用 `ctx.get('name')` 读取；`ctx.<name>` 只用于自身 `inject` 声明的服务。
- 聚合：`rin/tsconfig.json` 是唯一聚合（references 全部 package）；`tsconfig.base.json` 的 `paths` 有每个 `@rin/<name>` → `./rin/<group>/<name>/src` 的映射（根级合并点之一，见 MIGRATION.md §9）。
- 产品层（web-ui / gui / cli / bundle）可以有构建或运行依赖；host 插件层保持零依赖。

## 权威文档

- `MIGRATION.md` — 迁移计划、价值分层、目录重设计、更新迭代契约（单一权威）。
- `PHASE4-STANDALONE.md` — 独立 Web UI 架构与 API 契约。
