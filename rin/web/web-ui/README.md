# @rin/web-ui

rin 的独立 React SPA，渲染 @rin/web-server 的 JSON API。这是「完整 Web UI」的前端主体。

## 技术栈

Vite + React 18 + React Router 6 + TypeScript（jsx: react-jsx）。

## 页面

8 个页面（App.tsx 左侧 sidebar 导航 + Routes）：

- Repository → /api/repository
- Environment → /api/environment/plan
- Knowledge → /api/knowledge/*
- SessionSearch → /api/sessions/*
- PromptMemory → /api/prompt-memory/*
- SkillMemory → /api/skill-memory/overview
- Evolution → /api/evolution/overview
- TokenOptimization → /api/smart-pruning/status

## 开发 / 构建（真机）

```sh
pnpm install                        # 联网拉取 react/react-router-dom/vite 等（沙箱内不可行）
pnpm --filter @rin/web-ui run dev   # vite dev，port 5173，/api 代理到 http://127.0.0.1:8320
pnpm --filter @rin/web-ui run build # 产出 dist/，交给 @rin/web-server 伺服（staticRoot 指到 dist/）
```

## 约束

- 沙箱无法构建本包：vite build 被 spawn 拦截，且 react 等外部依赖需要联网 `pnpm install`。
- 源码用 `tsc -p tsconfig.json` 单独检查（装依赖后 exit 0）；不并入 rin 的 host 聚合门禁。
- 后端契约见 @rin/web-server 的 README 与 PHASE4-STANDALONE.md。
