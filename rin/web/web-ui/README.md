# @rin/web-ui

rin 的独立 React SPA，渲染 @rin/web-server 的 JSON API。这是「完整 Web UI」的前端主体。

## 技术栈

Vite + React 18 + React Router 6 + TypeScript（jsx: react-jsx）。

## 页面

11 个页面（App.tsx 左侧 sidebar 导航 + Routes）：

- Repository → /api/repository
- Environment → /api/environment/plan
- Knowledge → /api/knowledge/*
- SessionSearch → /api/sessions/*
- PromptMemory → /api/prompt-memory/*
- SkillMemory → /api/skill-memory/overview
- Evolution → /api/evolution/overview
- TokenOptimization → 三控件（响应风格开关 / Prompt 清理开关 → /api/token-optimization/set；智能裁剪级别滑块 + enabled 开关 → /api/smart-pruning/set）。即时提交、乐观更新、失败回滚，无轮询无图表。
- Notes → /api/notes/*（列表/搜索/编辑保存/新建/删除/会话备份/图谱/待办）
- Sandboxes → /api/sandboxes（profile CRUD + probe + execute，显示 InstallRun 状态与分阶段日志）
- Agents → /api/agents（列表/新建/编辑/删除/投影/AI 提案草案填充）

## 与 @rin/gui 的统一 UI

本包是 rin 唯一的 UI 实现。@rin/gui 不重写前端，开发态 WebView 直连 8320，发布态把本包 `dist/` 打进桌面壳；`@rin/web-server` 的 `staticRoot` 也指向本包 `dist/`，因此浏览器 Web 与桌面 GUI 永远是同一套界面。

## 开发 / 构建（真机）

```sh
pnpm install                 # 联网拉取 react/react-router-dom/vite 等（沙箱内不可行）
pnpm run rin:build           # 等价于 pnpm --filter @rin/web-ui run build，产出 dist/
pnpm --filter @rin/web-ui run dev   # vite dev，port 5173，/api 代理到 http://127.0.0.1:8320
pnpm run rin                 # 启动 host：http://127.0.0.1:8320 伺服 dist/（@rin/bundle staticRoot）
```

## Known Limitations and Deferred Work

- 沙箱无法构建本包：vite build 被 spawn 拦截，且 react 等外部依赖需要联网 `pnpm install`。真机 `pnpm --filter @rin/web-ui run build` 验证。
- `src/types.ts` 手抄了 server 的领域类型（AgentRecord / SandboxProfile / NoteMeta / InstallRun 等）：**server 领域类型变了必须同步这里**，否则页面字段名漂移。
- Sandboxes 的 aiConfigure、AgentWorkspace 的 AI 提案默认 LLM 适配器需要真机（dsh llm seam / sandbox provider）验证；MVP 未接入 aiConfigure。
- 智能裁剪滑块为 0–3 档，映射到三个真实级别（conservative / balanced / aggressive），第 3 档饱和到 aggressive。
- 后端契约见 @rin/web-server 的 README 与 PHASE4-STANDALONE.md。
