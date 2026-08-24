# 真机验证清单（@rin/desktop）

> 本清单区分本地验证、CI 配置和真实跨平台执行证据。只有对应命令或 CI job
> 实际成功，才能勾选；不能用 Linux 或静态配置结果外推 Windows/macOS。

## 前置

- [x] Linux/WSL：Rust 1.98.0 stable 与 Tauri CLI 2.11.4 可用。Windows/macOS 工具链仍由对应 CI 验证。
- [x] Linux/WSL：webkit2gtk-4.1 + ayatana-appindicator3 + rsvg + patchelf 已安装；Windows/macOS 系统 WebView 仍待对应平台验证。
- [x] `pnpm install`、`@rin/web` 构建，以及 sidecar 构建脚本触发的 `@rin/host`/`@rin/cli` 编译通过。
- [ ] 品牌资产已由主线程按 `docs/asset-migration.md` Copy-Item 就位（图标/字体/provider-icons）。

## 1. Tauri 构建

- [ ] 开发构建：`cd apps/desktop && cargo tauri dev` 能起窗口、无 panic、Rust 无编译错误/警告关键项。
- [ ] 发布构建：`cargo tauri build` 成功产出安装包：
  - Windows：NSIS `.exe`；Linux：`.deb` + `.AppImage`；macOS：`.dmg`（由 `tauri.conf.json` 的 nsis/deb/appimage/dmg 目标生成）。
- [x] Linux/WSL：`pnpm --dir apps/desktop exec tauri build --bundles deb` 成功产出 `rin_0.1.0_amd64.deb`。
- [ ] 产物在 `src-tauri/target/release/bundle/{nsis,deb,appimage,dmg}/` 就位；图标（icon.ico/icns）已打进包（无缺图警告）。
- [ ] `cargo tauri build --target x86_64-pc-windows-msvc`（或对应平台 triple）交叉/本机构建通过。

## 2. WebView 连 8320

- [x] Linux/WSL：安装 `.deb` 后 GUI 自动 spawn host，`http://127.0.0.1:8320/api/status` 返回 `{"status":"ok","version":"0.1.0",...}`。
- [ ] WebView 内渲染出 web-ui 侧边栏，11 页（Repository/Environment/Knowledge/SessionSearch/
      PromptMemory/SkillMemory/Evolution/TokenOptimization/Notes/Sandboxes/Agents）均可点开、API 正常返回。
- [ ] 页面与 API 同源（无 CORS 报错）；字体/图标（app-icon.svg、provider-icons）加载正常、无 404。
- [ ] `enabled: false` 关掉 @rin/host/web-server 时，GUI 能 fail-loud 报「host 未就绪」，不白屏挂死。

## 3. 托盘回收（生命周期）

- [ ] 系统托盘出现 rin 图标；最小化/关闭窗口不杀 host（托盘常驻）。
- [ ] 托盘「退出」→ host 子进程随之退出（进程列表无残留 node/rin 进程、无孤儿）。
- [x] Linux/WSL：直接 `SIGKILL` 已安装 GUI 后，sidecar 依据 `RIN_PARENT_PID` 在等待窗口内自退，未留下孤儿进程。
- [ ] 重复启动（二次启动 GUI）不出现双 host/端口占用（单实例或 fail-loud）。

## 4. sidecar 打包（发布态）

- [x] Linux x64：`scripts/build-sidecar.mjs` 产出目标三元组命名的 native Node runner；Rust 侧通过 `app.shell().sidecar("rin-sidecar")` 解析。
- [x] Linux x64：构建脚本生成 hoisted、自包含的 `sidecar-runtime/`，包含编译后的 host/web、运行依赖和 builtin repository；安装后从 `resource_dir()` 正确定位。
- [x] sidecar 单独冒烟：target-suffixed native Node sidecar 启动 Host，`/api/status` 返回 `status: "ok"`（Linux x64，本地 WSL）。
- [x] Linux/WSL：Tauri `.deb` 已包含 sidecar、runtime 与 repository，externalBin/resource 校验通过。
- [x] Linux/WSL：通过 `apt` 安装后直接运行 `/usr/bin/rin`，运行时不调用系统 Node/pnpm，host 正常启动且 8320 可达；测试后已卸载该包。

## 5. 开发态 spawn rin

- [ ] 本机已装 @rin/cli 时，`cargo tauri dev` 走 spawn `rin` 起 host，WebView 正常连 8320。
- [ ] @rin/cli 缺失时 fail-loud（给出「请先构建 @rin/cli」错误），不静默白屏。

## 6. 资产迁移校验

- [ ] `src-tauri/icons/` 核心 7 件（icon.png/32/64/128/128@2x/icon.ico/icon.icns）就位。
- [ ] `assets/fonts/` 7 款、`assets/provider-icons/`（含 styled/rin-*.png）、`assets/icons/github.svg` 就位。
- [ ] 无旧品牌文件名残留（provider-icons 已全部为 rin-*）；wordmark 已弃用或重绘为 rin。

## 7. NSIS 安装器（Windows）

- [ ] 安装前有旧 rin 进程时，预安装 hook 正确 taskkill（`rin.exe`/`rin-sidecar.exe`）。
- [ ] 安装后开始菜单/桌面快捷方式出现（Tauri 默认或 hook 补建）。
- [ ] 定义 `RIN_ASSOCIATE_RIN_FILES` 时，`.rin` 文件关联注册成功，双击能把路径交给 GUI。
- [ ] 卸载后进程回收 + `.rin` 关联清理，无残留注册表键。

## 8. 与双 webui 共存

- [ ] GUI（8320）运行期间，`dsh --profile web`（3080）可独立启动、互不干扰。
- [ ] 关闭/退出 GUI 不影响已开的 dsh 原生 3080；反之亦然（端口 8320 vs 3080 无冲突）。

## 9. clean-machine 安装/启动 E2E

- [ ] `.github/workflows/desktop-e2e.yml` 已配置在全新 Ubuntu runner 上安装构建出的 `.deb`，但仍须真实 GitHub Actions job 成功后才能勾选。
- [ ] E2E 等待 `http://127.0.0.1:8320/api/status` 返回 `status: "ok"`，并在 GUI 退出后确认没有残留 `rin-sidecar`。
- [ ] Windows NSIS、macOS DMG 仍需各自 clean-machine runner 验证；Linux workflow 的通过不能外推到其他平台。

## 10. updater 产物与密钥边界

- [ ] 发布构建使用 `src-tauri/tauri.release.conf.json`，并在命令行环境提供 `TAURI_SIGNING_PRIVATE_KEY`（可选密码变量）；禁止把私钥或伪造公钥提交到仓库。
- [ ] 发布 job 将仓库变量 `TAURI_UPDATER_PUBLIC_KEY` 临时注入生成的 config，再执行 `createUpdaterArtifacts: true`；普通本地构建不生成签名更新包。
- [ ] Linux AppImage、Windows NSIS、macOS `.app.tar.gz` 与各自 `.sig`/`latest.json` 在真实 release job 上传后，用已安装版本检查更新；仅生成 installer 或 workflow artifact 不等于 updater 已发布。

## 结果记录

| 条目 | 平台 | 结果 | 备注 |
|---|---|---|---|
| Tauri 构建 | Linux x64 / WSL | 通过 | `cargo check` 与 release `.deb` |
| WebView 连 8320 | Linux x64 / Xvfb | 通过 | apt 安装后 `/api/status` 为 `ok` |
| 托盘回收 | Linux x64 / Xvfb | 部分通过 | 崩溃看门狗通过；交互式托盘动作未测 |
| sidecar 打包 | Linux x64 / WSL | 通过 | 自包含 hoisted runtime + builtin repository |
| NSIS 安装器 | | | |
| clean-machine E2E | Ubuntu workflow | 已配置，未执行 | 需真实 GitHub Actions 证据 |
| updater 签名/安装 | | | |
