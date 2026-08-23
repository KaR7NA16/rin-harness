# @rin/bundle

rin 装配层。把 dsh 底座（`@deepseek-ai/dsh-base`）与 @rin 全家 host 插件装配成一个零侵入组合，供 `@rin/cli` 的 `rin` 启动器 boot。本装配是 rin Web UI（8320）与未来 GUI 桌面壳共用的 host。本包是**纯数据/装配包**：不注册任何 Cordis 插件，只导出装配元数据、默认配置与路径解析助手。

## 职责

- 声明装配清单：`@deepseek-ai/dsh-base` + 当前 29 个 host 插件和 `@rin/web-server`，**不含 `@deepseek-ai/dsh-web-app`**（MIGRATION.md §8 决策 10）。
- 提供声明式装配文件 `src/cordis.yml`（@rin 插件 entry 列表，含默认 Config）。
- 提供程序化元数据（`src/index.ts`）：包名列表、默认配置对象、`rinHome`/`dshHome`/`sessionRoot`/`settingsPath`/`credentialsPath`/`builtinRepositoryRoot`/`webUiDistRoot`/`configPath`/`baseBundlePatchPath` 助手。
- 不写 `$DSH_HOME/profiles`、不向 dsh 加模板、不改 dsh 任何文件（零侵入）。

## 装配清单

`src/cordis.yml` 是唯一的声明式装配顺序，`src/index.ts` 导出相同的 roster
供 CLI、profile patch 和校验器复用。当前装配由三部分组成：

- `@deepseek-ai/dsh-base`：dsh 核心层；
- `RIN_HOST_PLUGINS`：29 个 @rin host 插件；
- `RIN_WEB_SERVER`：`@rin/web-server`，默认监听 `127.0.0.1:8320`。

具体 entry、默认 Config 和 dsh storage overrides 以 `src/cordis.yml` 与
`cordis.patch.yml` 为准，`pnpm exec tsx rin/scripts/verify-rin-cordis.ts`
会检查两条装配路径保持一致。

内置仓库根 `builtinRepositoryRoot()` 解析到 `rin/core/repository/builtin/`；Web UI 静态根 `webUiDistRoot()` 解析到 `rin/web/web-ui/dist/`。两者均相对本包解析，非相对进程 cwd。

## 构建 Web UI

`web-server` 的 `staticRoot` 指向 `@rin/web-ui` 的生产构建目录，启动 `rin` 前先构建一次：

```sh
pnpm run rin:build   # = pnpm --filter @rin/web-ui run build
pnpm run rin         # 启动 host，WebView/浏览器打开 http://127.0.0.1:8320
```

开发迭代前端可另开 `pnpm --filter @rin/web-ui run dev`（Vite dev server 代理到 8320）。

## 路径与覆盖

默认状态边界是 `$RIN_HOME`（设置时优先）否则 `~/.rin`；dsh 状态默认位于
`$RIN_HOME/dsh`，但可以独立迁移。路径覆盖方式：

- `RIN_HOME`：RIN catalog、投影、归档和 backup 的根目录；
- `DSH_HOME`：dsh 的独立状态根，未设置时回退到 `$RIN_HOME/dsh`；
- `RIN_SESSION_ROOT`：dsh JSONL session 根目录；
- `RIN_SETTINGS_PATH`：dsh settings 文件路径；
- `RIN_CREDENTIALS_PATH`：dsh credentials 文件路径，归档默认排除；
- 在 `src/cordis.yml` 直接改某行的 `config`（或改 `src/index.ts` 的 `defaultConfig`，两者需同步）。
- 通过 `rin` 启动器的 `--port`/`--host`/`--url` 覆盖 web-server 行。

## 与 dsh 原生 Web 的关系

本装配**不含 `@deepseek-ai/dsh-web-app`**，因此 `rin` 默认不监听 3080。dsh 原生 Web UI 仍可用 `dsh --profile web` 原样启动，永不改动、永不被 rin fork 或内嵌。rin 自己的 Web 面是 8320（`@rin/web-server`，可用 `enabled: false` 单独关闭）。

## Known Limitations and Deferred Work

- **`@rin/evolution` 的 `reviewModel` 是 boot 时适配器**：`src/index.ts` 导出的 `defaultConfig.evolution.reviewModel` 是 fail-loud 占位（需要 dsh llm seam，只在 boot 上下文存在）；真正可用的默认在 `src/cordis.yml` 的 `!!js` 里。该适配器已把消息内容构造成 `text` 内容块并检测 provider 错误 finish 分块（`tests/seam.smoke.ts` 用 fake llm 验证），完整真机 boot 仍由 `@rin/cli` 验收。
- **`cordis.yml` 与 `src/index.ts` 是两份平行来源**：路径与默认值需手工同步；冒烟测试只断言包名列表，不断言两份配置逐字一致。
- **`baseBundlePatchPath()` 依赖 `@deepseek-ai/dsh-base` 的 `./cordis.patch.yml` 公开导出**：上游移动该导出时需同步更新。
- **静态校验不代替真机 boot**：本包只保证元数据与 `cordis.yml` 能被解析；完整 host boot 由 `@rin/cli` 的真机 smoke 验收，dsh 或 web-ui 依赖变更后应重新运行。
