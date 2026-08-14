# rin — 目录分区权威说明

`rin/` 是 rin-harness 在 dsh 底座之上的自有能力层。分区原则：**两层（group / package），
每个 package 对应一个 `@rin/<name>` 包**，workspace glob 为 `rin/*/*`。

## group 语义

| group | 语义 | 已建 package |
|---|---|---|
| `core/` | 资产主轴：仓库读取 + 环境安装计划 | `repository`、`environment` |
| `memory/` | 记忆域（文件 / SQLite 持久化） | `knowledge`、`prompt-memory`、`skill-memory`、`session-search` |
| `optimization/` | token 与输出优化 | `token-optimization`、`smart-pruning` |
| `learning/` | 自我进化 | `evolution` |
| `web/` | 独立 Web UI（独立端口，不并入 dsh Web UI） | `web-server` |

规划未建（见 MIGRATION.md §8 value tiering）：`collaboration/`（team/remote/im）、
`automation/`（computer-use / agent-migration / schedule / worktree）。

## package 结构约定

每个 package（`rin/<group>/<name>/`）统一：

- `package.json`：`name` = `@rin/<name>`，`private: true`，`type: module`，peerDep `@deepseek-ai/cordis`。
- `tsconfig.json`：extends `tsconfig.base.json`，`rootDir: src`，`outDir: lib/types`，references 每个 workspace 依赖。
- `src/`：`types.ts`（纯类型）+ `index.ts`（Cordis 插件入口）+ 领域模块。
- `tests/`：vitest 单测 + 可 strip-types 跑的冒烟脚本。
- `README.md`：包职责 + API + 已知限制。
- `web-server` 额外有 `static/`：独立前端的静态文件（HTML/JS/CSS，无构建步骤）。

## 约定

- 跨 @rin 依赖用**包名 import**（`@rin/repository`）+ tsconfig project references，绝不用相对路径 `../../../`。
- 零外部运行时依赖：只用 `node:` 内置；`@deepseek-ai/cordis` 是 peerDep，`@deepseek-ai/schemastery` 是 devDep。
- 可选 host 服务用 `ctx.get('name')` 读取；`ctx.<name>` 只用于自身 `inject` 声明的服务。
- 聚合：`rin/tsconfig.json` 是唯一聚合（references 全部 package）；`tsconfig.base.json` 的 `paths` 有每个 `@rin/<name>` → `./rin/<group>/<name>/src` 的映射。

## 权威文档

- `MIGRATION.md` — 迁移计划与价值分层。
- `PHASE4-STANDALONE.md` — 独立 Web UI 架构与 API 契约。
