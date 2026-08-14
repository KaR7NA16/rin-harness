# @rin/cli

`rin` 启动器：装配并 boot `@rin/bundle`（dsh-base + @rin 全家 + web-server），在 8320 起一个 host 并打印其 URL。零侵入 dsh：不写 `$DSH_HOME/profiles`、不向 dsh 加模板、不列 dsh-web-app。rin 的交互面是 Web UI（8320）与 GUI 桌面壳；本启动器只负责 host 生命周期，无终端前端。

## 用法

```sh
rin              # 起 host（默认 http://127.0.0.1:8320）并打印 URL，常驻到 Ctrl-C
rin web          # 等价别名
rin --port 9000  # 覆盖 web-server 端口
rin --host 0.0.0.0
rin --url http://127.0.0.1:8320  # 覆盖打印的 URL（GUI 壳连入钩子）
rin --version
rin --help
```

## 与 dsh CLI 的关系

`rin` 只装配 rin 自己的资产面（8320），**不装配 `@deepseek-ai/dsh-web-app`**。dsh 原生 Web UI（3080）不受影响，仍可用 `dsh --profile web` 原样启动；dsh 的 headless/CLI/JSON-RPC 命令面也保留不动。两者可同时运行（端口 8320 vs 3080 互不冲突）。

## 与 @rin/gui 的关系

GUI 桌面壳（@rin/gui）通过 spawn 本启动器（或等价的 host 装配）拉起 host，再用 WebView 内嵌 8320 的 Web UI。本启动器因此保持无前端、无终端依赖。

## Known Limitations and Deferred Work

- **host boot 需真机验证**：`startHost` 走 `@deepseek-ai/dsh-app-boot` 的 `boot`（dsh-base patch 层 + `@rin/bundle` cordis.yml + `--port/--host` 覆盖）。本沙箱无法 spawn vitest/tsx，也缺 `DEEPSEEK_API_KEY`，故完整 boot（含 `@rin/evolution` 的 `reviewModel` llm seam 表面）只能在真机验收；当前仅断言装配元数据与参数解析。
- **`@rin/evolution` 的 `reviewModel`**：默认适配器是 `src/cordis.yml` 里的 `!!js`，其 dsh llm seam（`stream`/`listProviders`）表面需真机确认（对齐 `@rin/agents` 的已知限制）。
- **运行时构建收口**：`rin` 的 `lib/bin.js` 运行时构建（tsc 只产出 lib/types）与 `@rin/bundle` 的 tsconfig paths（`@rin/bundle`/`@rin/cli`）由主线程统一收口。
