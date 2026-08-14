# PHASE4-STANDALONE — 独立端口 Web UI

> 决策：**不动 dsh 原生 Web UI**，用独立端口跑 @rin 自己的 Web UI。
> 该决策取代 PHASE4-CLIENT.md 的 SlotMap 集成技术路线（后者仅保留「功能映射表」作功能清单参考）。

## 1. 为什么转向

PHASE4-CLIENT.md 的 SlotMap 集成方案有三个真机前置缺口：

1. 自建 `rin.workspace.*` 槽位要并入 `gen-client-catalog` 生成器。
2. @rin host 服务缺 typert 生成的 Remote API 半（client 取数前置依赖）。
3. client 插件要 tsdown bundle + `test:gui` 验证（沙箱 spawn EPERM 不可行）。

独立端口方案用 `node:http` 直连 host 服务，把这三条全部绕开：

- 不碰 dsh 的 client/ui-*/SlotMap/AppWebEntry，零侵入。
- 不经 typert Remote API，HTTP 直接序列化 host 服务的读接口返回值。
- 前端纯静态（vanilla HTML/JS/CSS），无构建步骤，沙箱可验证。

## 2. 架构

```
@rin host 插件（repository/environment/...） —— 已在 ctx 上暴露读接口
        │  ctx.get('repository') 等（可选读取，未挂载返回 undefined）
        ▼
@rin/web-server（host 插件，node:http，独立端口，默认 8320）
  ├─ /api/*   JSON 接口（把 host 服务读接口序列化为 JSON）
  └─ /        静态伺服 web/（前端单页）
        ▲  fetch /api/*
        │
浏览器打开 http://127.0.0.1:8320 —— 独立于 dsh 原生 Web UI（3080）
```

## 3. API 契约（v1，权威）

Base: `http://<host>:<port>`（默认 `http://127.0.0.1:8320`）。
所有响应 `application/json`；错误返回 4xx/5xx，body 为 `{"error":"<message>"}`。

| 端点 | 说明 |
|---|---|
| `GET /api/health` | `{"ok":true,"name":"rin-web","version":"0.1.0","services":{...}}`，services.* 表示各 @rin 服务是否挂载 |
| `GET /api/repository?root=<abs>` | 返回完整 AssetRepository JSON；root 可省略（用 Config.repositoryRoot） |
| `GET /api/environment/plan?profile=<id>&root=&platform=&apt=&python=&pip=&r=&npm=&tlmgr=` | 返回 ResolvedEnvironmentPlan JSON；platform 默认 process.platform，runtime 布尔默认 false |
| `GET /api/smart-pruning/status` | `{"mounted":true,"enabled":<bool>,"level":<str>,"mode":<str>}` 或 `{"mounted":false}` |

静态：`GET /` 伺服 `web/index.html`；`GET /<path>` 伺服 `web/` 下文件（path 穿越防护）；否则 404。

## 4. MVP 范围与后续里程碑

**MVP（本迭代）**：`/api/health` + `/api/repository` + `/api/environment/plan` + `/api/smart-pruning/status` + 静态前端四面板（health / repository / environment / smart-pruning）。

**后续里程碑**（把其余 host 服务读接口加进 `/api/*`，均为只读展示）：

- `knowledge`：`ctx.knowledge.open(dbPath)` 的列表/搜索。
- `session-search`：`ctx.sessionSearch.browse/discover/read/scroll`。
- `prompt-memory`：`ctx.promptMemory.readFile/getStatus/getConfig/readReviewLogs`。
- `evolution`：`ctx.evolution.readConfig/readState/getCandidate`。
- `skill-memory`：`ctx['skill-memory'].createStore`。

## 5. 与 PHASE4-CLIENT.md 的关系

PHASE4-CLIENT.md 的「功能适配映射表」（设计参考页面 → host 数据源）仍有效，作为这个独立前端要覆盖哪些面板的功能清单；但其 SlotMap/typert/tsdown 集成技术路线作废。
