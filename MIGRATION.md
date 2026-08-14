# rin-harness 迁移方案（cyberpsychosis → rin-harness）

> 单一权威规划文档。取代并清理历史文档：rin-harness-plan.md（v3）、rin-harness-rebranding-plan.md、rin-harness-brand.md、agent/rin-harness-rename-plan.md。
> 现状：cyberpsychosis（v1.4.9，Bun + Ink TUI + Tauri 桌面端，CC 反编译重建）→ rin-harness（dsh 底座 + @rin 资产层）。

## 0. 结论

dsh 给「组合 + 运行时」，rin 给「资产 + 环境」。第一公民是 Asset Repository（九类资产单一事实源）。迁移 = 把 cyberpsychosis 的差异化能力重写为 @rin 插件挂在 dsh 底座上，砍掉 CC 包袱与 UI，复用 dsh 的 loop/工具/会话/沙箱/多模型。

已落地：@rin/repository（只读 reader + schema）、@rin/environment（出安装计划）、裁掉 codex/claude 子代理、全新 git 仓库 main 主支。

## 1. 目标架构

rin 不是 dsh 的平行层，而是 dsh 的插件生态。它只做两件事：(1) 把能力注册进 dsh 已有的 seam（compaction / subagent / shell / lsp / skill / tool）；(2) 引入唯一一个新 seam：资产仓库 ctx.repository。

- 划界从「命名空间」换成「seam」：@rin/* 只是标签，每个 rin 插件最终挂在 dsh 的某个 seam 上。
- 投影机制：运行时 effect-based 投影（增删资产即时生效），非构建期 codegen。
- ctx.repository 是普通 service（像 ctx.llm），非特权核心；「第一公民」指生态中心插件。

### 1.1 目录结构（内外层 + group）

```
rin/core/          资产主轴（新 service）：repository + environment
rin/memory/        记忆域（各持 SQLite）：prompt-memory / skill-memory / session-search / knowledge
rin/optimization/  token 优化（seam provider 注册进 compaction）
rin/collaboration/ 协作/远程（seam provider 注册进 subagent/shell）：team / remote / im-feishu / im-telegram / github
rin/automation/    自动化：computer-use / agent-migration / schedule / worktree
rin/evolution/     进化/诊断：evolution / codegraph / notes / doctor
rin/client/        外层呈现（TUI 在这）：ui-tui
```

- 内层（host）跑 node 进程、生产能力；外层（client）只渲染，消费 host 事件，永不碰 core。
- rin/tsconfig.json 是 rin 的聚合，让 rin 包独立进 typecheck（不并入 dsh 的 host/client 聚合）。

### 1.2 九类资产 → dsh seam

environments→@rin/environment、agents→agent-presets、skills→skill、workflows→workflow、tools→mcp/hooks、knowledge→@rin/knowledge、policies→permission-presets、outputs→输出渲染、bundles→bundle。

## 2. 待迁移资产全景（完整清单）

### 2.1 运行时产品（4）
CLI/TUI、Local Server（HTTP/WS）、Desktop（React WebView + Tauri）、IM Adapter（Feishu/Telegram）。

### 2.2 能力模块（11，CONTEXT.md 权威命名）
Knowledge、Skill Memory、Prompt Memory、Session Search、Scheduled Tasks、External Agent Migration、Computer Use、Bridge/Remote、Skillify/Evolution、Token Optimization、Code Graph。

### 2.3 工具（61）
AgentTool, AskUserQuestionTool, BashTool, BriefTool, ConfigTool, CtxInspectTool, DiscoverSkillsTool, EnterPlanModeTool, EnterWorktreeTool, ExitPlanModeTool, ExitWorktreeTool, FileEditTool, FileReadTool, FileWriteTool, GlobTool, GrepTool, ListMcpResourcesTool, ListPeersTool, LSPTool, McpAuthTool, MCPTool, MonitorTool, NotebookEditTool, NotesTool, OverflowTestTool, PowerShellTool, PromptMemoryTool, PushNotificationTool, ReadMcpResourceTool, RemoteTriggerTool, REPLTool, ReviewArtifactTool, ScheduleCronTool, SendMessageTool, SendUserFileTool, SessionSearchTool, SkillGateTool, SkillMemoryTool, SkillTool, SleepTool, SnipTool, SubscribePRTool, SuggestBackgroundPRTool, SyntheticOutputTool, TaskCreateTool, TaskGetTool, TaskListTool, TaskOutputTool, TaskStopTool, TaskUpdateTool, TeamCreateTool, TeamDeleteTool, TerminalCaptureTool, TodoWriteTool, ToolSearchTool, TungstenTool, VerifyPlanExecutionTool, WebBrowserTool, WebFetchTool, WebSearchTool, WorkflowTool。

### 2.4 命令（19）
advisor, bridge-kick, brief, commit, commit-push-pr, createMovedToPluginCommand, force-snip, init, init-verifiers, insights, proactive, repositoryCommands, review, security-review, subscribe-pr, torch, version。

### 2.5 服务（27）
- token 优化栈：cavemanOptimization, liteOptimization, ponytailOptimization, rtkOptimization, smartPruningOptimization
- 诊断/监控：claudeAiLimits, codeGraphPreflight, codeGraphTextBudget, diagnosticTracking, tokenEstimation, vcr
- CC 限流（包袱）：mockRateLimits, rateLimitMessages, rateLimitMocking
- 其他：awaySummary, notifier, preventSleep, voice, voiceKeyterms, voiceStreamSTT

### 2.6 包（6，含内部结构）
- asset-repository：types / repository / environment / writer / validation / migration / seed
- knowledge：db / service
- prompt-memory：budget / config / insights / reviewLog / store / seed
- scheduled-tasks：cron / frequency
- session-search：db / indexStore / history / query / transcript / projectMemory / contextTag
- skill-memory：gate / lifecycle / store

### 2.7 仓库分区（9，骨架）
agents / bundles / environment / environments / knowledge / outputs / policies / skills / tools / workflows —— 除 environments/ 外全为 .keep 占位。environments/ 有真实资产：packages/ 五个生态目录（latex / node / python / r / system.yaml）+ profiles/ 三个 profile（scientific-base / bioinformatics-base / mathematical-modeling-base）+ installers/、verifiers/ 空占位（installer/verifier 概念已设计未实现）。

### 2.8 服务端 API（28 模块）
computer-use、notes、repositories、token-optimization、teams、agents、conversations、sessions、skills、knowledge、prompt-memory、scheduled-tasks、sandboxes、providers、models、settings、mcp、monitor、search、status、adapters、agent-migration、filesystem、cybercode-oauth、plugins。

### 2.9 UI 面
- Ink TUI（components/events/hooks/layout/termio）
- Tauri 桌面（28 页 / 147 组件）：ComputerUseSettings, RepositoryWorkspace, KnowledgeSpace, AgentMigration, SessionBackup, TokenOptimization, Monitor, Notes, Sandboxes, AdapterSettings 等
- React 组件（34 目录）、屏幕（Doctor/REPL/ResumeConversation）、hooks（80+）、keybindings 引擎（16 文件）

### 2.10 领域目录
bridge（40+ 文件）、skills（60+ 文件）、memdir、promptMemory、sessionSearch、skillMemory、skillLearning、ssh、remote、daemon、tasks、coordinator、vim、buddy、voice、outputStyles、proactive、environment-runner、self-hosted-runner、upstreamproxy、cli（SSE/WS/Hybrid 传输）、query（QueryEngine）、state、assistant。

### 2.11 设计资产（client/UI/呈现）

- src/components（34 目录 ~360 文件）：messages(45)、permissions(53)、PromptInput(21)、agents(28)、tasks(14)、mcp(14)、Spinner(13)、scheduled-tasks(10)、design-system(16)、LogoV2(15)、wizard(6)、sandbox(5)、diff(3)、memory(2)、teams(2)、settings/shell/skills/providers/CustomSelect/HighlightedCode/StructuredDiff/TrustDialog/HelpV2/FeedbackSurvey/Passes/ui/hooks
- desktop/src/components（15 目录 147 文件）：chat、codegraph、controls、layout、markdown、memory、notes、plugins、providers、screenshot、settings、shared、skills、teams、terminal
- desktop/src/pages（28 页）：ActiveSession、KnowledgeSpace、RepositoryWorkspace、ComputerUseSettings、AgentMigration、Sandboxes、SessionBackup、TokenOptimization、Notes、Monitor、Settings 等
- Ink TUI（src/ink）：components(18) + events/hooks/layout/termio
- 屏幕（3）：Doctor、REPL、ResumeConversation
- editor/companion：vim（motions/operators/textObjects/transitions）、buddy（companion sprite）、voice、outputStyles
- i18n（desktop/src/i18n/locales：en/ja/ko/zh）+ theme（globals）
- docs（agent/channel/desktop/features/guide/im/memory/reference/skills + ui-clone/stitch_cybercode_frontend_design 设计参考）

### 2.12 内容资产（prompt/文案/规则）

- model-visible：prompts.ts、systemPromptSections.ts、cyberRiskInstruction.ts
- UI 文案：outputStyles.ts、messages.ts、figures.ts、spinnerVerbs.ts、turnCompletionVerbs.ts、errorIds.ts
- 配置边界：betas.ts、apiLimits.ts、toolLimits.ts、xml.ts、common.ts
- 默认规则：defaults/agent-work-rules、defaults/ponytail-rules

迁移去向：能力资产→@rin host 插件；设计资产→@rin client 插件（dsh slot）；内容资产→system-prompt sections + i18n 文案 + UI copy。

## 3. 四分类迁移映射

### 🟢 dsh 已有 → 直接砍
Bash/PowerShell/TerminalCapture→tool-bash/tool-pwsh/tool-terminal；FileRead/Write/Edit→tool-fs + tool-str-replace-editor；Glob/Grep→tool-fs-search；WebFetch/Search/Browser→tool-web + web-*；MCP/McpAuth/ListMcpResources/ReadMcpResource→mcp-client；LSP→lsp + tool-lsp；EnterPlanMode/ExitPlanMode/VerifyPlanExecution→plan-mode；TodoWrite→tool-todo；Workflow→workflow + tool-workflow；AskUserQuestion→user-questions + tool-ask-user；AgentTool→subagent 家族 + tool-subagent；TaskCreate/Get/List/Output/Stop/Update→jobs + tool-jobs；ScheduleCron→schedule；Skill/SkillGate/DiscoverSkills→skill + tool-skill；ConfigTool→settings；ToolSearch→tool catalog。

### 🟡 dsh 有 seam、改写为 @rin 插件
PromptMemoryTool→@rin/prompt-memory（system-prompt）；SkillMemoryTool→@rin/skill-memory（skill）；SessionSearchTool→@rin/session-search（session-query）；CtxInspectTool/SnipTool/force-snip→@rin/compaction-*（compaction + token-meter）；token 优化栈→@rin/compaction-* 系列；Code Graph→@rin/codegraph（lsp + Rust 索引器）；BriefTool→@rin/brief；ReviewArtifactTool/review/security-review→@rin/review。

### 🔴 全新 @rin 插件（dsh 无对应）
@rin/repository（已）、@rin/environment（已）、@rin/prompt-memory、@rin/skill-memory、@rin/session-search、@rin/knowledge、@rin/compaction-*、@rin/codegraph、@rin/team、@rin/remote（bridge + ssh + teleport + daemon）、@rin/im-feishu、@rin/im-telegram、@rin/github、@rin/worktree、@rin/editor-notebook、@rin/evolution（skillify + dream + proactive）、@rin/schedule、@rin/doctor、@rin/computer-use（vendored computer-use-mcp）、@rin/agent-migration、@rin/notes、@rin/voice（可选）。注意 @rin/github 的 github-app 是空桩，需从零建。

### ⚫ CC 包袱 / 测试工具 → 砍
claudeAiLimits, mockRateLimits, rateLimitMessages, rateLimitMocking；grove, ClaudeCodeHint, DesktopUpsell, ManagedSettingsSecurityDialog；REPLTool；OverflowTestTool, SyntheticOutputTool, TungstenTool, SleepTool, TestingPermissionTool；chrome extension / marketplace / subscriptions hooks。

## 4. UI 迁移

cyber 有一套完整的 React Web UI（28 页 + 147 桌面组件 + 34 共享组件目录），是 rin-harness Web UI 的**设计参考**（不是「砍」）。代码因 CC 风险重写，但设计/功能集保留，映射到 @rin client 插件。

| UI 面 | 处置 |
|---|---|
| Ink TUI | 后置（保留需写 client 插件） |
| Tauri 桌面壳 | 弃（React WebView 壳重写为纯浏览器，dsh 已自带 Web 壳） |
| React 组件（34 目录）+ 28 页 | **设计参考**：映射到 @rin client 插件，代码重写、数据层换成 dsh slot/Props |
| ActiveSession / messages / PromptInput / diff / skills / mcp / providers | dsh 已自带，直接用，不重写 |
| 屏幕 Doctor / ResumeConversation | Doctor→@rin/doctor client；ResumeConversation→dsh session resume 原生 |
| 屏幕 REPL + grove / ClaudeCodeHint / DesktopUpsell | 砍（CC 专属） |

### 4.1 Web UI 功能适配（第一公民，非「后置品牌」）

dsh 的 Web UI 是 rin-harness 的主用户面（TUI/桌面端后置）。@rin 是 host 能力，要让人看得见、用得上，必须做功能适配——每个有 UI 的 @rin 功能走 dsh client 插件三件套：

1. host 插件（注册能力到 seam）
2. client 插件（slots.register 注册 UI，src/client/ 浏览器半）
3. web-app 三处注册（tsconfig.client 聚合 + web-app/cordis.patch.yml 的 dsh.client 行 + web-app package.json 依赖）

映射：@rin/repository→RepositoryWorkspace 页；@rin/environment→安装计划+执行进度+verification；@rin/knowledge→KnowledgeSpace；@rin/prompt-memory / skill-memory→设置页+注入展示；@rin/session-search→搜索面板；@rin/team→团队/多 agent 视图；@rin/remote→远程会话；@rin/computer-use / agent-migration→设置页+操作界面；@rin/doctor / codegraph→诊断/索引面板；各 @rin 工具结果→ui-tool 的 toolview slot。

含义：每个 Phase 的「完成」= host 插件 + client 插件 + web-app 注册；client 工作量与 host 相当（受 slot 纪律 + 100% 覆盖率门禁约束）。

## 5. 品牌与标识（variant A + 海豹 seal）

- 形象：海豹 seal（cyberpsychosis 桌面端自绘 SVG，desktop/public/app-icon.svg，深蓝渐变底 + 单笔海豹轮廓）。
- 名字：rin 来自「智能体用 DeepSeek API 时给自己起的名字」，与「agent 在 harness 内环境自我演化」定位同构。
- 替换清单：apps/web title→rin；favicon→海豹 SVG；README/docs 标题→rin-harness（注明派生自 dsh）；CLI bin→rin；CLI 帮助文案→rin-harness profile。
- 合规保留：LICENSE（MIT）+ 原 DeepSeek Harness 版权行；THIRD_PARTY_NOTICES.md 原样；README 加「基于 DeepSeek Harness（MIT）迁移开发」声明。

## 6. 分阶段路线（MVP 收敛后）

### MVP（HIGH 护城河：约 10 host + 10 client 插件）

- Phase 0（已完成）：新仓库 main 主支；@rin/repository 只读 reader；@rin/environment 出安装计划；裁 codex/claude；目录重组 rin/*/*。
- Phase 1 地基：@rin/repository 补 writer/validation/migration/seed + @rin/environment 补 preflight/stages/status（对齐 cyber 的 asset-repository 参考）。
- Phase 2 记忆域：@rin/knowledge、@rin/prompt-memory、@rin/skill-memory、@rin/session-search。
- Phase 3 进化 + 优化：@rin/evolution（依赖 skill-memory + prompt-memory）+ @rin/compaction-*。
- Phase 4 Web UI 功能适配：client 插件 + web-app 三处注册，与 host 成对。

### 后置（MEDIUM，MVP 验证价值后按需）

team、remote/bridge、im-feishu/telegram、computer-use、agent-migration、codegraph、schedule。

### 砍/极后置（LOW/负值）

worktree、editor-notebook、voice、github（空桩）、notes（并入 knowledge）、doctor。

## 7. 关键决策（已定）

1. MVP 优先级：Phase 1→2→3（environment 执行 + 仓库投影 + 记忆域）为主轴，team/remote/github/im 后置。✅
2. CC 包袱 UI（grove/REPL/DesktopUpsell/ClaudeCodeHint）：直接砍、不留兼容。✅
3. 桌面端/TUI：后置为可选 client 插件（不砍，也不进 MVP）。✅
4. 更名策略：作废（策略 A：迁移 = 重写，旧 repo 留档，不搬名、不物理重命名）。✅
5. asset-repository 对齐：B（按 cyberpsychosis 的 asset-repository 包逐模块移植）。✅
6. Computer Use + Agent Migration：进 MVP（放 Phase 6，MVP 后半段）。✅

## 8. 迁移价值分层

价值 = 差异化 × 用户价值 × 战略契合 ÷ 迁移成本 ÷ 法律风险。

- **🟢 HIGH（护城河，MVP 必做）**：@rin/repository + @rin/environment（唯一差异化「harness 内环境」）、@rin/knowledge、@rin/prompt-memory、@rin/skill-memory + @rin/evolution（自我进化）、@rin/session-search、@rin/compaction-*（token 优化）。
- **🟡 MEDIUM（有价值，后置）**：team、remote/bridge、im-feishu/telegram、computer-use、agent-migration、codegraph、schedule。
- **🔴 LOW（审慎，可能不值）**：worktree（bash 可替代）、editor-notebook（小众）、voice（边缘）、github（空桩，成本>价值）、notes（并入 knowledge）、doctor（dsh 已部分覆盖）。
- **⚫ 零值/负值（砍）**：dsh 已覆盖的 16 工具组 + messages/PromptInput/diff/permissions UI；CC 包袱 grove/REPL/ClaudeCodeHint/DesktopUpsell/subscriptions/marketplace/chrome/rate-limits。

关键结论：内容资产（prompts/systemPromptSections）是 CC 派生，只能重写设计不能搬原文；github-app 是空桩；voice/worktree/editor-notebook 是边缘。**MVP = HIGH 6 域（约 10 host 插件 + 10 client 插件），其余后置。**

## 9. 审计结论（第三轮）

- 61 工具 / 27 服务 / 6 包 / 28 API / 11 能力模块全部有归属，无未分类项。
- 本轮新增：notes 系统（NotesTool + notes API + Notes 页）→ @rin/notes；environments/ 有 5 生态目录 + 3 profile 真实资产；computer-use 是 vendored computer-use-mcp；github-app 是空桩（从零建）；feishu 适配器含 cardkit 卡片渲染 + streaming-card + markdown→卡片 + media。
- 方案已完整。

## 10. 子 agent 并行执行计划

### 分工

- 主线程（我）：地基（@rin/repository + @rin/environment 规格源）+ 编排 + 评审 + 提交。
- 子 agent：独立域（host 插件，可含 client 插件），用 subagent_fork 继承本对话上下文（架构/约定/参考路径都在内）。

### 约束

- 子 agent 只在各自目录写（rin/<group>/<name>/），不 commit、不跑 pnpm install（主线程统一 regenerate lockfile + commit）。
- 验证用 strip-types 冒烟（vitest 被 spawn EPERM 阻断）。

### 并行批次

- 批次 1（Phase 2，4 并行）：@rin/knowledge、@rin/prompt-memory、@rin/skill-memory、@rin/session-search——各自读 cyber 的 packages/<name> 作为参考，互不依赖。
- 批次 2（Phase 3，2 并行）：@rin/evolution（等 skill-memory + prompt-memory）、@rin/compaction-*（独立，读 cyber 的 services/optimization）。
- 批次 3（Phase 4，client 插件）：host 稳定后，按域做 client 插件（Web UI 功能适配，读 cyber 的 src/components 设计参考）。

### 依赖图

- 地基：@rin/repository（无依赖）→ @rin/environment（依赖 repository schema）。
- 记忆域：4 个互不依赖（各自 SQLite）。
- @rin/evolution 依赖 skill-memory + prompt-memory。
- @rin/compaction-* 依赖 dsh compaction seam（不依赖 @rin）。

### 收口

主线程收集各子 agent 结果 → 评审（seam 三角齐全、strip-types 冒烟通过、README 门禁）→ pnpm install --lockfile-only → 统一 commit。
