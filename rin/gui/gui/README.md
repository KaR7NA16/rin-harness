# @rin/gui

rin 桌面 GUI 壳 —— 一个 **Tauri 2 薄壳**，内嵌 rin 自己的 Web UI（`@rin/web-ui`，8320），
用系统 WebView 渲染、系统托盘常驻，负责起/收 host 子进程。它不重写任何前端、不触碰 dsh 上游。

## 定位

| 项 | 说明 |
|---|---|
| 形态 | Tauri 2 薄壳（Rust + 系统 WebView），产物轻量，无 Electron 级运行时 |
| 内嵌 | rin web-ui（复用全部 11 页，零前端重写） |
| host 形态 | 开发态 `spawn rin`；发布态 `spawn sidecar`（打包 dsh runtime） |
| 生命周期 | 启动 → 起 host → WebView 连 8320 → 托盘常驻 → 退出回收子进程 |

选型定稿见根 `MIGRATION.md` §8 决策 9/10。本包只做「壳」，业务能力全部在 host 侧
（`@rin/bundle` 装配 dsh-base + @rin 全家 + `@rin/web-server`），GUI 侧零业务逻辑。

## 架构图

```
┌────────────────────────────────────────────────────────────────────┐
│                        @rin/gui  Tauri 2 薄壳                          │
│                                                                    │
│   ┌──────────────────────────────────────────────────────────────┐ │
│   │  系统 WebView（Windows: WebView2 / macOS: WKWebView /         │ │
│   │               Linux: WebKitGTK）                              │ │
│   │                                                              │ │
│   │    ┌────────────────────────────────────────────────────┐    │ │
│   │    │  rin web-ui（@rin/web-ui，11 页 React SPA）        │    │ │
│   │    │  · 加载 http://127.0.0.1:8320                      │    │ │
│   │    │  · /api/* 走同源 JSON API，无 CORS 跨域            │    │ │
│   │    └──────────────────────────┬─────────────────────────┘    │ │
│   └────────────────────────────────┼──────────────────────────────┘ │
│                                    │ HTTP JSON API（127.0.0.1:8320）│
│   ┌────────────────────────────────▼──────────────────────────────┐ │
│   │  Rust 侧 host 管理（仅 spawn / 监控 / 回收，不做业务）          │ │
│   │  · 开发态：spawn `rin`（@rin/cli → @rin/bundle → host） │ │
│   │  · 发布态：spawn `rin-sidecar`（打包 runtime）   │ │
│   │  · 父进程看门狗：GUI 崩溃/退出时回收 host，不让它变孤儿         │ │
│   └────────────────────────────────┬──────────────────────────────┘ │
│                                    │ node 子进程                     │
│   ┌────────────────────────────────▼──────────────────────────────┐ │
│   │  host = @rin/bundle 装配层                                      │ │
│   │  dsh-base + @rin 全家（repository/environment/...）+            │ │
│   │  @rin/web-server（默认 127.0.0.1:8320，enabled 开关）           │ │
│   └─────────────────────────────────────────────────────────────────┘ │
│                                                                    │
│   系统托盘（tray）常驻 → 「退出」动作先回收 host 再退出 GUI            │
└────────────────────────────────────────────────────────────────────┘
```

要点：

- **WebView 内嵌 8320 web-ui**：GUI 不打包、不 fork web-ui 的业务逻辑，只复用它的 11 页。
  开发态（`devUrl`）WebView 直连 `http://127.0.0.1:8320`，页面由 `@rin/web-server` 的
  `staticRoot` 伺服、与 API 同源免 CORS；发布态（`frontendDist`）加载打进 bundle 的 web-ui
  `dist/`，其 `/api/*` 仍打回本机 8320（CSP `connect-src` 已放行 `127.0.0.1:*`）。
  `devUrl`/`frontendDist` 由子任务 1 的 `tauri.conf.json` 定。
- **host 由 Rust 起收**：host 是独立 node 子进程。GUI 负责起它（等 `/api/health`
  变 ok 再让 WebView 加载）、监控它（崩溃可重启，MVP 先 fail-loud）、并在退出时回收它。
- **单 host 单端口**：默认只起一个 host、只占 8320，无双端口冲突、无性能浪费
  （MIGRATION.md §8 决策 10）。

## 与双 webui 的关系

rin-harness 有三个 Web 面（MIGRATION.md §4.1）。本包只属于其中之一：

| UI 面 | 端口 | 与 @rin/gui 的关系 |
|---|---|---|
| **dsh 原生 Web UI** | 3080 | **独立、永不改动、GUI 不内嵌**。由 dsh 上游所有，用 `dsh --profile web` 原样启动；GUI 不 fork、不嵌、不关它的 bundle，也不读它 |
| **rin Web UI** | 8320 | rin 的主 Web 面，**GUI 内嵌它**（WebView 直连 8320）。可配置关闭（`@rin/web-server` 的 `enabled: false`），关闭只影响 8320，不影响任何 dsh 面 |
| **rin GUI（本包）** | — | Tauri 2 桌面壳：起 host → WebView 内嵌 8320 → 托盘常驻 → 退出回收子进程 |

三者可同时运行：8320 与 3080 端口互不冲突。GUI 只依赖 8320，与 dsh 原生 3080 无任何耦合。

## 目录说明

```
rin/gui/gui/
├── README.md                     # 本文档
├── src-tauri/                    # Rust 壳（子任务 1 所有：main.rs / tauri.conf.json / capabilities）
│   ├── src/main.rs               #   入口（spawn host + 托盘 + WebView）
│   ├── tauri.conf.json           #   窗口/安全策略/bundle.externalBin/installerHooks
│   ├── capabilities/             #   shell:allow-execute/spawn/kill（host/sidecar 权限，整包放行）
│   ├── icons/                    #   平台图标（二进制，主线程 Copy-Item，见 docs/asset-migration.md）
│   └── binaries/                 #   发布态 sidecar：rin-sidecar[.exe]（构建产物，gitignore）
├── assets/                       # 品牌/字体/图标静态资产（二进制，主线程 Copy-Item）
│   ├── app-icon.svg              #   海豹 app 图标（主视觉）
│   ├── fonts/                    #   7 款字体（Archivo/Geist/JetBrains Mono/Material Symbols/codicon）
│   ├── provider-icons/           #   deepseek/ollama/… 及 styled/ 变体
│   ├── icons/                    #   github 等第三方图标
│   └── brand/                    #   wordmark（旧 cyberpsychosis → 需改名 rin，见资产清单）
├── docs/
│   ├── asset-migration.md        # 品牌资产迁移清单（源路径 → 目标路径，供主线程 Copy-Item）
│   └── verification.md           # 真机验证清单
└── scripts/
    ├── installer.nsh             # NSIS 安装器 hook 占位（快捷方式 + .rin 关联 + 进程回收）
    └── build-sidecar.md          # dsh runtime sidecar 打包说明（发布态 host）
```

> `src-tauri/` 与 `assets/` 下的二进制资产（图标/字体/图片）**不由本子任务搬运**，
> 由主线程按 `docs/asset-migration.md` 用 Copy-Item 迁移。本仓库只写清单与引用路径。

外壳身份（子任务 1 的 `src-tauri/tauri.conf.json`）：`productName: "rin"`、
`identifier: "com.rin.harness"`、`devUrl: http://127.0.0.1:8320`、`frontendDist: ../../../web/web-ui/dist`、
`resources` 打进 builtin 仓库。sidecar：main.rs 以 `rin-sidecar[.exe]` 名 spawn（argv `serve ...`）；
`externalBin` 写 `["binaries/rin-sidecar"]`，与 main.rs 的 `rin-sidecar` 名一致（标准 Tauri sidecar 模式：构建时按 `binaries/rin-sidecar-<triple>[.exe]` 找源、打包后邻 exe 落为无 triple 的 `rin-sidecar[.exe]`，见 `scripts/build-sidecar.md`）。

## host 形态

开发态与发布态共用同一套 GUI 壳，区别只在「起 host 的方式」：

- **开发态（`cargo tauri dev`）**：Rust 侧 spawn `rin`（`@rin/cli` 的 bin），
  `@rin/cli` 装配 `@rin/bundle` 在 8320 起 host。需要本机已 `pnpm install` +
  `pnpm --filter @rin/cli ... run build`（或走 source launch）。
- **发布态（`cargo tauri build`）**：Rust 侧 spawn 随安装包分发的 sidecar
  `rin-sidecar[.exe]`（单文件 node 可执行，打包 dsh runtime，目标机
  **无需安装 Node/pnpm**；argv = `serve --port 8320 --host 127.0.0.1`）。打包方式见 `scripts/build-sidecar.md`。

## 实现现状（子任务 1：Tauri 配置 + Rust 壳 + 前端 bootstrap）

已落地的骨架（子任务 1 产物，真机构建前为静态自查级）：

- Rust 侧 spawn 用 `std::process::Command`（非 shell 插件）：统一 `start_host()`，dev/release 只差可执行路径与 argv。
  - 开发态 argv：`rin web --port 8320 --host 127.0.0.1`（命令名可用 `RIN_GUI_HOST_CMD` 覆盖）。
  - 发布态 argv：`rin-sidecar serve --port 8320 --host 127.0.0.1`（sidecar 名对齐 scripts/build-sidecar.md）。
  - 统一带 `RIN_PARENT_PID` 环境变量，供 sidecar 父进程看门狗自退。
- host stdin 写端由壳持有（`rin web` 把 stdin EOF 当退出信号），退出时 drop + kill + wait 回收。
- 托盘：左键单击显示窗口，菜单「Show rin / Quit rin」；关闭窗口隐藏到托盘而非退出；托盘退出置 quitting 标志后 app.exit(0)。
- `build.frontendDist` = "../../../web/web-ui/dist"：发布态直接打包 `@rin/web-ui` 的产物，与浏览器 8320 共用同一套 UI。
- 前端 bootstrap（index.html + src/main.ts）仅探测宿主 + 探 /api/health，真实 UI 由 web-ui 提供。
- 环境变量：`RIN_GUI_HOST_CMD`（覆盖 dev 命令）、`RIN_GUI_NO_SPAWN`（置 1/true/yes/on 直连已运行的 8320，不 spawn）。

## 开发 / 构建 / 打包（真机）

> 本沙箱 Rust 工具链缺失、spawn 被 EPERM 拦截、网络受限，**以下命令均未在本仓库执行**。
> 真机（Windows/macOS/Linux 桌面 + Rust + 联网）执行。

前置（一次）：

```sh
# Rust 工具链（rustup 或发行版包）
rustup toolchain install stable

# Tauri CLI
cargo install tauri-cli --version "^2" --locked

# 系统 WebView / Tauri 系统依赖
#   Windows : WebView2 Runtime（Win10/11 一般已内置，或安装 Evergreen 版）
#   macOS   : 系统 WKWebView（无需额外安装）
#   Linux   : webkit2gtk-4.1 + libayatana-appindicator3 + rsvg + patchelf（见 tauri 文档）
```

前端与 sidecar 前置（发布态需要）：

```sh
# rin web-ui 静态产物（供 @rin/web-server staticRoot 伺服，也供 GUI 发布态打包）
pnpm install
pnpm run rin:build

# 开发态 host：pnpm run rin（等价于 source-launch @rin/cli -> @rin/bundle -> 8320）
pnpm run rin
```

开发（热重载 WebView + 实时 host）：

```sh
cd rin/gui/gui
cargo tauri dev
```

构建安装包：

```sh
cd rin/gui/gui
cargo tauri build                 # 产物在 src-tauri/target/release/bundle/（.msi/.exe 或 .dmg/.deb/.rpm）
# 指定目标/包格式：
#   cargo tauri build --target x86_64-pc-windows-msvc
#   cargo tauri build --bundles deb,rpm
```

发布态还需先产出 sidecar（见 `scripts/build-sidecar.md`）并放入 `src-tauri/binaries/`，
否则 bundle 里的 `externalBin` 会失败。

## Known Limitations and Deferred Work

- **真机构建未验证**：本包在沙箱内仅做静态自查（结构/语法/无拼写），`cargo tauri
  dev/build` 需在真机验证（Rust + WebView + 联网 + 前端 dist + sidecar 齐备）。验收点见
  `docs/verification.md`。
- **host 起收由 Rust 侧实现**：spawn `rin` / spawn sidecar、`/api/health` 就绪探测、
  父进程看门狗、退出回收，属 `src-tauri/src/main.rs`（子任务 1），本子任务只写文档契约。
- **通知（系统通知）后置**：托盘常驻但不接系统通知推送；通知插件（Tauri notification）后置。
- **开机自启（auto-launch）后置**：不做登录自启；需要时加 Tauri autostart 插件。
- **远程实例后置**：GUI 只连本机 8320，不支持连接远端 host（对应 @rin/remote 后置）。
- **多实例后置**：MVP 默认单实例（单 host 单端口 8320）；多实例/多 host 需端口协商，后置。
- **品牌资产依赖主线程迁移**：图标/字体/provider-icons 未搬到位时，GUI 能起 host 但视觉资产
  缺失（web-ui 的 favicon/app-icon 引用可能 404），属预期，见 `docs/asset-migration.md`。
- **LLM 依赖面**：`@rin/agents` 的 AI 提案、`@rin/evolution` 的 reviewModel 走 dsh
  llm seam，需真机 `DEEPSEEK_API_KEY` 才能端到端验证（对齐 @rin/web-ui 已知限制）。

## 关联文档

- 根 `MIGRATION.md` §4.1（UI 三面共存）、§8 决策 9/10（GUI 选型 / 装配零侵入）。
- `docs/asset-migration.md` —— 品牌资产迁移清单（主线程 Copy-Item 执行）。
- `docs/verification.md` —— 真机验证清单。
- `scripts/build-sidecar.md` —— dsh runtime sidecar 打包说明。
- `@rin/web-server` README —— 8320 JSON API 契约（GUI 内嵌页面的数据源）。
- `@rin/web-ui` README —— 11 页清单。
- `@rin/cli` / `@rin/bundle` README —— 开发态 host 的装配与启动。
