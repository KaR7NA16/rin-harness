# @rin/web-ui

rin 的独立 React SPA，渲染 @rin/web-server 的 JSON API。这是「完整 Web UI」的前端主体。

## 技术栈

Vite + React 18 + React Router 6 + TypeScript（jsx: react-jsx）。

## 页面

18 个页面（`src/pages/*.tsx` 17 个 + `src/features/scheduledTasks/ScheduledTasks.tsx` 1 个）：

- ActiveSession → 活动会话（聊天主体）
- EmptySession → 空会话（新会话选择器）
- KnowledgeSpace → 知识空间
- Notes → 笔记
- Sandboxes → 沙箱
- Monitor → 监控
- RepositoryWorkspace → 仓库工作区
- AgentWorkspace → Agent 工作区
- Settings → 设置中枢（overview + 各设置子页入口）
- AdapterSettings → 适配器设置
- AgentMigration → Agent 迁移
- ComputerUseSettings → 计算机使用设置
- ExecutionBehaviorSettings → 执行行为设置
- McpSettings → MCP 设置
- SessionBackup → 会话备份
- TokenOptimization → 三控件（响应风格开关 / Prompt 清理开关 / 智能裁剪级别滑块 + enabled 开关）。即时提交、乐观更新、失败回滚，无轮询无图表。
- Terminal → 交互式终端（xterm.js + WS `/ws/terminal/<terminalId>`，见下方 Known Limitations 的 resize 说明）。
- ScheduledTasks → 定时任务（`src/features/scheduledTasks/`）

## 与 @rin/gui 的统一 UI

本包是 rin 唯一的 UI 实现。@rin/gui 不重写前端，开发态 WebView 直连 8320，发布态把本包 `dist/` 打进桌面壳；`@rin/web-server` 的 `staticRoot` 也指向本包 `dist/`，因此浏览器 Web 与桌面 GUI 永远是同一套界面。

## 开发 / 构建（真机）

```sh
pnpm install                 # 联网拉取 react/react-router-dom/vite 等（沙箱内不可行）
pnpm run rin:build           # 等价于 pnpm --filter @rin/web-ui run build，产出 dist/
pnpm --filter @rin/web-ui run dev   # vite dev，port 5173，/api 代理到 http://127.0.0.1:8320
pnpm run rin                 # 启动 host：http://127.0.0.1:8320 伺服 dist/（@rin/bundle staticRoot）
```

## 加载策略

Settings、workspace 页面、Terminal、Mermaid、Shiki 代码高亮与 DiffViewer 均按需懒加载（Suspense 边界见 `src/components/chat/lazyRenderers.tsx`、`ContentRouter.tsx` 与 `SettingsPanel.tsx`），避免把重型依赖打进首屏主包。

## Known Limitations and Deferred Work

- `motion-dom` / `motion-utils` 虽无源码直接 import，但 `preserveSymlinks` 下 TypeScript 需要它们作为直接依赖才能解析 `framer-motion` 的类型；不要仅凭 import 扫描删除。
- 沙箱无法构建本包：vite build 被 spawn 拦截，且 react 等外部依赖需要联网 `pnpm install`。真机 `pnpm --filter @rin/web-ui run build` 验证。
- `src/types.ts` 手抄了 server 的领域类型（AgentRecord / SandboxProfile / NoteMeta / InstallRun 等）：**server 领域类型变了必须同步这里**，否则页面字段名漂移。
- Sandboxes 的 aiConfigure、AgentWorkspace 的 AI 提案默认 LLM 适配器需要真机（dsh llm seam / sandbox provider）验证；MVP 未接入 aiConfigure。
- terminal tab 已接入交互式终端（`src/pages/Terminal.tsx`，WS 协议见 @rin/web-server）。已知限制：subprocess 终端句柄无 resize 方法（见 packages/subprocess/subprocess/src/types.ts），PTY 固定为 spawn 时的尺寸（80×24 或 fit 后首报值），窗口缩放只重新 fit 本地 xterm 渲染，不向服务端发 resize。`@xterm/xterm` / `@xterm/addon-fit` 已声明在 package.json；沙箱无法 `pnpm install`，需真机安装后才能构建/运行（测试通过 seam 注入 xterm 假实现，见 `src/pages/terminalDeps.ts`）。
- 智能裁剪滑块为 0–3 档，映射到三个真实级别（conservative / balanced / aggressive），第 3 档饱和到 aggressive。
- 后端契约见 @rin/web-server 的 README 与 PHASE4-STANDALONE.md。
