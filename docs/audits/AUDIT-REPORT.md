# rin 代码质量审查报告（死代码 + 设计冗余）

> 历史快照：2026-08-15，审查基于迁移前的 `rin/` 目录布局。文中的包数量、文件路径、引用关系和死代码位置不代表当前仓库；当前目录事实以 `docs/architecture/CURRENT.md` 与 `docs/audits/REPOSITORY-LAYOUT-CLOSEOUT.md` 为准。历史命中保留用于追溯，不得作为现行路径引用。

> 5 组并行审查（core+workspace / memory / optimization+learning+notes / 新服务包 / web+bundle+cli+gui），
> 全部只读核实（grep export 引用 + 逐文件阅读），未修改任何文件。生成时间 2026-08-15。

## 全局结论

**可消除死代码约 ~3300 行**，外加大量「完整实现但未接入」的半成品面与跨包重复。

核心模式（跨 5 组一致）：

1. **「写完了但没接入」是最主要死代码来源**——Phase 9 之前「先建服务、后接 seam」策略的遗留：领域逻辑写全了，但 seam/route/host 只接了一半，导致整文件/整方法零调用。
2. **双路由面 shadowing**：legacy(v1) 与 routes/(v2) 并存，legacy 前置遮蔽使 v2 一批路由永远不执行。
3. **跨包重复**：路径/FS 原语、search-limit 常量、`*_API_VERSION`、overview 三份、COMPOSITION_FILE 镜像、defaultConfig vs cordis.yml 双配置源。
4. **前端先行、后端后置**：UI 可达但 8320 无端点的特性（scheduled-tasks/terminal/plugins/adapters/filesystem 等）。

## 各组死代码规模

| 组 | 范围 | 可删规模 | 核心项 |
|---|---|---|---|
| A | core+workspace | ~302 行 | repository writer/migration/seed 三整文件（零消费）；sandboxes registerShellSeam 空实现；attachRepositoryToContainer 未接入 |
| B | memory | ~2000 行 | session-search 项目记忆链(1090)；skill-memory store+lifecycle(590)；knowledge 写入侧(357)；prompt-memory entries/reviewLog/config 写路径(210) |
| C | optimization+learning+notes | ~250 行 | smart-pruning message-list 路径(117，与 seam-core 重复)；evolution 死方法组+闭环无入口(120)；token cleanSystemPromptParts(13) |
| D | 新服务包 | 16 文件+~55 行 | 16 个 src/*.d.ts.map（已 git rm）；COMPUTER_USE_API_VERSION；过度 re-export；写路径未接线 |
| E | web+bundle+cli+gui | ~770 行 | web-server 被遮蔽 v2 路由(180)；web-ui 整模块死(260)+死导出(160)；bundle defaultConfig 半死+placeholderReviewModel(45)；gui 占位(112)；cli 死常量(6) |

**合计 ~3300 行纯死代码**（不含半成品面、跨包重复抽取收益）。

## 关键决策点（需产品定夺，非机械清理）

1. **「删瘦身」 vs「接全」**：memory 域的 ~2000 行是「完整实现但未接入」的领域能力（session-search 项目记忆、skill-memory store、knowledge 写入侧）。删=放弃已实现能力，接=让知识库/技能记忆/会话记忆真正可写。这决定 Phase 11 的方向。
2. **双路由面统一**：legacy(v1) 与 routes/(v2) 该收敛为单套。
3. **defaultConfig 与 cordis.yml 双配置源**：建议只留 cordis.yml 为唯一源。
4. **前端后置特性二分**：scheduled-tasks/terminal/plugins 等 UI 可达但后端未接，按「后置可接受 vs 该清理」逐一处置。

## 立即可做的机械清理（无决策风险）

1. ✅ 16 个 src/*.d.ts.map（已 git rm）
2. web-ui 整模块死：mocks/data.ts(202)、api/search.ts(29)、ProjectContextChip.tsx(29)
3. 死导出：*_API_VERSION ×5、COMPUTER_USE_API_VERSION、cli DEFAULT_PORT/HOST、9 个 __xxx__ TAB 常量、~30 个 web-ui 死类型
4. repository writer/migration/seed 三文件 + reader resolveAssetRepositoryRoot
5. sandboxes registerShellSeam 空实现
6. bundle placeholderReviewModel + defaultConfig 死键
7. gui 占位前端 main.ts/index.html

## 门禁衔接

- verify-rin-structure「无 src 编译产物」门禁可直接防住 .d.ts.map 类污染复发。
- verify-rin-deps 门禁可防住 evolution 类「import 未声明」缺口复发。

## 门禁收口清单（GD 审查 + 各子代理报告汇总）

1. bundle 缺 5 个 @rin 依赖（真实缺口）：@rin/host package.json dependencies 只声明 13 个 @rin 包，缺 tasks/mcp/computer-use/agent-migration/teams（cordis.yml + RIN_HOST_PLUGINS 已挂载但未声明）。verify-rin-deps 是 import 级检查，bundle 用字符串字面量引用故漏掉。收口：补 5 个 dependencies。

2. gui/web-ui tsconfig 豁免：rin/gui/gui 与 rin/web/web-ui 是产品层（Tauri/Vite 独立配置），不 extends base、不 references vendor/cordis、不在 rin/tsconfig.json 聚合。裁决：verify-rin-structure 脚本对产品层包加豁免。

3. README 规则口径：任务说放宽，rin/AGENTS.md 写精确标题+bullet。精确规则挂 agent-migration/tasks/web-ui 三个包。裁决：选精确标题为 canonical，修 3 个包标题。

4. oxlintrc 配置问题：reportUnusedDisableDirectives 非 root 被拒 + ignorePatterns 混用 ../ 与无前缀基准。收口修。

5. M1 发现的 v2 读 handler 信封不一致：mountedValue 信封 vs 前端原始消费。建议后续统一（单独项）。

6. GB lint 发现（33 条，清理输入）：19 no-explicit-any + 5 no-useless-constructor + 4 no-dynamic-delete + 3 no-unused-vars + 2 prefer-const。均真实（非误报），全在 rin/ 内。建议根脚本 rin:lint 改为 oxlint -c rin/.oxlintrc.json rin 收窄；web-ui baseUrl 迁移后可启用 type-aware 规则；web-server/tests/smoke.ts 命名非 *.smoke.ts 贡献 3 条（建议改名）。
