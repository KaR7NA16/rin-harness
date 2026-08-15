# rin-harness 迁移与构建方案（旧项目 → rin-harness，第四轮审计修订版）

> 单一权威规划文档。取代并清理历史文档：rin-harness-plan.md（v3）、rin-harness-rebranding-plan.md、rin-harness-brand.md、agent/rin-harness-rename-plan.md、PHASE4-CLIENT.md（其功能适配映射表并入本文 §4）。
> 既往对话记录 = 本仓库 git 历史 + 本文档前轮 + PHASE4-STANDALONE.md（独立 Web UI 架构与 API 契约，继续有效）。
> 现状：旧项目 v1.4.9（Bun + Ink TUI + Tauri 桌面端）→ rin-harness（dsh 底座 + @rin 资产层）。

## 0. 结论

dsh 给「组合 + 运行时」，rin 给「资产 + 环境」。第一公民是 Asset Repository（九类资产单一事实源）。迁移 = 把旧项目的差异化能力重写为 @rin 插件挂在 dsh 底座上，砍掉上游包袱与 UI 重写，复用 dsh 的 loop/工具/会话/沙箱/多模型。

已落地：@rin/repository（reader/writer/validation/migration/seed 全量）、@rin/environment（预检 + 分阶段安装计划）、记忆域 4 包（knowledge / prompt-memory / skill-memory / session-search）、evolution、token-optimization（响应风格开关 + prompt 清理开关）+ smart-pruning（级别）、独立 Web UI（8320，v2 API + React 8 页）、全新 git 仓库 main 主支、裁 codex/claude 子代理。

**第四轮审计与方案修订要点**（相对上一轮）：

1. **审计补漏**：旧项目的 `src/server/services/` 编排层（约 45 文件：agentService、agentProposalService、repositoryService、repositoryCatalog、sandboxService、environmentInstallService、notesService、sessionBackupService、sessionRewindService、cronService、codeGraphService、monitorService 等）此前未单独成册，本轮全部归类（§2.13）；桌面新增页面 AgentWorkspace、Sandboxes、SessionBackup、EmptySession、ExecutionBehaviorSettings、aiConfigurationPrompts 已入册。
2. **三个「半成品」升为一等公民并排期**：笔记（Notes 模块 + NotesTool + Notes 页 + 9 组件）、知识空间（knowledge 包 + KnowledgeSpace 页 + 检索工具）、仓库接入 agent 与 sandbox 配置（agents/environments 资产 → agent-presets 投影 + sandbox profile 装配 + 环境计划执行）。完整链设计见 §6。
3. **token 优化缩略**：UI 收敛为「响应风格开关 + prompt 清理开关 + 智能裁剪级别滑块」三个控件；旧五栈（caveman/lite/ponytail/rtk/smart-pruning）与 codeGraph 预算折叠进去，不再各自成包成页（§5）。
4. **UI 三面共存**：dsh 原生 Web UI（3080）保留、默认不随 rin 启动、可配置关闭、永不改动（便于随上游更新）；rin Web UI（8320）独立；rin GUI 桌面壳（Tauri 2 内嵌 rin web-ui）新建——TUI 取消（dsh 自身 TUI 已删，见 note 2026-08-04；dsh 生态已有多款社区 TUI，重复价值不显）。
5. **目录结构重设计**（§1.1）与 **dsh/rin 更新迭代契约**（§9）：dsh 所有目录零改动，rin 全部落在 `rin/`，根级合并点收敛为 3 个文件。

## 1. 目标架构

rin 不是 dsh 的平行层，而是 dsh 的插件生态。它只做两件事：(1) 把能力注册进 dsh 已有的 seam（compaction / subagent / shell / lsp / skill / tool / agent-presets / sandbox）；(2) 引入唯一一个新 seam：资产仓库 ctx.repository。

- 划界从「命名空间」换成「seam」：@rin/* 只是标签，每个 rin 插件最终挂在 dsh 的某个 seam 上。
- 投影机制：按 seam 分层——运行时注册型 seam（system-prompt / compaction / subagent / skill）用 effect-based 注册；文件型 seam（agent-presets 的 preset 目录）用生成式投影（从仓库资产生成 agent.cordis.yml）。两种机制并存，不是单一「运行时投影」。
- ctx.repository 是普通 service（像 ctx.llm），非特权核心；「第一公民」指生态中心插件。

### 1.1 目录结构（重设计，目标态）

dsh 上游目录（`vendor/ packages/ apps/ docs/ examples/ website/ scripts/ native/ python/`）**零改动**。rin 的一切落在单一扩展根 `rin/`：

```
rin/                          # rin 唯一扩展根（dsh 之外的一切）
├─ README.md                  # 目录分区权威说明
├─ tsconfig.json              # rin host 包聚合（独立于 dsh 的 host/client 聚合）
├─ core/                      # 资产主轴
│  ├─ repository/             # @rin/repository：schema/reader/writer/validation/migration/seed
│  │  └─ builtin/             # 内置 AssetRepository（repository.yaml + 九根种子资产）
│  └─ environment/            # @rin/environment：预检 + 分阶段计划 + 沙箱执行 + 验证
├─ workspace/                 # 仓库 → agent / sandbox 装配（本轮新增）
│  ├─ agents/                 # @rin/agents：agent 配置 CRUD + agent-presets 投影 + AI 提案
│  └─ sandboxes/              # @rin/sandboxes：sandbox profile + 仓库挂载 + 环境安装执行
├─ memory/                    # 记忆域
│  ├─ knowledge/              # @rin/knowledge（+ 知识检索工具）
│  ├─ prompt-memory/          # @rin/prompt-memory
│  ├─ skill-memory/           # @rin/skill-memory
│  └─ session-search/         # @rin/session-search
├─ notes/
│  └─ notes/                  # @rin/notes：Obsidian 风格笔记 + NotesTool + 会话备份（本轮新增）
├─ optimization/              # token 与输出优化
│  ├─ token-optimization/     # @rin/token-optimization：响应风格开关 + prompt 清理开关
│  └─ smart-pruning/          # @rin/smart-pruning：智能裁剪级别滑块
├─ learning/
│  └─ evolution/              # @rin/evolution
├─ web/
│  ├─ web-server/             # @rin/web-server（8320 独立端口，node:http + JSON API）
│  └─ web-ui/                 # @rin/web-ui（Vite + React SPA，静态产物）
├─ gui/
│  └─ gui/                    # @rin/gui：Tauri 2 桌面壳（内嵌 rin web-ui + 托盘 + spawn host，Phase 8）
├─ cli/
│  └─ rin/                    # @rin/cli：`rin` 启动器（起 host 打印 URL；GUI 壳复用它拉 host，Phase 8）
└─ bundle/
   └─ rin/                    # @rin/bundle：rin 装配层（cordis.yml：dsh-base + @rin 全家，Phase 8）
```

相对上一版：新增 `workspace/`、`notes/`、`gui/`、`cli/`、`bundle/` 五个 group；`core/repository/builtin/` 承载内置仓库种子资产；`web/` 下 web-ui 与 web-server 并列。

- 内层（host）跑 node 进程、生产能力；外层（client）只渲染，消费 host 事件，永不碰 core。
- `rin/tsconfig.json` 是 rin 的聚合，让 rin 包独立进 typecheck（不并入 dsh 的 host/client 聚合）。

### 1.2 九类资产 → dsh seam

environments → @rin/environment（计划）＋ @rin/sandboxes（执行）；agents → @rin/agents（CRUD + 投影）→ agent-presets；skills → skill；workflows → workflow；tools → mcp/hooks；knowledge → @rin/knowledge；policies → permission-presets；outputs → 输出渲染；bundles → bundle。

## 2. 待迁移资产全景（第四轮审计完整清单）

参考根：`<旧项目根>`。旁支目录非源码：`<旧项目根>-local/`（桌面运行残留 + 日志）、`load/`（v1.4.9 rpm/zip/source 发布物）、`tools/`（bun/cargo/rustup 工具链）——不入迁移，仅 `load/` 的发布物作打包参考。

### 2.1 运行时产品（4）

CLI/TUI、Local Server（HTTP/WS）、Desktop（React WebView + Tauri）、IM Adapter（Feishu/Telegram）。

### 2.2 能力模块（11，CONTEXT.md 权威命名）

Knowledge、Skill Memory、Prompt Memory、Session Search、Scheduled Tasks、External Agent Migration、Computer Use、Bridge/Remote、Skillify/Evolution、Token Optimization、Code Graph。

### 2.3 工具（61，目录清单已验证）

AgentTool, AskUserQuestionTool, BashTool, BriefTool, ConfigTool, CtxInspectTool, DiscoverSkillsTool, EnterPlanModeTool, EnterWorktreeTool, ExitPlanModeTool, ExitWorktreeTool, FileEditTool, FileReadTool, FileWriteTool, GlobTool, GrepTool, ListMcpResourcesTool, ListPeersTool, LSPTool, McpAuthTool, MCPTool, MonitorTool, NotebookEditTool, NotesTool, OverflowTestTool, PowerShellTool, PromptMemoryTool, PushNotificationTool, ReadMcpResourceTool, RemoteTriggerTool, REPLTool, ReviewArtifactTool, ScheduleCronTool, SendMessageTool, SendUserFileTool, SessionSearchTool, SkillGateTool, SkillMemoryTool, SkillTool, SleepTool, SnipTool, SubscribePRTool, SuggestBackgroundPRTool, SyntheticOutputTool, TaskCreateTool, TaskGetTool, TaskListTool, TaskOutputTool, TaskStopTool, TaskUpdateTool, TeamCreateTool, TeamDeleteTool, TerminalCaptureTool, TodoWriteTool, ToolSearchTool, TungstenTool, VerifyPlanExecutionTool, WebBrowserTool, WebFetchTool, WebSearchTool, WorkflowTool。

其中 NotesTool 本轮确认为一等公民：list/search/read 三动作，读用户笔记库（旧项目配置目录 notes/），搜索返回 title+snippet，读取返回 markdown 全文。

### 2.4 命令（19）

advisor, bridge-kick, brief, commit, commit-push-pr, createMovedToPluginCommand, force-snip, init, init-verifiers, insights, proactive, repositoryCommands, review, security-review, subscribe-pr, torch, version。

### 2.5 服务 — src/services（27）

- token 优化栈：cavemanOptimization, liteOptimization, ponytailOptimization, rtkOptimization, smartPruningOptimization
- 诊断/监控：claudeAiLimits, codeGraphPreflight, codeGraphTextBudget, diagnosticTracking, tokenEstimation, vcr
- 上游限流（包袱）：mockRateLimits, rateLimitMessages, rateLimitMocking
- 其他：awaySummary, notifier, preventSleep, voice, voiceKeyterms, voiceStreamSTT

### 2.6 包（6，含内部结构）

- asset-repository：types / repository / environment / writer / validation / migration / seed（+ agent.test / environment.test，本轮核实 agent 资产测试）
- knowledge：db / service
- prompt-memory：budget / config / insights / reviewLog / store / seed
- scheduled-tasks：cron / frequency
- session-search：db / indexStore / history / query / transcript / projectMemory / contextTag
- skill-memory：gate / lifecycle / store

### 2.7 仓库分区（9，骨架 + 真实资产）

agents / bundles / environment / environments / knowledge / outputs / policies / skills / tools / workflows。`environments/` 有真实资产：packages/ 五个生态目录（latex / node / python / r / system.yaml）+ profiles/ 三个 profile（scientific-base / bioinformatics-base / mathematical-modeling-base）+ installers/、verifiers/ 空占位（installer/verifier 概念已设计未实现）。`repository/environment/` 另有五个生态目录（latex/node/python/r/system）。本轮核实：agents/、skills/、workflows/ 等仍为 .keep 占位——「仓库接入 agent」是旧项目未完成的半成品。

### 2.8 服务端 API（28 模块，本轮逐一核实）

computer-use、notes、repositories、token-optimization、teams、agents（含 agents.proposals——AI 提案接口）、conversations、sessions、skills、knowledge、prompt-memory、scheduled-tasks、sandboxes（含 sandboxes.aiConfigure——AI 配置沙箱）、providers、models、settings、mcp、monitor、search、status、adapters、agent-migration、filesystem、oauth、plugins。

repositories API 提供多仓库连接管理：list / connect（按路径）/ create（新建仓库）/ disconnect / manifest（PUT 更新）——即「harness 原生仓库」可接入多个仓库，本轮确认为半成品链路的起点。

### 2.9 UI 面

- Ink TUI（src/ink ~110 文件：vendored Ink 框架 components(18)/events/hooks/layout/termio + 产品屏幕 Doctor/REPL/ResumeConversation）——框架是 vendored 依赖，产品屏是设计参考。
- Tauri 桌面（23 页面文件 + 147 组件）：本轮核实页面清单含新增 AgentWorkspace、Sandboxes、SessionBackup、EmptySession、ExecutionBehaviorSettings、aiConfigurationPrompts（AI 配置沙箱提示词）、KnowledgeSpace、RepositoryWorkspace、TokenOptimization、Notes、Monitor、ComputerUseSettings、AgentMigration 等。
- React 组件（34 目录）、hooks（80+）、keybindings 引擎（16 文件）。
- notes 组件（9）：BacklinksPanel、NoteEditor、NoteGraphView、NoteNameDialog、NotePickerModal、OutlinePanel、QuickSwitcher、SnapshotPanel、TodoPanel——@rin/notes 的 Web UI 设计参考。

### 2.10 领域目录

bridge（40+ 文件）、skills（60+ 文件）、memdir、promptMemory、sessionSearch、skillMemory、skillLearning、ssh、remote、daemon、tasks、coordinator、vim、buddy、voice、outputStyles、proactive、environment-runner、self-hosted-runner、upstreamproxy、cli（SSE/WS/Hybrid 传输）、query（QueryEngine）、state、assistant。

### 2.11 设计资产（client/UI/呈现）

- src/components（34 目录 ~360 文件）：messages(45)、permissions(53)、PromptInput(21)、agents(28，含 generateAgent——从描述生成 agent 配置)、tasks(14)、mcp(14)、Spinner(13)、scheduled-tasks(10)、design-system(16)、LogoV2(15)、wizard(6)、sandbox(5)、diff(3)、memory(2)、teams(2)、settings/shell/skills/providers/CustomSelect/HighlightedCode/StructuredDiff/TrustDialog/HelpV2/FeedbackSurvey/Passes/ui/hooks
- desktop/src/components（15 目录 147 文件）：chat、codegraph、controls、layout、markdown、memory、notes、plugins、providers、screenshot、settings、shared、skills、teams、terminal
- Ink TUI 产品屏（3）：Doctor、REPL、ResumeConversation
- editor/companion：vim（motions/operators/textObjects/transitions）、buddy（companion sprite）、voice、outputStyles
- i18n（desktop/src/i18n/locales：en/ja/ko/zh）+ theme（globals）
- 品牌：desktop/public/app-icon.svg（海豹 seal，深蓝渐变底 + 单笔海豹轮廓）
- docs（agent/channel/desktop/features/guide/im/memory/reference/skills + ui-clone/frontend-design 设计参考）

### 2.12 内容资产（prompt/文案/规则）

- model-visible：prompts.ts、systemPromptSections.ts、cyberRiskInstruction.ts
- UI 文案：outputStyles.ts、messages.ts、figures.ts、spinnerVerbs.ts、turnCompletionVerbs.ts、errorIds.ts
- 配置边界：betas.ts、apiLimits.ts、toolLimits.ts、xml.ts、common.ts
- 默认规则：defaults/agent-work-rules、defaults/ponytail-rules

迁移去向：能力资产→@rin host 插件；设计资产→@rin web-ui / gui 设计参考；内容资产→system-prompt sections + i18n 文案 + UI copy（上游派生的只能重写设计，不搬原文）。

### 2.13 服务端编排层 — src/server/services（本轮补录，~45 文件）

agentService（运行态 agent 定义（旧项目配置目录 agents/ YAML/MD） + 仓库 agent 记录 + revision hash）、agentProposalService/agentProposalGenerator（LLM 生成 agent 提案）、repositoryService（多仓库连接 CRUD + ensureDefault）、repositoryCatalog（仓库资源目录：环境 profiles/skills/workflows）、sandboxService（sandbox profile 管理，local-sandbox/container/remote，attachRepositoryToContainer 挂载 /workspace，YAML v2 存储 + 旧 JSON 迁移）、environmentInstallService（安装计划执行状态机 blocked→resolved→approved→provisioning→verifying→ready/failed/rollback-needed + 分阶段日志）、notesService（笔记存储，见 §6.1）、sessionBackupService / sessionRewindService（会话备份/回退）、cronService/cronScheduler、codeGraphService/codeGraphDatabase/codeGraphAnalysis、computerUseApprovalService、conversationService、monitorService、pluginService、providerService、searchService、settingsService、sshService、taskService、teamService/teamWatcher、titleService、applicationVersion、notificationService、permissionPolicy、processRunner、desktopCliLauncherService、mcpHostPreflight、modelImageCapabilityProbe。

## 3. 四分类迁移映射（第四轮）

### 🟢 dsh 已有 → 直接砍（同前，16 组工具 + 会话 UI）

Bash/PowerShell/TerminalCapture→tool-bash/tool-pwsh/tool-terminal；FileRead/Write/Edit→tool-fs + tool-str-replace-editor；Glob/Grep→tool-fs-search；WebFetch/Search/Browser→tool-web + web-*；MCP/McpAuth/ListMcpResources/ReadMcpResource→mcp-client；LSP→lsp + tool-lsp；EnterPlanMode/ExitPlanMode/VerifyPlanExecution→plan-mode；TodoWrite→tool-todo；Workflow→workflow + tool-workflow；AskUserQuestion→user-questions + tool-ask-user；AgentTool→subagent 家族 + tool-subagent；TaskCreate/Get/List/Output/Stop/Update→jobs + tool-jobs；ScheduleCron→schedule；Skill/SkillGate/DiscoverSkills→skill + tool-skill；ConfigTool→settings；ToolSearch→tool catalog；messages/PromptInput/diff/permissions UI→dsh 自带；SessionRewind→dsh session resume 原生。

### 🟡 dsh 有 seam、改写为 @rin 插件

PromptMemoryTool→@rin/prompt-memory（system-prompt）；SkillMemoryTool→@rin/skill-memory（skill）；SessionSearchTool→@rin/session-search（session-query）；CtxInspectTool/SnipTool/force-snip→**dsh 已有 compaction seam**（dsh-compaction/dsh-compaction-basic/tool-result-pruner），@rin/compaction-* 不单独建；BriefTool→@rin/brief、ReviewArtifactTool/review/security-review→@rin/review **后置未排期（未覆盖项，见 §10）**。

token 优化五栈折叠（§5）：cavemanOptimization/ponytailOptimization→@rin/token-optimization 响应风格开关；liteOptimization→@rin/token-optimization prompt 清理开关（deterministic cleaner）；rtkOptimization（终端输出压缩）→@rin/smart-pruning 级别 ≥2 的工具结果裁剪；smartPruningOptimization→@rin/smart-pruning 级别滑块；codeGraphTextBudget/codeGraphPreflight→smart-pruning 级别 3 的上下文预算（codeGraph 本体后置）。

### 🔴 全新 @rin 插件（dsh 无对应）

已建：@rin/repository、@rin/environment、@rin/prompt-memory、@rin/skill-memory、@rin/session-search、@rin/knowledge、@rin/evolution、@rin/token-optimization、@rin/smart-pruning、@rin/web-server、@rin/web-ui。

本轮新增（HIGH，§6）：@rin/agents、@rin/sandboxes、@rin/notes、@rin/gui、@rin/bundle、@rin/cli。

后置（MEDIUM/LOW）：@rin/team、@rin/remote（bridge + ssh + teleport + daemon）、@rin/im-feishu、@rin/im-telegram、@rin/github（空桩，从零建）、@rin/worktree（bash 可替代）、@rin/editor-notebook、@rin/schedule、@rin/doctor、@rin/computer-use（vendored computer-use-mcp）、@rin/agent-migration、@rin/codegraph、@rin/voice（可选）。

### ⚫ 上游包袱 / 测试工具 → 砍

claudeAiLimits, mockRateLimits, rateLimitMessages, rateLimitMocking；grove, ClaudeCodeHint, DesktopUpsell, ManagedSettingsSecurityDialog；REPLTool；OverflowTestTool, SyntheticOutputTool, TungstenTool, SleepTool, TestingPermissionTool；chrome extension / marketplace / subscriptions hooks；SessionBackup 独立页（功能并入 @rin/notes 会话备份）。

## 4. UI 三面共存与功能适配

### 4.1 共存策略（本轮定稿）

| UI 面 | 处置 |
|---|---|
| dsh 原生 Web UI（3080，`dsh --profile web`） | **保留、默认不随 rin 启动、可开关、永不改动**。它是 dsh 上游的官方交互面，随上游更新同步获得新功能；rin 不 fork、不嵌、不改其 bundle。rin 启动器默认不装配 dsh-web-app；用户想用时 `dsh --profile web` 原样可用。 |
| rin Web UI（8320，@rin/web-server + @rin/web-ui） | rin 主 Web 面。独立端口、独立前端，只读 @rin host 服务，零 dsh 侵入。可配置关闭（`@rin/web-server` 的 `enabled: false`），关闭只影响 8320，不影响任何 dsh 面。 |
| rin GUI（@rin/gui，本轮定稿） | rin 桌面壳（决策 9）：Tauri 2 薄壳——起 host（spawn `rin` 或发布态 sidecar）→ WebView 内嵌 8320 的 rin web-ui → 系统托盘常驻 → 退出回收子进程。零前端重写（复用 web-ui 11 页），不碰 dsh 原生 web（3080）。dsh 原生 tui 已被上游删除（note 2026-08-04），无停用对象；dsh 原生 CLI/headless/JSON-RPC 命令面保留不动。 |
| Ink TUI（旧项目 src/ink） | 仅设计参考，不 vendor；TUI 已取消（dsh 生态已有多款社区 TUI，价值不显）。 |
| Tauri 桌面壳（旧项目 desktop） | 设计参考（Tauri 配置/窗口/sidecar/品牌资产迁移）；rin 用 Tauri 2 重做薄壳，不搬上游代码。 |

### 4.2 Web UI 功能适配映射表（并入自 PHASE4-CLIENT.md，第四轮扩展）

| 设计参考（页面） | rin 承载 | host 数据源 | 优先级 |
|---|---|---|---|
| RepositoryWorkspace | web-ui RepositoryPage（已有，扩展多仓库连接 + 目录浏览） | ctx.repository | HIGH |
| 环境安装 / verification | web-ui EnvironmentPage（已有，扩展执行进度/日志/回滚） | ctx.environment + ctx.sandboxes | HIGH |
| KnowledgeSpace | web-ui KnowledgePage（已有，扩展来源生命周期 + 文档浏览） | ctx.knowledge | HIGH |
| AgentWorkspace（含 AI 提案） | web-ui AgentWorkspacePage（新增：列表/编辑/删除 + 提案对话框 + 投影状态） | ctx.agents | HIGH |
| Sandboxes（含 aiConfigure） | web-ui SandboxesPage（新增：profile 列表/编辑/启停/挂载/AI 配置） | ctx.sandboxes | HIGH |
| Notes | web-ui NotesPage（新增：编辑器 + 图/大纲/反向链接/快照/待办面板） | ctx.notes | HIGH |
| TokenOptimization | web-ui TokenOptimizationPage（改为三控件，§5） | ctx.token-optimization + ctx.smartPruning | HIGH |
| PromptMemory 编辑 | web-ui PromptMemoryPage（已有） | ctx.promptMemory | HIGH |
| SkillMemory 面板 | web-ui SkillMemoryPage（已有） | ctx['skill-memory'] | HIGH |
| SessionSearch 搜索 | web-ui SessionSearchPage（已有） | ctx.sessionSearch | HIGH |
| 进化/技能学习 | web-ui EvolutionPage（已有） | ctx.evolution | HIGH |
| SessionBackup | 并入 NotesPage（会话导出为 markdown 笔记） | ctx.notes | HIGH（并入） |
| Monitor / Doctor | 后置 @rin/doctor | 诊断服务 | LOW |
| ComputerUseSettings / AgentMigration | 后置 | computer-use / agent-migration | MEDIUM |
| ActiveSession / 对话 / 输入 / diff | dsh 已自带 | — | 不重写 |

## 5. token 优化缩略设计（本轮定稿）

旧 TokenOptimization 页含五栈状态轮询 + codeGraph 可视化，是本轮「缩略轻量」的对象。目标 UI 只留三个控件（一个页面、无轮询、无独立图表）：

1. **响应风格开关**（@rin/token-optimization `responseStyle`）：`off | caveman | ponytail` 单选——已实现，映射 cavemanOptimization / ponytailOptimization。
2. **Prompt 清理开关**（@rin/token-optimization `cleanPrompt`）：布尔——已实现，映射 liteOptimization 的 deterministic cleaner。
3. **智能裁剪级别滑块**（@rin/smart-pruning `level`）：`conservative | balanced | aggressive` 三档——已实现工具结果去重 / 替代读折叠 / 超预算截断。注：rtkOptimization（终端 I/O 压缩）与 codeGraphTextBudget（上下文预算）本轮**舍弃**（未折叠进本滑块，dsh 已自带 tool-result pruner 覆盖主体）；codeGraph 本体（索引器 + 可视化）后置。

旧五栈与 codeGraph 不再各自成包成页；其功能经三控件全部保留或显式舍弃（舍弃 = 测试工具与上游限流栈）。API 侧 `token-optimization` 路由保留为三控件读写。

## 6. 三个半成品功能的完整链（本轮新增）

### 6.1 笔记（@rin/notes，新包 rin/notes/notes/）

旧项目 notesService 为 Obsidian 风格纯文件存储，功能全量清单（迁移目标）：markdown 文件 + 目录；wikilink（`[[target|alias]]`）+ 标签（frontmatter + 行内）解析；模板（.templates）；历史快照（.history 保留 10 份）；assets 目录；全文搜索（snippet + score）；笔记图谱（nodes/edges）；待办提取（行级 checkbox）；笔记元数据（标题取首个 H1、大小、mtime）。上层：NotesTool（list/search/read）+ notes API + Notes 页 + 9 组件（BacklinksPanel/NoteEditor/NoteGraphView/NoteNameDialog/NotePickerModal/OutlinePanel/QuickSwitcher/SnapshotPanel/TodoPanel）。

rin 侧拆三层：
- host 插件 @rin/notes：`ctx.notes` 服务（文件存储 + 解析 + 搜索 + 图谱 + 写时快照，零外部依赖，node: 内置）+ 注册 dsh tool（NotesTool：list/search/read 对齐旧 schema）。
- web-server 路由：`/api/notes/{list,read,search,graph,todos,templates,write,delete,backup}`；snapshots 列举/读取（SnapshotPanel）后置。
- web-ui NotesPage：按 9 组件设计参考重写（SnapshotPanel 后置）；**会话备份并入**——`session backup` = 把 dsh 会话导出为一条 markdown 笔记（SessionBackup 页功能保留、独立页取消）。

### 6.2 知识空间（@rin/knowledge 补全）

已实现：来源生命周期（add/reindex/remove）、文件/目录增量索引（mtime 判定）、SQLite + FTS、分块（5000 字符 + 300 重叠）、搜索、统计、schema 迁移（对齐旧 knowledge 包 db/service）。

补全项：
- **知识检索工具**（旧项目通过 QueryEngine 注入知识查询；rin 侧以 dsh tool 注册为对称实现）：`knowledge_search(query)` / `knowledge_stats()` 挂在 dsh tool seam，agent 可直接检索知识库（当前 index.ts 标注 NEXT milestone）。
- KnowledgeSpace 页扩展：来源管理 + 文档/分块浏览 + 索引状态。
- 内置仓库的 knowledge/ 根目录作为默认来源（种子）——后置：builtin/knowledge 当前为空占位。

### 6.3 仓库接入 agent 与 sandbox 配置（@rin/agents + @rin/sandboxes，新 group workspace/）

旧项目链条（半成品，两侧都已实现到不同程度）：

```
repository（agents/environments 资产）
   ├─→ agentService：仓库 agent 记录 + revision hash；运行态 agent 定义（旧项目配置目录 agents/）
   │    └─→ AgentWorkspace 页：CRUD + AI 提案（agentProposalService 生成草案 → 人工评审 → 落库）
   └─→ sandboxService：profile（local-sandbox/container/remote）+ attachRepositoryToContainer（挂 /workspace）
        └─→ environmentInstallService：安装计划在沙箱内分阶段执行 + 验证 + 回滚
```

rin 侧完整链（补齐缺口）：

1. **@rin/agents**：仓库 agent 配置 CRUD（writer 已具备，补 service + revision hash）；AI 提案（dsh llm seam 调模型生成 AgentConfiguration 草案 → approval seam 评审 → 写入仓库）；**投影**：把仓库 agents/ 生成到 dsh agent-presets seam（用 agent-presets authoring API 产出 agent.cordis.yml，preset 目录放 rin home + apps/cli/config/agent-presets 同构的用户层）。仓库内 agents/ 种子 1–2 个 starter agent。
2. **@rin/sandboxes**：sandbox profile 存储（rin home，YAML v2，含旧 JSON 迁移）；local-sandbox 型用 dsh shell/subprocess seam 执行；container 型（docker/podman）与 remote 型（SSH）为 provider；仓库挂载（/workspace）；`ctx.sandboxes.probeCapabilities()`（ResolverCapabilities：apt/python/pip/r/npm/tlmgr）。
3. **@rin/environment 执行**（补 NEXT milestone）：plan 已出，补执行状态机（blocked→resolved→approved→provisioning→verifying→ready/failed/rollback-needed）+ 分阶段日志 + verify 规格（pythonImports/rPackages/commands）——对齐 environmentInstallService。
4. **内置仓库**：`rin/core/repository/builtin/` 承旧项目 environments 真实资产（5 生态 packages + 3 profiles），repository.yaml roots 指向 builtin 内九根；agents/ 放 starter agent；knowledge/ 放默认来源。
5. **装配**：@rin/bundle 把 dsh-base + @rin host 全家 + web-server 装配为 rin profile（§9）。

链条验收：仓库选 agent → agent 引用 environmentProfileId → 沙箱 profile 挂载仓库 → 执行安装计划 → 验证通过 → agent 在沙箱内运行（dsh sandbox seams）。

## 7. 分阶段路线（进度 + 剩余）

已完成：Phase 0（新仓库 main + repository reader + environment plan + 裁 codex/claude + 目录重组）、Phase 1（repository writer/validation/migration/seed + environment preflight/stages）、Phase 2（记忆域 4 包）、Phase 3（evolution + smart-pruning + token-optimization 开关）、Phase 4（web-server v1/v2 + web-ui 8 页，独立端口）、**Phase 5（@rin/agents + @rin/sandboxes + @rin/environment 执行状态机 exec.ts + builtin 种子仓库，冒烟/tsc 通过）**、**Phase 6（@rin/notes + knowledge 检索工具 knowledge_search/knowledge_stats，冒烟/tsc 通过）**、**Phase 7 主体（web-ui 新增 NotesPage/SandboxesPage/AgentWorkspacePage + TokenOptimizationPage 三控件 + web-server 路由/POST/enabled 开关：web-server 冒烟/tsc 通过、web-ui tsc 通过）**。

- **Phase 5 资产链路（HIGH，本轮新增）**：@rin/agents + @rin/sandboxes + @rin/environment 执行 + builtin 种子资产。依赖 repository/environment 已建；两包可并行（agents 依赖 agent-presets authoring，sandboxes 依赖 environment plan）。
- **Phase 6 笔记与知识闭环（HIGH，本轮新增）**：@rin/notes（存储 + 工具 + API + 会话备份）+ knowledge 检索工具 + KnowledgeSpace 页补全。两域互不依赖，可并行。
- **Phase 7 UI 补齐（HIGH）**：web-ui 新增 NotesPage / SandboxesPage / AgentWorkspacePage + TokenOptimizationPage 改三控件。
- **Phase 8 装配与发布（HIGH，已完成）**：@rin/gui（Tauri 2 桌面壳，内嵌 web-ui）+ @rin/bundle（cordis.yml 装配 dsh-base + @rin 全家）+ @rin/cli（`rin` 启动器：起 host 8320 打印 URL，GUI 壳复用）+ 文档收口（本文档为唯一权威，PHASE4-STANDALONE.md 为 Web API 契约）。选型定稿见 §8 决策 9/10。
- **Phase 9 seam 接入（HIGH，已完成）**：8 个缺口经 8 个子代理并行实现 + 主线程收口，全部接入 dsh seam（矩阵与交付摘要见 `rin/SEAM-PROJECTION.md`）：prompt-memory→systemPrompt 段落、session-search→session 事件索引 + `rin_session_search`/`rin_session_stats` 工具、skill-memory→skills provider、agents→`agent/created` 自动投影（指纹去重）、environment+sandboxes→`ctx.shell` 真实执行（dryRun 开关）、smart-pruning→`agent/pre-step` 去重+替代读折叠、evolution→reviewModel 适配器修复 + autoTrigger 开关、repository→`repository_search`/`repository_read` 资产浏览工具。收口：`pnpm install --lockfile-only`（新增 dsh-tools/dsh-skill 依赖）→ `pnpm rin:typecheck` 通过 → 9 个 seam 冒烟 + 5 个回归冒烟全绿。knowledge/notes/token-optimization 此前已接入。
- 后置（MEDIUM，MVP 验证价值后按需）：team、remote/bridge、im-feishu/telegram、computer-use、agent-migration、codegraph、schedule、doctor。
- 砍/极后置（LOW/负值）：worktree、editor-notebook、voice、github（空桩）。

## 8. 关键决策（含本轮新增/修订）

1. MVP 主轴：Phase 5→6→7→8（资产链路 + 笔记/知识闭环 + UI 补齐 + 装配）为主轴；team/remote/github/im 后置。✅
2. 上游包袱 UI（grove/REPL/DesktopUpsell/ClaudeCodeHint）：直接砍、不留兼容。✅
3. 桌面端弃、TUI 后置 → **本轮修订**：改为一等产品 **GUI 桌面壳 @rin/gui（Tauri 2 内嵌 rin web-ui）**；TUI 取消（dsh 生态已有多款社区 TUI、价值不显）。
4. 更名策略作废（迁移 = 重写，旧 repo 留档，不搬名、不物理重命名）。✅
5. asset-repository 对齐 B（按 asset-repository 包逐模块移植）——已完成，schema 版本 rin.dev/v1。✅
6. Computer Use + Agent Migration 进 MVP Phase 6 → **本轮修订**：维持「MVP 后半段」意图，但排在 Phase 8 之后按需启用（本轮主轴被资产链路与笔记/知识闭环占用）。✅（修订）
7. **笔记升等（本轮新增）**：notes 从「并入 knowledge」改为独立一等公民 @rin/notes；SessionBackup 并入 notes（会话 → markdown 笔记），独立页取消。✅
8. **token 优化缩略（本轮新增）**：五栈 + codeGraph 预算折叠为三控件（响应风格开关 / prompt 清理开关 / 裁剪级别滑块），见 §5。✅
9. **GUI 选型（本轮定稿）**：**Tauri 2 薄壳**（Rust + 系统 WebView，产物轻量；旧项目即 Tauri，配置/窗口/sidecar/品牌资产可迁移）+ **内嵌 rin web-ui**（零前端重写，复用 11 页）+ **host 形态 = 发布态 sidecar 打包 dsh runtime（复用 python/sdk-runtime 的 dsh-jsonrpc-agent-pkg 先例 + 旧项目 sidecar 模式）/ 开发态 spawn `rin`** + **品牌资产迁移**（海豹 app-icon.svg、字体、provider-icons）。TUI 取消。真机验收点：Tauri 构建 + WebView 连 8320 + 托盘/回收。✅
10. **装配零侵入（本轮定稿）**：`rin` 启动器直接装配 host（dsh-base + @rin 全家 + @rin/web-server），**不写入 $DSH_HOME profiles、不向 packages/boot 加模板、不列 dsh-web-app**；dsh 原生 web（`dsh --profile web`，3080）永不改动、随时可用。默认单 host 进程、单端口 8320：无性能浪费、无双端口冲突。✅

## 9. dsh 与 rin 更新迭代契约（本轮新增）

目标：dsh 上游更新（git merge）与 rin 自身迭代互不污染。

- **只读区（upstream-owned，rin 永不写入）**：`vendor/ packages/ apps/ docs/ examples/ website/ scripts/ native/ python/`。
- **rin 写入区**：`rin/**`。
- **根级合并点（仅 3 个文件）**：`pnpm-workspace.yaml`（`rin/*/*` glob 一条）、根 `package.json`（@rin workspace 依赖一段）、`tsconfig.base.json`（@rin paths 映射一段）。约定：追加在文件尾部、以注释块标注「rin extension — merge point」；upstream 冲突只可能发生在这 3 处，逐个重放即可。
- **门禁**：rin 包只进 `rin/tsconfig.json` 聚合；不进 tsdown glob（上游 rebase 不感知）；100% 覆盖与 host 包同一门禁；模型可见变更走快照；新包带 README 门禁。
- **装配纪律**：rin 不 fork dsh web bundle、不向 dsh 的 PROFILE_TEMPLATES 注册模板；原生 `dsh --profile web`（3080）始终可用，作为上游适配面保留。
- **资产即配置**：仓库资产（agents/environments/…）是可版本化数据；@rin 投影只读不写回（投影不回写仓库，仓库是单一事实源）。

## 10. 迁移价值分层（第四轮）

价值 = 差异化 × 用户价值 × 战略契合 ÷ 迁移成本 ÷ 法律风险。

- **🟢 HIGH（护城河，本轮必做）**：@rin/repository + @rin/environment（唯一差异化「harness 内环境」，本轮补执行）、@rin/agents + @rin/sandboxes（仓库接入 agent/sandbox 配置，本轮新晋）、@rin/notes（本轮新晋）、@rin/knowledge（补检索工具）、@rin/prompt-memory、@rin/skill-memory + @rin/evolution（自我进化）、@rin/session-search、token 优化三控件、@rin/web-server + web-ui + gui + bundle + cli（产品面）。
- **🟡 MEDIUM（有价值，后置）**：team、remote/bridge、im-feishu/telegram、computer-use、agent-migration、codegraph、schedule、doctor。
- **🔴 LOW（审慎，可能不值）**：worktree（bash 可替代）、editor-notebook（小众）、voice（边缘）、github（空桩，成本>价值）。
- **⚫ 零值/负值（砍）**：dsh 已覆盖的 16 工具组 + messages/PromptInput/diff/permissions UI；上游包袱 grove/REPL/ClaudeCodeHint/DesktopUpsell/subscriptions/marketplace/chrome/rate-limits；五栈独立服务与 codeGraph 独立页（折叠进三控件）；SessionBackup 独立页（并入 notes）。

关键结论：内容资产（prompts/systemPromptSections）是上游派生，只能重写设计不能搬原文；github-app 是空桩；voice/worktree/editor-notebook 是边缘。**MVP = HIGH 域（约 14 host 插件 + web-ui 11 页 + gui + 装配层），其余后置。**

## 11. 子 agent 并行执行计划（第四轮）

### 分工

- 主线程（我）：规格源 + 编排 + 评审 + 提交 + 统一 regenerate lockfile。
- 子 agent：独立域（host 插件，可含 web-ui 页面与 web-server 路由），用 subagent_fork 继承本对话上下文（架构/约定/参考路径都在内）。

### 约束

- 子 agent 只在各自目录写（rin/<group>/<name>/），不 commit、不跑 pnpm install。
- 验证用 strip-types 冒烟（vitest 被 spawn EPERM 阻断时）。

### 并行批次

- 批次 A（Phase 5，2 并行）：@rin/agents、@rin/sandboxes——各自读旧项目的 src/server/services/{agentService,agentProposalService,sandboxService,environmentInstallService} 作参考，互不依赖；主线程先行补 @rin/environment 执行状态机（两包都依赖它）。
- 批次 B（Phase 6，2 并行）：@rin/notes、@rin/knowledge 检索工具 + 页补全——互不依赖。
- 批次 C（Phase 7）：web-ui 新页（依赖 A/B 的路由契约）。
- 批次 D（Phase 8，主线程收口）：@rin/bundle + @rin/cli + 共存开关 + 文档收口。

### 依赖图

- 地基：@rin/repository（无依赖）→ @rin/environment（依赖 repository schema）→ 执行状态机（Phase 5 前置）。
- @rin/agents 依赖 repository writer + agent-presets authoring；@rin/sandboxes 依赖 environment plan + dsh shell/subprocess seam。
- @rin/notes 无跨包依赖（node: 内置 + dsh tool seam）；knowledge 工具依赖 @rin/knowledge 既有 service。
- @rin/gui 依赖 @rin/cli（spawn host）+ web-ui dist；web-ui 新页依赖 web-server 新增路由。
- @rin/bundle 依赖全部 host 包 + web-server；@rin/cli 依赖 bundle。

### 收口

主线程收集各子 agent 结果 → 评审（seam 三角齐全、strip-types 冒烟通过、README 门禁、模型可见快照）→ pnpm install --lockfile-only → 统一 commit。
