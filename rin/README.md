# rin — 目录分区权威说明

`rin/` 是 rin-harness 在 dsh 底座之上的自有能力层。分区原则：**两层（group / package），
每个 package 对应一个 `@rin/<name>` 包**，workspace glob 为 `rin/*/*`。

dsh 上游目录（vendor/packages/apps/docs/…）零改动；rin 的一切落在 `rin/`。完整结构设计见根级
MIGRATION.md §1.1，更新迭代契约见 §9。

## group 语义

| group | 语义 | 已建 package |
|---|---|---|
| `core/` | 资产主轴与主机运维：仓库读取、环境计划、文件浏览、会话备份、监控、诊断 | `repository`（含 `builtin/` 内置仓库）、`environment`、`filesystem`、`session-backup`、`monitor`、`doctor` |
| `workspace/` | 仓库 → agent / sandbox / plugin 装配 | `agents`、`sandboxes`、`plugins` |
| `memory/` | 记忆域（文件 / SQLite 持久化） | `knowledge`、`prompt-memory`、`skill-memory`、`session-search` |
| `notes/` | 笔记（Obsidian 风格 + 会话备份） | `notes` |
| `optimization/` | token / 输出优化与代码图谱 | `token-optimization`、`smart-pruning`、`codegraph` |
| `learning/` | 自我进化 | `evolution` |
| `capability/` | LLM 驱动的会话/工件能力（经 dsh llm seam） | `brief`、`review` |
| `automation/` | 任务、MCP、provider 探测与桌面策略 | `tasks`、`mcp`、`mcp-client`、`provider-probe`、`computer-use`、`agent-migration` |
| `collaboration/` | 团队配置 | `teams` |
| `web/` | 独立 Web UI（独立端口 8320，不并入 dsh Web UI） | `web-server`、`web-ui` |
| `gui/` | 桌面壳（Tauri 2 内嵌 web-ui） | `gui` |
| `cli/` | `rin` 启动器（装配 dsh-base + @rin host 全家） | `rin` |
| `bundle/` | rin 装配层（cordis.yml） | `rin` |

未迁移/后置项的处置定论见下文「旧项目迁移处置」节（含「已决定不迁移」「已由 dsh 取代」「待决」三栏）。

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
- seam 接入（Phase 9）：注册代码集中在 `src/seam.ts`，`apply()` 保持薄；结构型 seam 不新增依赖，tools/agentPresets/skills 走真实 workspace 依赖。见 `SEAM-PROJECTION.md`。
- 聚合：`rin/tsconfig.json` 是唯一聚合（references 全部 package）；`tsconfig.base.json` 的 `paths` 有每个 `@rin/<name>` → `./rin/<group>/<name>/src` 的映射（根级合并点之一，见 MIGRATION.md §9）。
- 产品层（web-ui / gui / cli / bundle）可以有构建或运行依赖；host 插件层保持零依赖。

## 旧项目迁移处置（收口定论）

旧项目剩余能力的处置定论，杜绝反复提起：

### 已决定不迁移

价值低 / 小众 / 已被现有能力覆盖（详见 MIGRATION.md §10）：

- dsh hook 桥：`hook-protocol` + `hooks-claude-code` / `hooks-codex`（rin 是独立产品，外部 agent CLI 互操作非目标）
- 自动化 / 远程子代理：`acp`、`subagent-acp`、`subagent-dsh-sdk`
- 桌面目录选择器：`directory-picker-native` / `directory-picker-browse`（GUI 壳未实现原生选择）
- 会话基础设施变体：`session-persistence-sqlite`、`session-projection-cache`、`session-stats`（base 用 jsonl 已够）
- `message-feedback`（无 UI / 工具消费者）
- `github`（空桩，成本 > 价值）
- `worktree`（bash 可替代）
- `editor-notebook`（小众）
- 小服务：notificationService、mcpHostPreflight、modelImageCapabilityProbe

### 已由 dsh 取代

- `conversationService`（旧 `/api/conversations`）→ dsh `/api/sessions`：会话/对话由 dsh session 原生承载，无遗留引用，无需迁移。

### 待决（需 scope 或外部凭据）

- `@rin/remote`（bridge / ssh / teleport / daemon）：需先定「rin 的 remote 是什么」
- `e2b` 远程沙箱、`web-search-exa` / `web-search-perplexity`：需外部 API 凭据
- `voice` + STT、`im-feishu` / `im-telegram`：需外部 STT / IM 凭据
- LSP 激活：`lsp-stdio` 已挂载但 `disabled`，需部署层提供具体 language-server `servers` 表

## 权威文档

- `MIGRATION.md` — 迁移计划、价值分层、目录重设计、更新迭代契约（单一权威）。
- `PHASE4-STANDALONE.md` — 独立 Web UI 架构与 API 契约。
- `SEAM-PROJECTION.md` — Phase 9 seam 接入矩阵执行清单。
