# ARCHIVED — legacy 空态落地收口清单

> 本文件记录 A/B/C/D 四类落地过程中发现的、需在收口阶段处理的问题。
> 由主线程维护；接线代理（WIRE）与收口阶段逐项核销。

## 已记录问题

### 1. 仓库根临时文件（待删除）
- `tsconfig.teams-check.json`（A2 子代理遗留的临时 typecheck 配置，untracked，会误入提交）
- `rin/tasks/mcp/lib/` + `node_modules/`（A3 子代理跑 tsc/pnpm 的产物；.gitignore 已拦，收口 `git clean` 即可）

### 2. B1 语义决策点（接线时决定）
- `@rin/notes` 的 `vault.delete()` 现状：连同 `.history` 快照一起删。
- 旧项目 `notesService.remove()`：保留历史快照。
- 决策点：接 `/api/notes/snapshots` 时，是否让 `delete()` 保留快照？
  - 若「保留」：改 `vault.ts` 的 delete 逻辑 + 同步改 `vault.test.ts` 的 "delete removes snapshots" 用例。
  - 若「维持现状」：仅记录语义差异，不改。

### 3. 新包聚合注册（WIRE/收口做，子代理未碰根合并点）
- 5 个新包需注册：
  - `rin/tsconfig.json` 聚合 references
  - `tsconfig.base.json` paths（`@rin/tasks` / `@rin/teams` / `@rin/mcp` / `@rin/computer-use` / `@rin/agent-migration` → src）
  - 根 `package.json` workspace 依赖（如需）
- `pnpm-workspace.yaml` 的 `rin/*/*` 已覆盖，无需改。

### 4. legacy.ts 端点接线（WIRE 统一做）
- B2 `/api/prompt-memory/insights`（照抄旧 api/prompt-memory.ts）
- B1 `/api/notes/snapshots` + `/api/notes/snapshot`
- D 类（按 `./LEGACY-D-SPEC.md` 规格）
- A 类 5 域（`/api/tasks`、`/api/teams`、`/api/mcp`、`/api/computer-use/*`、`/api/agent-migration/*`）
- 需加 web-server/src/index.ts 的 services refs（mcp/teams/tasks/computerUse/agentMigration）

### 5. 桌面展示型 DTO 投影（接线时做）
- McpSettings 页需要 scope/enabled/statusLabel/configLocation/summary/canEdit 等展示字段——store 层只提供 name/command/args/env/transport/status，接线层投影补齐。

## 结构链路排查结论（2026-08-15）

### 已确认正确（无需改）
- `pnpm-workspace.yaml` 的 `rin/*/*` 已覆盖 5 个新包
- 新包 tsconfig references 正确：mcp/tasks 引 vendor/cordis + vendor/schemastery（因 index.ts 用 z）；agent-migration/teams 只引 vendor/cordis（纯 node: 内置）
- 新包 package.json 依赖声明正确：mcp/tasks devDep 含 schemastery；agent-migration/teams 只 cordis。**无「import 未声明」缺口**（对照 evolution 之前的问题）
- 新包无跨 @rin 依赖（零交叉引用，干净）

### 待 WIRE/收口补齐（根合并点 + 装配）
1. `rin/tsconfig.json` 聚合 references：加 5 个（automation/tasks、automation/mcp、automation/agent-migration、automation/computer-use、collaboration/teams）
2. `tsconfig.base.json` paths：加 5 个 `@rin/*` → src 映射
3. `rin/bundle/rin/src/index.ts` `RIN_HOST_PLUGINS`：加 5 个新包名
4. `rin/bundle/rin/src/cordis.yml`：加 5 个新包行（含各自 config）
5. `rin/web/web-server/src/routes.ts` `RinServiceRefs` + `src/index.ts` services refs：加 mcp/teams/tasks/computerUse/agentMigration 五个 thunk
6. `rin/web/web-server/src/routes/legacy.ts`：替换 5 组空态桩为真实服务调用

## 6. 启动阻塞 bug（SA-C 发现，WIRE-A 修复）

**现象**：`rin host` 启动崩溃——`rin sandboxes: ctx.shell is unavailable; environment installation requires the dsh shell seam`。

**根因**：`@rin/workspace/sandboxes` 的 `registerShellSeam`（`rin/workspace/sandboxes/src/seam.ts:149-152`）在 load 期立即 `shellFromContext(ctx)` 断言，非 dryRun 时 shell 缺失即 throw。但装配顺序是 [rin rows(0-12), base rows(13-89)]——提供 `ctx.shell` 的 `bash-sandbox` 在 base row 38，晚于 sandboxes（rin row 11），所以 load 期必然取不到 shell。

**修复（WIRE-A 负责）**：`registerShellSeam` 去掉 load 期立即断言，改为惰性（执行期 `resolveStageRunner` 已有 fail-loud，`shellResolverFor` 执行期懒解析）。保留 dryRun 无 shell 模式。




## 7. 服务名 vs 插件名 联动点（收口验证）

WIRE-B 接线 ctx.get(...) 必须用 super(ctx, <服务名>) 里的服务名，而非插件 name（cordis.yml 装配用包名）：

| 包 | 插件 name | super 服务名 | ctx.get 用 |
|---|---|---|---|
| @rin/tasks | tasks | tasks | 'tasks' |
| @rin/mcp | mcp | mcp | 'mcp' |
| @rin/computer-use | computer-use | computerUse | 'computerUse' |
| @rin/agent-migration | agent-migration | agentMigration | 'agentMigration' |
| @rin/teams | teams | teams | 'teams' |

两个 camelCase 服务名（computerUse / agentMigration）接线时勿误用 kebab 插件名。web-server services refs 沿用 Phase 9 先例：thunk 名用 camelCase、内部 ctx.get 用上述服务名。



## 8. WIRE-A 遗留决策点（收口处理）

1. **agent-migration homeDir 语义**：WIRE-A 按指令写了 `homeDir: !!js rinHome()`，但 scan 找的是 OS home 下的 .claude/.codex 外部 agent 根，默认值 homedir() 才是语义正确值。设 rinHome() 会让 scan 默认空结果。**收口修复：省略 cordis.yml 里 agent-migration 的 homeDir 键（走默认 homedir()）**，或显式给 homedir()。
2. **defaultConfig 未扩展**：5 个新包未加 defaultConfig（config 全在 cordis.yml，defaultConfig 仍 8 键）。可接受（bundle 的 cordis.yml 已带 config）；如需一致性再补。
3. **cordis.yml 头部注释**：因加 dsh storage 链成为「never re-states dsh internals」例外，WIRE-A 已加行内注释说明。可接受。

## 9. WIRE-A 完成确认
- 启动 bug 已修（registerShellSeam 惰性化），起 host 打印 8320 无崩溃，curl /api/status 200
- storage 链补全为 4 行（storage → storage-json → storage-domain → workspace），D spec §6 的 2 行不完整已纠正
- tsconfig paths/references、RIN_HOST_PLUGINS、cordis.yml 5 新包均到位
- 验证全绿：seam/sandboxes/host 三 smoke + rin:typecheck exit 0
