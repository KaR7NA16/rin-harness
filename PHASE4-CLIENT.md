# PHASE4 — Web UI 功能适配设计稿

> ⚠️ 已转向：改为**独立端口独立 Web UI**（见 PHASE4-STANDALONE.md）。本文的 SlotMap/typert/tsdown 集成技术路线作废，仅「功能适配映射表」仍作功能清单参考。

> 本文是 Phase 4（client 插件）的**设计文档**，不是实现。完整代码实现留到真机（有 test:gui + tsdown bundle + 视觉验证）。
> 零迁移痕迹约束同 MIGRATION.md：对参考项目用「设计参考」这类中性表述。

## 1. 现状与阻塞

- 已提交 9 个 @rin host 插件（repository / environment / knowledge / prompt-memory / skill-memory / session-search / token-optimization / smart-pruning / evolution），全部 strip-types 冒烟通过，跑在 dsh 底座上。
- client 插件未开始。host 能力在 Web UI 上不可见。
- **阻塞**：本沙箱 `test:gui` 与 tsdown bundle 均因 spawn EPERM 无法运行；client 插件无法在本沙箱验证。因此本文先定架构与决策，实现留真机。

## 2. 四个待决问题的决策

### 决策 1 — 命名与目录

- 目录：`rin/client/<pkg>`（例 `rin/client/ui-repository`）。
- 包名：`@rin/client-ui-<name>`（对齐 dsh 的 `@deepseek-ai/dsh-client-ui-<name>`）。
- workspace glob：现有 `rin/*/*` 已覆盖 `rin/client/*`，无需改。
- 理由：与 dsh client 包命名同构，与 @rin host 包（`@rin/repository`）清晰分层——host 包无 `client-` 前缀，client 包带 `client-ui-` 前缀。

### 决策 2 — tsdown 打包冲突

host 包与 client 包是**两种构建面**，不能共用一个骨架：

| 轴 | host 包（@rin/repository 等） | client 包（@rin/client-ui-*） |
|---|---|---|
| 构建面 | Node（host face） | 浏览器（client face） |
| tsconfig | extends `tsconfig.base.json`，进 `rin/tsconfig.json` 聚合 | extends `tsconfig.base.client.json`，进 `tsconfig.client.json` 聚合 |
| 打包 | 无 tsdown（tsc emit 类型） | tsdown 产 `lib/client.js`（`dsh.client` manifest） |
| import | 相对 `./xxx.ts` + strip-types | 包名 import，由 vite/tsdown 解析 |
| 禁物 | 可 node:* 内置（node:sqlite 等） | **禁 node:* 内置、禁 node:sqlite**（浏览器无这些） |
| 入口 | `src/index.ts`（cordis 插件） | `src/index.ts`（空 node half）+ `src/client/index.ts`（浏览器 half） |

理由：host 包是 Node 进程内能力，client 包是浏览器呈现，两者运行时不同，必须分面。

### 决策 3 — SlotMap 槽位选择

dsh 的 Web UI 是**会话中心**的（`conversation.*` / composer / input / settings）。@rin 的「资产工作区」功能（仓库浏览、知识库、环境安装）没有现成的「页面」槽位。因此分两种贡献模式：

- **贡献型**（type-only import，注册进 dsh 已有 slot）：settings 面板、工具结果渲染、会话头部、overlay。用 `import type {} from '.../client'` 拉 slot 声明，`ctx.slots.inject(key, () => ctx.slots.register(...))` 注册。
- **声明型**（SlotMap merge，@rin 自建新 slot）：一个 `rin.workspace` 型槽位，承载「仓库/知识库/环境」工作区视图。用 `declare module '@deepseek-ai/dsh-client-ui-slots' { interface SlotMap { 'rin.workspace': {...} } }` 声明。

理由：dsh 有 42 个 SlotMap key（settings.section、conversation.*、tool.call.toolview、shell.overlay 等），但没有「资产工作区页」这个槽位；@rin 的核心差异化（仓库/环境）需要一个自建槽位，其余配置类功能复用 dsh 的 settings.section。

### 决策 4 — 「三处注册」澄清

一个客户端功能要三处登记，对应三个层：

1. **host 层**：@rin host 插件提供数据服务（`ctx.repository`、`ctx.knowledge` 等）。
2. **client 层**：@rin client 插件的 `slots.register` 提供组件。
3. **装配层**（机械三处）：`web-app/cordis.patch.yml` 的 `dsh.client` 行 + `web-app/package.json` 依赖 + `tsconfig.client.json` 聚合 references。

理由：host 提供数据、client 提供 UI、装配把它们接进 web-app。缺任一层，能力在界面上不可见或无法加载。

## 3. 客户端扩展架构速览

- **SlotMap**（`@deepseek-ai/dsh-client-ui-slots`）：declare-merge 表。每个 slot 有 `kind`（single/list/keyed/chain）与 `scope`（root/session-maybe/session）。所有者声明，注册者贡献。
- **runtime**（`@deepseek-ai/dsh-client-runtime`）：浏览器运行时，提供 `SlotRegistry`、`ClientContext`、session/projection 对象层。
- **AppWebEntry**（`@deepseek-ai/dsh-client-web`）：web shell 库入口，聚合 `ui-*` 包并装配成页面。
- **cordis-client-runner + slot-catalog**：`gen-client-catalog.ts` 从 SlotMap 声明生成编译期契约（`slot-catalog.ts`），是「哪些 slot 可注册、kind/scope、谁已占位」的权威清单。42 个 key。
- **两种贡献模式**：type-only import（贡献到已有 slot，如 ui-goal 注册进 conversation 的 dock 座）；SlotMap merge（声明新 slot，属主）。
- **组件四份额**：owner props + framework standard props（useSession/useProjection 等）+ store seat + inject face。业务数据走 projection/remote，不落本地 store。

## 4. 功能适配映射表

| 设计参考（页面） | @rin client 插件 | SlotMap key | kind/scope | host 数据源 | 优先级 |
|---|---|---|---|---|---|
| RepositoryWorkspace | @rin/client-ui-repository | `rin.workspace.repository`（自建） | single/root | ctx.repository | HIGH |
| 环境安装/verification | @rin/client-ui-environment | `rin.workspace.environment`（自建） | single/root | ctx.environment | HIGH |
| KnowledgeSpace | @rin/client-ui-knowledge | `rin.workspace.knowledge`（自建） | single/root | ctx.knowledge | HIGH |
| PromptMemory 编辑 | @rin/client-ui-prompt-memory | `settings.section` | list/root | ctx.promptMemory | HIGH |
| SkillMemory 面板 | @rin/client-ui-skill-memory | `settings.section` | list/root | ctx.skill-memory | HIGH |
| SessionSearch 搜索 | @rin/client-ui-session-search | `conversation.session.header` 或 `shell.overlay` | single/session | ctx.session-search | HIGH |
| 进化/技能学习 | @rin/client-ui-evolution | `settings.section` | list/root | ctx.evolution | HIGH |
| TokenOptimization 开关 | @rin/client-ui-token-optimization | `settings.section` | list/root | ctx.token-optimization + smart-pruning | HIGH |
| Monitor | @rin/client-ui-doctor | `settings.section` 或 `shell.overlay` | — | 诊断服务 | LOW |
| SessionBackup / Notes | @rin/client-ui-notes | `settings.section` | list/root | 会话持久化 | LOW |
| ComputerUseSettings | @rin/client-ui-computer-use | `settings.section` | list/root | computer-use | MEDIUM |
| AgentMigration | @rin/client-ui-agent-migration | `settings.section` | list/root | agent-migration | MEDIUM |
| ActiveSession / 对话 / 输入 / diff | dsh 已自带 | — | — | — | 不重写 |

关键：`rin.workspace.*` 三个自建槽位是 @rin 的差异化 UI 承载点；其余复用 dsh 的 settings.section / conversation / shell.overlay。

## 5. client 插件骨架模板

以 `@rin/client-ui-repository` 为例，四个文件 + 三处装配。

- `package.json`：`name` 为 `@rin/client-ui-repository`；`type: module`；`exports` 含 `.` / `./invariant` / `./client`（指向 lib/client.js）/ `./src/*` / `./package.json`；`dsh.client` 为 `{ inject: ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-ui-slots", ...], platform: "web" }`；peerDependencies 含 `@deepseek-ai/cordis` + 用到的 dsh client 包 + `react`；`scripts.bundle: tsdown`；无 node:* 内置、无 node:sqlite。
- `tsconfig.json`：extends `tsconfig.base.client.json`；`rootDir: src`、`outDir: lib/types`；references 每个 workspace 依赖 + `vendor/cordis` + `runtime-diagnostics/invariants`。
- `src/index.ts`（node half）：空 `apply()`。业务能力在 host 插件，不在 client 的 node half。
- `src/invariant.ts`（伴生）：`inject: ['invariants']` + 空 installer（slot 注册由 registry 观察，无运行时不变式）。
- `src/client/index.ts`（浏览器 half）：`inject: ['slots', ...]` + `apply(ctx: ClientContext)`，体内 `ctx.slots.inject('rin.workspace.repository', () => ctx.slots.register({ name: 'rin.workspace.repository', locale: NS }, Component))`。
- `src/client/slots.ts`（注入 face 类型）：`declare module '@deepseek-ai/dsh-client-ui-slots' { interface SlotMap { 'rin.workspace.repository': { kind: 'single', scope: 'root', owner: {...} } } }`。

## 6. 端到端接线图

`@rin/repository`（host：ctx.repository 读九类资产）
  → Remote API（typert 生成，经 api-remotes 暴露到浏览器）
  → `@rin/client-ui-repository`（client：slots.register 组件，经 useProjection/remote 取数）
  → web-app 装配（cordis.patch.yml 加 dsh.client 行 + package.json 加依赖）
  → AppWebEntry（web shell）聚合 ui-* 包 → 渲染页面

数据流：host 服务读资产 → 经 Remote API 传到浏览器 → client 组件经 useProjection/remote 取数 → 渲染。业务状态不落本地 store，走 projection。

## 7. MVP 路线图

| 步骤 | 能否在本沙箱做 | 说明 |
|---|---|---|
| 定 SlotMap 自建槽位契约 + 映射表 | ✅ | 本文档 |
| host 侧新增 Remote API 类型（api-remotes 的 client 半） | ⚠️ typecheck 可，spawn 需真机 | 需 typert 生成 |
| client 包骨架（package.json/tsconfig/index.ts/invariant/slots.ts） | ✅ 纯写文件 | 骨架可写，bundle 不能跑 |
| tsdown bundle + test:gui + 视觉验证 | ❌ 必须真机 | spawn EPERM |

MVP 建议顺序：先自建 `rin.workspace.*` 三个槽位 + @rin/client-ui-repository 全链路（host → Remote → client → web-app），在真机验证「三件套」跑通，再复制到其余 8 个 client 插件。

## 8. 风险与开放问题

1. **自建槽位的装配**：`rin.workspace.*` 需要 @rin 自己声明 SlotMap + 在 web-app 装配，dsh 的 AppWebEntry 是否允许 @rin 自建顶层槽位，需真机确认（slot-catalog 只列 dsh 声明的 42 key，@rin 自建的要并入生成器）。
2. **Remote API 生成**：client 取 host 数据要靠 typert 生成的 Remote API（经 api-remotes），@rin host 服务（ctx.repository 等）目前**没有 Remote 半**——这是 client 插件接入的前置缺口，需先给 @rin host 服务补 Remote 类型。
3. **tsdown.client.ts 复用**：@rin client 包在 `rin/client/*`，引用 `packages/client/tsdown.client.ts` 的相对路径更深，需确认 tsdown 配置兼容 @rin 目录。
4. **覆盖门禁**：client 包在 per-file 100% 覆盖门禁内，真机实现时测试量不小。

## 附：实际读过的文件

- MIGRATION.md（权威计划）
- packages/client/ui-slots/src/index.ts（SlotMap / SlotEntryDef / kind / scope / PropsRuntime）
- packages/client/ui-goal、ui-plan、ui-user-questions（package.json / src/client/index.ts / slots.ts / invariant.ts）
- packages/client/runtime/src/client/index.ts（SlotRegistry / ClientContext）
- packages/client/web/src/index.ts（AppWebEntry 所在包）
- packages/extensions/cordis-client-runner/src/client/slot-catalog.ts（42 个 SlotMap key + CLIENT_NOTES）
- scripts/slot-walk.ts（SlotMap merge + register 的 AST 扫描）

设计参考项目（E:\_projects\agent）**可读**：读到 27 个页面（RepositoryWorkspace / KnowledgeSpace / AgentMigration / ComputerUseSettings / TokenOptimization / SessionBackup / Sandboxes / Monitor / Notes 等），页面清单已并入映射表。
