# Desktop sidecar 构建说明（@rin/desktop 发布态 Host）

本文描述已经落地的 `build-sidecar.mjs` 流程。平台验证状态见
`docs/verification.md`，签名与 updater 边界见 `docs/release.md`。

## 运行形态

| 形态 | Host 启动方式 | 目标机要求 |
|---|---|---|
| 开发态 | Rust spawn `rin web --port 8320 --host 127.0.0.1` | 已构建的 workspace 与 Node/pnpm |
| 发布态 | Rust spawn Tauri externalBin `rin-sidecar` | 无需另装 Node/pnpm |

发布态由两部分组成：目标平台的原生 Node 可执行文件，以及安装包内的
`sidecar-runtime/`。后者包含编译后的 Host、Cordis 配置、依赖、Web 静态文件和
builtin repository。

Rust 注入 `RIN_PARENT_PID`；生成的 `entry.mjs` 每秒检查父进程，并在 GUI
消失时关闭 Host。Linux 已安装 GUI 的强制终止场景已验证该行为。

## 目标文件

| 平台 | 文件名 |
|---|---|
| Windows x64 | `src-tauri/binaries/rin-sidecar-x86_64-pc-windows-msvc.exe` |
| macOS x64 | `src-tauri/binaries/rin-sidecar-x86_64-apple-darwin` |
| macOS arm64 | `src-tauri/binaries/rin-sidecar-aarch64-apple-darwin` |
| Linux x64 | `src-tauri/binaries/rin-sidecar-x86_64-unknown-linux-gnu` |
| Linux arm64 | `src-tauri/binaries/rin-sidecar-aarch64-unknown-linux-gnu` |

Tauri 配置使用逻辑名 `binaries/rin-sidecar`。构建期由 Tauri 按目标三元组查找
上表文件；运行期 Rust 通过 `app.shell().sidecar("rin-sidecar")` 解析安装后的路径。

## 构建流程

1. `tsc -b packages/runtime/host/tsconfig.json` 编译 Host 及其 project references。
2. `pnpm --config.node-linker=hoisted --filter @rin/host deploy --prod` 物化不依赖
   workspace 符号链接的运行树。
3. 复制 builtin repository 与 `apps/web/dist`，生成带信号处理和父 PID 看门狗的
   `entry.mjs`。
4. 将当前平台的原生 Node 可执行文件复制为 Tauri 目标三元组名称。
5. 执行 `--help` 与真实 Host `/api/status` 冒烟；任一失败都会使构建失败。

Linux x64 示例：

```sh
pnpm exec node apps/desktop/scripts/build-sidecar.mjs \
  --target x86_64-unknown-linux-gnu
```

脚本拒绝用非原生 runner 生成其他平台的产物。Windows 与 macOS 产物必须在对应
平台和架构的 runner 上构建。

## 打包与验证

先生成 sidecar 和 `sidecar-runtime/`，再运行 Tauri：

```sh
pnpm --dir apps/desktop exec tauri build --bundles deb,appimage
```

构建脚本用临时 `RIN_HOME` 启动 sidecar，轮询随机本地端口的 `/api/status`，
要求返回 `status: "ok"`，随后终止进程并清理临时目录。

- Linux x64 已完成 sidecar 构建、runtime 冒烟、Tauri `.deb` 打包、apt 安装，
  以及无系统 Node/pnpm 环境下的健康检查。
- Windows/macOS 的安装器、代码签名、公证与 updater 仍须对应 CI runner 实际执行，
  不能由 Linux 结果外推。
