# Phase 9 — seam projection 接入矩阵（执行清单）

> 状态：**Phase 9 已完成（2026-08-15，8 个子代理并行实现 + 主线程收口）**。
> 8 个缺口全部接入并通过 `pnpm rin:typecheck` + 9 个 seam 冒烟 + 5 个回归冒烟；
> 全部 11 个 @rin host 插件已投影进 dsh seam（knowledge/notes/token-optimization 此前已接入）。
> 本文档保留矩阵与 API 速查作为维护参考；权威规划见根级 MIGRATION.md。

## 0. 交付摘要（子代理实现）

| # | 包 | 落地文件 | 验证 |
|---|---|---|---|
| 1 | prompt-memory | `src/seam.ts` + `src/projection.ts`（inject systemPrompt，section order 50 + assemble 刷新） | PROMPT-MEMORY-SEAM-SMOKE-OK ✅ |
| 2 | session-search | `src/seam.ts` + `seam-core.ts` + `projectSession.ts` + `tools-core.ts`（session/created+disposed 索引 + rin_session_search/stats） | SEAM-SMOKE-OK ✅ |
| 3 | skill-memory | `src/seam.ts` + `catalog.ts`（ctx.skills.registerProvider，providerName rin-skill-memory） | SEAM-SMOKE-OK ✅ |
| 4 | agents | `src/seam.ts`（agent/created 触发 + 指纹去重，autoProject 开关） | AGENTS-SEAM-SMOKE-OK ✅ |
| 5 | environment+sandboxes | `sandboxes/src/seam.ts`（ctx.shell resolve/run 折叠 StageExecutionResult，dryRun 开关） | SEAM-SMOKE-OK + SANDBOXES/EXEC 回归 ✅ |
| 6 | smart-pruning | `src/seam.ts` + `seam-core.ts`（agent/pre-step 去重+替代读折叠，level 热生效） | SEAM-SMOKE-OK ✅ |
| 7 | evolution | `src/seam.ts`（autoTrigger opt-in）+ bundle cordis.yml reviewModel 适配器修复（ContentBlock 契约 + finish 错误处理） | EVOLUTION + BUNDLE-REVIEW-MODEL-SMOKE-OK ✅ |
| 8 | repository | `src/seam.ts` + `browse.ts` + `tools.ts`（repository_search/read 九类资产浏览） | SEAM-SMOKE-OK + BUILTIN 回归 ✅ |

收口：`pnpm install --lockfile-only`（新增 dsh-tools/dsh-skill workspace 依赖）→ `pnpm rin:typecheck` 通过 → 9+5 冒烟全绿 → 统一提交。

## 1. 接入矩阵

| # | @rin 包 | 目标 dsh seam | 现状 | 缺的注册代码 | 优先级 |
|---|---|---|---|---|---|
| 1 | prompt-memory | systemPrompt | 独立服务；"Projection into system prompt is the NEXT milestone" | inject ['systemPrompt'] + 注册 prompt-memory 段落（user memory + soul + brief，受 budget 约束） | **P0** |
| 2 | session-search | session 事件 + tools | 独立服务；"Projection into dsh tool seams is the NEXT milestone" | 监听 session/created（global）与后续会话事件 → 写 SQLite FTS 索引；注册检索工具（**不可用 session_search 名，dsh tool-session-query 已占用**） | **P0** |
| 3 | skill-memory | skills | 独立服务（gate/lifecycle/store） | ctx.skills.registerProvider：把 skill-memory 仓库暴露为 skill provider（discover/get） | **P0** |
| 4 | agents | agentPresets | projectRepositoryAgents() 已实现但**无触发点**（apply 只挂 store） | 监听 agent/created（global，payload {agent}）→ 自动投影 repository agents 到 agent-presets 用户根 | **P0** |
| 5 | environment + sandboxes | shell / subprocess | 服务 + exec.ts 状态机，无执行通道 | 环境安装执行经 ctx.shell（ShellExecRequest/ShellRunResult）跑真实命令；sandbox profile 装配到 dsh sandbox 语义 | **P1** |
| 6 | smart-pruning | toolResultPruner / compaction | inject = []，无任何钩子 | 接入 ctx.toolResultPruner（或监听 compaction/prune 会话事件）按 level 参数化裁剪 | **P1** |
| 7 | evolution | llm / subagent | 服务就绪；bundle 的 cordis.yml 已提供真实 reviewModel 适配器（launcher 装配） | 验证 reviewModel 链路（默认配置仅 placeholder）；补自动触发（按配置开关） | **P1** |
| 8 | repository | tools | 独立服务（九类资产读写/校验/迁移/种子） | 注册资产浏览工具（repository_search / repository_read） | **P2** |
| — | knowledge | tools | ✅ 已接入（knowledge_search/knowledge_stats） | — | — |
| — | notes | tools | ✅ 已接入（NotesTool） | — | — |
| — | token-optimization | systemPrompt | ✅ 已接入（section + assemble 清理） | — | — |

## 2. dsh seam API 速查（实现时引用）

### 2.1 tools — ctx.tools.register(defineTool({...}))
- 包：@deepseek-ai/dsh-tools（**真实依赖**，范例：rin/memory/knowledge/src/index.ts、rin/notes/notes/src/index.ts、packages/session-query/tool-session-query/src/index.ts）
- 字段：name / description / parameters / output.schema(+render) / execute / presentCall

### 2.2 systemPrompt — section + assemble
- 结构型 seam（不依赖 dsh 包），范例：rin/optimization/token-optimization/src/store-core.ts 的 TokenOptimizationSeam
- ctx.systemPrompt.section({ name, order, text }) => disposer；ctx.on('system-prompt/assemble', (assembly, context, next) => ...)
- inject: ['systemPrompt']

### 2.3 skills — ctx.skills.registerProvider(control => provider)
- 包：@deepseek-ai/dsh-skill（建议真实依赖），范例：packages/skill/skill-filesystem/src/index.ts（providerName / inject: ['skills'] / registerProvider / discover / get / dispose）
- provider 返回 candidates（含 name/rank/loader），winning candidate 再经 get() 取 body

### 2.4 agentPresets — 用户根投影
- 包：@deepseek-ai/dsh-agent-presets（agents 已依赖），writableRoot(roots) + copyComposition / 删除；用户根 .agent-presets（USER_PRESET_DIR）
- 触发：ctx.on('agent/created', ({ agent }) => ...)（global；范例 packages/schedule/schedule/src/index.ts:45）

### 2.5 session 生命周期（session-search 索引触发）
- ctx.on('session/created', (session) => ..., { global: true })（范例 packages/goal/goal/src/index.ts:54）
- 会话事件流经 agent/session 的 ctx；ctx.sessionQuery 提供读接口（@deepseek-ai/dsh-session-query）
- ⚠️ 命名冲突：dsh tool-session-query 已注册 session_search / session_event_search / session_trace 等 5 工具——rin 检索工具用 rin_session_search 等前缀，description 里说明差异化（跨工作区全文 + 项目记忆 + transcript 全文）

### 2.6 shell — 环境安装执行通道
- ctx.shell：ShellExecRequest / ShellExecSpec / ShellProcess / ShellRunResult（packages/shell/shell/src/types.ts）；结构型即可
- 范例参考 packages/shell/tool-bash 怎么消费 shell seam

### 2.7 toolResultPruner / compaction
- ctx.toolResultPruner.pruneContent(blocks) / pruneSession(session)（@deepseek-ai/dsh-compaction-tool-result-pruner）
- 会话事件 compaction/start | summary | end | prune（packages/compaction/compaction/src/types.ts）

## 3. 实现约定（仓库分区整洁）

1. **seam 注册代码单文件集中**：每个包在 src/ 下新增 seam.ts（注册逻辑 + 结构型 seam 类型），index.ts 的 apply() 保持薄：ctx.plugin(Store, config) + registerSeam(ctx, config)（对齐 knowledge/notes 的 registerTools 既有模式）。
2. **类型策略**：结构型 seam（systemPrompt / shell / session 事件 / toolResultPruner）不新增依赖，在 seam.ts 内定义最小接口（参考 token-optimization 的 TokenOptimizationSeam）；tools / agentPresets / skills 需要真实类型与工具函数时走真实依赖（dsh-tools / dsh-agent-presets / dsh-skill，workspace:^，加入 package.json dependencies）。
3. **可测性**：注入/索引/裁剪逻辑放纯函数模块（store-core 风格），strip-types 冒烟可测；seam.ts 只做接线。
4. **不注册重复能力**：dsh 已覆盖的（session_search、tool-result pruner 主体）不重做，只做差异化补强。
5. **装配**：bundle 的 cordis.yml 除新增 config 外不需要改（所有包已在 RIN_HOST_PLUGINS）；新增依赖由主线程统一 pnpm install + lockfile。

## 4. 验证方式（子代理交付标准）

- 每个接入点带 strip-types 冒烟测试（tests/*.smoke.ts，node --experimental-strip-types 直接跑），覆盖：注册生效（disposer 可清理）、触发点被调用（fake ctx 事件）、注入/索引内容正确。
- 不改 package.json 的包：主线程跑 pnpm rin:typecheck 收口。
- 子代理不 commit、不跑 pnpm install。

## 5. 子代理分工（并行批次）

- **批次 A（P0，4 并行）**：prompt-memory→systemPrompt；session-search→session 事件+工具；skill-memory→skills provider；agents→agent/created 自动投影。
- **批次 B（P1/P2，4 并行）**：environment+sandboxes→shell 执行；smart-pruning→toolResultPruner；evolution→reviewModel 验证+触发；repository→资产浏览工具。
- **收口（主线程）**：评审（seam 三角齐全、冒烟通过、README 门禁）→ pnpm install --lockfile-only → pnpm rin:typecheck → 统一提交。
