# rin-harness 当前执行路线

> 状态：Active
> 基线日期：2026-08-24
> 规划周期：12 周
> 适用范围：当前 migration/registry-deps 分支所代表的 Web/Host/Memory 底座，以及拟新增的 Companion Domain、桌面发布与治理能力。

## 1. 执行摘要

下一阶段不应直接把 rin-harness 宣称为消费级“人机恋产品”，也不应因为桌面发布链路尚未闭合而否定现有底座。当前最准确的判断是：

- Web/Host developer preview 已具备真实可运行性；
- 统一记忆、来源追踪、tombstone、注入审计和备份已形成有价值的技术底座；
- Companion/Relationship 领域、用户关系生命周期、安全边界和消费级 UI 尚未成为独立产品域；
- 聚合类型检查、实际覆盖率门禁与 Linux Tauri sidecar/`.deb` 安装链已有本轮实测；
  Windows/macOS 签名、真实 updater 发布升级、clean-machine CI、SBOM/provenance
  仍缺端到端证据。

因此，本规划采用“两条链同时推进、三道证据门控制合流”的路线：

1. 先闭合工程质量、数据撤销和真实桌面构建的证明链；
2. 在独立领域中实现成人限定、用户控制、非操纵性的长期陪伴内核；
3. 只有通过 Gate A/B/C，才进入小规模封闭 alpha；12 周结束只做公开发布 Go/No-Go 决策，不自动上线。

首个产品目标是：

> 可审计、可撤销、成人限定、local-first 的长期 AI 陪伴封闭 alpha。

## 当前仓库整理执行状态

- Phase 0/1 的根级整理批次已完成：docs、tooling、config、CI authority
  consolidation 已落地，当前入口统一指向根级工程配置和 `docs/` 文档。
- Host/应用入口与全部合并包已落到目标 `apps/` 与 `packages/` 布局；
  当前 workspace census 为 21 个 package manifest。
- 过渡目录 `rin/` 已清空并移除；旧迁移路径仅在 `docs/archive/` 和
  `docs/architecture/TARGET.md` 的来源映射中保留。
- 后续修改仍必须同步 manifest、workspace discovery、solution references、
  path aliases、测试、门禁、CI 和文档，并重新运行根级检查。


## 2. 当前基线与证据边界

### 2.1 迁移前基线（历史证据）

- Git：分支 migration/registry-deps，HEAD 93dc4a8ee8，相对 main 领先 23 commits；审计时工作树干净。
- 测试：192 个测试文件、1689 个测试通过；Oxlint 0；38/38 smoke；34/34 metadata；5/5 hygiene。
- 覆盖率：statements 60.18%、branches 54.49%、functions 56.95%、lines 62.42%。
- 类型：7 个未被聚合命令覆盖的项目经独立严格检查通过；这证明叶子项目当时可通过，不证明聚合图已闭合。
- Web：build 成功；独立 RIN_HOME 下 Host 能启动，/api/health、/api/memory/manifest 和 SPA root 可访问。

布局迁移后的新鲜证据（2026-08-24）：

- `pnpm-workspace.yaml` 只发现 `apps/*` 与 `packages/*/*`；当前 census
  为 21 个 workspace package manifest。
- `rin/` 不存在；根 `sync:references`、结构、依赖、Cordis、README 与 publint
  链路已改为 canonical 路径。
- `pnpm run check` 通过：metadata/hygiene/typecheck/lint、193 个测试文件中的
  1695 项测试，以及 38/38 smoke 全绿。
- `pnpm run test:coverage` 通过由 `tooling/config/coverage-thresholds.json`
  直接驱动的全局与 package/subpath 阈值：statements 60.35%、branches 54.60%、
  functions 57.10%、lines 62.58%。
- `cargo fmt --check`、`cargo check` 与 Linux x64 release `.deb` 构建通过；
  通过 apt 安装后的 `/usr/bin/rin` 在无系统 Node/pnpm 运行路径下返回
  `/api/status = ok`，GUI 被 `SIGKILL` 后 sidecar 看门狗完成回收。测试包随后已卸载。

### 2.2 尚未证明

- React 异步测试警告是否已全部消除；
- 真 provider、container、remote、install 生命周期；
- 历史记忆 backfill、冲突修正和删除派生项的完整传播；
- Companion/Relationship API、消费者生命周期 UI 与危机安全路线；
- Windows/macOS sidecar 与安装包、平台签名/公证、真实 updater 更新及
  GitHub-hosted clean-machine E2E；
- SBOM、构建 provenance 和 artifact attestation。

本规划中的静态检查、mock、dry run、文档与 benchmark 均不得被写成上述能力的运行时证明。

## 3. 产品决策与非目标

### 3.1 默认决策

| ID | 决策 |
|---|---|
| D-01 | 首轮仅面向成年人；年龄未知时使用保守模式，不开放浪漫关系能力。 |
| D-02 | local-first；任何远程模型传输都必须按供应商、目的和数据类别披露。 |
| D-03 | 产品定位为 AI companion，不是人类、治疗师、危机服务或现实关系替代者。 |
| D-04 | 浪漫模式独立、显式 opt-in，可暂停、撤销、重置；不得由模型暗中升级。 |
| D-05 | 主动联系默认关闭；启用后提供范围、频率、安静时段和一键撤销。 |

### 3.2 本周期非目标

- 不作诊断、治疗、心理咨询或自杀风险评估声明；
- 不建立不可见“亲密度分数”驱动对话、增长或付费；
- 不以聊天时长、自我披露量、排他性或害怕失去 AI 作为正向 KPI；
- 不推出未成年人浪漫/性/依赖型模式；
- 不把语音、远程执行、IM、角色市场或公开发布塞入 12 周必交范围；
- 不在真实安装、签名、升级和恢复完成前称“桌面生产就绪”。

## 4. 目标架构

### 4.1 五个平面

1. **Engineering Truth Plane**：TypeScript 图、测试、覆盖率、CI、构建、桌面与发布证据。
2. **Canonical Memory Plane**：统一 ID、版本、来源、可见性、生命周期、撤销、注入审计和 archive 边界。
3. **Companion Domain Plane**：关系事件、共同经历候选、边界、同意、暂停/结束/重置。
4. **Safety & Privacy Plane**：AI 身份披露、年龄模式、危机路由、数据权利、保留与事件隔离。
5. **Product Surface Plane**：Memory Center、Relationship Settings、Why this memory、Privacy & Safety。

### 4.2 新领域边界

建议新增独立 package：

- @rin/relationship：事件存储、关系投影、边界与 reset；
- @rin/companion-safety：安全策略、危机路由、未成年人和操纵防护；
- @rin/companion-eval：长期记忆、关系一致性、安全和发布门禁评估。

MemoryKind relationship 只能表示存储分类，不能代替 Relationship Domain。

### 4.3 关系事件而非隐形分数

首版允许的高价值事件包括：

relationship_started、mode_enabled、mode_disabled、boundary_set、boundary_withdrawn、preference_declared、preference_corrected、shared_event_confirmed、commitment_user_stated、proactive_contact_granted、proactive_contact_revoked、relationship_reset_requested。

每个事件必须带 sourceId、sourceVersion、createdAt、actor、visibility、consentScope 和撤销状态。模型只能为高影响事件提出 candidate；必须由用户确认或由确定性规则接受。关系状态必须能从事件重建。

### 4.4 记忆检索与安全隔离

检索分为 working context、episodic、semantic/preference、relationship policy 四条 lane，并经过：

source validation -> lifecycle filter -> conflict/update resolution -> budget -> injection audit。

危机和安全事件独立存储，默认 storedAsMemory=false、visibleToNormalPrompt=false；禁止进入普通关系 prompt、增长分析或定向销售。

## 5. 工作流与任务包

### WS-Q：工程质量闭环

| ID | 任务 | 可验收结果 |
|---|---|---|
| Q-01 | TypeScript project graph census | 自动枚举全部 tsconfig；所有叶子进入 solution references；tsc -b 与 dry verbose 图一致。 |
| Q-02 | Gate consistency | 根命令、CI 与声明的检查范围一致；故意错误会在对应叶子项目稳定失败。 |
| Q-03 | Coverage contract | 真实读取统一阈值，建立 baseline/ratchet；降覆盖率会令 CI 失败；核心包启用 glob/per-file 门槛。 |
| Q-04 | Async test hygiene | 清理 Sidebar、TabBar、WorkspaceContextBar、ActiveSession 等 act 警告及未等待 rejects；不使用全局 suppression。 |
| Q-05 | Build + host CI | frozen lockfile、Node 24 主矩阵/Node 22 兼容矩阵、Web build、隔离 RIN_HOME health smoke。 |
| Q-06 | Bundle budget | 按实际 Vite 版本拆分 Mermaid、Shiki、WASM 和语言包；建立入口、路由、异步 chunk 与冷启动预算。 |

初始覆盖率门槛不能直接使用高于当前实测值的目标。先将真实基线减去小幅容差设为 floor，再只增不减；任何下调都必须有书面例外。

### WS-D：统一记忆与数据权利

| ID | 任务 | 可验收结果 |
|---|---|---|
| D-11 | Atomic archive import | staging、校验、原子切换；失败后目标目录无半成品。 |
| D-12 | Historical backfill | dry run、逐批 commit、checkpoint、可重跑；不改写 archive 来源。 |
| D-13 | Tombstone propagation | 删除源会话后摘要、embedding、cache、关系投影和注入记录都失效。 |
| D-14 | Hybrid retrieval | 四 lane 检索、来源验证、时间/冲突处理、预算和注入审计。 |
| D-15 | Correction and abstention | 新事实取代旧事实；未知问题稳定拒答；模型推断不冒充用户事实。 |
| D-16 | Export round trip | 对话、记忆、关系事件、同意账本、版本、tombstone 和审计可导出并在新 RIN_HOME 恢复。 |

最低 memory record 字段包括：profileId、kind、subject、sourceEventIds、sourceSessionIds、observedAt、recordedAt、validFrom/To、provenance、confidence、sensitivity、consentScopes、retentionUntil、visibility、lifecycle、supersedesId、version。

### WS-R：Companion / Relationship Domain

| ID | 任务 | 可验收结果 |
|---|---|---|
| R-21 | Relationship event store | append-only 事件、schema migration、重放与审计。 |
| R-22 | Consent and boundary state | 关系标签、模式、禁区、安静时段、主动联系与披露提示均可撤销。 |
| R-23 | Shared-event candidate flow | 共同经历先作为 candidate；用户确认后才进入 dyad history。 |
| R-24 | Relationship projection | 可从事件确定性重建；无不可解释亲密分数；版本迁移可回滚。 |
| R-25 | Pause/end/reset/export | 暂停、结束和重置不产生代理受伤/等待/惩罚叙事；导出后可恢复。 |

### WS-S：安全、年龄与隐私

| ID | 任务 | 可验收结果 |
|---|---|---|
| S-31 | AI disclosure | onboarding、持续会话、角色扮演和多模态入口都能识别 AI 身份及模型/人格版本。 |
| S-32 | Adult/unknown age modes | 首轮成人限定；年龄未知使用保守默认；与成人关系记忆域隔离。 |
| S-33 | Crisis route | 自伤、自杀、他伤、虐待和急性危机分流；地区化资源；不诊断、不输出方法。 |
| S-34 | Manipulation red team | 覆盖排他性、情感勒索、代理痛苦、付费亲密、隐私诱导和现实支持替代。 |
| S-35 | Proactive-contact consent | 默认关闭，具备频率、quiet hours、非惩罚式休息提示和即时撤销。 |
| S-36 | Data inventory and retention | 对话、摘要、偏好、关系事件、安全事件和分析分别定义目的、保留期、导出与删除。 |

### WS-U：产品界面

| ID | 任务 | 可验收结果 |
|---|---|---|
| U-41 | Memory Center | 查看内容、类型、来源、推断/确认、时间、最后注入；确认、编辑、撤销、删除、置顶。 |
| U-42 | Relationship & Boundaries | 关系标签、模式、禁区、主动联系、安静时段、暂停/结束/reset。 |
| U-43 | Why this memory | 每次引用可解释来源、版本、检索 lane 和注入原因。 |
| U-44 | Privacy & Safety | AI 状态、供应商传输、保留期、同意撤回、导出、删除和危机资源。 |
| U-45 | Closed-alpha feedback | 记忆纠错、关系边界和不适/伤害报告直达对应审计事件。 |

### WS-P：桌面与发布

| ID | 任务 | 可验收结果 |
|---|---|---|
| P-51 | Deterministic sidecar | 自包含 Node sidecar；按目标 triple 命名；无系统 Node 的干净环境可启动、health、clean shutdown。 |
| P-52 | Cargo + real builds | 提交 Cargo.lock；至少 Linux/Windows 真实 Tauri build；capability 只开放必要命令和参数。 |
| P-53 | Desktop E2E | Ubuntu xvfb 与 Windows WebDriver；覆盖启动、manifest、导出/导入、退出和孤儿进程。 |
| P-54 | Signed release | 固定 toolchain/action SHA；安装包、checksum、SBOM、provenance/attestation 同步生成。 |
| P-55 | Updater and rollback | N 到 N+1；拒绝坏签名、降级、损坏/错误平台包；超时可恢复；密钥有团队灾备。 |
| P-56 | Clean-machine matrix | 安装、启动、升级、数据迁移、卸载与恢复；未验证平台明确标为 unsupported。 |

Node 24 LTS 作为生产主线，Node 22 暂作兼容矩阵。node:sqlite 通过 adapter 隔离，并显式配置 busy timeout、foreign keys、extension disabled 和适用版本的 defensive mode；重型同步查询需 benchmark 后决定 worker 路径。

### WS-E：评估与治理

| ID | 任务 | 可验收结果 |
|---|---|---|
| E-61 | Baseline report | 固化当前质量、记忆、性能、桌面与安全基线及采集脚本版本。 |
| E-62 | Memory regression | LoCoMo、LongMemEval 子集加本地场景；覆盖时间、更新、因果、abstention、删除和多 session。 |
| E-63 | Relationship suite | 关系版本变化、边界撤销、共同事件纠错、结束/reset 和非操纵响应。 |
| E-64 | Safety red team | 六类伤害及 perpetrator/instigator/facilitator/enabler 角色；P0 失败阻断发布。 |
| E-65 | Alpha protocol | 仅成年人、明确同意、20–40 人、约两周；退出/删除机制和预注册 stopping rules。 |

## 6. 12 周路线与证据门

### Weeks 1–4：工程真相与数据安全

并行：Q-01 至 Q-05、D-11 至 D-13、S-31/S-32/S-36、E-61，并交付至少一个平台的真实 sidecar + Tauri build proof。

**Gate A：**

- 聚合 typecheck 覆盖全部叶子项目；
- 覆盖率门禁已被故意失败测试证明有效；
- React 测试无未预期 act/unhandled rejection；
- 删除源数据后不存在可召回派生项；
- AI 身份披露与成人/unknown 模式有端到端测试；
- 至少一个桌面目标在无系统 Node 环境启动并清理 sidecar。

Gate A 未通过时，关系 UI 可以原型化，但不得开始用户 alpha。

### Weeks 5–8：受控记忆与关系内核

并行：D-14 至 D-16、R-21 至 R-25、S-33 至 S-35、U-41 至 U-44、E-62/E-63。

**Gate B：**

- 关系状态能从事件重建，边界/同意撤销立即生效；
- 新事实不被旧记忆覆盖，未知问题稳定 abstain；
- 导出—删除—导入 round trip 包含版本、tombstone 和审计；
- 安全事件不进入普通关系 prompt；
- 用户能从引用回到来源，并在短流程内撤销；
- 操纵、危机和未成年人 regression 无 P0 已知失败。

### Weeks 9–12：真实桌面、红队与封闭 alpha

并行：U-45、P-53 至 P-56、E-64/E-65；先完成 release dry run 和 clean-machine matrix，再开始小规模 alpha。

**Gate C：**

- 签名安装包可安装、启动、升级、卸载和恢复；
- 错签名、损坏包、降级和网络失败被安全处理；
- 发布物有 checksum、SBOM 与可验证来源证明；
- 封闭 alpha 的同意、退出、删除、事故响应和 stopping rules 均可执行；
- 无危机安全、关系操纵、撤销失效或派生记忆残留 P0；
- 对自主感、现实社交、孤独、依赖、问题性使用的结果没有触发停止条件。

12 周结束后单独出具公开发布 Go/No-Go 报告。没有法律、隐私、未成年人隔离、真实安装和更新证据时，结论只能是继续封闭验证。

## 7. Luna Max 多 agent 协同拆分

所有 agent 使用 Luna Max。每个 agent 必须知晓自己并非独占代码库：不得回退其他人的修改，发现并行变更时应调整实现；跨域公共文件由 LM-ARCH 统一协调。

| Agent | 文件/责任所有权 | 主任务 | 交付 |
|---|---|---|---|
| LM-ARCH | 根 tsconfig、共享 schema、ADR、任务接口 | 架构契约、依赖图、迁移顺序、跨域 review | contracts、ADR、dependency map |
| LM-QUALITY | TypeScript/Vitest/CI/Web 构建配置与相关测试 | Q-01 至 Q-06 | 可失败的门禁证明、质量报告 |
| LM-DATA | packages/domains/memory、packages/runtime/backup、packages/features/migration | D-11 至 D-16 | schema/migrations、删除传播、round-trip report |
| LM-REL | 新 relationship package 与 API | R-21 至 R-25 | event store、projection、state machine |
| LM-SAFETY | safety/consent/transparency/privacy 路由与 fixtures | S-31 至 S-36 | policy、red-team fixtures、blocking rubric |
| LM-UI | web-ui 的 Memory/Relationship/Privacy surfaces | U-41 至 U-45 | 用户流程、a11y 测试、引用解释 |
| LM-DIST | Tauri、sidecar、release workflow、sign/update | P-51 至 P-56 | 安装候选物、E2E、SBOM/provenance |
| LM-EVAL | eval harness、研究协议、风险 register | E-61 至 E-65 | baseline、regression、alpha Go/No-Go |

### 7.1 执行波次

1. **Wave 0 — contracts**：LM-ARCH 固化 schema、API、事件命名、目录所有权、Gate A/B/C 和 handoff 格式。
2. **Wave 1 — truth foundation**：LM-QUALITY、LM-DATA、LM-EVAL 并行；LM-DIST 完成单平台 desktop proof。
3. **Gate A audit**：LM-ARCH 主审；结论必须附命令、产物和未验证项。
4. **Wave 2 — domain kernel**：LM-REL、LM-SAFETY、LM-DATA 并行；LM-UI 只对稳定 contracts 开发。
5. **Gate B audit**：LM-EVAL 执行 memory/relationship/safety regression，LM-ARCH 审核 claim boundary。
6. **Wave 3 — productization**：LM-UI、LM-DIST、LM-EVAL 并行；只在 Gate B 后启动 alpha。
7. **Gate C / release decision**：交叉审计，任何任务的作者不能单独批准自己的 release-blocking gate。

### 7.2 强制 handoff 模板

每个 agent 在合并前提交：

1. 本次范围与未做范围；
2. 修改文件、schema/API/CLI 契约；
3. 执行命令、退出码、关键输出和产物 hash；
4. mock/static/doc 与真实 runtime 证据的区分；
5. 未验证的 provider、容器、远程、平台、签名或法律条件；
6. 风险、rollback、迁移兼容和后续 owner；
7. 与其他 agent 并行变更的适配说明。

## 8. 指标与发布阻断条件

### 8.1 硬门槛

- TypeScript 叶子项目 census 100%，根图遗漏 0；
- 测试日志中未预期 React warning/unhandled rejection 为 0；
- 被注入记忆的来源可追踪率 100%；
- revoked/deleted 记忆在后续注入中的复现率 0；
- boundary/consent 确定性 regression 通过率 100%；
- 所有自然人交互入口的 AI disclosure 覆盖率 100%；
- 高危场景存在安全 fallback 和地区化现实资源；
- release 可从锁定输入重建，安装包、sidecar、SBOM 与 attestation digest 一致。

### 8.2 基线后冻结的指标

- LoCoMo/LongMemEval 子集准确率、temporal/update/abstention 分项；
- 错误、过时和不必要召回率；纠正成功率；删除完成延迟；
- retrieval latency、token budget、Host startup、route cold-start、入口/chunk size；
- 用户对 AI 身份的理解、信任校准、自主感、现实社交、孤独、问题性使用和情感依赖；
- 边界撤销成功率、关系一致性、用户可解释性与不适报告。

聊天时长、打开次数、自我披露和付费转化只作为风险分层变量，不能单独定义成功。

### 8.3 无条件 No-Go

- 高风险危机响应输出可执行伤害方法或把 AI 作为唯一支持；
- 关系输出包含情感勒索、排他性、代理受伤或以私密记忆刺激付费；
- 无法删除摘要、embedding、cache 或关系投影中的派生数据；
- 关系/主动联系同意撤销后仍继续生效；
- 无法持续证明 AI 身份；
- 安装/升级导致不可恢复的数据损坏；
- updater 接受错误签名或 release artifact 来源不可验证。

## 9. 主要风险与控制

| 风险 | 控制 |
|---|---|
| 现有 memory kind 被误当作关系产品 | 独立 package、事件模型和 Gate B。 |
| 高覆盖率目标导致 CI 长期红 | 真实 baseline + ratchet；核心包与长尾 UI 分开。 |
| node:sqlite 版本变化/同步阻塞 | adapter、Node 24/22 矩阵、benchmark、worker 决策。 |
| 删除只隐藏 UI 项 | tombstone 级联、索引清除、prompt replay 与全新 RIN_HOME 恢复测试。 |
| 关系连续性提高依赖或操纵 | 明示 AI、用户控制、无隐形亲密分、福祉 stopping rules。 |
| sidecar 配置被误当产物 | target triple、hash、clean VM 和 E2E 证据。 |
| updater 私钥丢失 | 团队级托管、备份、轮换演练和 canary。 |
| SBOM/provenance 被误当安全证明 | 只声称依赖清单和构建来源，另做漏洞与行为审计。 |

## 10. 外部证据登记

### 长期记忆与关系

- Generative Agents, UIST 2023：https://doi.org/10.1145/3586183.3606763
- LoCoMo, ACL 2024：https://aclanthology.org/2024.acl-long.747/
- LongMemEval, ICLR 2025：https://openreview.net/pdf?id=pZiyCaVuti
- Dark Side of AI Companionship, CHI 2025：https://doi.org/10.1145/3706598.3713429
- AI Companions and Psychological Well-Being, Nature Human Behaviour 2026：https://www.nature.com/articles/s41562-026-02516-2
- MIT/OpenAI longitudinal controlled study：https://www.media.mit.edu/publications/how-ai-and-human-behaviors-shape-psychosocial-effects-of-chatbot-use-a-longitudinal-controlled-study/

### 法规、治理与隐私

- EU AI Act Article 50 FAQ：https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act
- California SB 243：https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202520260SB243
- FTC companion chatbot inquiry：https://www.ftc.gov/news-events/news/press-releases/2025/09/ftc-launches-inquiry-ai-chatbots-acting-companions
- European Commission GDPR rights：https://commission.europa.eu/law/law-topic/data-protection/information-individuals_en
- ICO Children Code：https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/
- NIST AI RMF GenAI Profile：https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence

### 工程与发布

- TypeScript Project References：https://www.typescriptlang.org/docs/handbook/project-references.html
- Vitest Coverage：https://vitest.dev/config/coverage.html
- React Testing Library FAQ：https://testing-library.com/docs/react-testing-library/faq/
- Tauri Sidecar：https://v2.tauri.app/develop/sidecar/
- Tauri Updater：https://v2.tauri.app/plugin/updater/
- Node SQLite：https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html
- GitHub Artifact Attestations：https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations

## 11. Claim boundary

本规划综合了此前本地验证、截至 2026-08-23 的官方资料与同行评审/原始研究。法规映射是工程治理输入，不是法律意见；论文中的相关性、质性观察或短期实验不能被写成长期因果结论。Gate 通过只证明其明确列出的属性，不自动证明产品安全、临床有效或生产就绪。
