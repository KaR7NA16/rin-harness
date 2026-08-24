# rin-harness 目标架构

> 状态：Accepted — canonical repository layout implemented; product and release closure remain in progress
>
> 日期：2026-08-24
>
> 本文定义已批准的目标信息架构及其来源映射。目标目录已落地；本文不替代
> [CURRENT.md](CURRENT.md) 对当前事实的记录，也不把静态布局证明提升为运行时、
> 安装、签名或升级证明。

## 1. 设计结论

> 实施状态说明：本节的 34 包/13 group 是迁移基线，不是当前 census。
> Host、应用入口和首批低耦合包已经迁移；准确现状以
> [CURRENT.md](CURRENT.md) 为准。旧路径到目标路径的表格描述来源映射，
> 不代表旧路径仍然存在。

当前仓库有 34 个私有 package、13 个物理 group。问题不是缺少模块化，而是一级目录同时混用了技术层、业务域、产品形态、能力类型和装配职责。目标结构必须只使用一个分类轴：

> 一级目录表示架构角色；二级目录才是 package；package 内部目录表示子能力。

目标从 34 个 package 收敛为 21 个 package。收敛依据不是文件数量，而是以下边界：

1. 是否有独立运行/部署生命周期；
2. 是否有稳定的公开 API 和反向依赖；
3. 是否拥有独立状态、迁移和数据生命周期；
4. 是否需要单独 owner、版本和 release gate；
5. 仅有 2–5 个源码文件且只由同一宿主消费的模块，默认不单独成包。

## 2. 外层与包层采用不同且固定的分类

仓库根只表达 monorepo 资产类型：

| 根目录 | 唯一含义 |
|---|---|
| apps | 用户直接启动或分发的产品入口 |
| packages | 可被 apps 或其他 package 复用的运行时代码 |
| tooling | 只服务仓库开发、验证和生成的工具 |
| docs | 当前架构、ADR、计划、审计和历史记录 |
| patches | 有 ADR 和来源记录的第三方依赖补丁 |
| .artifacts | 本地或 CI 生成物，全部 Git ignore |

packages 的下一层才表达架构角色：

| Package group | 唯一含义 | 允许放置 | 禁止放置 |
|---|---|---|---|
| runtime | 进程装配、传输、运维和恢复 | Host、HTTP/API、contracts、health、backup | 具体领域 UI、外部协议实现 |
| domains | 拥有状态和业务不变量的领域 | assets、workspace、memory、knowledge、notes、automation、collaboration | Tauri、React 页面、MCP transport |
| features | 面向用户或 agent 的可组合能力 | authoring、evolution、context、computer-use、migration | 进程入口、通用持久化 |
| integrations | 外部协议、供应商和系统适配 | MCP、provider adapters | 产品状态和页面 |

不再保留 rin/ 外壳，也不再建立 core、capability、optimization、learning、web、gui、cli、bundle 这类互相不在同一分类轴上的 group。

## 3. 目标目录树

~~~text
rin-harness/
├─ README.md
├─ README.zh.md
├─ AGENTS.md
├─ CLAUDE.md
├─ CONTRIBUTING.md
├─ CONTRIBUTING.zh.md
├─ CODE_OF_CONDUCT.md
├─ SECURITY.md
├─ LICENSE
├─ THIRD_PARTY_NOTICES.md
├─ package.json
├─ pnpm-lock.yaml
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ tsconfig.json
├─ vitest.config.ts
├─ .oxlintrc.json
├─ lefthook.yml
├─ .editorconfig
├─ .gitattributes
├─ .gitignore
├─ .rgignore
├─ apps/
│  ├─ cli/                         # @rin/cli
│  ├─ web/                         # @rin/web
│  └─ desktop/                     # @rin/desktop
├─ packages/
│  ├─ runtime/
│  │  ├─ host/                    # @rin/host
│  │  ├─ contracts/               # @rin/contracts
│  │  ├─ health/                  # @rin/health
│  │  └─ backup/                  # @rin/backup
│  ├─ domains/
│  │  ├─ assets/                  # @rin/assets
│  │  ├─ workspace/               # @rin/workspace
│  │  ├─ memory/                  # @rin/memory
│  │  ├─ knowledge/               # @rin/knowledge
│  │  ├─ notes/                   # @rin/notes
│  │  ├─ automation/              # @rin/automation
│  │  └─ collaboration/           # @rin/collaboration
│  ├─ features/
│  │  ├─ authoring/               # @rin/authoring
│  │  ├─ evolution/               # @rin/evolution
│  │  ├─ context/                 # @rin/context
│  │  ├─ computer-use/            # @rin/computer-use
│  │  └─ migration/               # @rin/agent-migration
│  └─ integrations/
│     ├─ mcp/                     # @rin/mcp
│     └─ providers/               # @rin/providers
├─ tooling/
│  ├─ config/
│  ├─ gates/
│  ├─ scripts/
│  └─ generators/
├─ docs/
│  ├─ architecture/
│  ├─ decisions/
│  ├─ roadmap/
│  ├─ audits/
│  └─ archive/
├─ patches/
├─ .github/
└─ .artifacts/                     # ignored
~~~

apps 下的直接子目录，以及 packages/<role>/<name>，才是 workspace package。package 内部的 repository、prompt、brief、pruning 等只是模块，不再拥有独立 package.json、tsconfig 和 README。

## 4. 目标 package 清单

| 层 | Package | 核心职责 |
|---|---|---|
| apps | @rin/cli | 薄命令入口，只解析参数并启动 host |
| apps | @rin/web | React SPA，只依赖 contracts，不直接依赖领域实现 |
| apps | @rin/desktop | Tauri 壳、sidecar 生命周期、平台菜单和安装边界 |
| runtime | @rin/host | 唯一服务进程；插件装配、HTTP、routes、start/stop |
| runtime | @rin/contracts | API DTO、事件 envelope、错误码；不得包含领域实现 |
| runtime | @rin/health | monitor、doctor、诊断快照和 readiness |
| runtime | @rin/backup | RIN_HOME 级备份、恢复、导入 staging 和原子切换 |
| domains | @rin/assets | Asset Repository、schema、校验、seed 和迁移 |
| domains | @rin/workspace | 环境、agent、sandbox、plugin 和 filesystem 装配 |
| domains | @rin/memory | canonical memory、prompt/skill/session 投影与检索 |
| domains | @rin/knowledge | 知识索引和跨来源 graph read model |
| domains | @rin/notes | 笔记状态、查询和会话备份笔记 |
| domains | @rin/automation | 任务、调度状态和执行记录 |
| domains | @rin/collaboration | teams、成员和协作配置 |
| features | @rin/authoring | brief 和 review 两类 LLM 工件能力 |
| features | @rin/evolution | 经验提取、候选变更和学习生命周期 |
| features | @rin/context | token policy、pruning 和 codegraph 上下文能力 |
| features | @rin/computer-use | computer-use 审批与执行接口 |
| features | @rin/agent-migration | 外部 agent 配置迁移 |
| integrations | @rin/mcp | MCP protocol 与 client adapter |
| integrations | @rin/providers | provider discovery、probe 和 capability normalization |

## 5. 现有 34 包到目标 21 包的映射

> 本节的 `rin/<group>/<name>` 路径是迁移前的来源标识，仅用于追溯每个目标包的组成；
> 它们不表示当前工作树仍存在这些目录。当前物理路径和 21 个 manifest 以
> [CURRENT.md](CURRENT.md) 为准。

| 目标 package | 合并或迁入的现有路径 | 处理方式 |
|---|---|---|
| apps/cli | rin/cli/rin | 保留 bin/args；host.ts 迁往 packages/runtime/host |
| apps/web | rin/web/web-ui | 包改名；删除对领域实现的直接依赖，改用 contracts |
| apps/desktop | rin/gui/gui | 去除 gui/gui 重复路径；Tauri 归产品入口 |
| packages/runtime/host | rin/host/rin、rin/web/web-server、rin/cli/rin 的 host 部分 | 合并装配、HTTP 和生命周期；移除 @rin/host |
| packages/runtime/contracts | 新建 | 从 web-ui 手抄类型和 routes 响应抽取纯 DTO |
| packages/runtime/health | rin/core/monitor、rin/core/doctor | 合并共享诊断采集与检查编排 |
| packages/runtime/backup | rin/core/session-backup | 保留独立包，因为它拥有 RIN_HOME 级恢复事务 |
| packages/domains/assets | rin/core/assets | 改名，明确它是资产领域而不是泛用 core |
| packages/domains/workspace | rin/core/environment、rin/core/filesystem、rin/workspace/agents、rin/workspace/plugins、rin/workspace/sandboxes | 合并同一条 repository → plan → sandbox/agent/plugin 装配链 |
| packages/domains/memory | rin/core/memory、rin/memory/prompt-memory、rin/memory/skill-memory、rin/memory/session-search | canonical store 为根，其余作为投影模块 |
| packages/domains/knowledge | rin/memory/knowledge、rin/memory/knowledge-graph | index 与 graph 同包；graph 是 read model，不再独立发包 |
| packages/domains/notes | rin/notes/notes | 去除 notes/notes 重复路径 |
| packages/domains/automation | rin/automation/tasks | 任务状态归领域；未来 schedule 进入本包模块，不新建一级 group |
| packages/domains/collaboration | rin/collaboration/teams | 包改名，领域名与物理路径一致 |
| packages/features/authoring | rin/capability/brief、rin/capability/review | 两个相同生命周期的小能力合并 |
| packages/features/evolution | rin/learning/evolution | 只改变架构归类 |
| packages/features/context | rin/optimization/token-optimization、rin/optimization/smart-pruning、rin/optimization/codegraph | 合并共同的上下文预算和裁剪链 |
| packages/features/computer-use | rin/automation/computer-use | 从 automation 移出；它是交互能力，不是任务领域 |
| packages/features/migration | rin/automation/agent-migration | 从 automation 移出；它是一次性迁移能力 |
| packages/integrations/mcp | rin/automation/mcp、rin/automation/mcp-client | protocol/client 作为同一 integration 的内部模块 |
| packages/integrations/providers | rin/automation/provider-probe | 从 automation 移出，作为 provider adapter |

该映射覆盖全部 34 个现有 package。目标不是把所有代码塞进少数大包，而是消除只为目录分类存在、却没有独立生命周期的 package 边界。

## 6. 依赖方向

允许的主要依赖方向：

~~~text
apps/cli ───────────────► packages/runtime/host
apps/desktop ───────────► packages/runtime/host + packages/runtime/contracts
apps/web ───────────────► packages/runtime/contracts

packages/runtime/host ──► packages/domains/*
packages/runtime/host ──► packages/features/*
packages/runtime/host ──► packages/integrations/*
packages/runtime/host ──► packages/runtime/health + packages/runtime/backup

packages/features/* ────► packages/domains/* 和 packages/integrations/* 的公开 API
packages/domains/knowledge ─► assets + memory + notes
packages/domains/workspace ─► packages/domains/assets

packages/integrations/* ─► 外部 SDK / node 内置
packages/domains/* ─────X apps/*、runtime/host、React、Tauri
~~~

强制规则：

1. apps/web 不再直接依赖 @rin/memory 或其他领域包，只依赖 @rin/contracts。
2. packages/runtime/host 是唯一 composition root；其他包不得装配全家桶。
3. domains 不依赖 apps，也不依赖 HTTP/Tauri/React。
4. integrations 不拥有产品状态；它们只做协议和供应商归一化。
5. features 可以调用领域公开接口，但不得绕过领域 store 直接读数据库。
6. 跨 package 只使用 @rin 包名；package 内部使用相对 import。
7. 不允许为了避免相对 import 再创建只有 2–3 个文件的新 package。
8. 任何新增 package 必须用 ADR 证明独立生命周期、公开 API 和 owner。

## 7. Package 内部统一布局

每个 package 只保留必要目录：

~~~text
<package>/
├─ package.json
├─ tsconfig.json
├─ README.md
├─ src/
│  ├─ index.ts
│  ├─ types.ts                 # 仅包内公共领域类型
│  └─ <internal-modules>/
└─ tests/
   ├─ unit/
   ├─ integration/
   └─ fixtures/
~~~

约束：

- 不强制每个模块都有 types.ts；只有真正公共类型才从 index.ts 导出。
- 不再同时维护 tests、test、__tests__ 多种布局。
- 构建产物统一输出到 package 的 dist/，全部 Git ignore。
- lib/types 不作为源代码导航入口。
- package README 只写职责、公共 API、运行方式和已知限制，不承担全仓架构说明。

## 8. 根目录与生成物

仓库根只保留工具需要自动发现或所有贡献者必须看到的文件：

~~~text
/
├─ README.md
├─ README.zh.md
├─ AGENTS.md
├─ CLAUDE.md
├─ CONTRIBUTING.md
├─ CONTRIBUTING.zh.md
├─ CODE_OF_CONDUCT.md
├─ SECURITY.md
├─ LICENSE
├─ THIRD_PARTY_NOTICES.md
├─ package.json
├─ pnpm-lock.yaml
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ tsconfig.json
├─ vitest.config.ts
├─ lefthook.yml
├─ apps/
├─ packages/
├─ tooling/
├─ docs/
├─ patches/
├─ .github/
└─ .artifacts/                  # 全部 ignored
   ├─ coverage/
   ├─ codegraph/
   ├─ build/
   ├─ reports/
   └─ temp/
~~~

根级保留标准：

- 工具或平台按约定自动发现：package.json、pnpm/TypeScript/Vitest/Lefthook/GitHub 配置；
- 进入仓库后必须立即看到：README、AGENTS、CONTRIBUTING、SECURITY、LICENSE；
- 法律与开源治理要求位于根：CODE_OF_CONDUCT、THIRD_PARTY_NOTICES；
- 中英文文件成对存在并通过链接互相跳转，不复制其他架构文档。

当前外层到目标位置的映射：

| 当前路径 | 目标路径 | 处理 |
|---|---|---|
| rin/apps 等全部源码 | apps/ 与 packages/ | 去掉多余 rin/ 外壳并按第 5 节迁移 |
| rin/scripts | tooling/gates、tooling/scripts、tooling/generators | 按检查、操作脚本、生成器三类拆分 |
| rin/.oxlintrc.json | 根 .oxlintrc.json | 只有一个 lint 入口 |
| rin/vitest.config.ts + vitest.shared.ts | 根 vitest.config.ts | 合并为唯一 Vitest 入口，内部按 project 分类 |
| rin/coverage-thresholds.json | tooling/config/coverage-thresholds.json | 由唯一 coverage gate 读取 |
| rin/tsconfig.json | 根 tsconfig.json | 生成的 solution references，覆盖全部 workspace |
| rin/README.md | docs/architecture/CURRENT.md | 不再作为第二个仓库 README |
| rin/AGENTS.md | 根 AGENTS.md | 去掉 rin 外壳后合并专有规则；CLAUDE.md 继续只链接根规则 |
| rin/DEFERRED-ITEMS.md | docs/roadmap/BACKLOG.md | 只保留一个 backlog |
| rin/docs/* | docs/architecture、decisions、roadmap、audits、archive | 按状态重新归档 |
| MIGRATION.md | docs/archive/migration/MIGRATION.md | 历史迁移证据，不再作为当前目录权威 |
| .github/workflows/rin.yml | .github/workflows/ci.yml | 名称表达职责；发布另用 release.yml |
| coverage/ | .artifacts/coverage/ | ignored，可再生成 |
| .codegraph/ | .artifacts/codegraph/ | ignored，可再生成 |
| patches/ | patches/ | 保留；每个补丁必须有来源和 ADR |

目标态中：

- coverage/ 和 .codegraph/ 不再直接出现在根目录；
- 所有可再生成报告进入 .artifacts/；
- 产品运行数据只进入 RIN_HOME，不写入源码树；
- 安装包、sidecar 和 SBOM 进入 .artifacts/build 或 CI artifact，不进入 package 源目录；
- patches/ 只保存经过 ADR 说明的第三方补丁。

## 9. 文档权威结构

~~~text
docs/
├─ README.md                    # 唯一索引，标记状态和 owner
├─ architecture/
│  ├─ CURRENT.md               # 当前已实现事实
│  ├─ TARGET.md                # 批准后的目标架构
│  └─ DEPENDENCIES.md          # 允许/禁止的依赖方向
├─ decisions/
│  ├─ ADR-0001-*.md
│  └─ ...
├─ roadmap/
│  ├─ ACTIVE.md                # 唯一活跃计划
│  └─ BACKLOG.md               # deferred 项
├─ audits/
│  └─ YYYY-MM-DD-*.md
└─ archive/
   └─ migration/
~~~

文档状态规则：

| 类型 | 权威范围 |
|---|---|
| CURRENT.md | 当前仓库实现事实；必须由代码或门禁输出支持 |
| TARGET.md | 已批准但未必实现的目标态 |
| ADR | 已决定且不可静默改写的架构决策 |
| ACTIVE.md | 唯一当前执行计划 |
| BACKLOG.md | 未承诺排期的需求和 deferred 项 |
| audits | 某一时间点的证据快照 |
| archive | 历史材料，不作为当前事实来源 |

蓝图获批后，MIGRATION.md 应转入 archive/migration；它不再同时承担历史审计、当前事实、目标架构和待办列表。DEFERRED-ITEMS.md 应合并进 roadmap/BACKLOG.md。现有多个 PLAN 文档要么合并进 ACTIVE.md，要么进入 archive，并在索引中标明 superseded。

## 10. 聚合与门禁

目标 workspace：

~~~yaml
packages:
  - apps/*
  - packages/runtime/*
  - packages/domains/*
  - packages/features/*
  - packages/integrations/*
~~~

目标 TypeScript 聚合不再手工维护一份容易遗漏的长 references 列表。由 tooling/generators 根据 workspace manifests 生成并检查 solution references：

1. package census 数量必须等于 solution references 数量；
2. 新增/删除 package 后生成文件必须同步变化；
3. apps/web 使用独立 DOM config；
4. Tauri/Rust 不伪装成 TypeScript package；
5. 根 check 明确分为 typecheck、unit、integration、web-build、host-smoke、desktop；
6. 任何未运行的 gate 必须显示 skipped + reason，不能静默消失。

### 10.1 根命令面

仓库已经只服务 rin-harness，目标命令不再保留迁移期 rin: 前缀：

| 当前 | 目标 |
|---|---|
| pnpm rin | pnpm dev 或 pnpm start |
| pnpm rin:typecheck | pnpm typecheck |
| pnpm rin:test | pnpm test |
| pnpm rin:test:coverage | pnpm test:coverage |
| pnpm rin:lint | pnpm lint |
| pnpm rin:hygiene | pnpm hygiene |
| pnpm rin:smoke | pnpm smoke |
| pnpm rin:metadata | pnpm metadata |
| pnpm rin:build | pnpm build:web |
| pnpm build | pnpm check && pnpm build:all |

目标根 package.json 只编排 workspace 命令，不直接指向深层源码文件。apps/cli 自己声明 bin，runtime/host 自己声明 start，根脚本通过 pnpm --filter 调用。

### 10.2 CI 外层

.github/workflows/ci.yml 不再只有一个名为 rin 的串行 job。目标分为：

~~~text
ci
├─ metadata-and-structure
├─ typecheck
├─ lint
├─ unit-and-coverage
├─ host-smoke
├─ web-build
└─ desktop-proof            # 具备 runner/toolchain 后启用
~~~

结构收益：

- required checks 能准确指出失败面；
- Web、Host、Desktop 的证据不再被一个绿色 job 混为一谈；
- package census、solution references、contracts drift 和 docs authority 进入 metadata-and-structure；
- release 使用独立 release.yml，不与每次 push 的 CI 混合；
- workflow 文件名和 job 名表达职责，不再重复仓库名。

## 11. 未来 Companion Domain 的落位规则

本蓝图不预建空目录。只有开始实现且 ADR 获批时才增加：

- packages/domains/relationship：关系事件、边界、同意状态和关系投影；
- packages/features/companion-safety：危机、操纵和年龄策略；只有拥有独立 release gate 时才单独成包；
- tooling/evals/companion：LoCoMo、关系一致性与安全评估；默认是仓库工具，不是运行时 package。

首版 consent、privacy export 和 relationship reset 应优先作为 packages/domains/relationship 与 packages/runtime/backup 的内部模块。只有出现多个独立消费者和不同生命周期后，才考虑拆出新 package。

这样可以容纳下一阶段产品规划，同时避免再次用“未来可能需要”制造空 group 和微包。

## 12. 非大爆炸迁移约束

蓝图获批也不代表立即移动全部目录。未来实施必须遵守：

1. 先建立 package census、依赖方向检查和 CURRENT.md；
2. 一次只迁移一个目标 package，保留兼容 re-export；
3. 每一步都要求 typecheck、相关测试、host smoke 和 import census；
4. package rename 至少保留一个迁移周期的兼容入口；
5. 不在同一提交同时移动路径、重写领域逻辑和修改 API；
6. apps/web 的 contracts 解耦优先于领域包合并；
7. packages/runtime/host 合流优先于删除 bundle/web-server 旧入口；
8. 生成物搬迁不删除用户数据，只改变 ignored 工作目录；
9. 文档归档保留 Git 历史和 superseded 指针；
10. 任何阶段失败都能退回上一个可运行结构。

建议的实施顺序只表达依赖，不是本蓝图的执行授权：

~~~text
contracts
   ↓
host composition
   ↓
leaf merges: health / mcp / authoring / context
   ↓
stateful domains: workspace / memory / knowledge
   ↓
apps rename: web / desktop / cli
   ↓
docs authority and generated artifacts final cleanup
~~~

## 13. 审阅时需要确认的决策

### B-00：移除 rin/ 外壳

是否接受将 apps、packages、tooling 和 docs 直接提升到仓库根，不再用 rin/ 包裹项目拥有的全部源码。

推荐：接受。当前仓库不维护 dsh 源码副本，约 930 个受跟踪文件已经几乎全部属于 rin；继续保留 rin/ 只会制造第二套 README、AGENTS、tsconfig、Vitest 和文档入口。

### B-01：一级分类轴

是否接受根层 apps / packages / tooling / docs，以及 packages 下 runtime / domains / features / integrations 的两级固定分类。

推荐：接受。根层表达 monorepo 资产类型，package group 表达架构角色；两层不能再混用。

### B-02：34 包收敛为 21 包

是否接受本文件第 5 节的合并边界。

推荐：整体接受，但允许在实施前通过 dependency cycle audit 调整单个合并项。不能因为移动成本而默认保留所有微包。

### B-03：Workspace Domain 合并

是否将 environment、filesystem、agents、plugins、sandboxes 合并为 @rin/workspace。

推荐：接受。这五者已经形成同一条资产仓库到执行环境的装配链，也是当前目录最分散的领域。

### B-04：Memory Domain 合并

是否将 canonical memory、prompt-memory、skill-memory、session-search 合并为 @rin/memory 内部模块。

推荐：接受。统一来源、版本、撤销和注入审计需要单一领域边界；内部模块仍可保持代码隔离。

### B-05：Host 合流

是否将 bundle、web-server 和 CLI 中的 host 生命周期合并为 @rin/host。

推荐：接受。CLI 和 Desktop 都应启动同一个 host，装配不应同时分散在三个 package。

### B-06：Repository 改名为 Assets

是否将 @rin/assets 改名为 @rin/assets。

推荐：接受物理目标 packages/domains/assets；包名可以暂时保留 @rin/assets。包名重命名不是结构收口的必要前置条件，可独立决策。

### B-07：文档权威切换

是否让 architecture/CURRENT.md、roadmap/ACTIVE.md 和 decisions/ADR 成为新的权威体系，并将 MIGRATION.md 降为历史迁移档案。

推荐：接受。当前最大治理风险之一就是历史迁移计划继续冒充实时架构事实。

## 14. 蓝图验收标准

只有同时满足以下条件，未来结构迁移才能称为完成：

- 根目录全部能用“monorepo 资产类型”解释，packages 的 group 全部能用“架构角色”解释；
- 不再出现 gui/gui、notes/notes、cli/rin、bundle/rin 重复路径；
- package census 与 TypeScript solution references 完全一致；
- apps/web 不再直接 import 领域实现；
- 只有 packages/runtime/host 是 composition root；
- 旧 34 包均有迁移、兼容或明确删除记录；
- 所有 current/target/history 文档状态可从 docs/README 一眼识别；
- 根目录不存在生成报告和产品运行数据；
- 新开发者只阅读根 README、architecture/CURRENT.md 和对应 package README 即可定位代码；
- 任何新增 package 都有 ADR、owner、公开 API、依赖方向和独立生命周期证明。

## 15. 明确不在本蓝图中决定的事项

- 不决定具体文件移动提交；
- 不决定 Companion 功能是否进入下一个 release；
- 不改变 dsh registry dependency；
- 不修改 API 行为和数据 schema；
- 不删除历史文档、coverage、codegraph 或任何用户数据；
- 不承诺 package 重命名的时间；
- 不把目标目录写成已经实现的当前事实。
