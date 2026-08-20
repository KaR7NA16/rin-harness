# rin-harness 资产仓库落地计划（v2 修正版）

> 版本: v2.0 ｜ 状态: 待评审
> v1 被否决: 原方案把 ~/.rin 提升为全局仓库属『物理收编错误方向』——混淆配置主目录与用户资产,
> 与 rin 既有『投影统一』架构(Atlas 图谱 / Files 挂载 / seam 投影)冲突, 且资产目录含凭据无法 git。
> v2 方向: 方向 B 修正版——**显式资产根 + 聚合管理入口 + 凭据/状态分离**。

---

## 1. 决策记录（v2 为什么对）

### 1.1 否决项
1. ~~把 ~/.rin 提升为全局仓库~~: bundle README 明确 ~/.rin 是『所有可变状态的单一配置主目录』,
   内含 providers.json 等凭据。仓库化的核心价值(git/分享/迁移)会因凭据混入而失效。
2. ~~仓库 reader 收编全部资产解析~~: repository README 明确『只读投影, 各资产域由拥有包投影』,
   且 AUDIT-REPORT 已把 writer/migration/seed 列为死代码。重复能力违背 seam 约定。
3. ~~仅做只读聚合入口~~: 满足不了『管理所有资产』——资产仍埋在隐藏目录, 用户不可见、不可拥有。

### 1.2 采纳项
**显式资产根(assetsRoot)**: 用户拥有一个可见、可 git、可分享的资产目录, harness 以其为
默认数据源。这对应 Obsidian vault / dotfiles / Home Assistant config 的成熟形态, 即
『harness 内环境』。

### 1.3 关键事实（可行性依据, 已源码核实）
- 全部 13 个插件路径经 `rinHome()` 单一注入点（bundle/rin/src/index.ts + cordis.yml）——
  换根只需改一个函数 + 迁移一次数据。
- `RIN_HOME` 环境变量已支持重定位（空值视为未设）。
- CLI host.ts 把 rinHome 注入 boot context（cli/rin/src/host.ts:89），扩展 helper 即可。
- repository reader 通用：任何含 repository.yaml 的目录都可读——资产根天然可被仓库体系消费。

---

## 2. 目标架构：双根职责分离

    ~/rin-home/                     ← 资产根 assetsRoot（默认 ~/rin-home, 可配置）
    ├── repository.yaml             ← 资产清单(自动生成, 幂等, 复用 reader 校验)
    ├── notes/                      ← 笔记默认存储(Obsidian vault, 用户可见)
    ├── agents/                     ← 智能体定义(原 ~/.rin/agents)
    ├── environments/               ← 环境包 + profiles(从内置模板引导复制)
    ├── skills/                     ← 技能 + skill-memory 学习产物
    ├── knowledge/                  ← 知识图谱(knowledge.db)
    ├── prompt-memory/              ← 提示记忆(soul/brief 用户身份资产)
    ├── evolution/                  ← 自进化状态(state/config/backups)
    ├── workflows/ tools/ policies/ outputs/ bundles/   ← 预留九类根
    └── (git init 可选, 用户自行决定版本控制)

    ~/.rin/                         ← 配置主目录(保留, 只放内部状态与凭据)
    ├── providers.json              ← 凭据(绝不进资产目录!)
    ├── settings.json / repositories.json / sandbox.yaml / mcp/
    ├── session-search/             ← 可重建索引
    ├── knowledge-graph.db          ← 图谱投影(可重建)
    └── ...

**不变**: Atlas 图谱 / Files 挂载 / seam 投影 / 各资产拥有包——它们消费路径注入结果, 换根即通。

---

## 3. 分阶段落地

### 阶段 1：路径拆分（核心, 小改动）

| 文件 | 改动 |
|---|---|
| rin/bundle/rin/src/index.ts | 新增 `assetsRoot(subpath?)`: `$RIN_ASSETS_HOME` 优先, 否则 `~/rin-home`; `rinHome` 保持为配置主目录; defaultConfig 同步 |
| rin/bundle/rin/src/cordis.yml | notes/agents/knowledge/prompt-memory/skill-memory/evolution 各行的 `rinHome('x')` 改为 `assetsRoot('x')`; sandbox.yaml/repositories.json 等保持 rinHome |
| rin/cli/rin/src/host.ts | boot context 增加 `assetsRoot` helper（与 rinHome 并列, host.ts:89 附近） |
| rin/bundle/rin/README.md | 路径表更新: assetsRoot 与 configRoot 双根说明 |

**验证**: typecheck + host 冒烟; 手工: 设 RIN_ASSETS_HOME=/tmp/a 启动, 笔记/记忆读写落在 /tmp/a。

### 阶段 2：资产根初始化 + 一次性迁移

**2a. ensureAssetRepository（扩展 rin/core/repository/src/）**
- 新增 `ensureAssetRepository(assetsRoot)`：幂等生成 `assetsRoot/repository.yaml`
  （apiVersion rin.dev/v1, kind AssetRepository, metadata.id: local, spec.mutable: true,
   roots 指向各资产目录; 已存在则校验读回, 不覆盖用户修改）
- bundle 启动 prepare 阶段调用（bundle/rin/src/index.ts 或 cli host）

**2b. 迁移工具（web-server 端点 + web-ui 向导, 或 cli 命令）**
- 扫描 `~/.rin/{notes,agents,knowledge,prompt-memory,skill-memory,evolution}` 是否存在数据
- 交互确认 → 移动到资产根对应目录（保留失败回滚: 先复制后删除, 或软链兼容）
- 完成前 harness 双读兼容（资产根优先, 配置主目录回退）

**2c. 环境模板引导**
- 首次启动检测资产根 environments/ 为空 → 提示从内置仓库复制 scientific-base 等模板
- 提供『复制到资产根』操作（复用现有仓库连接/解析逻辑）

### 阶段 3：仓库工作区 → 资产中心（UI）

见 UI-REDESIGN-PLAN.md v2 的『仓库资产中心』节。要点：
- 仓库切换器: 资产根(本地, 固定首项) + 内置仓库 + 共享仓库连接
- 资产 tab: 总览 / 笔记 / 智能体 / 环境 / 技能 / 记忆·自进化
- 总览卡片: 各资产数量/最近更新/存储位置, 点击进入对应 tab 或跳转
- 各 tab 复用拥有包既有页面/组件（AgentWorkspace、环境展示、EvolutionProfile、记忆 API）

### 阶段 4：设置增强

- 设置-通用 新增『资产根』配置: 显示当前路径, 提供路径选择/重定位 + 迁移入口
- 设置-仓库连接管理: 资产根固定不可删除, 共享仓库连接增删
- DEFERRED-ITEMS A3 顺带: repository 的 skills/workflows/tools 根入图

---

## 4. 边界与不做什么

1. **不生成 ~/.rin/repository.yaml**——配置主目录不仓库化。
2. **不复活 repository writer 死代码**——资产写入仍走各拥有包。
3. **不把 session-search/knowledge-graph.db 移入资产根**——可重建索引留配置主目录。
4. **不在仓库内解析笔记正文**——@rin/notes 仍拥有 vault 能力, 资产中心只做摘要展示。
5. **SQLite 资产的 git 局限**（knowledge.db）: 文档标注, 默认仍入资产根（用户资产语义优先）。

---

## 5. 文件级改动清单

| 文件 | 阶段 | 改动 |
|---|---|---|
| rin/bundle/rin/src/index.ts | 1 | assetsRoot() + defaultConfig |
| rin/bundle/rin/src/cordis.yml | 1 | 资产行改 assetsRoot |
| rin/cli/rin/src/host.ts | 1 | boot context 注入 assetsRoot |
| rin/bundle/rin/README.md | 1 | 双根说明 |
| rin/core/repository/src/global.ts (新) | 2 | ensureAssetRepository |
| rin/web/web-server/src/routes/legacy.ts | 2,4 | 迁移端点 / 资产根信息 |
| rin/web/web-ui/src/pages/RepositoryWorkspace.tsx | 3 | 资产中心重构 |
| rin/web/web-ui/src/pages/AgentWorkspace.tsx | 3 | 嵌入资产中心智能体 tab |
| rin/web/web-ui/src/pages/Settings.tsx | 4 | 资产根配置 |
| rin/web/web-ui/src/stores/uiStore.ts | 3 | 视图类型 |
| 对应测试 + i18n | 全部 | 每阶段同步 |

## 6. 验收总标准

1. 新装机: 首次启动自动创建 ~/rin-home + repository.yaml, 笔记/记忆写入资产根。
2. 存量机: 迁移向导把 ~/.rin 用户资产移入资产根, 可回滚。
3. 资产根可 git init/分享/备份; ~/.rin 不含用户资产, 凭据不泄露。
4. 仓库工作区 = 资产中心, 六个资产 tab 可用, 各资产显示存储位置。
5. typecheck/test/lint 全绿, Atlas/Files/seam 冒烟回归通过。
