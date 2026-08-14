# 真机验证清单（@rin/gui）

> 本沙箱（Rust 工具链缺失 + spawn EPERM + 网络受限）无法执行以下任何一项。所有条目均为
> **真机（Windows/macOS/Linux 桌面 + Rust + 联网）**验收点，由主线程/子任务 1 落地后逐项打勾。

## 前置

- [ ] Rust stable 工具链 + `cargo install tauri-cli --version "^2" --locked`。
- [ ] 系统 WebView：Windows=WebView2 / macOS=WKWebView / Linux=webkit2gtk-4.1 + ayatana-appindicator3 + rsvg + patchelf。
- [ ] `pnpm install` + `pnpm --filter @rin/web-ui run build` + `@rin/bundle`/`@rin/cli` 构建。
- [ ] 品牌资产已由主线程按 `docs/asset-migration.md` Copy-Item 就位（图标/字体/provider-icons）。

## 1. Tauri 构建

- [ ] 开发构建：`cd rin/gui/gui && cargo tauri dev` 能起窗口、无 panic、Rust 无编译错误/警告关键项。
- [ ] 发布构建：`cargo tauri build` 成功产出安装包：
  - Windows：`.msi/.exe (NSIS)`；macOS：`.dmg/.app`；Linux：`.deb/.rpm/.AppImage`。
- [ ] 产物在 `src-tauri/target/release/bundle/` 就位；图标（icon.ico/icns）已打进包（无缺图警告）。
- [ ] `cargo tauri build --target x86_64-pc-windows-msvc`（或对应平台 triple）交叉/本机构建通过。

## 2. WebView 连 8320

- [ ] GUI 启动后自动 spawn host，`http://127.0.0.1:8320/api/health` 返回 `{"ok":true,"name":"rin-web",...}`。
- [ ] WebView 内渲染出 web-ui 侧边栏，11 页（Repository/Environment/Knowledge/SessionSearch/
      PromptMemory/SkillMemory/Evolution/TokenOptimization/Notes/Sandboxes/Agents）均可点开、API 正常返回。
- [ ] 页面与 API 同源（无 CORS 报错）；字体/图标（app-icon.svg、provider-icons）加载正常、无 404。
- [ ] `enabled: false` 关掉 @rin/web-server 时，GUI 能 fail-loud 报「host 未就绪」，不白屏挂死。

## 3. 托盘回收（生命周期）

- [ ] 系统托盘出现 rin 图标；最小化/关闭窗口不杀 host（托盘常驻）。
- [ ] 托盘「退出」→ host 子进程随之退出（进程列表无残留 node/rin 进程、无孤儿）。
- [ ] 直接 kill GUI 进程（模拟崩溃）→ sidecar 读 `RIN_PARENT_PID` 自退，不留孤儿（看门狗生效）。
- [ ] 重复启动（二次启动 GUI）不出现双 host/端口占用（单实例或 fail-loud）。

## 4. sidecar 打包（发布态）

- [ ] `scripts/build-sidecar.ts`（或等价单文件构建）产出 `rin-sidecar[.exe]` 并放入 `src-tauri/binaries/`（名对齐 main.rs）。
- [ ] sidecar 单独冒烟：起 `rin-sidecar serve --port <port>`，`/api/health` ok（借鉴旧项目 smoke-test-sidecar.ts）。
- [ ] `cargo tauri build` 把 sidecar 打进 bundle（externalBin 校验通过，无缺 sidecar 报错）。
- [ ] 目标机**免装 Node/pnpm** 下安装并启动，host 正常起、8320 可达。

## 5. 开发态 spawn rin

- [ ] 本机已装 @rin/cli 时，`cargo tauri dev` 走 spawn `rin` 起 host，WebView 正常连 8320。
- [ ] @rin/cli 缺失时 fail-loud（给出「请先构建 @rin/cli」错误），不静默白屏。

## 6. 资产迁移校验

- [ ] `src-tauri/icons/` 核心 7 件（icon.png/32/64/128/128@2x/icon.ico/icon.icns）就位。
- [ ] `assets/fonts/` 7 款、`assets/provider-icons/`（含 styled/rin-*.png）、`assets/icons/github.svg` 就位。
- [ ] 无 `cybercode-*`/`cyberpsychosis-*` 残留文件名；wordmark 已弃用或重绘为 rin。

## 7. NSIS 安装器（Windows）

- [ ] 安装前有旧 rin 进程时，预安装 hook 正确 taskkill（`rin.exe`/`rin-sidecar.exe`）。
- [ ] 安装后开始菜单/桌面快捷方式出现（Tauri 默认或 hook 补建）。
- [ ] 定义 `RIN_ASSOCIATE_RIN_FILES` 时，`.rin` 文件关联注册成功，双击能把路径交给 GUI。
- [ ] 卸载后进程回收 + `.rin` 关联清理，无残留注册表键。

## 8. 与双 webui 共存

- [ ] GUI（8320）运行期间，`dsh --profile web`（3080）可独立启动、互不干扰。
- [ ] 关闭/退出 GUI 不影响已开的 dsh 原生 3080；反之亦然（端口 8320 vs 3080 无冲突）。

## 结果记录

| 条目 | 平台 | 结果 | 备注 |
|---|---|---|---|
| Tauri 构建 | | | |
| WebView 连 8320 | | | |
| 托盘回收 | | | |
| sidecar 打包 | | | |
| NSIS 安装器 | | | |
