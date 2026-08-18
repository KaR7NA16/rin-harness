# rin 延后项留档（Deferred Items Archive）

> 目的：汇总截至当前（2026-08，Phase 0–5 全部落地 + 收尾项完成之后）所有已识别但未实施的延后项，
> 作为后续排期与 **web-ui 调整优化**的参考底稿。单一事实来源仍是各包 README 的
> 「Known Limitations and Deferred Work」节；本文件是聚合视图，改动时同步两处。

## 总览

| 类别 | 项数 | 主要依赖 | 性质 |
|---|---|---|---|
| A. 知识一体化方案延后项 | 15 | 无外部依赖 | 纯代码，可随时收口 |
| B. web-server / 产品面限制 | 8 | 部分需真机验证 | 已知行为限制 |
| C. 产品待决（外部凭据 / scope） | 4 组 | 外部 API / 决策 | 需先定 scope |
| D. MIGRATION §10 未建项 | 8 | 多数外部依赖 | 需 scope |
| E. web-ui 延后项与可优化点 | 10 | 无 | UI 调整参考 |

---

## A. 知识一体化方案延后项（对应 `rin/NOTES-KNOWLEDGE-INTEGRATION.md`）

### A1. 活查询 DSL 扩展（`@rin/notes`）

| 项 | 现状 | 投入 | 参考 |
|---|---|---|---|
| Dataview 表达式函数 | `WHERE` 仅支持裸值、`date(today)`、数字 | 中 | `/tmp/note-research/obsidian-dataview` |
| `GROUP BY` / `FLATTEN` | 未支持 | 中 | 同上 |
| 行内字段：一行多字段、`[key:: value]` 列表语法 | 目前一行一个 key、无列表 | 低 | 同上 |
| 任务日期仅 Obsidian emoji 语法 | `key:: due` 行内字段与任务字段互不联通 | 低 | `/tmp/note-research/obsidian-tasks` |
| 行内标签在 fenced code block 内误匹配 | `#word` 出现在代码样例里会被当标签 | 低 | — |

### A2. notes 服务层 API 正式化（`@rin/notes`）

| 项 | 现状 | 投入 |
|---|---|---|
| `move` / `createFromTemplate` / `daily` / `setTodo` 服务层方法 | **web-server legacy 路由已用 read/write/delete 组合实现**（`/api/notes/move`、`/from-template`、`/daily`）；`NotesStore` 服务 API 未正式化 | 低 |
| 会话备份独立预算 | 备份笔记与普通笔记共用 4 MiB 上限 | 低 |

### A3. knowledge-graph 图能力（`@rin/knowledge-graph`）

| 项 | 现状 | 投入 |
|---|---|---|
| filesystem provider 递归浏览 | 仅浅浏览一层（受 `browse()` 单层 API 限制） | 中 |
| repository 的 skills / workflows / tools 根入图 | 仅 agents / environments / packages（Phase 3 遗留缺口） | 中 |
| codegraph 需已索引项目 | 无 `.codegraph` 库的项目静默跳过 | 低（文档说明即可） |
| session `derived_from` 标题匹配脆弱 | 备份笔记重命名即断边 | 低 |
| graph refresh 全量替换 | 非增量；大库每次请求重投影 | 中 |

### A4. `@rin/knowledge`

| 项 | 现状 | 投入 |
|---|---|---|
| 纯文本内容索引 | 无 PDF / office 提取（metadata 模式） | 高 |
| 每次调用开库关库 | 无长生命周期句柄 | 低 |
| 单进程 SQLite | 无跨进程锁 / 共享 config home | 低 |
| 无隐式默认 `dbPath` | 需 host 注入 | 低（文档说明即可） |

---

## B. web-server / 产品面已知限制（`@rin/web-server` README）

1. `/api/agents/propose` 需真实 dsh llm seam（默认适配器运行时解析首个 provider/model）——真机验证。
2. `/api/sandboxes/execute`、`/api/sandboxes/{id}/probe` 需真实 sandbox provider（local/container/remote）——真机验证。
3. 静态目录由前端包拥有；本插件只读并 404。
4. 监听失败只记日志、不 fail 插件。
5. skill-memory overview 直接读目录 + STATS.json/SUMMARY.md（store 无全局枚举）。
6. 终端 POSIX-only：win32 spawn 报 `SPAWN_FAILED`（显式 argv 不能绕过）。
7. **终端 resize 未实现**：`SubprocessTerminalHandle` 无 resize 方法，固定 80×24；客户端 cols/rows 只设初始几何。
8. 终端会话 v1-临时：断连即亡、无恢复协议，重连必须重新 spawn。

---

## C. 产品待决（需外部凭据或 scope 决策，`rin/README.md`「待决」节）

| 项 | 阻塞 |
|---|---|
| `@rin/remote`（bridge / ssh / teleport / daemon） | 需先定「rin 的 remote 是什么」 |
| e2b 远程沙箱、web-search-exa / web-search-perplexity | 需外部 API 凭据 |
| voice + STT、im-feishu / im-telegram | 需外部 STT / IM 凭据 |
| LSP 激活（`lsp-stdio` 已挂载但 `disabled`） | 需部署层提供具体 language-server `servers` 表 |

---

## D. MIGRATION §10 后置但至今未建（已核对目录）

`@rin/schedule`、`@rin/remote`、`@rin/voice`、`@rin/github`（空桩）、`@rin/worktree`（bash 可替代）、
`@rin/editor-notebook`、`@rin/im-feishu`、`@rin/im-telegram`

> **MIGRATION §10 过时表述**：其「后置」列表中 computer-use / agent-migration / codegraph / teams / doctor / tasks
> **实际均已建**，建议下次修订 MIGRATION.md 时清理。

---

## E. web-ui 延后项与可优化点（供 UI 调整参考）

| 项 | 现状 | 优化方向 |
|---|---|---|
| Atlas 画布交互 | 无 pan/zoom/搜索/双击聚焦（`CodeGraphVisualization` 有，Atlas 没有） | 复用 CodeGraph 的 transform/缩放/搜索模式 |
| Atlas 布局 | 按 kind 聚类的确定性环形布局，无力导向 | 可加力导向选项或按边密度聚类 |
| Queries 页 | 单 DSL 输入框；结果无排序/分组 UI | 结果列排序、示例查询库、查询历史 |
| Tags 页 | 仅单标签过滤 | 多标签 AND/OR、标签重命名、跨标签并集 |
| Terminal | 无 resize（固定 80×24）、无恢复 | 等后端 resize seam 后接 UI；会话恢复入口 |
| `src/types.ts` 手抄 server 领域类型 | 页面字段与后端契约靠手工同步，易漂移 | 从 server 生成或加契约测试 |
| Sandboxes aiConfigure / AgentWorkspace AI 提案 | MVP 未接入真实 LLM 适配器 | 真机验证 + 接 dsh llm seam |
| `uiStore.railSettingsView` | 已废弃（deprecated）字段 | 清理 |
| 新页面测试覆盖 | Atlas 有 layout 测试；Queries / Tags 页面无独立测试 | 补页面级测试 |
| 构建体积 | 多个 chunk > 500 kB（Vite 警告） | code-split / manualChunks 优化 |
| i18n 覆盖 | ja / ko 为部分覆盖（英文回退） | 补齐或维持回退策略 |

---

## 建议优先级

1. **可立刻收口（纯代码、无外部依赖）**：A1 行内多字段与列表语法、A2 服务层方法 + README 同步、
   A3 repository skills/workflows/tools 入图。
2. **中投入**：A3 filesystem 递归 / 增量 refresh、终端 resize seam、E 组 Atlas 交互升级。
3. **需决策或凭据**：C 组全部、D 组多数。
