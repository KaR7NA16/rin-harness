# rin AGENTS.md

rin 是 dsh 底座之上的 @rin 资产层（`rin/` 为唯一写入区）。通用工程纪律继承根
[`AGENTS.md`](../AGENTS.md)；本文件只补 rin 特有约定，冲突时本文件在 `rin/` 目录内优先。
完整门禁方案见 [`GATES-PLAN.md`](./GATES-PLAN.md)，目录分区权威说明见 [`README.md`](./README.md)。

## 继承的 dsh 通用纪律（根 AGENTS.md，rin 直接适用）

根 [`AGENTS.md`](../AGENTS.md) 的这些纪律 rin 不重复定义，只在此点名引用：

- **ESM everywhere**：`"type": "module"`；跨包用包名 import，包内相对 `.ts`；source 启动走 tsx 的 ESM-only hook（`node --import tsx/esm`），模块必须保持 ESM。
- **JSDoc**：每个模块/导出的非显然契约要有 JSDoc，函数式导出带 `@param`/`@returns`。
- **Waterfall 监听器必须 `next()`**：返回而不 next 会短路链。
- **Branded 类型**：Opaque 跨边界 id 用 `Branded<B>`，绝不裸 `string`。
- **Source plane vs artifact plane**：静态门禁与测试经 tsconfig `paths` 解析到 `src`；消费 `lib/` 的门禁显式声明依赖。
- **Snapshot 精神**：模型可见行为变更走 keyless snapshot（见根 `docs/testing.md`）。
- 其余根约定（Registrations are effects、显式 > 隐式、Misconfiguration fails loud、测试描述行为等）同样适用。

## rin 特有约定

1. **结构型 seam**：systemPrompt / shell / session 事件 / toolResultPruner 等 seam 不新增依赖，在 `seam.ts` 内定义最小接口；tools / agentPresets / skills 需要真实类型与工具函数时走真实 workspace 依赖（`@deepseek-ai/dsh-tools` / `dsh-agent-presets` / `dsh-skill`，`workspace:^`）。见 [`SEAM-PROJECTION.md`](./SEAM-PROJECTION.md)。
2. **seam.ts 单文件**：每个包的 seam 注册代码集中在 `src/seam.ts`，`index.ts` 的 `apply()` 保持薄（`ctx.plugin(Store, config)` + `registerSeam(ctx, config)`）；注入/索引/裁剪逻辑放纯函数模块，strip-types 冒烟可测。
3. **根合并点仅 3 个**（MIGRATION.md §9 更新迭代契约）：`pnpm-workspace.yaml`（`rin/*/*` glob）、根 `package.json`（@rin workspace 依赖段）、`tsconfig.base.json`（@rin paths 映射段）。约定：追加在文件尾部 + 注释块「rin extension — merge point」；upstream 冲突只可能在这 3 处，逐个重放。`.github/workflows/rin.yml` 是新增文件（上游无同名文件），不与 merge 冲突。
4. **Known Limitations 门禁**：每个包 README 含「`## Known Limitations and Deferred Work`」节（至少一条 top-level `- ` bullet），由 `verify-rin-readme` 强制。
5. **门禁拼装**：rin 门禁叶子由 [`rin/scripts/rin-gates.ts`](./scripts/rin-gates.ts) 拼装（`check` 全跑 / 单个叶子名）；smoke 脚本（`rin/*/*/tests/*.smoke.ts`）是 Cordis-free 直跑脚本，用 `node --experimental-strip-types` 从包目录运行，由 [`rin/scripts/run-smokes.mjs`](./scripts/run-smokes.mjs) 串行执行。vitest 只收 `.test.ts`（`rin/vitest.config.ts`）。

## 命令

```sh
pnpm rin:typecheck        # tsc -b rin/tsconfig.json（rin 唯一聚合）
pnpm rin:lint             # oxlint -c rin/.oxlintrc.json
pnpm rin:hygiene          # tsx rin/scripts/rin-gates.ts check（4 个 verify 叶子）
pnpm rin:test             # vitest run -c rin/vitest.config.ts（.test.ts）
pnpm rin:smoke            # node rin/scripts/run-smokes.mjs（.smoke.ts 串行）
pnpm rin:build            # 构建 @rin/web-ui
pnpm rin                  # node --import tsx/esm rin/cli/rin/src/bin.ts（host 启动）
```

## 包结构约定

- 两层（group / package）：`rin/<group>/<name>/` ↔ `@rin/<name>`，workspace glob `rin/*/*`。
- `package.json`：`name: @rin/<name>`、`private: true`、`type: module`、peerDep `@deepseek-ai/cordis`。
- `tsconfig.json`：extends `tsconfig.base.json`，`rootDir: src`、`outDir: lib/types`，references 每个 workspace 依赖。
- host 插件层零外部运行时依赖（只用 `node:` 内置）；产品层（web-ui / gui / cli / bundle）可以有构建/运行依赖。
- 跨 @rin 依赖用包名 import + project references，绝不用相对 `../../../`。
