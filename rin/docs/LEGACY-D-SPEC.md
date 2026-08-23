# LEGACY D 类端点接线规格（@rin/web-server）

> 本文档是 D 类端点（辅助桩）接线代理的直接输入。只描述目标响应字段、dsh 数据源、新 thunk、装配缺口，不包含实现。
>
> 适用范围：/api/providers/auth-status、/api/sessions/recent-projects、/api/effort、/api/sessions/{id} 的 git-info / usage / slash-commands 三个子动作。
>
> 只读调研基线（已验证源码）：dsh 侧 packages/credentials/credentials/src/index.ts、packages/workspace/workspace/src/index.ts(+types.ts/entity.ts)、packages/interaction/commands/src/index.ts(+types.ts)、packages/llm/token-meter/src/index.ts(+projection.ts)、packages/shell/shell/src/index.ts(+types.ts)、packages/llm/llm/src/index.ts(+types.ts)、packages/core/agent/src/index.ts、packages/core/agent-default-model/src/index.ts、packages/core/session/src/types.ts、packages/session/session-projection/src/index.ts；装配侧 packages/bundle/base/cordis.patch.yml、packages/bundle/web-app/cordis.patch.yml、rin/bundle/rin/src/cordis.yml、rin/bundle/rin/src/index.ts；旧项目 src/server/api/sessions.ts、api/models.ts、services/providerService.ts、utils/effort.ts、router.ts；现桩 rin/web/web-server/src/routes/legacy.ts。

---

## 0. dsh-base 装配事实（D 类端点相关）

rin 的装配链是 [dsh-base, ...@rin 插件]（rin/bundle/rin/src/index.ts 的 ASSEMBLY_LAYERS），并明确排除 dsh-web-app（cordis.yml 头注 + `../../MIGRATION.md` §8 decision 10）。

packages/bundle/base/cordis.patch.yml 已装配（ctx.<name> 可用）：

| 服务 | 行 | ctx.get 名 | 说明 |
|---|---|---|---|
| credentials | 85-86 | credentials | @deepseek-ai/dsh-credentials-local |
| commands | 250-251 | commands | @deepseek-ai/dsh-commands |
| token-meter | 281-282 | tokenMeter | @deepseek-ai/dsh-token-meter |
| agent-default-model | 63-67 | agentDefaultModel | @deepseek-ai/dsh-agent-default-model |
| session-projection | 126-127 | sessionProjections | @deepseek-ai/dsh-session-projection |
| llm | 24-25 | llm | @deepseek-ai/dsh-llm |
| sessions | 27-28 | sessions | @deepseek-ai/dsh-session |
| session-persistence-jsonl | 98-101 | sessionPersistence | @deepseek-ai/dsh-session-persistence-jsonl |
| shell | 178-186 | shell | bash-sandbox（非 win32）/ pwsh-sandbox（win32） |

未装配（装配缺口，见 §5）：

| 服务 | 位置 | 说明 |
|---|---|---|
| workspace（workspaceRegistry） | 仅在 web-app/cordis.patch.yml:73-74 | dsh-base 没有；rin 没有 |
| storage-domain（storageDomain） | 仅在 web-app/cordis.patch.yml:59-60 | workspace 的 inject=['storageDomain','sessionPersistence'] 前置依赖 |

---

## 1. /api/providers/auth-status

### 现桩（legacy.ts:116）
    { "hasAuth": false, "source": "none" }

### 旧项目语义（providerService.ts:865-901 checkAuthStatus）
    { hasAuth: boolean, source: 'legacy-provider' | 'original-settings' | 'env' | 'none', activeProvider?: string }
判定顺序：① 旧项目激活 provider 有 apiKey（或 preset 免 key）→ legacy-provider；② 进程 env 有 ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN → env；③ 原旧项目配置目录 settings.json 有上述 key → original-settings；④ 否则 none。

### dsh 数据源

ctx.credentials（CredentialProvider，抽象服务；本地实现 credentials-local 提供 source 层 env / file / project-env / user-env）：

    const credentials = ctx.get('credentials')                    // CredentialProvider | undefined
    await credentials.describe(credentialRef('DEEPSEEK_API_KEY'))
    // → { configured: boolean, source?: 'env'|'file'|'project-env'|'user-env', writable: boolean }
    // 或 resolve(ref) → { value, source } | undefined（不暴露 value 时用 describe）

激活 provider：ctx.agentDefaultModel.currentSelection() → { provider, model, reasoningEffort? }（agent-default-model 在 base）。默认 provider: 'deepseek-official'（base cordis.patch.yml:63-67）。备选：ctx.llm.listProviders() → [{ id, name }]。

凭据引用（apiKeyEnv）是 adapter 自有的 Config 字段，llm 服务没有公开按 provider 查 apiKeyEnv 的读法。已确认出货 adapter：
- llm-deepseek：PROVIDER='deepseek-official'，DEFAULT_API_KEY_ENV='DEEPSEEK_API_KEY'（packages/llm/llm-deepseek/src/index.ts:45-47）。
- web-search-deepseek：apiKeyEnv: DEEPSEEK_API_KEY（base cordis.patch.yml:412）。
- llm-pi-ai：按 settings profile 的 apiKeyEnv（多 provider，动态注册）。

### 推荐映射

    const ref = ACTIVE_PROVIDER_REF[ctx.agentDefaultModel.currentSelection().provider]
    const info = await ctx.credentials.describe(credentialRef(ref))
    // hasAuth = info.configured
    // source 映射：info.source 为 env|project-env|user-env → 'env'；file → 'managed'（新增档，见注）
    // activeProvider = currentSelection().provider

ACTIVE_PROVIDER_REF：建议一个出货 adapter 常量表 { 'deepseek-official': 'DEEPSEEK_API_KEY' }；未知 provider 回退 { hasAuth: false, source: 'none' }。这是当前唯一不侵入 llm 服务的做法。

字段/语义注意：旧 source 词汇（legacy-provider/original-settings）在 dsh 没有对应物。建议保留 hasAuth，source 用三档 'env' | 'managed' | 'none'（managed 对应 dsh 的 file 托管源 $DSH_HOME/.credentials.yaml），并保留 activeProvider。若前端只认旧四个字面量，可退化 env → 'env'、file → 'legacy-provider'（语义最近但易误导，需注释说明）。

---

## 2. /api/sessions/recent-projects

### 现桩（legacy.ts:48）
    { "projects": [] }

### 旧项目语义（api/sessions.ts:732-843 getRecentProjects）
    { projects: Array<{
      projectPath: string   // 会话记录的（脱敏）项目路径
      realPath: string      // 解析后的真实路径
      projectName: string   // realPath 的 basename
      isGit: boolean        // git rev-parse --is-inside-work-tree === 'true'
      repoName: string|null // git remote get-url origin 解析出的 owner/repo；无则 null
      branch: string|null   // git rev-parse --abbrev-ref HEAD
      modifiedAt: string    // 该路径最新会话的 modifiedAt（ISO）
      sessionCount: number  // 该路径去重后的会话数
    }> }
查询参数 limit（默认 10，clamp 1..500）；30s 内存缓存；按 modifiedAt 降序。

### dsh 数据源

ctx.workspaceRegistry（WorkspaceRegistry；list() 同步、已按 durable order 排序——bootstrap 按 newestAt 降序，create 前插）：

    const registry = ctx.get('workspaceRegistry')   // WorkspaceRegistry | undefined
    registry.list()                                  // Workspace[]
    // Workspace = { id, path(规范化真实路径), title, createdAt, updatedAt, sessionIds,
    //               setTitle, attachSession, insertSessionBefore, detachSession,
    //               status(): Promise<'ok'|'missing-dir'> }

字段映射：

| 旧字段 | dsh 来源 |
|---|---|
| projectPath | workspace.path（规范化路径；旧项目区分 projectPath/realPath，dsh 只有一份 path，二者可同值） |
| realPath | workspace.path |
| projectName | workspace.title（默认即 basename(path)） |
| modifiedAt | workspace.updatedAt |
| sessionCount | workspace.sessionIds.length |
| isGit / repoName / branch | 用 ctx.shell 对 workspace.path 跑 git（见 §4 git-info 的 shell 用法），失败/非 git 仓库 → false / null / null |

注意：workspace.updatedAt 是最后一次 durable 变更（含 create）的时间戳，不是该路径最新会话活动时间；若前端对排序敏感，可改用 sessionPersistence.list()（已有 { id, createdAt, cwd }）按 cwd 分组取 max(createdAt) 作为 modifiedAt。规格默认用 workspaceRegistry.list() 的既有顺序 + updatedAt，接线时按前端反馈决定是否引入分组重排。

### 装配缺口
workspaceRegistry 不在 rin 装配里（见 §0）。此端点要落地，必须先补 storage-domain + workspace 两行（见 §5）。若暂不补装配，退路是用已有的 sessionPersistence.list() 按 cwd 分组做等价投影（无 workspace 语义，git 信息仍可经 ctx.shell 补齐）——需在接线时与委托方确认取舍。

---

## 3. /api/effort

### 现桩（legacy.ts:113）
    { "level": "medium", "available": ["low", "medium", "high"] }

### 旧项目语义（models.ts:234-252 + utils/effort.ts）
- GET：{ level, available: ['low','medium','high','max'] }（level 来自 settings，默认 medium）。
- PUT { level }：校验后持久化到用户 settings。
- utils/effort.ts 结论：档位 ['low','medium','high','max']，但判定链深度依赖旧项目商业逻辑——Anthropic 订阅档（Pro/Max/Team isProSubscriber 等）、模型白名单（Opus 4.6/4.8、Sonnet/Haiku 排除）、ultrathink 特性开关、GrowthBook 远程配置、USER_TYPE==='ant' 内部档、CLAUDE_CODE_EFFORT_LEVEL env、max 对非 Opus-4.6 降级为 high。这些在 dsh 里都不存在。

### dsh 侧对应物
dsh 有 reasoningEffort，但形态完全不同：
- 类型：ReasoningEffortId（Branded<'ReasoningEffortId'> 不透明字符串，adapter 自有词汇；packages/llm/llm/src/brand.ts）。
- 出货 deepseek adapter 词汇：'off' | 'high' | 'max'（llm-deepseek/src/index.ts:70,95；官方 API reasoning_effort 只收 'high'|'max'，low/medium 服务端归并到 high）。
- 读取：ctx.agentDefaultModel.currentSelection().reasoningEffort（可缺省）。

### 处理建议（明确推荐：保持档位桩）

保持 { level: 'medium', available: ['low','medium','high'] } 的只读档位桩，不映射 reasoningEffort。理由：
1. 词汇不匹配：旧档位 low/medium/high/max vs deepseek off/high/max，且 low/medium 在 deepseek 语义里被归并——把 dsh 的 reasoningEffort 套进旧 UI 的 low/medium/high 选择器是语义错误，不是翻译。
2. 判定链不可复刻：旧 level 由订阅档 + 模型白名单 + 特性开关 + 远程配置共同决定，dsh 无对应输入。
3. 写路径错位：旧 PUT 持久化的是 Claude Code 的 effort 设置；dsh 的推理档由 agent-default-model（+ settings 段 agent-default-model）承载，非旧 effort 通道，强接会污染模型选择语义。
4. 前端可渲染：桌面 UI 只消费 { level, available } 做选择器；档位桩保持该 UI 可用，且 available 收窄为三档（去掉 max）与 dsh 无 max 商业档一致。

如后续确实要打通写路径，正确目标是 ctx.agentDefaultModel.saveSelection({ ...current, reasoningEffort })（agent-default-model/src/index.ts:98），且仅接受 'off'|'high'|'max'；此改动能动模型选择，应单独立项，不在本次 D 类接线范围内。

---

## 4. /api/sessions/{id} 的三个子动作

接线时这三个动作都在 sessionsItemRoute（legacy.ts:1125-1180）里展开。

### 4.1 git-info（现桩 legacy.ts:1159）

现桩：{ branch: null, repoName: null, workDir: '', changedFiles: 0 }

旧语义（api/sessions.ts:602-661）：取会话 workDir，跑三条 git 命令；非 git 仓库/失败 → 全空。响应 { branch, repoName, workDir, changedFiles }。

dsh 数据源：

workDir 取会话 header.cwd：
    const store = ctx.get('sessions')      // SessionStore（base 装配）
    const session = store.get(id)           // Session（含 header/events/seq）
    const workDir = session?.header.cwd     // SessionHeader.cwd（packages/core/session/src/types.ts:73）

git 命令经 ctx.shell：
    const shell = ctx.get('shell')          // ShellExecutor（base 的 bash-sandbox/pwsh-sandbox 注册）
    const run = async (cmd) => {
      const spec = shell.resolve({ command: cmd, workdir: workDir })
      const res = await shell.run(spec)     // ShellRunResult { exitCode, stdout: CollectedOutput{ text, truncated, spillPath? }, ... }
      return res.exitCode === 0 ? res.stdout.text.trim() : null
    }
    const branch = await run('git rev-parse --abbrev-ref HEAD')
    const remote = await run('git remote get-url origin')
    const changed = await run('git status --porcelain')
    // repoName = remote 解析（/ : 正则，同旧项目）；changedFiles = changed 非空行数

失败/非 git（exitCode 非 0 或命令异常）→ { branch: null, repoName: null, workDir, changedFiles: 0 }（保留 workDir，与旧项目一致）。

### 4.2 usage（现桩 legacy.ts:1161）

现桩：{ usage: null, context: null }

旧语义（api/sessions.ts:546-579）：
    {
      usage: { totalInputTokens, totalOutputTokens, totalCacheReadInputTokens, totalCacheCreationInputTokens }, // 累计
      context: { model, usedTokens, contextWindow, percentage, latestTurn?: { inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens } } | null
    }

dsh 数据源（两条可独立读的 seam，均已在 base 装配）：

a) ctx.tokenMeter.measure(session)（同步、重放感知）
    const meter = ctx.get('tokenMeter')
    const m = meter.measure(session)   // TokenMeasurement
    // m = { logRevision, baseline: {kind:'none'|'estimated'|'usage', tokens, usage?: TokenUsage},
    //       surfaceDeltaTokens, totalTokens, surfaceTokens, nodes }
    // baseline.kind==='usage' 时 baseline.usage = { inputTokens, outputTokens, cacheReadTokens?, cacheWriteTokens?, reasoningTokens? }

b) ctx.sessionProjections.snapshot(session)（累计 provider 用量 + 上下文占用，最贴近旧语义）
    const projections = ctx.get('sessionProjections')
    const snap = projections.snapshot(session)   // { asOfSeq, values }
    // values.tokenUsage = { uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }   ← 累计 provider 用量
    // values.contextPressure = { pressureTokens?, projectedTokens?, contextWindow? }                   ← 最新请求压力 + 最新 route 容量
（tokenUsage/contextPressure/contextBreakdown 由 token-meter 在 token-meter/src/projection.ts 注册进 sessionProjections。）

推荐映射（优先 b，回退 a）：

| 旧字段 | dsh 来源 |
|---|---|
| usage.totalInputTokens | values.tokenUsage.uncachedInputTokens + cacheReadTokens + cacheWriteTokens（旧项目 totalInputTokens 是含缓存合计；若前端分开算则保留四桶） |
| usage.totalOutputTokens | values.tokenUsage.outputTokens |
| usage.totalCacheReadInputTokens | values.tokenUsage.cacheReadTokens |
| usage.totalCacheCreationInputTokens | values.tokenUsage.cacheWriteTokens |
| context.model | ctx.agentDefaultModel.currentSelection().model（或最新 request/header 事件里的 model，可选） |
| context.usedTokens | values.contextPressure.projectedTokens ?? pressureTokens ?? meter.measure(session).totalTokens |
| context.contextWindow | values.contextPressure.contextWindow（无则 null；也可 ctx.llm.resolveModelInfo(provider, model) → context.contextWindow 兜底） |
| context.percentage | usedTokens / contextWindow * 100（contextWindow 未知 → 省略或 null） |
| context.latestTurn | 无直接对位；token-meter 的 usage 桶是最近一次成功请求而非最近一轮，建议省略该字段（旧项目仅在有 apiUsage 时附带） |

无实时会话/无投影值 → 保持 { usage: null, context: null }。

### 4.3 slash-commands（现桩 legacy.ts:1158）

现桩：{ commands: [] }

旧语义（api/sessions.ts:409-429）：{ commands: [{ name, description }] }（workDir 的 skill 目录命令，过滤 userInvocable !== false）。

dsh 数据源：

ctx.commands（CommandRuntime）+ ctx.agents（AgentRegistry；agent id === session id，见 packages/core/agent/src/index.ts:476-478）：

    const agents = ctx.get('agents')         // AgentRegistry
    const agent = agents.get(sessionId)      // Agent | undefined（sessionId 即 agentId）
    const commands = ctx.get('commands')     // CommandRuntime
    const descriptors = agent ? commands.list(agent) : []   // readonly CommandDescriptor[] = { name, description, input? }
    const out = descriptors.map(({ name, description }) => ({ name, description }))

注意/缺口：
1. CommandRuntime.list(agent) 必须传 Agent（list() 无无参全局版），因此只能为实时会话（agents.get(sessionId) 命中）列出命令；非实时会话返回 { commands: [] }（与现桩一致）。这是 dsh 命令 registry 的现状约束——如需为非实时会话列出全局命令，需要 dsh 侧新增 listGlobal()，属 dsh 改动，不在本次 @rin 接线范围。
2. 现有 DshAgentRegistryLike.get(id) 类型（web-server/src/routes.ts:77）标注返回 DshAgentHandleLike，但真实 AgentRegistry.get(id) 返回裸 Agent；接线时需修正该结构类型为 get(id): DshAgentLike | undefined（DshAgentLike 已有 id/session/ctx/followup 等字段），并把 commands.list 的入参以结构化视图（as unknown as）传真实 agent。

---

## 5. 需要加到 web-server/src/index.ts services refs 的新 thunk 清单

RinServiceRefs（web-server/src/routes.ts:92-110）新增以下 thunk，index.ts:76-94 的 services 对象同步补 ctx.get(...)（沿用现有 as unknown as 结构视图模式，避免 web-server 依赖 dsh 包图）：

| thunk | ctx.get 名 | 建议结构视图（routes.ts 新增接口） |
|---|---|---|
| credentials() | 'credentials' | DshCredentialsLike = { describe(ref: string): Promise<{ configured: boolean; source?: string; writable: boolean }> } |
| workspaceRegistry() | 'workspaceRegistry' | DshWorkspaceRegistryLike = { list(): Array<{ id: string; path: string; title: string; createdAt: string; updatedAt: string; sessionIds: readonly string[]; status(): Promise<string> }> } |
| commands() | 'commands' | DshCommandsLike = { list(agent: unknown): readonly Array<{ name: string; description: string; input?: { hint: string } }> } |
| tokenMeter() | 'tokenMeter' | DshTokenMeterLike = { measure(session: unknown): { totalTokens: number; surfaceTokens: number; baseline: { kind: string; tokens: number; usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number } } } } |
| sessionProjections() | 'sessionProjections' | DshSessionProjectionsLike = { snapshot(session: unknown): { asOfSeq: number; values: { tokenUsage?: { uncachedInputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }; contextPressure?: { pressureTokens?: number; projectedTokens?: number; contextWindow?: number } } } } |

已有 thunk 需调整（不新增服务，只改类型/读取方式）：
- dshAgents()（'agents'）：DshAgentRegistryLike.get(id) 改为返回裸 agent（DshAgentLike），供 slash-commands 用。
- sessions()（'sessions'）：DshSessionStoreLike.get(id) 返回的真实 Session 需带上 header.cwd 与 seq（现有 DshSessionLike 只有 id/events）。为 git-info（cwd）与 usage（传给 tokenMeter/sessionProjections 的完整 Session）扩展 DshSessionLike 增加 header?: { cwd?: string }、seq?: number（运行时对象本就是完整 Session，仅类型层补字段）。

---

## 6. 装配缺口（需在 bundle 加 provider 的说明）

| 缺口 | 影响端点 | 处置 |
|---|---|---|
| workspace（@deepseek-ai/dsh-workspace）未装配 | recent-projects | 在 rin/bundle/rin/src/cordis.yml 增加一行 |
| storage-domain（@deepseek-ai/dsh-storage-domain）未装配 | recent-projects（workspace 的前置） | 同上，需与 workspace 同层加入 |

具体：rin/bundle/rin/src/cordis.yml 的 - insert: 列表里新增两行（建议放在 repository 之前或 web-server 之前均可，行序无加载语义，服务可用性驱动激活）：

    - id: storage-domain
      name: '@deepseek-ai/dsh-storage-domain'

    - id: workspace
      name: '@deepseek-ai/dsh-workspace'

（WorkspaceRegistry.inject = ['storageDomain','sessionPersistence']，两者都必须在；sessionPersistence 已在 dsh-base。web-app 同款行见 packages/bundle/web-app/cordis.patch.yml:59-74。）

其余 D 类端点（auth-status / effort / git-info / usage / slash-commands）依赖的服务全部已在 dsh-base，无装配缺口。

---

## 7. 无法在 @rin 包内解决的问题

1. auth-status 缺按 provider 查 apiKeyEnv 的公开 API：llm 服务不暴露 adapter 的 apiKeyEnv，只能靠出货 adapter 常量表（当前仅 deepseek-official → DEEPSEEK_API_KEY）或后续在 llm 服务补 describeProviderAuth(provider)。多 provider（pi-ai 动态 profile）场景本表覆盖不全。
2. slash-commands 非实时会话无法列出：CommandRuntime.list(agent) 必须传 Agent，无全局无参列表。给非实时会话返回命令需要 dsh 侧新增 API（如 listGlobal()）。
3. effort 语义不可映射：见 §3，保持档位桩是唯一诚实选项；打通需走 agentDefaultModel.saveSelection 且仅 off/high/max，另立项目。
4. recent-projects 的 modifiedAt 语义偏差：workspace.updatedAt 是 durable 变更时间，非会话活动时间；如需严格按会话活动排序，需改用 sessionPersistence.list() 分组或扩展 workspace 记录。
5. usage 的 latestTurn 无对位：dsh 的 usage 桶是最近一次成功请求，不是最近一轮；建议省略该字段或后续在 session-stats/telemetry 侧补。

---

## 附：关键源码位置索引

- 现桩：rin/web/web-server/src/routes/legacy.ts（48 / 113 / 116 / 1158-1161）。
- dsh 服务：packages/credentials/credentials/src/index.ts；packages/workspace/workspace/src/index.ts + types.ts；packages/interaction/commands/src/index.ts；packages/llm/token-meter/src/index.ts + projection.ts；packages/shell/shell/src/index.ts + types.ts；packages/llm/llm/src/index.ts + types.ts；packages/core/agent/src/index.ts；packages/core/agent-default-model/src/index.ts；packages/core/session/src/types.ts；packages/session/session-projection/src/index.ts。
- 装配：packages/bundle/base/cordis.patch.yml；packages/bundle/web-app/cordis.patch.yml；rin/bundle/rin/src/cordis.yml；rin/bundle/rin/src/index.ts。
