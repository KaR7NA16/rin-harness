# rin-harness

[English](README.md) | 中文

> **rin-harness**（`rin`）是基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`，[DeepSeek AI](https://deepseek.com) 的开源 agent harness）底座迁移开发的 harness。
>
> 本项目保留 DeepSeek Harness 的 MIT 许可与第三方声明（见 [LICENSE](LICENSE) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)）。“rin”这个名字，是作者的一个智能体在使用 DeepSeek API 时给自己起的名字。

它采用**一切皆插件**的架构，并由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。

## 开发者预览

rin-harness 继承了 DeepSeek Harness 的 _开发者预览_ 状态，正在快速迭代。**未来将出现破坏兼容性的变更。**

## 功能

rin 在 `dsh` 底座之上叠加了一组 `@rin/*` 包：

- **资产仓库与环境**（`@rin/repository`、`@rin/environment`、`@rin/agents`、`@rin/sandboxes`）——读取资产仓库、投影 agent，并把环境安装计划落到可运行的 sandbox profile。
- **文件系统与会话备份**（`@rin/filesystem`、`@rin/session-backup`）——路径收容的目录浏览，以及 gzip 会话导出/导入。
- **记忆**——四个包：`@rin/knowledge`、`@rin/prompt-memory`、`@rin/skill-memory` 与 `@rin/session-search`。
- **笔记**（`@rin/notes`）——Obsidian 风格笔记，含会话备份。
- **优化与代码图谱**（`@rin/token-optimization`、`@rin/smart-pruning`、`@rin/codegraph`）——token/输出优化控件，以及 SQLite 代码图谱可视化。
- **进化**（`@rin/evolution`）——自我进化的状态与配置。
- **诊断**（`@rin/monitor`、`@rin/doctor`）——Linux 主机指标快照与诚实的 host 自诊断。
- **自动化与协作**（`@rin/tasks`、`@rin/mcp`、`@rin/mcp-client`、`@rin/provider-probe`、`@rin/computer-use`、`@rin/agent-migration`、`@rin/teams`）——任务、MCP 配置与模型侧 MCP 桥接、provider 探测、桌面 computer-use 策略、agent 迁移与团队。
- **LLM 能力**（`@rin/brief`、`@rin/review`）——LLM 生成的会话摘要与工件审查。
- **Web**（`@rin/web-server`、`@rin/web-ui`）——在独立端口（默认 `8320`）上运行的 Web UI，含基于 `/ws/terminal/<id>` 的浏览器终端。
- **桌面壳**（`@rin/gui`）——内嵌同一套 Web UI 的 Tauri 壳。

## 运行

### 从源码运行

rin 的 `dsh` 底座以 `@deepseek-ai/*` 依赖形式从**公共 npm registry** 安装——**无需单独检出 DeepSeek Harness**。clone 本仓库后执行 `pnpm install` 即自动拉齐整个 `dsh` 底座（精确钉在 `0.1.0-rc.8`）：

```sh
pnpm install
pnpm run rin
```

`rin` host 默认在 `http://127.0.0.1:8320` 伺服 Web UI（**rin 自启**：由 `@rin/cli` 启动）。

rin 也可以**托管在 dsh CLI 内运行**：创建一个 `dsh.profile.bundles` 列出 `@rin/bundle`（其声明了 `dsh.bundle.patch`）的 dsh profile，然后 `dsh --profile <name>` 会在 dsh 自己的启动器上装配同一套装配。

### 发行形态

rin 以三种形态发布，均于[发布页](https://github.com/your-name/rin-harness/releases)公布：

- **npm 包**——`@rin/*` 各包，含 `@rin/cli` 可执行文件。
- **Windows 可执行文件**——由 `@rin/gui` 构建的 Tauri 安装程序（`nsis`）。
- **Linux deb**——由 `@rin/gui` 构建的 Tauri `deb` 包。

<!-- TODO：发布前将 https://github.com/your-name/rin-harness 替换为真实仓库地址。 -->

## 社区与支持

- 欢迎通过 [GitHub Discussions](https://github.com/your-name/rin-harness/discussions) 提交反馈或 bug 报告。
- 通过 [GitHub Issues](https://github.com/your-name/rin-harness/issues) 跟踪并提交 issue。

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 开发

请先阅读[开发指南](docs/development.md)与[架构文档](docs/architecture.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
