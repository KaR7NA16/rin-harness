# 2026-09-06 统一记忆 Wave 7–8 全量审查与冗余代码/结构扫描

> 状态：Evidence snapshot — Wave 7–8 落地后的全量审查记录
>
> 日期：2026-09-06
>
> 审查范围：`migration/registry-deps` 工作区（Wave 1–8 全部未提交改动，约 2.7 万行）
> 中的记忆域重构、host/web 接线、contracts、文档与门禁。本文是时间点快照，不是
> 当前事实的权威来源；当前事实以 [CURRENT.md](../architecture/CURRENT.md) 为准。

## 1. 方法

按六类扫描执行，全部基于可复查命令，不基于叙述性判断：

1. **v1 残留扫描**：对 `MemoryItem`、`memory_items`、`syncMemoryProjection`、
   `MemoryDatabase`、`MemoryListOptions`、`recordInjection`、`MemoryInjectionRecord`、
   `MemoryExport` 等已删除标识符做全仓源码 grep（排除 lib/、target/、node_modules、
   .d.ts 构建产物）。
2. **遗留文件扫描**：`*.orig`、`*.rej`、`*.bak`、`*~` 于 packages/apps/tooling/docs。
3. **失效依赖扫描**：包 manifest 声明但源码零导入的 `@rin/*` 依赖；以及反向的
   未声明导入（由 verify-deps 门禁覆盖）。
4. **死导出扫描**：对重构后疑似失去消费者的导出逐一统计全仓引用
   （buildPromptMemorySectionText、redactProjectMemoryText、
   projectMemoryFileSessionId、decayMemory、boundPromptMemoryPair/Text、
   projectMemoryFileSessionKey）。
5. **结构扫描**：包 census、跨层导入方向（packages→apps）、TODO/FIXME 引入、
   Cordis 元数据、manifest entry、结构/README/publint/依赖门禁。
6. **门禁复跑**：hygiene、lint、memory 包测试、smoke、全仓 `pnpm run check`。

## 2. 结论摘要

- v1 记忆目录与 generic 路由在运行时源码中**零残留**；唯一命中是
  `tests/prompt/seam.test.ts` 中一个**故意的负向断言夹具**（legacy 写路径必须
  抛错的守护），属测试资产，非残留。
- 清理合并残留 `.orig` 文件 30 个；清理 notes 包一个失效依赖；删除一个死导出
  及其失效导入。处置后全部门禁保持绿色。
- 未发现跨层导入（packages→apps）、未引入新 TODO/FIXME、包 census 保持 21。
- 遗留观察项三项（见 F-6），均为既有模式或低价值清理，未在本轮处置。

## 3. 发现与处置

| ID | 级别 | 发现 | 处置 |
|---|---|---|---|
| F-1 | 清理 | 30 个 `.orig` 合并残留（memory 测试 25、apps/web 1、docs 4；源于早前手工 patch/合并操作，全部未被 git 跟踪） | 已移出仓库。**处置事故如实记录**：备份目标选在 WSL `/tmp`（tmpfs），VM 在调用间重启导致备份丢失、文件不可恢复。受影响文件均为旧状态快照，其后的权威版本全部在当前工作区与 git HEAD 中；无当前数据损失。教训已采纳：后续备份使用持久路径 |
| F-2 | 冗余 | `@rin/notes` 包 manifest 声明 `@rin/memory` 依赖但投影镜像删除后源码零导入 | 已从 notes 的 dependencies 移除；lockfile 同步 |
| F-3 | 冗余 | `@rin/knowledge` 的 `@rin/memory` 依赖**合法保留**：`knowledge/graph` 以 type-only 方式消费 `@rin/memory/session-search` 的 `SessionSearchStore`（只读投影消费，符合架构） | 保留；处置过程中曾误判并在 devDependencies 产生重复行，已立即纠正回原状 |
| F-4 | 死代码 | `buildPromptMemorySectionText`（静态 SOUL/BRIEF/USER 段构建器）在 prompt seam 改为 canonical-only 后失去全部消费者；随之失效的 `boundPromptMemoryPair`、`SOUL_CHAR_LIMIT`、`USER_PROMPT_MEMORY_CHAR_LIMIT`、`PromptMemoryStatus` 导入 | 已从 `prompt/projection.ts` 删除函数与失效导入，并移除 `prompt/index.ts` 再导出；canonical 构建器保留 |
| F-5 | 观察 | `redactProjectMemoryText`、`projectMemoryFileSessionId` 在 session-search 目录镜像删除后从公共消费转为内部/仅导出使用 | 未处置：仍是合法导出与内部工具函数；如需进一步收敛应随下一次 session-search 变更一并做 |
| F-6 | 观察 | 三项既有结构模式：`@rin/memory` 包内 `session-search/index.ts` 与 host `src/host.ts` 存在包名自导入；prompt-memory 静态文件服务（store/seed/reviewLog）继续作为管理面存在而不再进入模型输入 | 未处置：均为既有的、门禁通过的模式；无认知状态所有权问题 |
| F-7 | 集成缺口（已补齐） | 一体化核查发现：意图路由只有 dispatch 级测试，无真实 HTTP 端到端证据 | 新增 `memory-intent-http.smoke.ts`：真实 Host + 启用 web-server，经 HTTP 完成 preview→authorize→commit（scope 精确、重放 409）、corrections、influence restrict/revoke，并断言 journal 导出包含全部意图事务 |
| F-8 | 集成缺口（已补齐） | Memory Center 未露出 §10.2 用户控制清单第一项"纠正"（client API 已有，页面无控件） | 页面新增 Correction 区（加载表征 → JSON 编辑 → 提交 owner correction），场景行加 correct 按钮，测试覆盖加载-编辑-提交流程 |
| F-9 | UI 设计（已处置） | 全量 UI 走查（10+ 屏）发现：页头模式五页五样、空态标准不一、记忆中心整页英文硬编码且用原生按钮/调试风列表、仓库页 eyebrow 与标题重复且 zh 两个区块同名"环境配置"、浮层（最近项目/更多菜单）不互斥 | 新增共享 `PageHeader`/`EmptyState` 组件；记忆中心重构为 PageHeader + 空态 + 共享 Button + 全量 i18n（新增 memoryCenter.* 约 50 键 × en/zh/ja/ko）；仓库页头换用 PageHeader 并修正 zh `repository.profiles` 为"命名环境配置"。已实测：i18n 插值为单花括号 `{param}`（修正了初版双花括号错误）。**撤回一项误报**：Agent 配置页经实测（scrollWidth==clientWidth）无横向溢出，走查截图判断有误 |
| F-10 | UI 设计(部分处置,2026-09-06 第二批) | 走查其余发现:记忆双入口、浮层不互斥、会话空态、顶栏 pills 截断、bundle 体积 | **已处置**:① 记忆双入口分治——设置"记忆"改名"记忆与进化",删除描述已删 v1 目录的"规范记忆目录"卡片及 manifest 拉取,新增"打开记忆中心"引流条(认知面归记忆中心);② 侧栏两个浮层菜单互斥;③ 空会话页加引导标题(开始一次对话+副标题);④ 顶栏 ContextChip 分级显示(xl 以下隐藏标签、值限宽、2xl 以下隐藏状态文案),1440px 无截断;⑤ vite manualChunks 拆出 vendor-react/vendor-icons,首屏 JS 从 811KB 降至约 214KB(33+143+35,不含懒加载)。**仍遗留**:设置"记忆与进化"页的统计卡语义需随进化数据源复核;index 懒加载聚合 chunk 680KB 供后续分析;笔记工具栏 Tooltip 可选 |
| F-11 | 深度扫描(2026-09-06 第三批:冗余/迁移痕迹/简化实现) | ① 4 个 `.orig` 残留(apps/docs 下,首轮移动未覆盖);② `store.ts` MemoryCognitionDatabase docblock 仍提 "legacy catalog"(已删除的概念);③ `routes/legacy.ts` 3163 行桌面前端 REST 兼容层——最大结构冗余候选,存在理由是迁移后桌面前端的旧 REST 路径;④ `~/.rin/mcp/servers.json` 旧家目录默认路径 3 处;⑤ agent-migration 为声明式简化实现(仅 skills+instructions);⑥ workspace 的 RemoteProvider 为 fail-loud stub(deferred P3) | 已处置:①删除(持久备份至 ~/orig-backup-durable/);②注释改写为 "journal 拥有独立 schema marker 与表"。登记不处置:③ 需产品确认桌面前端 api/ 迁移状态后整层移除;④ 低优先级路径默认值;⑤⑥ 为诚实声明的已知边界(docblock/异常均显式)。**撤回两项误报**:CopyButton 有 2 个消费者非死组件;笔记删除已有 ConfirmDialog 防误触 |

## 4. 结构扫描结果

- 包 census：21 个 workspace manifest（3 apps + 18 packages），结构与
  [CURRENT.md](../architecture/CURRENT.md) 一致；`packages/domains/memory/scripts/`
  为新增基准脚本目录，结构门禁通过。
- `verify-deps`：无未声明导入；`@rin/host` 对 `@rin/contracts` 的新增依赖已声明。
- 跨层方向：未发现 packages→apps 或 domains→host 的运行时导入
  （host 自身 src 对 `@rin/host` index 的自导入为既有模式，见 F-6）。
- TODO/FIXME：本轮改动未引入新的 TODO/FIXME/XXX 标记。
- lint：627 文件，0 警告 0 错误。

## 5. 门禁证据（处置后复跑）

- `pnpm run hygiene`：5 passed, 0 failed（含 verify-deps、verify-structure、
  verify-readme、Cordis、publint）。
- `pnpm run lint`：0 warnings, 0 errors。
- `pnpm exec vitest run packages/domains/memory`：229 tests passed。
- `pnpm run check`（全链）：metadata 21 manifests、hygiene 5/5、typecheck、
  lint 0/0、203 测试文件/1860 测试、desktop release verify、41/41 smoke
  （含 memory-lifecycle 真实 Host smoke：E-13/E-16/E-18）。

## 6. Claim boundary

本文只记录执行过的扫描命令与处置。`.orig` 残留的备份丢失已如实记录，不做
"无信息损失"的声称——丢失的是旧状态快照本身，而非任何当前权威文件的正确性。
性能基线为单机相对数字；门禁通过只证明对应检查项，不证明认知行为在真实
provider/多平台环境下的表现。
