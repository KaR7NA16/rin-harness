# rin 技术债清偿决策规划（补测试 / 清 lint / 删死代码）

> 基于 5 组审查（`./AUDIT-REPORT.md`）+ GA/GB 的失败/lint/覆盖率清单。本文档是执行清单。
> 原则：先让门禁「可信」（测试全绿、lint 归零），再「渐进抬覆盖率」，最后「删死代码收敛架构」。

## 0. 决策原则

1. **测试失败 ≠ 产品 bug**：11 个失败全是「测试自身缺陷」（断言过期/process.cwd 假设/mock 错），不是产品代码错——**全修**，否则 CI 永远红、门禁失去信号。
2. **lint 分两类**：机械项（useless-constructor/unused-vars/prefer-const/dynamic-delete）直接删；no-explicit-any 分「结构型 seam 的必要 any」（defineTool 的 TS2321 绕行，加 eslint-disable + 理由）与「web-ui 真实泄漏」（真修）。
3. **覆盖率渐进**：不追 100%，从最痛点（web-server 1.91%）开始，thresholds 随补测逐步抬升。
4. **删死代码分两档**：无决策风险的机械删除（整文件死/空实现/死导出）直接做；涉及架构的（双路由面、defaultConfig、前端后置特性）给出明确决策后执行。

## 1. 方向一：修 11 个失败测试（P0，全修）

| 失败文件 | 根因 | 修法 |
|---|---|---|
| codiconFontAsset.test.ts、i18n/locales.test.ts | process.cwd() 假设 cwd=web-ui | 改用 import.meta.url 相对路径 |
| cli/host.test.ts | 插件数断言过期（12 vs 17） | 更新为 17/18/19 |
| core/repository/reader.test.ts | 错误文案过期 | 更新断言文案 |
| prompt-memory/store、api/promptMemory/sessions/skills、memorySettings | 断言传 undefined/参数不匹配 | 修正断言参数 |
| TerminalSettings.test.tsx | xterm mock 非构造函数 + 2 未捕获错误 | 修 mock 为构造函数 |
| IconRail.test.tsx | zh locale 未注入 | 注入 locale |

**验收**：rin:test 121/121 全绿。**拆分**：1 个子代理（机械修测试，量小）。

## 2. 方向二：清 lint（P0 机械 + P1 any 分类）

**P0（14 个，机械直接修）**：5 no-useless-constructor（空 super 构造，删）、4 no-dynamic-delete（改 Reflect.deleteProperty/重构）、3 no-unused-vars（删）、2 prefer-const（let→const）。

**P1（19 个 no-explicit-any，分类）**：
- **结构型 seam 的必要 any（约 6-8 个）**：defineTool 的 options as any（TS2321 绕行）、seam 结构视图 ctx.get(...) as unknown as X —— 这些是「类型系统无法表达结构型 seam」的合法绕行，加 eslint-disable-next-line no-explicit-any + 理由注释，不删（删了 typecheck 会 TS2321/结构不匹配）。
- **web-ui 真实泄漏（约 11-13 个）**：(window as any)、(input as any) 等 —— 真修（类型守卫/窄化/正确的 window 声明）。

**验收**：rin:lint 0 error。**拆分**：2 个子代理（机械 14 个 1 个、any 分类 1 个）。

## 3. 方向三：补覆盖（P1，渐进，优先 web-server）

| 包 | 当前 | 目标 | 做法 |
|---|---|---|---|
| web-server | 1.91% | ≥50% | 补 routes 单元测试（fake services refs，覆盖 dispatch + 回退，复用 legacy-wire.smoke 的 fake 模式转 vitest .test.ts） |
| repository | 32.18% | ≥60% | 补 browse/reader/tools 的 vitest 单测 |
| token-optimization | 33.82% | ≥60% | 补 store-core/prompts/clean 单测 |
| agents | 41.23% | ≥60% | 补 projection/repository-agents/runtime-agents 单测 |

**验收**：rin:test:coverage 各包达阈值，coverage-thresholds.json 同步抬升。**拆分**：2 个子代理（web-server 1 个、其余 3 包 1 个）。

## 4. 方向四：删死代码 + 待决策项（P1/P2）

### 4.1 无决策风险的机械删除（P1，直接做）

| 项 | 位置 | 规模 |
|---|---|---|
| repository writer/migration/seed 三文件 | rin/core/repository/src/{writer,migration,seed}.ts | ~302 行 |
| sandboxes registerShellSeam 空实现 | rin/workspace/sandboxes/src/seam.ts:150-152 | ~3 行 |
| bundle placeholderReviewModel + defaultConfig 死键 | rin/bundle/rin/src/index.ts | ~45 行 |
| web-ui 死模块 mocks/data.ts、api/search.ts、ProjectContextChip.tsx | rin/web/web-ui/src/ | ~260 行 |
| 死导出 *_API_VERSION ×5、COMPUTER_USE_API_VERSION、cli DEFAULT_PORT/HOST、9 个 __xxx__ TAB 常量 | 各包 | ~30 行 |

### 4.2 架构决策（P2，明确决策后执行）

| 决策项 | 决策 | 理由 | 动作 |
|---|---|---|---|
| 双路由面 shadowing | 收敛到 legacy 为唯一面 | 前端 api/*.ts 主走 legacy 路径（原始数组契约）；v2 读 handler 用 mountedValue 信封与前端不一致，已是半死 | 删 v2 被 legacy 遮蔽的死路由（agents/notes 重复分支 + token.ts 整模块，~180 行），v2 保留 legacy 不认领的路径 |
| defaultConfig 双配置源 | 只留 web-server 键 | cli 只消费 defaultConfig['web-server']；其余 7 键与 cordis.yml 重复 | 删其余 7 键 + placeholderReviewModel + DEFAULT_INITIAL_SOUL 常量 |
| web-ui 前端先行后端后置 | terminal 清理，其余标注后置 | terminal 的 Tauri 命令在 main.rs 未实现（UI 可达必失败）；scheduled-tasks/plugins/adapters/filesystem 属后端后置，可接受 | 删 web-ui terminal api + gui shell/process 插件；其余在 README Known Limitations 标注 |

## 5. 优先级与并行批次

| 批次 | 内容 | 子代理 | 优先级 |
|---|---|---|---|
| 波 1（并行 3） | A 修 11 测试、B1 lint 机械 14、B2 lint any 分类 | 3 | P0（让门禁可信） |
| 波 2（并行 2） | C 补覆盖（web-server + 其余 3 包） | 2 | P1 |
| 波 3（并行 2） | D1 机械删死代码、D2 架构收敛 | 2 | P1/P2 |

波 1 完成后 rin:test 121/121 + rin:lint 0 error；波 2 完成后覆盖率达标；波 3 完成后死代码收敛。

## 6. 验收标准（每波）

- 波 1：pnpm rin:test 121/121 绿 + pnpm rin:lint 0 error
- 波 2：pnpm rin:test:coverage web-server ≥50%、repository/token-optimization/agents ≥60%
- 波 3：删 ~1000 行死代码 + pnpm rin:typecheck / rin:hygiene / rin:smoke 全绿（架构收敛后回归）
