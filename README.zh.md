# Rin

[![CI](https://github.com/KaR7NA16/rin-harness/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/KaR7NA16/rin-harness/actions/workflows/ci.yml)
[![Desktop E2E](https://github.com/KaR7NA16/rin-harness/actions/workflows/desktop-e2e.yml/badge.svg?branch=main)](https://github.com/KaR7NA16/rin-harness/actions/workflows/desktop-e2e.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[文档](docs/README.md) · [报告问题](https://github.com/KaR7NA16/rin-harness/issues/new/choose) · [贡献指南](CONTRIBUTING.zh.md) · [安全政策](SECURITY.md)

[English](README.md) | 中文

> **Rin** 是一个本地优先、可审计的长期 AI 陪伴运行时与开发者平台。

> **状态：开发者预览。** 当前仓库已经提供可运行的 Host、Web UI、桌面壳、记忆与溯源基础设施、Provider/MCP 集成，以及跨平台安装/启动证据。但它还不能被描述为完整的消费级人机陪伴产品：关系生命周期、陪伴安全、面向用户的关系控制、签名发布和长期用户评测仍在建设中。

## Rin 要解决什么问题

长期陪伴不只是聊天界面。系统需要让用户能够检查和撤销记忆、导出自己的数据、理解模型和 provider 边界，并且让运行时行为可以被测试和追溯。

Rin 正在作为这样的本地优先基础设施建设。当前范围是可组合的运行时和开发者预览；下一层产品边界是一个包含同意、安全、可迁移性和评测能力的可审计关系运行时。

项目会明确区分事实边界：桌面程序可以安装、测试套件可以通过，只能证明被执行的工程链路，不能证明完整的陪伴体验已经完成。

## 当前可用能力

| 领域 | 当前能力 |
| --- | --- |
| 运行时组合 | 统一 Host 组合根、Cordis 服务、provider 清单、生命周期连接、路径辅助和 Web server |
| 记忆与知识 | canonical memory、投影、检索、溯源、注入审计、knowledge 和 notes |
| 工作区与恢复 | 资产/环境投影、路径收容的文件系统访问、会话备份与恢复 |
| 集成 | provider 探测、MCP 配置与 client bridge、自动化、computer-use 策略、协作和迁移 seam |
| 应用入口 | 薄 CLI 启动器、独立 Web UI、Tauri 桌面壳 |
| 质量门禁 | metadata、仓库卫生、typecheck、lint、单元/集成测试、release verify 和 smoke |
| 分发证据 | Linux、Windows、macOS Apple Silicon、macOS Intel 的清洁机器安装/启动/health/watchdog E2E |

当前 canonical workspace 有 21 个 package manifest。应用入口位于 apps/；一方可复用代码位于 packages/ 下的角色目录。

## 目录结构概览

~~~text
apps/
  cli/       源码启动器
  web/       React Web UI
  desktop/   Tauri 壳与原生 sidecar

packages/
  runtime/       host、contracts、health、backup
  domains/       memory、knowledge、notes、workspace、assets、automation
  features/      context、authoring、evolution、migration、computer-use
  integrations/  MCP 和 provider bridge
~~~

packages/runtime/host 是组合根。过渡时期的 rin/ 外壳不属于 canonical layout。

## 从源码运行

环境要求：

- Node.js 22.19+（或 Node.js 24+）
- pnpm 11.7.0

~~~sh
pnpm install
pnpm run start
~~~

Host 默认在 http://127.0.0.1:8320 提供 Web UI。同一套 Host 组合也可以嵌入桌面壳。

完整命令入口请先阅读[文档索引](docs/README.md)，然后阅读[当前架构](docs/architecture/CURRENT.md)和[活动路线](docs/roadmap/ACTIVE.md)。

## 验证当前 checkout

~~~sh
pnpm run check
pnpm run smoke
~~~

pnpm run check 会依次运行 metadata 和 hygiene、TypeScript project checks、lint、Vitest、桌面 release verification 以及 smoke tests。

已完成的代表性运行（历史证据；当前工作流状态见顶部徽章）：

- [CI #14](https://github.com/KaR7NA16/rin-harness/actions/runs/34695690356)：质量工作流通过。
- [Desktop clean-machine E2E #10](https://github.com/KaR7NA16/rin-harness/actions/runs/34222705204)：Linux、Windows、macOS Apple Silicon 和 macOS Intel 的安装/启动路径通过。

这些运行只证明已经执行的链路；它们尚未证明签名/公证分发、真实 updater 回滚、每一种 provider/container 生命周期，或完整的陪伴产品已经完成。

## 产品边界与路线

下一层产品能力记录在[活动路线](docs/roadmap/ACTIVE.md)中，计划包括：

- 关系事件、同意、边界、暂停/结束/重置/导出；
- 陪伴安全、AI 身份披露、年龄模式和危机路由；
- 面向用户的记忆中心、关系设置、隐私控制和“为什么记住这件事？”解释；
- 关系评测、安全评测、红队场景和封闭 alpha；
- 签名发布、更新器和回滚证据。

在这些内容分别实现并拥有独立证据之前，Rin 应被描述为开发者预览和运行时基础设施，而不是生产级人机关系服务。

## 上游运行时依赖

Rin 从 registry 中消费 @deepseek-ai/* scope 下的 dsh/Cordis 运行时包。这些包名是实现依赖，不是 Rin 的产品身份，也不要求单独检出上游仓库。

外部依赖的版权和许可条款仍然适用。依赖边界见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，Rin 一方源码的许可见 [LICENSE](LICENSE)。

## 参与贡献

提交变更前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。仓库仍处于预发布开发阶段，接口和 package 边界可能变化。变更应包含最小必要的测试或证据更新，并保持“已实现行为、计划工作、未验证声明”之间的区分。

安全问题请参阅 [SECURITY.md](SECURITY.md)。文档索引是架构决策、审计、迁移记录和活动执行路线的入口。

## 许可证

Rin 一方源码采用 [MIT License](LICENSE)。外部依赖和任何上游材料保留其自身声明，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
