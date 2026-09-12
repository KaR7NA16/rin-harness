# 参与 Rin 贡献

[English](CONTRIBUTING.md) | 中文

感谢你关注 Rin。Rin 是一个面向本地优先、可审计 AI 陪伴系统的开发者预览运行时。项目仍在快速演进，因此最有价值的贡献通常是范围小、证据清楚、容易审阅的改动。

## 修改代码前

1. 阅读[文档索引](docs/README.md)、[当前架构](docs/architecture/CURRENT.md)和[活动路线](docs/roadmap/ACTIVE.md)。
2. 在新增 import 或移动模块前，确认 package 所属边界和依赖方向。
3. 一方代码只放在 apps/ 或 packages/ 下的角色目录，不要重新创建已移除的 rin/ 过渡外壳。
4. 保持“已实现行为、计划工作、未验证声明”之间的区分。
5. 当修改影响仓库契约时，只更新最小必要的文档、manifest、reference、测试或 gate。

## 本地门禁

使用根 package manifest 中钉定的 Node.js 和 pnpm 版本：

~~~sh
pnpm install
pnpm run check
pnpm run smoke
~~~

聚焦开发时，先运行最窄的相关 package 或测试命令，再在请求审阅前运行 pnpm run check。涉及桌面打包、路径、manifest、生成引用、Cordis 组合或 CI 的改动，需要补充相应证据。

## 适合贡献的方向

- runtime 组合、contracts、生命周期和 provider 边界；
- memory 溯源、检索、备份、删除和导出；
- Web 和桌面可访问性、面向用户的控制；
- relationship、同意和 companion-safety 域；
- 评测 fixture、红队场景和可复现测试数据；
- 文档、架构决策和贡献者 onboarding；
- provider、MCP 和互操作适配器。

关系和安全相关内容尤其敏感。没有对应的实现和评测记录，不要声称系统具备情感、临床、危机处理或生产级行为。

## Pull Request

Pull Request 应说明：

- 改了什么以及为什么改；
- 影响哪些 package、路径、manifest、reference 或 gate；
- 如何测试；
- 哪些内容仍未验证或明确不在范围内。

不要把结构迁移和无关功能混在一个变更中。移动文件时保留来源信息，不要提交凭据、用户数据、生成的 secret 或本机路径。

## Issue 与安全问题

Bug 报告和功能请求请使用 [Issue 模板入口](https://github.com/KaR7NA16/rin-harness/issues/new/choose)，支持中文和英文。PR 模板沿用上面的范围与验证要求。安全报告或隐私敏感材料请遵循 [SECURITY.md](SECURITY.md)，不要直接把细节公开在 issue 中。社区行为问题的反馈方式见 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

Rin 依赖 @deepseek-ai/* scope 下的外部运行时包。未经记录许可和来源影响，不要把这些依赖的源码复制或 vendor 到本仓库。
