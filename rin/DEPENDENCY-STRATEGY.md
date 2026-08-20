# rin-harness 依赖策略：Path B（registry 依赖化）

> 决策日期：2026-08-18　·　状态：执行中
> 本文档是 rin-harness 从「vendored dsh 源码（Path A）」迁移到「npm registry 依赖（Path B）」的**决策记录 + 实施手册**。
> 进度见文末「状态日志」。

## 一、决策

1. rin 的 dsh 底座从 **vendored 源码** 迁移为 **npm registry 依赖**（`@deepseek-ai/*`）。
2. UI 方向确定为 rin 自有 **`@rin/web-ui`**（`rin/web/web-ui/`）——**不再 rebrand dsh-web-app**，这是本策略成立的关键前提。
3. 两种启动方式（rin 自启 / dsh 托管）收敛到同一套底座：`@rin/bundle` + `@rin/cli` + registry 依赖。

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

### Phase 3　双启动验证（✅ 完成）
- rin 自启：`@rin/cli` → 8320 → `@rin/web-ui` 浏览器验证（0 console error）
- dsh 托管：dsh CLI + profile `bundles=[@deepseek-ai/dsh-base, @rin/bundle]` → 浏览器验证（0 console error）
- llm-pi-ai 加固 VERIFY（✅ 完成）：rc.7 **未内置**（仍钉 `@earendil-works/pi-ai: ^0.82.1`，0.x 范围不含 0.84.2）；以 `@earendil-works/pi-ai: ^0.84.2` override 恢复审计既定组合（vendored 时代 ^0.84.2 全门禁通过）；`pnpm audit` 0 HIGH；运行时验证通过

### Phase 4　同步机制替换（✅ 完成）
- ✅ 删除 `sync-rin-dsh.sh` + `dsh-layer-exclusions.txt`（vendored 机制作废；无代码引用，仅策略文档历史提及保留）
- ✅ 新增 `bump-dsh-deps.sh`：TARGET 默认取 `@deepseek-ai/dsh-base` 的 `dist-tags.next`（`latest` tag 过期停在 0.0.1-rc.1，整组 rc 线走 next）→ 精确钉全部 `@deepseek-ai/dsh-*` → `pnpm install` → `rin:typecheck` → 输出可审 diff；koishi 生态依赖（cordis/cosmokit/schemastery/cordis-plugin-*）不重写；默认 dry-run
- ✅ CI 重建：新增 `.github/workflows/rin.yml`（GATES-PLAN §4.4：typecheck → lint → hygiene → test → test:coverage → smoke）
- `dsh-web.sh` / `update-dsh.sh` 保留（`~/deepseek-harness` 克隆仍在跑 3080 web）

## 六、版本钉版策略
- **精确钉版，不用 `^`**（`"@deepseek-ai/dsh-base": "0.1.0-rc.8"`）
- 文档化「支持的 dsh 版本」= `0.1.0-rc.8`，升级必须走闸门
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
| llm-pi-ai 加固未被 rc.7 吸收 | 低 | ✅ 已以 `@earendil-works/pi-ai: ^0.84.2` override 兜底（AUDIT F1c 处方恢复，boot + provider 路由运行时验证通过） |

## 九、状态日志

- **2026-08-18**：决策成立（UI=@rin/web-ui）；Phase 0/1 完成。分支 `migration/registry-deps`；36 个 dsh 依赖已切 `0.1.0-rc.7`；**试装闸门通过**（rin:typecheck exit 0；8320 boot 成功，web-ui HTTP 200）。
- **2026-08-18（Phase 2 完成）**：删除 dsh 层 7349 文件（packages/vendor/apps/native/python/scripts/website/docs/assets/.agents/.github 等）+ 根 dsh 配置；`pnpm-workspace.yaml` 只留 `rin/*/*`（保留审计 overrides，删 link:vendor 与 node-pty patch）；根 package.json → `@rin/root`（rin:* 脚本 + 精简 devDeps）；`tsconfig.base.json` paths 只留 31 条 @rin 别名；31 个 rin 包 cordis/cosmokit/schemastery 切 registry 精确版（4.0.1 / 1.8.2 / 3.18.1）；rin 包 tsconfig 剥离 dsh 项目引用；dsh 门禁助手（markdown/publint-all/release-process）移植进 rin/scripts/；`verify-rin-cordis`/`verify-rin-structure` 改 Path B 语义；lefthook.yml 换 rin 钩子。
- **2026-08-18（8320 boot 修复）**：`@rin/bundle` 布局助手改为包根定位（bundlePackageRoot 向上爬），编译布局下 configPath/webUiDistRoot/builtinRepositoryRoot 全部正确；补全 `@rin/bundle` 依赖到 dsh-base patch 全集（76 个：74 个 rc.7 + cordis-plugin-hmr@1.0.16 + cordis-plugin-timer@1.1.3，koishi 生态独立版本），配置项目自持全部装配插件。
- **2026-08-18（Phase 2 闸门全绿）**：pnpm install ✅；rin:typecheck ✅；rin:lint 0 错 ✅；rin:test 183/183 文件 1669/1669 用例 ✅；rin:smoke 38 ✅；rin:hygiene 5/5 ✅；8320 boot `rin host on http://127.0.0.1:8320` + web-ui HTTP 200（`<title>rin</title>`）✅。
- **2026-08-19（dsh 托管打通，Phase 3 双启动验证完成）**：dsh CLI 的 profile boot 并行应用条目，`!!js rinHome(...)` 插值在 helper 提供前执行而失败（`without inject`）。修复：给 src/cordis.yml 全部 15 个用 helper 的行加 `inject: [rinHome/builtinRepositoryRoot/webUiDistRoot]`（dsh web-app 先例：行 inject webStartup 后 Loader 才解析其表达式，vendor/loader 与 registry loader 1.0.2 语义一致），镜像到 cordis.patch.yml，profile 覆盖层（session-query-sqlite）同步加 inject；`@rin/bundle/providers` 行自持提供 helper。`--profile rinweb` boot 成功：8320 监听、HTTP 200、`<title>rin</title>`、真实数据渲染（23 会话/最近项目/skills/当前目录/分支 migration/registry-deps）、**0 console error**。回验 rin 自启 8320 无回归（0 console error）。门禁全绿：rin:typecheck ✅、rin:hygiene 5/5 ✅。命名统一为「rin 自启 / dsh 托管」。
- **2026-08-19（llm-pi-ai 加固 VERIFY 完成）**：查实 rc.7 **未吸收** F1c 加固——`@deepseek-ai/dsh-llm-pi-ai@0.1.0-rc.7` 声明 `@earendil-works/pi-ai: ^0.82.1`（0.x 范围到 <0.83.0，不含 0.84.2），Phase 2 将 vendored 副本（审计时代钉 ^0.84.2）换成 registry rc.7 后该腿丢失；7 条 HIGH 传递漏洞（fast-uri SSRF×2 / ip-address SSRF / brace-expansion DoS×3 / undici 泄露）仅靠 11 条 overrides 压制。修复：`pnpm-workspace.yaml` 加 `'@earendil-works/pi-ai': ^0.84.2` override（唯一依赖方 dsh-llm-pi-ai，无解析冲突），install 后 lockfile 解析 0.84.2；`pnpm audit` **0 HIGH**（2 low / 5 moderate，全 dev）。运行时验证：dsh-base 装配自带 dormant `llm-pi-ai` 行 → 每次 boot 已实际加载 0.84.2 catalog；再经 `~/.dsh/settings.yaml` 配 deepseek catalog 路由 + acme 手声明 openai-completions 路由 → rin 自启 boot **0 错误**（resolveRouteModels / reuseCatalogProvider / createProvider+openAICompletionsApi 全路径通过），随后还原 settings。fast-uri@3.1.5、ip-address@10.5.0、undici@7.29.0 修复版在树；brace-expansion 已被 0.84.2 弃用（override 留作防御）。
- **2026-08-19（Phase 4 完成）**：删 `rin/scripts/sync-rin-dsh.sh` + `dsh-layer-exclusions.txt`（vendored 同步机制作废，无残留引用）；新增 `rin/scripts/bump-dsh-deps.sh`（dry-run 默认；TARGET 取 dsh-base `dist-tags.next` = 0.1.0-rc.7，规避过期的 `latest`=0.0.1-rc.1；重写全部 96 个 `@deepseek-ai/dsh-*` 精确钉 → pnpm install → rin:typecheck → diff，koishi 生态版本不碰；dry-run 冒烟通过，already-at 路径 exit 0）；新增 `.github/workflows/rin.yml`（GATES-PLAN §4.4 六道闸门：rin:typecheck / rin:lint / rin:hygiene / rin:test / rin:test:coverage / rin:smoke；pnpm@11.7.0 + Node 22）。
- **2026-08-21（rc.8 升级完成）**：`MODE=apply bump-dsh-deps.sh`（TARGET=dist-tags.next 0.1.0-rc.8）将 110 个 `@deepseek-ai/dsh-*` 精确钉统一 7→8（仅 bundle 追加/更新 92 个装配依赖，其余 13 个包各 1~3 个直依赖），pnpm install + rin:typecheck 通过；`pnpm-workspace.yaml` 的 `@earendil-works/pi-ai: ^0.84.2` override 保留（rc.8 的 dsh-llm-pi-ai 仍声明 `^0.82.1`，加固腿不变）；`~/deepseek-harness` 克隆同步切到 `dsh-v0.1.0-rc.8`（update-dsh.sh：checkout + install + build + 3080 web 重启）。
- **2026-08-21（8320 启动失败排障，闸门暴露→dedupe 收口）**：bump 后 8320 boot 报 `The requested module '@deepseek-ai/dsh-attachment' does not provide an export named 'admitEncodedImages'`——根因是 `@deepseek-ai/dsh-commands@0.1.0-rc.8` 的 peer `dsh-attachment` 被解析绑定到残留的 rc.7 实例（`e337...`），`pnpm install`/`pnpm update '@deepseek-ai/dsh-*'` 只新增 rc.8 实例未重排旧 peer context。修复：`pnpm dedupe`（-129 包，rc.7 dsh 快照 149→99，bundle 的 dsh-commands 重排到 `3236...`=attachment rc.8），8320 boot `rin host on` + HTTP 200 稳定（5/5 探测）；3080 无回归。残留 99 个 rc.7 快照为传递 peer 闭包（非 bundle 直接解析路径），锁文件已收口；「退回显式版本映射」回退路径（bundle 补钉 dsh-attachment 等 peer 根）仍留作预案。
