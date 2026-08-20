# rin-harness 侧栏 × 设置 调整方案（v2）

> 版本: v2.0 ｜ 状态: 待评审
> v1 决定『仓库→设置-环境组』已撤销——仓库升级为资产中心（见 ASSET-REPOSITORY-PLAN.md v2）, 保留侧栏并提升地位。
> 依据: rin 源码 + 8 个高星项目调研（OpenHands/Open WebUI/Goose/AnythingLLM/LibreChat/NextChat/Cline/Roo Code）。

---

## 1. 目标结构

### 1.1 侧栏（7+5 → 5+3）

    [工作区]
    ├─ 会话      (chat)         ← 保留
    ├─ 笔记      (notes)        ← 保留, 内部吸收 查询/标签 子视图
    ├─ 文件      (files)        ← 保留（已挂载 vault/知识源/仓库根）
    ├─ 定时任务  (scheduled)    ← 保留（调研: Goose/Khoj 均在侧栏）
    ├─ 仓库      (repository)   ← 升级为『资产中心』（多 tab, 见 1.3）
    └─ 更多 ─┬─ 终端            ← 保留（Tab 型）
             ├─ 知识空间        ← 保留（codeGraph, 独立功能）
             └─ Atlas           ← 保留（统一图谱, 与资产中心互补）
    底部: 设置

**移除**: 智能体配置（→ 资产中心『智能体』tab）、查询、标签（→ 笔记子视图）。

### 1.2 设置（15 → 13 tab, 不再新增智能体/环境组）

    概览 / 关于
    通用      general（+新增『资产根』配置项）
    执行      providers, behavior
    扩展      skills, plugins, mcp, adapters
    数据      memory, sessionBackup, agentMigration
    运行时    permissions, computerUse

设置只管运行时配置与连接管理；资产浏览/管理统一在侧栏仓库（资产中心）。

### 1.3 仓库 = 资产中心（核心新形态）

    资产中心（RepositoryWorkspace 重构）
    ├─ 仓库切换器: 资产根(本地,固定) / 内置 / 共享连接
    ├─ 总览     各资产卡片(数量/最近更新/存储位置) → 点击进入 tab
    ├─ 笔记     复用 notes 摘要 API（vault 概况）
    ├─ 智能体   复用 AgentWorkspace（数据源=仓库 agents/）
    ├─ 环境     现有环境包/profile 展示
    ├─ 技能     skills + skill-memory 学习状态
    └─ 记忆·自进化  复用 EvolutionProfile + 记忆摘要 API

---

## 2. 分阶段实施

### UI-1：仓库 → 资产中心 + 智能体入口迁移

**类型层**
| 文件 | 改动 |
|---|---|
| rin/web/web-ui/src/stores/uiStore.ts | WorkspaceView 删除 'agents'（agents 不再独立视图）; 资产中心用内部 tab 状态 |

**导航层**
| 文件 | 改动 |
|---|---|
| Sidebar.tsx | 删除『智能体配置』行; 仓库行保持（图标/文案微调: 资产中心） |
| ContentRouter.tsx | 删除 agents 分支（保留 repository） |
| PluginDetail.tsx:106 | openWorkspaceView('agents') → openSettings('agents') 改为跳转资产中心? 待定: 可直接打开仓库视图 |

**资产中心**
| 文件 | 改动 |
|---|---|
| pages/RepositoryWorkspace.tsx | 重构: 仓库切换器 + 六个资产 tab; 各 tab 聚合既有 API（notes/agents/environments/skills/evolution/prompt-memory） |
| pages/AgentWorkspace.tsx | 适配为可嵌入组件（props 传入 repositoryId, 或内部选择） |
| api/ 新增 assets.ts | GET /api/assets/summary: 各资产 {count, updatedAt, rootPath}（web-server 聚合） |

**i18n**: assets.* 文案（en/zh/ja/ko）

### UI-2：笔记吸收 查询/标签 子视图

| 文件 | 改动 |
|---|---|
| pages/Notes.tsx | 顶层子视图 view: 'notes'|'queries'|'tags'; 页头切换器（复用 SideTab UI 模式） |
| pages/Queries.tsx / Tags.tsx | 拆内嵌组件, 去自身 header; 原 openWorkspaceView('notes') 跳转改内部切换 |
| Sidebar.tsx | 更多菜单删除 查询/标签 |
| ContentRouter.tsx | 删除 queries/tags 分支 |

### UI-3：设置增强（配合资产根）

| 文件 | 改动 |
|---|---|
| pages/Settings.tsx | 通用组新增『资产根』: 显示路径 + 重定位/迁移入口（对接 ASSET-REPOSITORY-PLAN 阶段 2b/4） |
| i18n | settings.general.assetsRoot* 文案 |

---

## 3. 调研依据回顾（为什么这样排）

| 决策 | 依据 |
|---|---|
| 定时任务留侧栏 | Goose Scheduler / Khoj Automation 均在侧栏（有运行时数据） |
| 资产中心在侧栏 | Open WebUI Workspace（实体 CRUD 在侧栏）; 仓库是高频内容入口 |
| 配置在设置 | OpenHands 设置含 Integrations; AnythingLLM Agent 配置在设置; rin 已有搜索 ✅ |
| 笔记吸收衍生视图 | Open WebUI Notes 在 Workspace 统一管理; 查询/标签本就是笔记工具 |
| 智能体配置跟随仓库 | 数据源是仓库 agents/, 与资产中心同源（AnythingLLM 同主题聚合） |

---

## 4. 验收标准

1. 侧栏: 会话/笔记/文件/定时任务/仓库(资产中心) + 更多(终端/知识空间/Atlas) + 设置。
2. 资产中心六个 tab 可用, 各资产显示存储位置; 智能体 tab 可完整编辑仓库智能体。
3. 笔记页内可切换 查询/标签; 更多菜单无查询/标签入口但功能完整。
4. 设置-通用有『资产根』配置; 设置不再有环境/智能体管理重复入口。
5. typecheck/test/lint 全绿。
