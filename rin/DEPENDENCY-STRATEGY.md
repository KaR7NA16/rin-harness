# rin-harness 依赖策略：Path B（registry 依赖化）

> 决策日期：2026-08-18　·　状态：执行中
> 本文档是 rin-harness 从「vendored dsh 源码（Path A）」迁移到「npm registry 依赖（Path B）」的**决策记录 + 实施手册**。
> 进度见文末「状态日志」。

## 一、决策

1. rin 的 dsh 底座从 **vendored 源码** 迁移为 **npm registry 依赖**（`@deepseek-ai/*`）。
2. UI 方向确定为 rin 自有 **`@rin/web-ui`**（`rin/web/web-ui/`）——**不再 rebrand dsh-web-app**，这是本策略成立的关键前提。
3. 两种产品形态（插件形态 / 独立 harness 形态）收敛到同一套底座：`@rin/bundle` + `@rin/cli` + registry 依赖。

## 二、背景

rin 的产品层是 `rin/*`（约 34 个 `@rin/*` 包），dsh 提供运行时底座。迁移前 dsh 底座以源码形式 vendored 在库内六个目录（`packages/ vendor/ apps/ website/ native/ scripts/`），配同步机制 `rin/scripts/sync-rin-dsh.sh` + 排除清单 `dsh-layer-exclusions.txt`（6 个 rin 定制文件）。

**Path A 的致命伤（实测）**：上游 deepseek-harness 约 **2 天一波发布**（2026-08-10 rc.1 → 08-11 rc.2 → 08-12 rc.3/rc.5 → 08-13 rc.6 → 08-17 rc.7）。按此节奏，Path A = 每 2 天一轮 435 文件树级同步 + 品牌补丁重打 + VERIFY 核对，不可持续。

## 三、决策依据（全部实测，2026-08-18）

| # | 证据 | 结论 |
|---|---|---|
| 1 | `@deepseek-ai/dsh@0.1.0-rc.7` 的 **61 个依赖全部声明 `^0.1.0-rc.7`** | 上游**整组一致发布**，无版本矩阵错配 |
| 2 | rin 所需 **29 个 `@deepseek-ai/dsh-*` 包全部存在 `0.1.0-rc.7`**（`npm view @pkg@0.1.0-rc.7` 逐一命中） | 可整体钉 `0.1.0-rc.7`，可复现 |
| 3 | `~/.dsh/profiles/web` 的 `dsh.profile.bundles = ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dshmarket"]` 已在跑 | **从 registry 组装 dsh 运行时是已实证的消费模式** |
| 4 | `@deepseek-ai/dsh-brand` 只是 `Branded<T>` 类型原语，非品牌机制 | 品牌不能靠上游 slot，只能走 `@rin/web-ui` 自持 |
| 5 | npm search 曾显示子包版本散乱（rc.1~rc.6） | 系索引滞后，非真实状态（见 #1/#2） |

## 四、A/B 对比结论

| 维度 | Path A（vendored） | Path B（registry） |
|---|---|---|
| 升级成本 | 每 ~2 天 435 文件同步 + 补丁重打 | 改版本号 + `pnpm install` |
| 版本可控 | 源码在库 | 整组钉 `0.1.0-rc.7`（已实证） |
| 定制 | 直接改源码（同步时重打） | slot / `patch:` / fork 单包 |
| 品牌/UI | 改 6 个 vendored 文件 | `@rin/web-ui` 自持（本决策确定） |
| 安全审计 | 审计 vendored 源码 | 审计 node_modules + `npm audit` |
| 开源叙事 | "fork of deepseek-harness" | "built on @deepseek-ai" |
| 发布节奏适配 | 🔴 不可持续 | ✅ 一行 bump |

**结论**：UI 方向定为 `@rin/web-ui` 后，Path B 无硬伤，采纳。

## 五、实施步骤

### Phase 0　基线（✅ 完成）
- Phase 1 提交：`8fb2960e4c feat(rin): integrate notes and knowledge graph into web-ui and web-server`
- 工具脚本提交：`b2f93fec1f chore(rin): add dsh web and upstream sync tooling`
- 前置：所有 pnpm/node 命令须 `source ~/.dsh_env.sh`（否则 node 解析到 Windows node.exe，pre-commit hook 会 `Permission denied`）

### Phase 1　分支 + 试装闸门
1. 分支 `migration/registry-deps`（主分支零影响，失败即停留分支回退 Path A）
2. 全量替换 `rin/**/package.json` 中 `"@deepseek-ai/dsh-*": "workspace:^"` → `"0.1.0-rc.7"`
   - ⚠️ 不动 `@deepseek-ai/cordis` / `cosmokit` / `schemastery`（koishi 生态，自有版本，Phase 2 后转 registry）
3. `pnpm install` + `pnpm run rin:typecheck` → **报错清单 = API 差异清单**
4. `@rin/cli` 启动 8320 + 浏览器验证 `@rin/web-ui`
5. **通过 → Phase 2；失败 → 停分支，回主分支执行 Path A（机制现成）**

### Phase 2　删除 vendored 层 + 根配置重写
- 删除 `packages/ vendor/ apps/ website/ native/ scripts/`（~430 文件）
- `pnpm-workspace.yaml` → 只留 `rin/*/*`
- 根 `package.json` → `@rin/root`；删 dsh 构建链（`tsc -b tsconfig.host.json` + `tsdown`）；换 `build:rin` / `typecheck:rin` / `publish:rin`
- `tsconfig.host.json` / `tsconfig.client.json` 作废，`rin/tsconfig.json` 独立聚合
- `@deepseek-ai/cordis`/`cosmokit`/`schemastery` 从 registry 引入（`cordis@^4.0.1` 已发布）

### Phase 3　双形态验证
- 插件形态：`@rin/cli` → 8320 → `@rin/web-ui` 浏览器验证（0 console error）
- harness 形态：dsh CLI + profile `bundles=[@deepseek-ai/dsh-base, @rin/web-server, @rin/web-ui, ...]` → 浏览器验证
- llm-pi-ai 加固 VERIFY：rc.7 是否已内置；若否 → `patch:` 协议

### Phase 4　同步机制替换
- 删除 `sync-rin-dsh.sh` + `dsh-layer-exclusions.txt`（vendored 机制作废）
- 新增 `bump-dsh-deps.sh`：查最新 registry 版本 → 更新精确钉 → `pnpm install` → `rin:typecheck` → 输出可审 diff
- `dsh-web.sh` / `update-dsh.sh` 保留（`~/deepseek-harness` 克隆仍在跑 3080 web）

## 六、版本钉版策略
- **精确钉版，不用 `^`**（`"@deepseek-ai/dsh-base": "0.1.0-rc.7"`）
- 文档化「支持的 dsh 版本」= `0.1.0-rc.7`，升级必须走闸门
- 上游发布纪律不佳时（未来若出现非整组发布），闸门会暴露，届时退回显式版本映射

## 七、闸门与回滚
- 每步可回滚：分支 + 安全 tag
- 硬性顺序：**试装通过 → 删除 → 双形态验证 → 提交**，禁止跳过

## 八、风险登记

| 风险 | 等级 | 应对 |
|---|---|---|
| 品牌 rebrand 无上游 slot | 中 | 已用 `@rin/web-ui` 自持规避 |
| 上游发布纪律下降 | 低-中 | 精确钉版 + bump 闸门 |
| rc.7 API 与 rin 代码不兼容 | 中 | typecheck 归因，逐个修 rin 侧 |
| llm-pi-ai 加固未被 rc.7 吸收 | 低 | `patch:` 协议兜底 |

## 九、状态日志

- **2026-08-18**：决策成立（UI=@rin/web-ui）；Phase 0/1 完成。分支 `migration/registry-deps`；36 个 dsh 依赖已切 `0.1.0-rc.7`；**试装闸门通过**（rin:typecheck exit 0；8320 boot 成功，web-ui HTTP 200）。