# rin 门禁体系复用方案（Phase 10 规划）

> 目标：把 dsh 已经具备的工程纪律与门禁基础设施，以「零污染上游、零影响迭代」的方式复用到 rin，
> 使 rin 从「内部开发态」达到「社区级开源发布态」，且与 dsh 共享同一套工具、纪律与 CI 心智模型。
> 本文档是执行清单；随实施逐项核销。

## 1. 原则（为什么这样分）

dsh 门禁 = 工具（vitest/oxlint/knip/tsx）+ 纪律（AGENTS.md）+ 配置（glob 硬编码）+ 拼装（run-gates.ts）。

- **复用工具与纪律**：它们与目录无关，rin 直接继承。
- **独立配置**：dsh 的所有门禁配置都是硬编码 glob（`packages/*/*` 等），rin 被刻意排除（MIGRATION.md §9 契约在门禁层的体现）。要让 rin 进门禁，唯一不污染上游的做法是 rin 自带配置。
- **根只加脚本入口**：根 `package.json` 是 §9 允许的 3 个合并点之一，尾部追加 `rin:*` 脚本（标 merge-point 注释）。
- **渐进阈值**：不一步套 dsh 的「每文件 100%」覆盖率，否则 CI 永远红、失去信号价值。

## 2. dsh 门禁现状盘点（已核实）

| 门禁 | 现状 | 是否含 rin |
|---|---|---|
| 测试 | `vitest.config.ts` include = `packages/*/*/tests/**/*.spec.ts` + apps/examples/scripts | ❌（且是 .spec.ts，rin 用 .test.ts） |
| 覆盖率 | `test:coverage` = vitest --coverage，CI 每文件 100% | ❌ |
| lint | `.oxlintrc.json` overrides glob = packages/apps/examples/scripts/website | ❌ |
| hygiene | `knip.json`（硬编码 workspace entry）+ `run-gates.ts` 拼装 verify-* 脚本 | ❌ |
| doc-sync | `run-gates.ts doc-sync`（i18n 双语 + 文档门禁） | ❌ |
| CI | `ci.yml` → `check:ci:static` 等 | ❌ |

dsh 的 `verify-*` 门禁叶子（`scripts/verify-*.ts`）有 30+ 个，rin 最有价值的 4 个参考模板：
`verify-package-invariants`（包结构）、`verify-cordis-config`（装配完整性）、`verify-runtime-closure`（运行时闭包）、`verify-package-readme-limitations`（README 门禁）。

## 3. 复用映射表

| dsh 门禁 | rin 方案 | 复用度 |
|---|---|---|
| vitest + vitest.shared.ts | `rin/vitest.config.ts`（import shared 的 standardDecoratorPlugin/vitestExecArgv） | 工具复用 |
| .oxlintrc.json rules | `rin/.oxlintrc.json`（同 rules，glob 改 rin/*/*/src+tests） | rules 复用 |
| knip.json | `rin/knip.json`（workspace entry 指向 rin 包） | 工具复用 |
| run-gates.ts | `rin/scripts/rin-gates.ts`（照搬 mode→gates 结构，叶子换 rin 版） | 框架复用 |
| verify-*.ts | 写 rin 版 4 个（见 §4.3） | 模式参考 |
| ci.yml | 新增 `.github/workflows/rin.yml`（新文件，不碰 ci.yml） | 结构参考 |
| AGENTS.md | `rin/AGENTS.md`（引用 dsh 通用纪律 + rin 特有约定） | 纪律复用 |

## 4. 五层落地设计

### 4.1 测试层（最高优先）

**新增 `rin/vitest.config.ts`**：
- import `standardDecoratorPlugin`、`vitestExecArgv` 自 `../vitest.shared.ts`
- `tsconfigPaths({ projects: ['../tsconfig.base.json'] })`（复用根 paths facade）
- include：`rin/*/*/tests/**/*.test.ts` + `rin/*/*/tests/**/*.smoke.ts`
- 两 project：node（host 包）+ jsdom（web-ui 的 React 测试，`rin/web/web-ui/**` 用 `@vitest-environment jsdom` pragma 或 environmentMatchGlobs）

**根 package.json 追加**（scripts 区尾部）：
```json
"rin:test": "vitest run -c rin/vitest.config.ts",
"rin:test:coverage": "vitest run -c rin/vitest.config.ts --coverage"
```

**覆盖率策略（渐进）**：新增 `rin/coverage-thresholds.json`，从「当前实测基线」起步，每个包设 `lines/functions/statements` 阈值，随补测试逐步抬升。**不套 100%**。

### 4.2 lint 层

**新增 `rin/.oxlintrc.json`**：rules 与根一致（no-var/prefer-const/no-unused-vars/@cordis 相关），files 覆盖 `rin/*/*/src`、`rin/*/*/tests`、`rin/web/web-ui/src`。

**根 package.json 追加**：`"rin:lint": "oxlint -c rin/.oxlintrc.json"`。

### 4.3 hygiene 层（rin 特有，最需要 rin 化）

**新增 `rin/scripts/rin-gates.ts`**（照搬 run-gates.ts 结构，mode 简化为 `check`/单个叶子）+ 4 个 rin 版 verify 脚本：

1. **`rin/scripts/verify-rin-deps.ts`**（最高价值）——每包源码 `import '@rin/xxx'` 或 `import '@deepseek-ai/dsh-xxx'` 必须有对应 package.json 声明（dependencies/peerDependencies/devDependencies）。堵住 evolution 那种「运行时 import 未声明」缺口。
2. **`rin/scripts/verify-rin-cordis.ts`**——检查 `rin/bundle/rin/src/cordis.yml` 的装配完整性：每行 `name` 对应的包存在、RIN_HOST_PLUGINS 与 cordis.yml 一致、`!!js` 引用的 helper（rinHome/builtinRepositoryRoot/webUiDistRoot）在 `@rin/bundle` 有定义、每个包的服务名（super 名）与 web-server services refs 的 ctx.get 名对齐。
3. **`rin/scripts/verify-rin-readme.ts`**——每包 README 含职责/API/Known Limitations 三节（对齐 dsh verify-package-readme-limitations）。
4. **`rin/scripts/verify-rin-structure.ts`**——包结构门禁（package.json name=@rin/、tsconfig extends base、references vendor/cordis、无 src 下编译产物）。

**根 package.json 追加**：`"rin:hygiene": "tsx rin/scripts/rin-gates.ts check"`。

### 4.4 CI 层

**新增 `.github/workflows/rin.yml`**（新文件，上游 merge 零冲突）：
```yaml
jobs:
  rin:
    runs-on: ubuntu-latest
    steps:
      - checkout + pnpm install --frozen-lockfile
      - pnpm rin:typecheck
      - pnpm rin:lint
      - pnpm rin:hygiene
      - pnpm rin:test
      - pnpm rin:test:coverage   # 渐进阈值
```

### 4.5 纪律层

**新增 `rin/AGENTS.md`**：引用根 AGENTS.md 的通用纪律（ESM/JSDoc/waterfall/branded 类型/source-artifact plane/snapshot 精神）+ rin 特有（结构型 seam 约定、seam.ts 单文件、根合并点 3 个、Known Limitations 门禁）。CLAUDE.md symlink 指向它。

## 5. 根合并点改动（精确清单，最小化）

| 文件 | 改动 | 是否超出 §9 三个合并点 |
|---|---|---|
| 根 `package.json` | scripts 区尾部追加 `rin:test`/`rin:lint`/`rin:hygiene`/`rin:test:coverage`（标注释） | ✅ 允许（3 个合并点之一） |
| `.github/workflows/rin.yml` | 新增文件 | ⚠️ 非 3 个合并点，但**新增文件**不与上游 merge 冲突（上游无同名文件） |
| 其余（vitest/oxlint/knip/run-gates） | **零改动**（rin 自带配置） | ✅ |

## 6. 风险与坑（诚实预判）

1. **覆盖率基线未知**：需先跑一次 `rin:test:coverage` 测出现状，再定阈值；否则阈值拍脑袋。
2. **web-ui 测试是 React/jsdom**：53 个 .test.ts 约 20 个在 web-ui（stores/pages/lib），需 jsdom 环境 + React 测试库，rin/vitest.config 要分开 project。
3. **smoke 测试是 strip-types 脚本不是 vitest**：24 个 .smoke.ts 用 `node --experimental-strip-types` 直跑，不是 vitest 用例。vitest 未必能直接跑它们（它们 import .ts 相对路径 + node assert）。**决策：smoke 保留 strip-types 直跑（另设 `rin:smoke` 脚本串行跑），vitest 只收 .test.ts**——避免强行改 smoke 为 vitest 造成大量返工。
4. **verify-cordis-config 不能直接套**：dsh 的版本检查 bare 插件 manifest，rin 的 cordis.yml 用 `!!js` + 包名装配，必须写 rin 版（§4.3 已列）。
5. **.test.ts vs .spec.ts 命名**：不改名，rin 配置直接 include .test.ts。

## 7. 分阶段路线 + 子代理拆分

| 阶段 | 内容 | 子代理 | 优先级 |
|---|---|---|---|
| G1 | `rin/vitest.config.ts`（host + web-ui 两 project）+ `rin:test` + 覆盖率基线测量 | 1 个 | **P0** |
| G2 | `rin/scripts/verify-rin-deps.ts`（依赖完整性，最小最高价值）+ 接入 rin:hygiene | 1 个 | **P0** |
| G3 | `.github/workflows/rin.yml`（跑 typecheck+test+deps） | 1 个 | P1 |
| G4 | `rin/.oxlintrc.json` + `rin:lint` | 1 个 | P1 |
| G5 | 其余 3 个 verify 脚本（cordis/structure/readme）+ `rin/scripts/rin-gates.ts` 拼装 + `rin/AGENTS.md` | 2 个 | P2 |

G1+G2 可并行（不同文件）；G3 依赖 G1/G2；G4/G5 独立可并行。

## 8. 与「不影响迭代」的论证

- **dsh 迭代**：dsh 目录零改动（只有新增 `rin/` 文件 + 一个 workflow 新文件 + 根 package.json 尾部脚本）。上游 `git merge` 时，rin 侧唯一可能冲突点是根 package.json 的 scripts 区尾部（§9 已约定「追加在文件尾部 + 注释块」，重放即可）。
- **rin 迭代**：门禁配置全在 `rin/` 内，改门禁只影响 rin；新增包自动被 `rin/*/*` glob 覆盖，无需逐个注册。
- **一体化**：同一套工具（vitest/oxlint/knip/tsx）、同一套纪律（AGENTS.md 精神）、同一套 CI（rin.yml 与 ci.yml 并存），社区成员心智模型一致。
- **官方做法**：这是 dsh「source/artifact plane 分离」「rin 独立 tsconfig 聚合」哲学在门禁层的自然延伸——rin 有 `rin/tsconfig.json`，就该有 `rin/vitest.config.ts`/`rin/.oxlintrc.json`/`rin/scripts/rin-gates.ts`。
