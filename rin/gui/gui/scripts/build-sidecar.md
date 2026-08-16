# dsh runtime sidecar 打包说明（@rin/gui 发布态 host）

> 本文是**说明/占位文档**：描述发布态 host 的打包路径与 Tauri 对接方式，**不实际执行打包**。
> 真机打包与验证清单见 `docs/verification.md`。

## 目的

@rin/gui 的 host 有两种形态（MIGRATION.md §8 决策 9）：

| 形态 | 起 host 方式 | 目标机要求 | 适用 |
|---|---|---|---|
| 开发态 | Rust 侧 spawn `rin`（@rin/cli bin → @rin/bundle → 8320），argv `web --port 8320 --host 127.0.0.1` | 本机有 Node + pnpm + 已构建的 @rin 全家 | `cargo tauri dev` |
| 发布态 | Rust 侧 spawn sidecar `rin-sidecar[.exe]`，argv `serve --port 8320 --host 127.0.0.1` | **无需 Node/pnpm** | `cargo tauri build` 产物 |

发布态的 sidecar 是一个**单文件 node 可执行程序**，把「dsh runtime + @rin/bundle 装配 +
@rin/web-server」整体编译进去，随安装包分发到目标机，由 GUI 直接 spawn。

> **sidecar 名 = `rin-sidecar`**（不加平台 triple 后缀）。这是 `src-tauri/src/main.rs`
> 的 `host_sidecar_name()` 与 spawn argv 的权威约定：Windows 上文件名为 `rin-sidecar.exe`，
> macOS/Linux 为 `rin-sidecar`，spawn 时 argv 固定 `serve --port 8320 --host 127.0.0.1`。

## 参照先例

### 1. dsh 官方：python/sdk-runtime 的 dsh-jsonrpc-agent-pkg

dsh 上游的 Python SDK 运行时已有一条成熟的「单文件 runtime」流水线：

- 产物名：`dsh-jsonrpc-agent-pkg-<platform>-<arch>`（linux/macos × x64/arm64），目标机免装 Node。
- 构建脚本：`scripts/build-exe-for-python-sdk.ts`（仓库根）。
- 部署根：`python/sdk-runtime/package.json` 是一份**零代码纯依赖 manifest**，其依赖闭包
  既是编译进 exe 的插件集，也是物化出的 node 部署树——往分发物加插件 = 加一行依赖再重建。
- macOS 额外随附 `-spawn-helper` 伴随文件（node-pty 需要）。

rin 的 sidecar 复用同一思路：**一份依赖 manifest（@rin/bundle + dsh-base + @rin 全家）→
单文件 exe → 放进 src-tauri/binaries/ → 随 bundle 分发**。差异只是入口从 JSON-RPC stdio server
换成「起 @rin/web-server 的 host」——即复用 `@rin/cli` 的 boot 逻辑。

### 2. 旧项目：sidecars/legacy-desktop-sidecar.ts（模式参考，重写不搬）

旧桌面的 sidecar 是「合并模式」单二进制：第一个 positional 参数选 mode，并有**父进程看门狗**
（父 pid 消失即自退，防孤儿）。rin 沿用两个思想：

- **单入口**：`rin-sidecar serve --port 8320 --host 127.0.0.1` 即够（旧项目多 mode 暂不需要）。
- **父进程看门狗**：sidecar 读 `RIN_PARENT_PID`（main.rs 已注入），轮询确认父进程存活，
  父进程（GUI）崩溃/退出时 sidecar 自退，不留孤儿——对齐 MIGRATION.md §4.1「退出回收子进程」。

## 产物命名与放置

| 平台 | sidecar 文件名 | 放置 |
|---|---|---|
| Windows | rin-sidecar.exe | `src-tauri/binaries/rin-sidecar.exe` |
| macOS / Linux | rin-sidecar | `src-tauri/binaries/rin-sidecar` |

main.rs 的 `resolve_host_sidecar()` 查找顺序：先「可执行文件同目录」、再「resource 目录」。
因此 sidecar 最终要落到**应用 exe 同目录**（Windows/macOS）或 resource 目录（Linux 打包布局）。

## 发布态打包路径（占位流程）

1. **构建单文件 sidecar**：复用 dsh 的 single-exe 构建（参考 `scripts/build-exe-for-python-sdk.ts`），
   入口指向 `@rin/cli` 的 boot（装配 @rin/bundle、起 @rin/web-server 于 8320，对应 `serve` 子命令）。
   （本仓库当前**尚未落地** rin 版构建脚本，落地位置建议 `scripts/build-sidecar.ts`，与旧项目
   `desktop/scripts/build-sidecars.ts` 对称。）
2. **产出到 binaries/**：把 `rin-sidecar[.exe]` 放进 `src-tauri/binaries/`。
3. **随 bundle 分发**：让 sidecar 落到 main.rs 能定位的位置（见下「externalBin 对接与收口」）。
4. **健康检查 + 看门狗**：main.rs spawn 后（当前为同步 spawn_blocking，未内置 health 轮询——真机补
   `/api/health` 就绪探测，见 verification.md）；退出时 drop stdin + kill + wait 回收；sidecar
   侧读 `RIN_PARENT_PID` 自退。
5. **`cargo tauri build`**：把 sidecar 复制进 bundle 的资源区，目标机免装 Node。

## externalBin 对接（已一致，无需二选一）

`src-tauri/tauri.conf.json` 写 `"externalBin": ["binaries/rin-sidecar"]`，main.rs 以
`rin-sidecar[.exe]`（无 triple）名 spawn，两者一致——这是标准 Tauri sidecar 模式：

- 构建期：Tauri 按 `$TAURI_ENV_TARGET_TRIPLE` 找源文件 `binaries/rin-sidecar-<triple>[.exe]`
  （如 Windows x64 为 `rin-sidecar-x86_64-pc-windows-msvc.exe`），打包进 bundle。
- 运行期：打包后的 sidecar 落到**可执行文件同目录**（Windows/macOS）或 resource 目录（Linux），
  且重命名为无 triple 的 `rin-sidecar[.exe]`。
- main.rs 的 `resolve_host_sidecar()`（exe 同目录 → resource 目录，找无 triple 名）恰好匹配
  打包后的落位，无需 `app.shell().sidecar()` 解析。

因此只需：真机产出 `binaries/rin-sidecar-<triple>[.exe]` 后 `cargo tauri build`。

## capabilities 说明

host 主路径走 main.rs 的 `std::process::Command`（见 Cargo.toml 注释），**不需要** shell 权限。
`src-tauri/capabilities/default.json` 已整包放行 `shell:allow-execute/spawn/kill` 与
`process:allow-exit/restart`，留给前端驱动的 spawn 面 / 未来 sidecar 管理；无需为 host 主路径
单独开 sidecar 白名单。

## 健康检查 smoke（借鉴旧项目 smoke-test-sidecar.ts）

发布前对 sidecar 单独冒烟：起 `rin-sidecar serve --port <port>`，轮询 `/api/health` 返回
`{"ok":true,"name":"rin-web",...}`，超时/退出码非 0 即失败。旧项目脚本用 Bun.spawn + 临时 HOME +
保留端口 + 30s 超时；rin 版可同构，Node 侧用 `node:child_process` + `node:net` 保留端口即可。

## 平台注意

- **Windows**：sidecar 用 baseline x64 运行时（旧项目对 Windows x64 用 bun-windows-x64-baseline，
  避免老 CPU 报 Illegal instruction）；node 单文件产物同理注意目标 CPU 基线。
- **macOS**：若 node-pty 参与（rin host 目前不需要），需随附 `-spawn-helper`；签名/公证另走。
- **Linux**：gnu 与 musl 三选一（默认 gnu）；AppImage/deb/rpm 依赖 webkit2gtk-4.1 等系统库（见 README）。

## 不实际打包（本沙箱限制）

- 本沙箱无 Rust 工具链、spawn 被 EPERM 拦截、网络受限，**未执行**任何 single-exe 构建 / tauri 打包。
- 第 1 步的 rin 版构建脚本（`scripts/build-sidecar.ts`）与 `@rin/cli` 的 boot 复用、
  externalBin 的 A/B 收口，均由主线程/子任务 1 落地；本文只固化 sidecar 名（`rin-sidecar`）、
  argv（`serve ...`）、看门狗契约与对接方式。
