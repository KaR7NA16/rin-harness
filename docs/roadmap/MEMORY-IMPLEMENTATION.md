# Rin 统一记忆系统实施主计划

> 状态：Active
>
> 日期：2026-08-27
>
> 目标权威：[MEMORY-BLUEPRINT.md](../architecture/MEMORY-BLUEPRINT.md)
>
> 本文是记忆系统唯一的执行拆解。它把蓝图中的统一记忆连续体、状态转移、召回动力学、
> 巩固机制和行为反馈模型映射到当前仓库。若本文与旧版 [ACTIVE.md](ACTIVE.md) 中的
> 四路检索、独立关系包、关系事件表或周计划冲突，以本文为准。

## 1. 要达到的运行结果

完成后，Rin 的记忆不是一组可被任意 CRUD 的文本条目，也不是 Prompt Memory、会话搜索、
关系字段、技能文件和 embedding 索引的并集，而是一个持续演化、可重放、可检验的认知状态：

1. 每次交互进入同一条认知事务，先形成场景和观察，再产生解释、关联、预测和行动；
2. 回忆由线索扩散、抑制竞争、冲突保留和工作空间选择共同决定，不由单一相似度排序决定；
3. 被使用的记忆进入重巩固窗口，新证据可以强化、修正、分裂、争议或取代它；
4. 自我、他人、关系、行为倾向、开放回路和未来模拟是同一记忆场中的不同表示形态；
5. 行动结果反向更新预测、表示、关联和行为倾向，使记忆真正参与后续行为；
6. 任意进入模型上下文的记忆影响都能从认知事务重建；
7. 自动过程只有衰减、抑制、归档、修正建议和影响限制权，没有硬擦除权；
8. 硬擦除只接受记忆所有者的明确授权，并只重算授权范围实际支持的派生影响。

这八项必须作为一个系统成立。任何单独的向量检索、摘要、profile、关系分数、技能提取或
删除传播，都不能被报告为“统一记忆系统已实现”。

## 2. 不可退让的实施约束

### 2.1 单一状态所有者

`packages/domains/memory` 是唯一认知状态所有者。scene、structure、self model、
person model、relationship model、disposition、open loop 和 prospect 不创建独立
package、数据库或生命周期。

- `@rin/host` 只装配和驱动，不保存认知状态；
- `@rin/contracts` 只暴露命令、查询 DTO 和错误码；
- `@rin/context` 只消费已经选出的工作空间并处理模型预算，不决定记忆真实性；
- `@rin/knowledge` 提供外部知识候选和只读图，不成为 Rin 经历的写入者；
- `@rin/evolution` 消费 disposition 的公开投影生成技能工件，不再拥有第二套学习真相；
- `apps/web` 只能通过意图明确的 API 观察或请求改变认知状态。

### 2.2 不建兼容层

当前 `MemoryItem`、通用 `POST /api/memory`、直接 `DELETE /api/memory/:id` 和
schema v1 是待替换接口，不是新系统必须兼容的抽象。v2 落地时：

- 新运行时拒绝把 v1 数据库当作 v2 打开；
- 不保留双写、双读、旧 DTO 翻译器或长期 feature flag；
- 若以后确有历史数据需要保留，另做一次显式导入，把可确认的旧记录转为认知事件；
- 导入失败不阻止新内核按正确语义构建。

### 2.3 不把实现拆成项目拼盘

外部项目只贡献已经吸收进蓝图的机制认识，不按项目名建立 adapter、vendor domain、
reference implementation 或 source-specific module。运行代码只使用 Rin 自己的类型、
状态转移和数据流。

同样，不为每一种表示形态创建一套 service/repository/schema。只有当一段代码拥有独立
不变量、事务边界或性能模型时才分离；文件数量不是架构目标。

### 2.4 支持关系是认知结构，不是文档负担

系统需要知道“哪些观察支持了哪些判断”，否则无法重巩固、处理冲突或限定擦除传播。
这不是给每个小功能附加来源文件和边界说明，而是在同一认知事务中自动写入的
`support / derive / contradict / supersede` 关系。它与表示和事件一起提交，不由开发者
手工维护，也不产生旁路台账。

### 2.5 语义正确先于迁移与性能

实施顺序由认知依赖决定，不按“最容易迁移”或“最便宜兼容”排序。性能优化只能发生在
状态语义、重放和评估场景稳定之后；embedding、缓存和摘要均为可丢弃投影。

## 3. 当前系统到目标系统的替换关系

| 当前实现 | 当前作用 | 目标位置 | 处理 |
|---|---|---|---|
| `MemoryItem` catalog | ID、版本、生命周期、注入审计 | 表示、状态、链接、事件和认知事务 | 整体替换，不扩充成巨型 record |
| Prompt Memory 文件 | 模型可见静态投影 | 当前工作空间的展示/启动投影 | 改为只读生成物；不再充当自我模型 |
| Session Search | FTS/LIKE 会话候选 | 场景形成的输入与召回候选索引 | 保留索引能力，重写其认知角色 |
| Skill Memory | 技能文件与 gate | disposition 的可执行投影 | canonical 状态回到 memory |
| Knowledge graph | 跨来源只读图 | 外部知识候选 | 不写 Rin 的经历、自我或关系状态 |
| Evolution candidate store | 候选技能生命周期 | disposition 导出与人工审查 | 去除重复的学习状态所有权 |
| generic memory routes | 任意条目 CRUD | 意图命令与认知查询 | 删除旧路由，无兼容 shim |
| injection audit | 记录进入 prompt 的 memory | recall/workspace cycle 重建 | 升级为完整选择证据，不只记 ID |
| tombstone | revoke/delete | 影响限制与授权擦除 | 拆清语义，禁止自动 hard erase |

替换不是先保留旧系统再在外面包一层。每个阶段都必须切断对应旧写入口，确保同一种状态
在任一时刻只有一个权威写路径。

## 4. 物理架构与职责

### 4.1 包级边界

`@rin/memory` 内部保持一个领域内核。下表是必须在代码中保持清楚的职责，不是要求
预先创建五个目录、五套 service 或每项一个文件：

| 单元 | 职责 | 禁止 |
|---|---|---|
| model | ID、表示形态、五轴状态、动态量、链接和不变量 | SQLite、HTTP、prompt 拼接 |
| events | 命令、事件、认知事务、确定性校验 | 直接读写投影 |
| store | schema v2、事务提交、快照、重放、查询索引 | 决定召回或巩固策略 |
| engine | 场景形成、召回、工作空间、巩固、反馈和擦除传播 | HTTP DTO、UI 状态 |
| projections | prompt、session-search、skill、调试视图 | 反向成为 canonical writer |

物理上先重写现有 `src/types.ts`、`src/store.ts` 和 `src/projection.ts`，其余职责
可以在同一领域内核中实现；只有独立不变量、事务边界或性能模型已经出现，才提取新的
实现文件。不得为了“分治”预建目录，不得按 scene/self/person/relationship 各复制一套
types/service/repository/schema 文件树。

### 4.2 运行链

~~~text
session/runtime event
        │
        ▼
cognitive command ──► validate ──► one cognitive transaction
        │                              │
        │                              ├─ append domain events
        │                              ├─ update materialized state
        │                              ├─ update support/link graph
        │                              └─ mark projections dirty
        ▼
current field ──► recall cycle ──► coalition ──► workspace
                                                │
                                                ▼
                                      context budget + model
                                                │
                                                ▼
                              prediction/action/outcome/feedback
                                                │
                                                └─► next transaction
~~~

事件日志与物化状态在同一个 SQLite 事务中提交。投影可以异步重建，但 canonical commit
不能依赖投影成功；模型调用前必须等待该轮工作空间投影完成。

## 5. 领域模型

### 5.1 标识

首轮使用 branded string ID，禁止在领域内部混用裸字符串：

- `MemoryOwnerId`
- `CognitiveTransactionId`
- `EventId`
- `SceneId`
- `RepresentationId`
- `LinkId`
- `RecallCycleId`
- `WorkspaceCycleId`
- `ActionId`
- `EraseAuthorizationId`

所有 ID 在事务入口生成。事件序号使用数据库单调递增整数承担重放顺序；时间戳只表达
发生时间，不承担全序。

### 5.2 表示与状态

`RepresentationForm` 固定为：

- `scene`
- `structure`
- `self_model`
- `person_model`
- `relationship_model`
- `disposition`
- `open_loop`
- `prospect`

每个 `MemoryRepresentation` 由内容、适用情境、时间区间、五个正交状态轴和动态量组成：

| 轴 | 值 |
|---|---|
| persistence | transient / encoded / durable / archived / erased |
| activation | dormant / primed / active / workspace |
| integration | raw / linked / consolidating / integrated |
| epistemic | observed / inferred / hypothesized / contested / superseded / rejected |
| influence | permitted / restricted / blocked / revoked |

动态量至少包括 `salience`、`appraisal`、`affect`、`confidence`、`stability`、
`accessibility`、`utility` 和 `validity interval`。它们必须独立更新：

- recall 次数可以改变 accessibility，不得直接提高 confidence；
- 情绪显著性可以提高激活，不得把 hypothesized 变为 observed；
- superseded 改变当前适用性，不删除历史表示；
- revoked 立即阻断影响，不自动改变 persistence 为 erased。

### 5.3 场景

`Scene` 是跨事件的经历单元，不等同于 session。它包含参与者、地点/媒介、目标、
张力、关键观察、行动、结果、未解决问题和时间边界。

场景形成器必须支持：

- 一个 session 内多个场景；
- 一个场景跨多个 session 延续；
- 新事件延伸当前场景；
- 情境突变关闭旧场景并开启新场景；
- 开放回路把未来事件重新连接到原场景。

### 5.4 链接

`MemoryLink` 至少支持：

- temporal-before / temporal-overlap
- part-of / continues
- supports / derives
- contradicts / supersedes
- similar-to / context-of
- caused-by / predicts
- actor-of / about-person
- shared-with / relationship-context
- action-led-to / feedback-for
- simulates

链接有强度、适用区间和状态，但不复制表示正文。support/derive 链是重巩固、冲突处理和
授权擦除传播的计算依据。

### 5.5 当前场与工作空间

`CurrentField` 是每轮认知的即时状态：当前场景、目标、活动参与者、情绪/生理代理量、
开放回路、环境约束和最近反馈。

`MemoryCoalition` 是一次 recall cycle 中共同获胜的一组表示与链接。工作空间保存联盟，
不是若干独立 top-k 条目。一个联盟可以同时包含支持、冲突、不确定性和未解决问题。

### 5.6 行为反馈

`FeedbackVector` 至少表达：

- 目标是否推进；
- 用户是否接受、纠正、拒绝或忽略；
- 预测误差；
- 关系边界是否被尊重；
- 行动代价；
- 延迟结果；
- Rin 对结果的当前解释及其 epistemic 状态。

反馈不能直接改写人格字段；它先关联到 action、prediction、scene 和 disposition，再由
巩固事务决定强化、修正或分裂。

### 5.7 擦除授权

`EraseAuthorization` 必须包含 owner、精确 scope、预览时的根表示/场景、预期派生集合、
确认时刻、一次性 nonce 和过期时刻。

授权不允许使用“所有相关内容”之类无法确定的 scope。提交前重新计算实际派生集合：

- 新增派生超出预览范围时，原授权失效并要求重新确认；
- 无认知依赖的相邻场景不得因相似度或同一人物被扩展擦除；
- 自动任务、模型工具调用、插件和安全策略不能创建有效授权；
- revoke/restrict/archive 不需要伪装成 erase，也不能在后台升级。

## 6. 命令、事件与认知事务

### 6.1 命令边界

只有确定性 controller 可以提交命令。模型可以产生候选解释和候选变化，但不能直接写库。

首轮命令：

- `ObserveRuntimeEvent`
- `AdvanceCurrentField`
- `RunRecall`
- `OpenReconsolidation`
- `CommitConsolidation`
- `RecordPrediction`
- `RecordAction`
- `RecordOutcome`
- `ApplyFeedback`
- `CorrectUnderstanding`
- `RestrictInfluence`
- `RevokeInfluence`
- `RequestErasePreview`
- `AuthorizeErase`
- `CommitAuthorizedErase`

每个命令经过 schema 校验、owner 校验、前置状态检查和领域不变量检查，成功后产生一个
`CognitiveTransaction`。失败不得部分更新任何表或投影 checkpoint。

### 6.2 事件集合

事件流至少包含：

- `RuntimeEventObserved`
- `SceneOpened` / `SceneExtended` / `SceneClosed`
- `RepresentationFormed`
- `RepresentationRevised`
- `RepresentationSplit`
- `RepresentationContested`
- `RepresentationSuperseded`
- `RepresentationRejected`
- `LinkFormed` / `LinkWeakened`
- `RecallCycleCompleted`
- `WorkspaceCoalitionSelected`
- `PredictionRecorded`
- `ActionRecorded`
- `OutcomeRecorded`
- `FeedbackApplied`
- `ConsolidationCommitted`
- `InfluenceRestricted` / `InfluenceRevoked`
- `ErasePreviewCreated`
- `EraseAuthorized`
- `AuthorizedEraseCommitted`

事件 payload 保存发生的状态变化和算法版本，不重复保存整张物化快照。

### 6.3 哪些动态需要记录

不记录每一次神经式激活浮动。一次 recall cycle 记录足以重建模型可见影响的内容：

- 输入线索和 current field 版本；
- 候选生成器及索引版本；
- 候选表示 ID；
- 评分分量；
- 抑制/冲突/预算处理；
- 最终 coalition；
- 工作空间序列化版本；
- 进入模型上下文的实际内容哈希与顺序。

这既能审计模型看到了什么，也避免把每个浮点变化写成事件洪水。

## 7. SQLite v2

### 7.1 canonical 表

| 表 | 关键内容 |
|---|---|
| `cognitive_meta` | schema version、owner、事件序号、算法版本 |
| `cognitive_transactions` | command、actor、started/committed、result |
| `cognitive_events` | seq、transaction、type、payload、occurred_at |
| `scenes` | 场景边界、当前状态、时间范围 |
| `representations` | form、content、context、五轴状态、动态量、版本 |
| `links` | typed edge、强度、状态、有效区间 |
| `current_field` | owner 当前认知场的唯一物化行 |
| `recall_cycles` | 线索、算法版本、候选摘要、选择结果 |
| `workspace_members` | cycle 内表示/链接、顺序、角色和分数 |
| `erase_authorizations` | scope、preview hash、nonce、expiry、consumed |
| `projection_checkpoints` | 投影名、最后事件 seq、版本、dirty 状态 |

action、prediction、outcome 和 feedback 作为 typed representation/link/event 表达，首轮不另建四套
业务表。只有实际查询和约束证明统一表示无法承担事务需求时才新增物化表。

### 7.2 索引与投影

以下全部可从 canonical 表重建：

- scene/representation FTS；
- embedding 向量索引；
- prompt/workspace 序列化；
- session-search 视图；
- skill/disposition 工件；
- Web 调试查询；
- knowledge cross-source read model；
- recall cache。

投影不得拥有只能存在于自身的认知状态。重建后必须得到相同的候选集合语义；近似向量搜索
允许排序有界差异，但最终 coalition 测试使用固定候选和确定性 scorer。

### 7.3 事务与故障

每个认知命令使用 `BEGIN IMMEDIATE`：

1. 读取当前 event seq 和相关状态版本；
2. 校验前置状态；
3. 插入 transaction；
4. 追加事件；
5. 更新 materialized state/link；
6. 标记受影响 projection dirty；
7. 提交。

进程在第 3–6 步崩溃必须整体回滚。投影更新失败不回滚 canonical commit，但在投影恢复前
禁止把过期投影用于模型输入。启动时执行 invariant check 和 checkpoint catch-up。

## 8. 召回动力学的运行实现

### 8.1 候选生成

候选来自统一场中的多种线索，不是四个固定 lane：

- 当前场景参与者、目标、情绪和开放回路；
- 时间/地点/主题/行动线索；
- typed link 邻域扩散；
- FTS 和 embedding；
- 最近被纠正或争议的表示；
- 当前行为所需的 disposition；
- 未完成预测和延迟结果。

候选生成只扩大搜索范围，不决定进入工作空间。

### 8.2 评分分量

每个候选的激活分数由可独立观测的分量构成：

`cue fit + contextual fit + accessibility + salience + utility + open-loop pressure
+ relation relevance + prediction relevance - inhibition - contradiction cost
- uncertainty penalty - invalidity penalty`

权重属于算法版本，不写进单条记忆。confidence 参与不确定性表达和竞争，但不能被相似度
覆盖。高激活、低置信表示可以进入 coalition，必须带着不确定性进入。

### 8.3 联盟选择

选择目标不是最大化独立分数总和，而是在预算内形成能解释当前任务的联合结构：

- 包含必要的场景背景；
- 支持与冲突不能被静默拆开；
- self/person/relationship model 只在当前行为相关时进入；
- open loop 可提高相关历史场景的联盟收益；
- prospect 必须保持 hypothesized；
- 低置信关键项附带 uncertainty surface；
- 同一事实的重复摘要不得通过数量垄断预算。

### 8.4 接入模型

`@rin/memory` 输出 typed workspace；`@rin/context` 只做 token budget 编排和序列化，
不得删掉冲突状态、epistemic 标签或影响限制。Host 在发起模型调用前，把最终 workspace
及其 hash 写入当前 session 的模型输入日志。

模型响应后，Host 只提交发生事实、候选解释、prediction 和 action。候选解释必须经过
engine 校验/巩固，不得直接成为 observed。

## 9. 巩固、重巩固与遗忘

### 9.1 在线形成

每次交互结束前完成低延迟形成：

- 关闭或延展 current scene；
- 保存 observation/action/outcome；
- 形成必要的 raw representation；
- 建立直接 temporal/actor/action 链；
- 更新 current field 和 open loop；
- 不在在线路径做大规模归纳。

### 9.2 离线巩固

巩固由事件积累、开放回路、睡眠/空闲窗口或显式维护触发，但触发器没有硬擦除权。每轮：

1. 选取尚未 integrated 的场景和最近进入 labile 的表示；
2. 聚合跨场景重复、差异和冲突；
3. 产生 structure/self/person/relationship/disposition 候选；
4. 检查独立支持、时间变化和适用情境；
5. reinforce、revise、split、contest、supersede 或 reject；
6. 原子提交表示、链接和状态；
7. 使旧投影失效并重建。

重复出现只能增强 accessibility/stability；只有新增独立证据可以改变 confidence。

### 9.3 重巩固

被实际用于回答、预测或行动的表示进入短暂 labile 状态。新结果到达时：

- 原记忆内容保留；
- 新解释通过 revised/derived/supersedes 链加入；
- 误召回形成负反馈，降低相应 cue-link；
- 用户纠正优先改变当前适用解释，但不伪造过去观察；
- 延迟 outcome 必须回连原 action/prediction 后再更新 disposition。

### 9.4 遗忘

自动遗忘只改变 activation、accessibility、link strength 或 persistence=archived。
真实性不因不常访问而下降。归档内容退出普通候选生成，但历史查询和明确线索仍可恢复。

## 10. API 与 UI 替换

### 10.1 API

删除通用写接口，替换为意图路由：

查询：

- `GET /api/memory/field`
- `GET /api/memory/scenes`
- `GET /api/memory/scenes/:id`
- `GET /api/memory/representations/:id`
- `GET /api/memory/recall/:cycleId`
- `GET /api/memory/export`

用户控制命令：

- `POST /api/memory/corrections`
- `POST /api/memory/influence/restrict`
- `POST /api/memory/influence/revoke`
- `POST /api/memory/erase/preview`
- `POST /api/memory/erase/authorize`
- `POST /api/memory/erase/commit`

运行时内部命令不暴露给 Web。Web 不能直接创建 self/person/relationship 表示，也不能把模型
建议当作 owner 授权。

### 10.2 Memory Center

Memory Center 不是条目编辑表。首轮界面按认知对象组织：

- 当前场：Rin 当前认为正在发生什么、目标和开放回路；
- 场景：经历时间线及其后续理解；
- 理解：structure/self/person/relationship/disposition，显示观察、推断、假设和争议；
- 回忆解释：某次回答为何激活这些内容，哪些冲突被保留；
- 用户控制：纠正、限制影响、撤销影响、导出和授权擦除；
- 擦除预览：准确根范围、会失效的派生影响、不受影响的内容和授权有效期。

UI 不提供“直接修改数据库字段”。纠正形成新事件；历史版本仍可查看。硬擦除流程必须在
preview 与 authorize 之间展示确定范围，commit 只消费一次性授权。

## 11. 依赖驱动的实施波次

这些是依赖波次，不是周计划。一个波次只有通过退出门才允许下一个波次把它当作可靠基础。

### Wave 0：权威收口与旧入口冻结

| ID | 实施 | 主要改动面 | 验收 |
|---|---|---|---|
| M0-01 | 固化蓝图与本文的权威关系 | docs | README、CURRENT、TARGET、ACTIVE 无冲突描述 |
| M0-02 | 标记 generic CRUD、v1 schema、旧四 lane 和独立关系包为替换对象 | docs、contracts、route tests | 新测试不得依赖这些目标语义 |
| M0-03 | 建立认知不变量测试清单 | memory tests | 每条蓝图不变量至少有一个可执行场景 ID |
| M0-04 | 建立 v1 拒绝策略 | memory store tests | v2 runtime 对 v1 给出明确错误，不静默迁移 |

退出门：文档权威唯一；没有任务再以兼容旧 `MemoryItem` 为前置条件。
当前落地证据（2026-08-26）：

- M0-03 已在 [invariants.test.ts](../../packages/domains/memory/tests/invariants.test.ts) 登记 11 个
  唯一场景 ID，并由测试校验来源锚点、断言文本和后续实现波次；这锁定了测试契约，不把
  尚未存在的认知行为误报为已实现。

- M0-02 已冻结旧 generic HTTP 写入：collection POST、revoke POST 和 item DELETE 均返回
  410；只读目录、单项查询、导出和注入审计仍可用。Web client 已移除 generic upsert/revoke/remove
  方法，认知写命令接口留到 Wave 1/7；当前内部 projection writer 暂保留，避免把旧物化结构
  提前误写成新认知内核。
- M0-04 已在 [store.test.ts](../../packages/domains/memory/tests/store.test.ts) 覆盖 v1、未来版本、
  新库和未版本化旧表；store 在建表前拒绝旧 schema，schema 常量已提升为 2。当前
  memory_items 表仍是待 Wave 1 替换的旧物化结构，不把本次版本闸门写成认知内核完成。

### Wave 1：认知内核与可重放存储

依赖：Wave 0。

| ID | 实施 | 主要改动面 | 验收 |
|---|---|---|---|
| M1-01 | branded IDs、八种 form、五轴状态和动态量 | `@rin/memory model` | 非法轴组合在构造/转移时失败 |
| M1-02 | command/event/transaction envelope | memory events、contracts DTO | 模型候选不能构造 owner-only 命令 |
| M1-03 | SQLite v2 schema 与原子 commit | memory store | fault injection 无半事务 |
| M1-04 | materializer 与全量 replay | memory store | 空库重放得到等价状态 hash |
| M1-05 | support/link graph 与版本检查 | memory model/store | 冲突、取代和派生链可查询 |
| M1-06 | 投影 checkpoint 协议 | memory projections | 投影失败被标 dirty，不能进入模型 |

退出门：固定事件流可重复得到相同场景、表示、链接和 current field；v1 写入口尚未进入新内核。

W1 当前落地切片（2026-08-27）：

- M1-01 已完成模型层：packages/domains/memory/src/model.ts 是唯一认知模型入口；
  RinMemory 用同一 envelope 承载 Scene、Structure、SelfModel、PersonModel、
  RelationshipModel、Disposition、OpenLoop、Prospect 八种 form。
- M1-01 已完成五轴状态和动态量校验：非法 persistence/activation/integration/
  epistemic/influence 组合在构造时失败；状态转移返回不可变新值并保持时间单调。
  recall activation 不修改 confidence；model proposal 不能把内容提升为 observed；
  prospect 永远保持 hypothesized；authorized erase 没有进入普通 transition API。
- M1-01 测试覆盖构造、branded IDs、不可变性、合法转移、非法组合和模型输出边界。
- M1-02 已完成：events.ts 定义统一 command/event/transaction envelope、actor authority 和 model candidate 边界，contracts 暴露协议 DTO。
- M1-03 已完成：store.ts 中的 MemoryCognitionDatabase 使用独立 cognition schema marker，在同一 SQLite 文件内以 BEGIN IMMEDIATE 原子提交 transaction/event，并支持幂等重放与故障回滚。
- M1-04 已完成：MemoryMaterializer 将认知事件事务确定性重放为不可变 memory/link 状态，并验证空库重放等价 hash。
- M1-05 已完成：typed support/link graph 进入统一模型与 `memory-linked` 事件；端点版本不匹配会拒绝物化，授权擦除会将关联 active edge 回撤为历史 `retracted`。
- M1-06 已完成协议层：cognition schema v3 使用全局 `event_seq` 和持久 projection checkpoint；提交原子标记 dirty，只有追到当前 journal 尾部的 clean checkpoint 才能通过模型输入 gate。
- M1-06 的运行输入闸门已接入 Prompt seam：canonical cognition state 生成可重建投影，assemble 前后均要求 prompt-memory checkpoint 追到 journal 尾部。
- notes/knowledge/session-search 的独立 projection writer、召回联盟仍属于后续波次；完整 Host 真实会话验收已在 M2 退出门中单独完成，不把本切片误报为完整记忆产品闭环。

### Wave 2：运行事件摄取、场景形成与当前场

M2-01 当前落地切片（2026-08-27）：

- `packages/domains/memory/src/runtime.ts` 将有意义的 session 事件映射为统一的 observation/action/outcome fact，并用确定性认知事务写入 cognition journal。
- 用户真实输入只从 `source.kind=user` 的 `user/message` 形成 observation；assistant message 与 tool call 形成 action；tool result 与 turn end 形成 outcome，失败状态保留在 outcome 中。
- 每个运行事实携带 `dsh-session` runtime locator，session/event seq 可回到原始事件；重复投递复用同一 transaction/event ID，不产生重复认知事实。
- `@rin/memory` 已注册 session/event seam；plugin 注入的 prompt context、step/header/chunk 等机制事件不被伪装成用户经历。
- M2-01 的单事实映射已被 M2-02 的场景状态转移吸收；事实仍保留原始 runtime locator，
  但在线写入不再为每个事件创建孤立 scene。
- M2-02 已完成：默认按 session 连续延展 scene；显式 continuityKey 支持跨 session 延展；
  boundary=open 在同一 scene 事务内关闭旧 scene 并开启新 scene；boundary=close 关闭当前 scene。
  scene revision 只允许按版本游标前进、保留既有 runtime 引用，关闭后的 continuity 不可静默重开。
- M2-03 已完成当前场物化：每个 committed transaction 只产生一个 field.version；
  当前 scene、participants/goals/affect、open-loop/prediction refs 与 uncertainty
  从同一 canonical state 确定性推导，并通过 `/api/memory/field` 提供只读面。
- M2-04 已完成：tool/call 的 callId 形成 Rin open-loop，工具调用与 loop 开启在同一 scene 事务内提交；
  延迟 tool/result 按 origin correlationKey 解析原 loop，不修改后来成为当前场的新 scene。
- M2-05 已完成：\`createModelProposalTransaction\` 将模型解释写成单一
  \`memory-proposed\` 认知事务；候选强制保持 \`transient/raw\`、\`inferred|hypothesized\`
  和 \`blocked\`，可被物化/重放但不改变 observed scene 或 current field。
- M2-06 已完成代码闭环：Prompt Memory 的 canonical 路径只消费 materialized cognition state，静态 SOUL/BRIEF/USER 文件不再是该路径的模型输入；checkpoint 失效时 assemble 被阻断。
- 2026-08-27 已通过 [memory-runtime.smoke.ts](../../packages/runtime/host/tests/memory-runtime.smoke.ts)：实际 Host
  启动两次并复用同一隔离 RIN_HOME，第一 session 写入后重启，第二 session 延续同一 open scene；最终 1 个
  scene 同时保留两个 dsh-session ref，root Prompt 含 `rin:prompt-memory` 且 checkpoint 为 clean。

依赖：M1-01 至 M1-06。

| ID | 实施 | 主要改动面 | 验收 |
|---|---|---|---|
| M2-01 | 把 session/runtime 事件映射为 observation/action/outcome | host seam、memory engine | session 日志与认知事务可互相定位 |
| M2-02 | 场景开/延/闭规则 | memory engine | 单 session 多场景、跨 session 同场景均通过 |
| M2-03 | current field 更新 | memory engine | 每个 committed 交互后只有一个当前版本 |
| M2-04 | open loop 建立与回连 | memory engine | 延迟结果回到原场景而非生成孤立事实 |
| M2-05 | 在线 raw formation | memory engine/store | 模型解释只能写 inferred/hypothesized candidate；事务可物化重放 |
| M2-06 | Prompt Memory 降级为生成投影 | prompt projection | 删除静态文件不会删除 canonical self model |

退出门：连续两次真实 Host session 能形成跨 session 场景，并从事件流重放。

### Wave 3：召回动力学与工作空间

依赖：Wave 2。

| ID | 实施 | 主要改动面 | 验收 |
|---|---|---|---|
| M3-01 | 多线索候选生成 | engine、FTS、embedding projection | 关闭任一索引仍可从 typed links 召回 |
| M3-02 | 可解释评分分量 | memory engine | recall trace 能还原每个分量 |
| M3-03 | 抑制、冲突和重复去垄断 | memory engine | 重复摘要不挤掉原始冲突 |
| M3-04 | coalition 优化与预算 | memory engine | 输出联合结构而非 top-k 独立列表 |
| M3-05 | typed workspace 输出 | memory/context contracts | uncertainty 与 epistemic 标签不丢失 |
| M3-06 | 模型输入日志闭环 | host/session logging | 给定 cycleId 可重建实际输入顺序与 hash |
| M3-07 | session-search 改为候选索引 | memory projection | 它不能绕过 coalition 直接注入模型 |

退出门：黄金场景中的支持、冲突、开放回路和低置信关键项可同时进入工作空间；模型可见输入
可重建。

> 2026-08-27 状态：Wave 3 退出门已通过。
>
> 新鲜证据：recall engine 8 个黄金/机制测试、Prompt seam 3/3、session-search seam 12/12、
> cognition store 12/12、真实 Host memory smoke，以及全仓 199 个测试文件/1763 个测试、
> 40/40 smoke、typecheck、lint、check 全部通过。
>
> 边界：embedding 目前只有 source contract，没有具体向量 provider/index；巩固、反馈、
> 授权擦除仍留在后续 Wave；Host smoke 验证的是 hook、持久化与输入快照校验，
> 不等同于 provider 成功返回的一次完整 agent turn。

### Wave 4：巩固、重巩固和自动遗忘

依赖：Wave 3 的 recall/use trace。

| ID | 实施 | 主要改动面 | 验收 |
|---|---|---|---|
| M4-01 | labile 窗口和 use trace | engine/store | 未被实际使用的表示不误入重巩固 |
| M4-02 | reinforce/revise/split/contest/supersede/reject | engine | 每种转移有正反例和非法转移测试 |
| M4-03 | 跨场景巩固调度 | host trigger、memory engine | 重复本身不把 hypothesis 升为 observation |
| M4-04 | accessibility/link 衰减 | engine | 衰减不改变 confidence/epistemic |
| M4-05 | 归档与历史恢复 | store/recall | archived 默认不召回，明确历史线索可恢复 |
| M4-06 | projection invalidation/rebuild | projections | 巩固后旧 prompt/vector/cache 不可继续使用 |

退出门：用户纠正、来源矛盾、情境差异和时间变化得到四种不同结果；重放保持一致。

#### Wave 4 执行切片与当前落地顺序

Wave 4 采用一条连续认知事务链，不把巩固、反馈和投影拆成彼此独立的旁路：

`实际使用 → labile 窗口 → consolidate → cognition event → materialized state → link/projection invalidation`

| 切片 | 统一运行产物 | 当前状态 | 进入下一切片的门 |
|---|---|---|---|
| W4-A / M4-01 | `record-use`、`memory-used`、精确版本的 use trace 与 labile window | 已落地 | recall-only 不能开窗；版本、生命周期和时间必须精确匹配 |
| W4-B / M4-02 | 六种巩固操作及不可变结果：reinforce、revise、split、contest、supersede、reject | 已落地 | 重复只改变可访问性/稳定性；confidence 变化必须有独立证据；非法状态转移拒绝 |
| W4-C / 事务接线 | `consolidate`、`memory-consolidated`、原子物化、旧链接撤回与重放 | 已落地 | 必须能从已持久化 use trace 提交，并在同一 journal 重放出同一状态 |
| W4-D / M4-03~06 | 跨场景调度、衰减、归档/历史恢复、projection invalidation/rebuild | 已落地 | 四类差异产生四种结果，旧 prompt/vector/cache 不得越过新版本继续生效 |

> 2026-08-28 状态：W4-D 已落地，Wave 4 的统一事务链已闭合。
>
> M4-03 由 MemoryStore.planConsolidation() 生成跨场景巩固调度快照；它只消费当前版本的真实
> use trace，重复使用只增加调度压力，不改变认识状态。M4-04 由 memory-decayed 后台事件物化
> accessibility/link 衰减，并严格保持内容、confidence、epistemic 与 influence 不变。
>
> M4-05 将 history 作为显式 recall 模式：current 默认排除 archived，历史结果保留
> influence=blocked 和非行为激活标记。M4-06 让 cognition journal 的每次新事务使 projection
> checkpoint 失效，只有当前物化版本才能重建 clean，旧版本无法通过门禁。
>
> 四类退出门差异已分别映射到 revise、contest、split、supersede，并由生成测试和 cognition
> journal 重放测试覆盖。W4-D 沿用同一事件、状态和物化链，没有新增旁路记忆表。


### Wave 5：自我、他人、关系、倾向和未来

依赖：Wave 4 的巩固语义。

| ID | 实施 | 主要改动面 | 验收 |
|---|---|---|---|
| M5-01 | self model 形成规则 | engine | 静态 persona 只作初值/投影 |
| M5-02 | person model 的时间与情境条件 | engine | 暂时情绪不固化为永久 profile |
| M5-03 | relationship model 的双主体与边界 | engine | 无隐藏亲密分数，无独立关系库 |
| M5-04 | disposition 从行动—反馈中学习 | engine、evolution projection | 单次结果不稳定化为长期倾向 |
| M5-05 | open loop 压力与关闭规则 | engine | 未解决后果提高相关召回但不改真实性 |
| M5-06 | prospect/反事实/梦境隔离 | engine | simulation 永远不能写成 observed scene |
| M5-07 | skill projection 改写 | memory/evolution | skill 工件可从 disposition 重建 |

退出门：五类长期结构都从场景、链接和反馈推导，并共享同一事务与状态轴。

> 2026-08-29 更新：M5-04 已增加从 canonical action→outcome→feedback 链派生 disposition 候选的规则；派生结果仍是 transient/raw/inferred/blocked，并由 `runCognitionMaintenance()` 返回，不自动写入 memories 或获得行为影响。M5-05 现在会把未解决 open-loop 的后果压力传播到相关 scene 的 recall 分数；关闭、归档、擦除或撤销后撤回该压力，且不会授予 action-selection 权限。M5-07 已提供受控 disposition→skill projection。
>
> `MemoryStore.deriveRepresentationFormation()` 现在从同一 canonical evidence stream 派生 disposition，以及 transient/raw/blocked 的 self/person/relationship/prospect 候选：self 读取 Rin 行为及结果/反馈，person 读取同一 participant id 的重复行为，relationship 只接受稳定参与者的重复共享场景，prospect 只接受显式 hypothesized prediction；runtime-scoped participant id 不被提升为跨 session identity。`MemoryStore.proposeRepresentationFormation()` 仍将实际物化 scene、行为记录和模型候选串入同一 journal，候选不会自动固化或获得行为影响。
> runtime scene 的 participant/goals 语义上下文现在可由 embedding application 通过 RuntimeSceneHint 或 MemoryPluginConfig.runtimeSceneDefaults 显式注入，并传递到场景、CurrentField 和 action goalIds；缺省链路继续使用 session/scene scoped identity。续接期间上下文不可变，变更会拒绝而不是静默改写。该入口解决的是已知运行身份与目标的承载，不是身份推断、关系证明或 provider/model 决策证明。
>
> 形成提案的 sourceSceneIds 现在作为 candidate.sourceMemoryIds 保存在同一 `memory-proposed` 事件中，并由 materializer 生成版本绑定的 `supports` 边；授权擦除会撤回受影响的支持边，来源失效的候选不能通过 owner 许可或 permitted consolidation 重新进入行为影响路径。
>
> `formMemoryRepresentations()` 现在对 self/person/relationship 施加证据形状门：可观察轨迹、同一主体的重复观察、双方重复共现与显式关系信号分别是稳定化的必要条件；interpretation 单独存在不会被当作观察证据。
> disposition 派生要求 action 至少关联一个 canonical outcome 或 feedback；仅有跨场景重复 action 而没有结果反馈时，不产生长期倾向候选。
> disposition 形成提案同时校验 action→outcome→feedback 的归属关系：支持 action 必须覆盖 source scene，outcome 必须属于支持 action，feedback 必须绑定支持 action 或 outcome，避免用不相干的已存在 ID 伪造证据链。
>
> 2026-08-30：统一当前版本链接判定。CurrentField 会把当前 scene 与 active、版本一致的 self/person/relationship/disposition 等表征组成同一 activeMemoryCoalition；archived/erased 端点、retracted 边和过期 endpoint link 不进入当前场。recall 邻域、重复/冲突处理与最终 workspace links 也复用该判定，避免已推进表征的旧边继续施加召回或关系影响。

> 2026-08-30：M5-02 的情境门控已贯通 CurrentField、current recall、fallback prompt projection 和 model-input。`contextConditions` 优先定义人物模型的适用环境，缺省时使用 `stateByContext` 的 context；当前 scene 的 environment/observations/interpretations 未命中时，人物模型不会进入当前联盟或模型输入，history 仍可显式访问。匹配采用规范化后的双向文本包含，仍是确定性条件匹配，不等同于身份推断或语义理解。
>
> 2026-08-30：M5-02 的形成判定现在同样以显式情境承载为准：`currentState` 配合非空 `contextConditions` 或 `stateByContext` 后，不再被错误地当作缺少情境；空 `stateByContext` 仍不能证明已记录情境。该规则与 CurrentField/current recall 的门控共享同一 model 语义。
>
> 同一版本边的行为适用性与 coalition 关系保持分离：`supports`/`derives` 可作为 disposition 的行动激活依据，`contradicts`/普通上下文边只进入关系与冲突证据，不会单独生成候选 action。
>
> recall 的 `utilityByGoal` 现在按当前显式 query goal 收束；无显式 query goal 时回退到 CurrentField goals；若两者均为空，仅对已进入 `candidateActionSources` 的 disposition 回退到自身 `intendedGoal`，其他记忆 utility 为零，避免不同目标之间发生动力学串扰。
>
> `projectDispositionToSkill()` 只接受 durable/integrated/permitted 且非 contested 的 disposition，并按版本重建同一 Markdown 工件。形成结果不会自动晋升为行为影响，skill projection 不反写 cognition state，旧 evolution 的文件候选状态不构成第二 canonical store。
>
> 当前场的候选行动已由 permitted disposition/open-loop 在 canonical state 中确定性派生，并携带其来源 memory id；它仍是工作空间中的可行动作候选，不等于已经执行。
候选行动现在在同一个 candidateActionSources 结构中携带 contextual/goal utility、inhibition、
selectionValue 和解释，并按 selectionValue 确定性竞争排序；runtime 对多条匹配行动也消费该排序，
不会再退化为只按文本长度绑定。没有显式 scene goal 时，只有已经由 triggering context 命中的
disposition 才使用其 contextual utility，避免把目标效用扩散到无关情境。
> FileMemoryStore.commitConsolidationDecision(schedule, decision) 将 controller 的 operation/evidence 绑定到 schedule item 的 memory version 和 persisted use trace，再复用既有 consolidation result 校验与原子事务提交。
>
> 2026-08-30：M6 use trace 的写入入口新增 validity interval 校验。`recordMemoryUse()` 只有在 `usedAt` 落入当前 memory version 的有效时间窗内时才追加 `memory-used` 事务，避免过期或尚未生效的版本进入 reconsolidation 证据链。

> 2026-08-30：关系表达消费已接入同一 canonical cognition journal。`assistant/message` 的显式 `relationshipExpression` 必须同时携带 `cycleId`、`workspaceHash` 和 `memoryIds`；runtime mapper 与行为记录先验证它和本轮行为 workspace 完全一致，`MemoryStore.recordRelationshipExpression()` 再接受来自 persisted recall workspace、版本一致且具有 `relationship-expression` 许可的 memory。它不把候选召回、关系模型存在本身或 session 最近一次 recall 当作已发生的表达影响。

> FileMemoryStore.commitRepresentationFormation() 已补上 Wave5 候选到长期状态轴的显式接受事务：它要求 cognition journal 中存在匹配的 memory-proposed、来源场景和达到 ready 的独立证据，然后以单一 memory-formed 事件验证并物化 encode → durable → link → consolidate → integrate。形成结果保持 epistemic 原值、influence=blocked 和空 influence surfaces；owner-only permitInfluence() 仍是后续独立许可，不会被 formation 或 background maintenance 自动授予。
>
> 2026-08-30：formation commit 复用提案 materializer 生成的 active `supports` 边检查 `fromVersion`；来源场景在提案后推进版本时，旧提案拒绝提交，不能把当前场景重新计算的 ready 状态冒充为原提案证据。

### Wave 6：行为反馈闭环

依赖：Wave 5。

| ID | 实施 | 主要改动面 | 验收 |
|---|---|---|---|
| M6-01 | prediction/action 记录接入模型循环 | host、memory | 每个重要行动可追到工作空间和预测 |
| M6-02 | immediate feedback 解析 | host、memory | 接受/纠正/拒绝更新正确链路 |
| M6-03 | delayed outcome 回连 | runtime event seam | 跨 session 结果更新原 action |
| M6-04 | disposition 更新 | memory engine | 行为选择因反馈改变且变化可解释 |
| M6-05 | 召回—行为联合评估 | eval tests | 不只评估“答对”，还评估后续选择 |

退出门：至少一个跨 session 场景证明“回忆影响行动—行动产生结果—结果改变下次召回与选择”。

> 2026-08-29 更新：M6-01~M6-04 已接入 canonical cognition journal。Host seam 记录 prediction/action/outcome/feedback，按 correlation key 将 delayed outcome 和 feedback 回接原 action/cycle/scene；feedback 触发 disposition maintenance。M6-05 联合评估器现在优先比较 CurrentField candidateActionSources 的 selectionValue，并保留 workspace item score 作为无候选字段时的回退；它对 before/after 候选集合对称识别新增与撤回，且要求 top choice 具备真实 workspace 来源，仍未冒充运行时 policy。
>
> runtime feedback 若显式携带 predictionId 或 outcomeId，只有在该记录确实属于当前 action 时才进入 canonical feedback；显式错配不会降级成无目标的 action-only feedback。
>
> canonical materializer replay 同样校验 action↔prediction、action↔outcome 和 prediction↔outcome 的记录绑定，保证直接 journal 重放与 Host runtime 入口共享同一行为语义。
>
> 2026-08-29：Host runtime 已将同一 session event 产生的行为事实收束为一个 `record-behavior` 事务；`tool/call` 原子写入 prediction + action，`tool/result`/`turn/end` 原子写入 outcome，feedback 原子写入 feedback。跨时间事件仍按 canonical id/cycle/scene 关系连接，不把本来分属不同事件的 action 与 outcome 错误合并为一个事务。
> `outcome-recorded` 现在在 materializer replay 中从 canonical prediction/action/outcome 关系派生来源 scene 的 `predictionErrors`，并随活动 scene 进入 CurrentField；它是可回放的粗粒度运行信号，不是独立事实表，也不是语义真值或 provider/model 策略证明。当前幅度规则为 failed=1、unknown=0.75、partial=0.5、observed 精确规范化匹配=0，否则=0.5。
> feedback 中有明确 prediction 绑定的 `factualCorrection` 时，同一 materializer 会追加 magnitude=1 的 correction error；无 prediction 依据的纠正不生成虚构 expected。该状态沿当前 canonical source scene 重放，并在 source behavior 被擦除后撤回，不新增独立事实表。
> runtime feedback 对多 prediction action 优先沿已记录 outcome 的 prediction 回连；无唯一绑定时只保留 action/outcome 反馈，不生成虚构的 prediction 关联，保证 delayed outcome 与 correction error 沿真实证据关系回放。
> runtime outcome 对多 prediction action 只有事件显式提供 predictionId 才绑定具体 prediction；无显式绑定时单 prediction 才可推断，materializer 与 runtime mapper 使用同一证据规则。
> runtime outcome/feedback 在同一 cycle 或 correlation key 对应多个 action 时保持未绑定，不按时间或 id 猜测 action 目标。
> DSH 原生 `tool/result` 的 correlation key 实际位于 `message.content[*].toolCallId`，块级 `content` 是结果文本；runtime mapper 与 Host smoke 已按该真实结构回连单一结果，多个不同 `toolCallId` 保持未绑定。
> runtime feedback 未显式携带 outcomeId 时，只有 action 关联唯一 outcome 才自动回连；多个 outcome 时保留 action-level feedback，不按最新时间猜测目标 outcome。
> runtime feedback 只携带显式 outcomeId 时，mapper 沿 canonical outcome→action 回连并继续验证 prediction/outcome 归属；目标缺失或关系冲突时不降级为无目标反馈。
> background maintenance 对 canonical outcome 与 outcome-only feedback 均沿 outcome→action 关系回连 disposition；没有可确定 action 归属的向量不会被猜测或触发学习。
> direct disposition feedback 若没有 actionId/outcomeId，则只在该 disposition 通过 disposition.supportingActionIds 或 action.sourceMemoryIds 解析出唯一 supporting action 时沿该明确支持关系进入 maintenance；支持 action 不唯一时保持未绑定，不按最近记录猜测。
>
> `MemoryFeedbackVector` 已统一为多维 canonical 结构：`taskOutcome`、`actionCost`、`factualCorrection`、`predictionAccuracy`、`userResponse`、`relationshipConsequence`、`boundaryRespect`、`autonomyEffect`、`safetyEffect` 和 `delayedConsequence` 进入同一 feedback-recorded 事件；runtime parser、journal validator 与 disposition polarity 使用同一范围和枚举约束，不把反馈压成单一长期奖励。
> `actionCost` 只进入 disposition 当前 `intendedGoal` 的 `utilityByGoal` 更新，并以小幅动力学压力影响 accessibility/inhibition；`data.utilityByGoal` 与 recall 使用的 `dynamics.utilityByGoal` 同步演化，但不会替代关系、安全、边界等反馈维度。
> recall behavior signal 现在将这些维度分别映射为纠正/矛盾压力、抑制压力和 delayed relevance；它只影响当前候选的可回放召回动力学，不产生新的 canonical reward 或自动长期固化。
> relationship formation now carries explicit boundary/negative relationship feedback into candidate boundaries, conflicts, and formation evidence while keeping the candidate transient/raw/blocked. Disposition formation carries negative feedback explanations into failureModes only when stable independent outcome evidence already passes the semantic-change gate; one feedback vector alone cannot create a long-term failure mode.
>
> `MemoryStore.runCognitionMaintenance()` 现在在同一受控入口返回 disposition learning、representation formation 结果与 consolidation schedule；formation 结果和 schedule 都仍需显式 controller 依据版本和 persisted use trace 处理，不自动固化。
>
> MemoryStore.evaluatePersistedRecallBehavior() 将 M6-05 从 workspace 比较提升为 cognition journal 评估：它读取两个已持久化 recall cycle 之间的真实 model-input、action-selection use、action、outcome 与 feedback，并检查 materialized version 推进、行动阶段 top choice、候选来源绑定、阶段首选的 workspace 来源可用性和完整结果链。评估不修改状态、不合成 reward，也不等同于 provider/model policy 证明。
>
> `MemoryStore.recordModelInput()` 现在只在 workspace hash 与持久化 recall 一致时，为当前版本的 canonical workspace memory 写入 model-input use trace；因此 consolidation schedule 能读取真实模型输入压力，而 recall 本身仍只是候选激活。
> `FileMemoryStore.recordModelInput()` 在 Host 重启后会从持久化 recall 与 model-input 记录恢复唯一可判定的同 session workspace 绑定；若同 session 存在多个未绑定 recall，则保持 `unbound`，不按时间或 id 猜测。该恢复只补足进程内 pending recall 队列丢失后的连续性，不把歧义记录升级为绑定关系。
>
> 2026-08-30：Host runtime 行为归属复用同一持久化 recall/model-input/action 主链。新 assistant/tool action 只接受唯一的同 session、model-input-backed 且尚未产生 action 的 recall；多个未决 recall 保持未绑定，已建立 action 的后续 tool call 才能沿其 cycle 继续。缺少精确 action cycle 的 outcome/feedback 不再回退到 session 最近一次 recall。真实 Host smoke 已覆盖两个未决 recall 的歧义路径。
>
> recall workspace 现在同时保存 CurrentField，实际 Host workspace 文本会渲染其中的候选行动；只有当前场在同一 materialized version 且来源具备 model-input 许可时，才登记该来源的 use trace。
> runtime action mapper 现在消费同一 CurrentField 的 candidateActionSources：命中候选行动时只绑定场景与该候选的来源 memory id；无候选命中时保留 workspace 级回退，避免伪造更窄的因果来源。
>
> 真实 Host smoke 已覆盖跨 session delayed outcome；召回—行为联合评估仍是 evaluator。MemoryStore.permitInfluence() 现已提供 owner-only、previous-version 绑定的许可事务，并有 store-level 正向 fixture；runtime/background 通用 transition 不得授予 influence。
>
> 2026-08-29 Wave6 多候选运行扩展已通过真实 Host smoke：permitted disposition 经 session-bound recall 进入同一 CurrentField，两个候选按 selectionValue 确定性排序，两条实际 tool action 分别命中各自 candidateActionSource 并登记各自的 action-selection use；primary 被 reject 后其 inhibition 上升，alternative 在下一次 CurrentField recall 中升至第一，并创建新的 model-input workspace hash；observed outcome 和 user feedback 仍能触发 disposition 新版本，后续 recall/model-input/action 仍保持版本与来源一致。
>
> 该证据证明了 Rin 的 CurrentField 、runtime action mapping 和 feedback maintenance 在多候选场景中的一致性；store-level evaluator 另已覆盖 before/after phase 的持久化行为链，但这些都不等于真实 provider/model 在多个候选间的策略概率、实时决策或泛化性能证明；owner 身份仍由当前 Host fixture 的稳定 actor id 表示，更广泛的 phase/policy/evaluator 覆盖留在后续迭代。

### Wave 7：用户控制、授权擦除与 Memory Center

依赖：Wave 4 的派生链，Wave 6 的行为链。

| ID | 实施 | 主要改动面 | 验收 |
|---|---|---|---|
| M7-01 | correction/restrict/revoke 意图 API | contracts、host route、memory | 无 generic writer |
| M7-02 | erase preview 计算 | memory engine/API | 仅沿 support/derive 传播，列出不受影响集合 |
| M7-03 | owner authorization | auth/session/API | 模型、插件、后台任务均无法签发 |
| M7-04 | atomic erase commit | memory store | 授权过期、scope 漂移、nonce 重放全部拒绝 |
| M7-05 | 派生状态与投影重算 | memory/projections | 被擦除支持不再影响 recall/action |
| M7-06 | Memory Center | web API/components | 场景、理解、召回解释和控制在统一界面 |
| M7-07 | export/replay | memory/backup | 导出后可恢复未擦除状态及事件顺序 |

退出门：未授权擦除路径为零；授权范围外的场景和模型在故障注入后仍保持不变。

> 2026-09-06 状态：Wave 7 已落地并通过全仓门禁。
>
> 实现事实：
> - 协议层（`packages/domains/memory/src/events.ts`）新增五个 owner-only 事务工厂：
>   correct→memory-corrected、restrict-influence→influence-restricted、
>   revoke-influence→influence-revoked、authorize-erase→erase-authorized（payload
>   含 scopeHash）、commit-erase→erase-committed。命令/事件 authority 映射保持
>   owner-only；model/plugin/background 提交在协议层被拒。
> - store 层（`FileMemoryStore`）公开 correctUnderstanding、restrictInfluence、
>   revokeInfluence、requestErasePreview、authorizeErase、commitAuthorizedErase。
>   纠正采用原地内容修订：旧版本保留在 journal 中，permitted 影响随内容修订重置为
>   blocked（新内容需重新获得 owner 许可）。
> - erase preview（`computeEraseScope`，store.ts）为确定性纯函数：擦除集合 = 授权
>   根；派生影响 = 被撤回的 active 边 + 直接 supports/derives 依赖；显式输出
>   unaffected 集合；scopeHash 绑定整个范围。authorize 持久化 scopeHash + expiresAt
>   （默认 15 分钟）；commit 拒绝未知授权、已消费授权（journal 扫描
>   `listEraseCommittedAuthorizationIds`）、过期授权与 scope 漂移（重算 scopeHash
>   比对）。
> - 擦除提交由既有 materializer 语义原子执行：删除授权内存、撤回触及边、擦除派生
>   行为引用；projection checkpoint 全部标记 dirty，模型输入门禁阻止过期投影
>   （M7-05）。
> - contracts 新增意图 DTO（MemoryCorrectionRequestDto、MemoryErasePreviewDto、
>   MemoryEraseAuthorizationDto 等）与认知查询 DTO；host 路由新增
>   POST /api/memory/corrections、/api/memory/influence/restrict、
>   /api/memory/influence/revoke、/api/memory/erase/{preview,authorize,commit}、
>   GET /api/memory/scenes、/api/memory/representations/:id、
>   /api/memory/recall[/:cycleId]、/api/memory/journal[/restore]（M7-07：journal
>   导出与空库恢复，重放得到与源 store 一致的物化状态）。
> - Memory Center（M7-06）：apps/web 新增 MemoryCenter 页面（当前场、场景时间线、
>   召回解释、owner 控制 + preview→authorize→commit 流程），挂入 workspace 视图与
>   侧栏；apps/web/src/api/memory.ts 扩展全部意图与查询方法。
> - 证据：`tests/owner-intents.test.ts`（11 测试，覆盖 E-13/E-14/E-15 语义、过期/
>   重放/漂移拒绝、journal 导出恢复）、`tests/long-range-scenarios.test.ts`、
>   host/web 测试更新；全仓 check 绿（见 ACTIVE.md）。

### Wave 8：系统评估与替换收口

依赖：Wave 1–7。

| ID | 实施 | 主要改动面 | 验收 |
|---|---|---|---|
| M8-01 | 删除 MemoryItem v1 与 generic routes | memory/contracts/host/web | repo 内无运行时引用 |
| M8-02 | 删除重复 canonical skill/prompt 状态 | memory/evolution | 只剩投影写路径 |
| M8-03 | projection rebuild 与崩溃恢复矩阵 | tests/smoke | 任意投影丢失可恢复 |
| M8-04 | 长程行为场景集 | eval tests | 跨 session、纠正、冲突、延迟反馈全部通过 |
| M8-05 | 性能基线 | benchmark | 在语义固定后测延迟、数据库增长和重建成本 |
| M8-06 | 全仓门禁与真实 Host smoke | root gates | typecheck/test/hygiene/smoke 全绿 |
| M8-07 | CURRENT/SEAMS/API 文档改为实现事实 | docs | 蓝图、计划、当前事实三者无越界 |

退出门：旧系统已移除，不是隐藏在 adapter 后；所有完成声明都有运行时场景证据。

> 2026-09-06 状态：Wave 8 已落地并通过全仓门禁。
>
> 实现事实：
> - M8-01：v1 `MemoryDatabase` 目录（memory_items/memory_injections）、
>   `syncMemoryProjection`/`removeMemoryProjectionSource` 投影写入、generic catalog
>   HTTP 路由（collection GET、item GET、revoke、injections、export）以及
>   contracts 中的 MemoryItem/MemoryInjectionRecord/MemoryExport 等类型全部删除；
>   knowledge、notes、session-search 不再镜像写记忆目录。运行时引用为零。
> - M8-02：prompt 静态文件不再是 canonical 自我模型来源；prompt seam 只消费
>   canonical cognition surface（缺失即拒绝挂载），legacy 目录同步与静态回退路径
>   已删除。skill 侧唯一自动学习真相是 memory 的 disposition；evolution 仅保留
>   提案/人工审查记录与 disposition 导出投影（projectDispositionToSkill）。
> - M8-03：投影 rebuild 与崩溃恢复由 E-16（故障注入回滚 + dirty 门禁）与 E-17
>   （重放等价 + checkpoint 恢复）场景覆盖，并把 M1-03 fault injection、M1-06
>   checkpoint 协议既有证据纳入恢复矩阵。
> - M8-04：`tests/long-range-scenarios.test.ts` 覆盖 E-01 至 E-20 全部 20 个 §12
>   场景（21 测试）。§12 要求进入 Host smoke 的五个场景全部具备真实 Host smoke
>   证据：E-01（跨 session 场景延续）与 E-10（delayed outcome 回连）由
>   memory-runtime.smoke.ts 覆盖；E-13（授权擦除只清除授权范围）、E-16（投影更新
>   崩溃回滚且过期投影不进入模型输入）与 E-18（给定回复 cycle 重建实际模型输入
>   顺序与 hash）由 memory-lifecycle.smoke.ts 在真实 Host 装配上覆盖。
> - M8-05：`pnpm run bench:memory`
>   （`packages/domains/memory/scripts/benchmark-memory.ts`）输出 journal append、
>   全量重放、recall、状态 hash 与数据库体积基线；结果记录于 ACTIVE.md。
> - M8-06：`pnpm run check` 全绿（metadata 21 manifests、hygiene 5 gates、
>   typecheck、lint 0 错、203 测试文件/1860 测试、release verify、41/41 smoke，
>   含新的 memory-lifecycle 真实 Host smoke）。
> - M8-07：CURRENT.md、SEAMS.md、API 文档、memory README 与本计划已同步为上
>   述实现事实。

## 12. 强制评估场景

| 场景 ID | 输入与变化 | 必须观察到 |
|---|---|---|
| E-01 | 会话结束后隔天继续同一未完成任务 | 新事件延伸原场景，open loop 关闭 |
| E-02 | 一个会话中从工作问题切换到私人话题 | 关闭旧场景并开启新场景 |
| E-03 | 用户纠正 Rin 对过去事件的理解 | 原理解保留为历史，新理解 supersede/revise |
| E-04 | 同一假设被多次召回但没有新证据 | accessibility 可升，epistemic/confidence 不升级 |
| E-05 | 高相关但低置信的关系推断 | 可进入 workspace，但明确带不确定性 |
| E-06 | 新说法与旧说法只在情境上不同 | 形成条件化表示，不粗暴判为矛盾 |
| E-07 | 两条独立来源真正冲突 | contested 双方共同进入相关 recall |
| E-08 | 模型生成未来模拟 | prospect=hypothesized，不进入 observed scene |
| E-09 | 一次行动被用户拒绝 | 对应 cue/action/disposition 更新，不改无关人格 |
| E-10 | 三个会话后出现延迟结果 | outcome 回连原 prediction/action |
| E-11 | 后台巩固认为内容“无用” | 最多 archived，不发生 erase |
| E-12 | 模型或插件调用 erase 命令 | actor/owner 校验拒绝且状态不变 |
| E-13 | 用户授权擦除一个确定场景 | 只清除该场景及实际派生影响 |
| E-14 | 相似但无 support 依赖的另一场景 | E-13 后完整保留且仍可召回 |
| E-15 | 擦除预览后新增派生表示 | 旧授权因 scope hash 改变而失效 |
| E-16 | 投影更新中崩溃 | canonical commit 完整，过期投影不进入模型 |
| E-17 | 删除 FTS/vector/cache | 从 canonical state 重建并恢复语义 |
| E-18 | 给定模型回复追查上下文 | 能重建选中 coalition、顺序、标签和内容 hash |
| E-19 | 重复摘要与一条原始冲突竞争 | 重复项去垄断，冲突不被挤出 |
| E-20 | 关系边界随时间改变 | 旧边界保留历史，新边界控制当前行为 |

每个场景必须至少覆盖领域测试；E-01、E-10、E-13、E-16、E-18 还必须进入 Host smoke。
E-13 必须使用合成 owner 和隔离数据库，不能拿真实用户数据做删除测试。

## 13. 门禁

### 13.1 领域不变量门

- 五轴状态转移无非法捷径；
- hypothesis 不因重复变 observed；
- recall 不直接改变 confidence；
- superseded、revoked、archived、erased 四者不混用；
- owner-only 命令无法由 model/plugin/background actor 提交；
- support graph 无悬空 active edge；
- current field 每个 owner 只有一个当前版本；
- event seq、materialized version 和 projection checkpoint 单调。

### 13.2 重放门

固定事件流必须在空库重放后得到相同的：

- scene/representation/link 状态 hash；
- current field；
- recall 固定候选下的 coalition；
- projection logical content；
- erase scope 计算。

### 13.3 模型输入门

每次模型调用必须有 workspace cycle，且 session 日志能回答：

- 哪些线索启动了召回；
- 哪些候选被抑制或因影响限制被排除；
- 哪些冲突和不确定性进入上下文；
- 最终序列化内容和 hash；
- 模型输出随后形成了哪些 candidate、prediction 和 action。

### 13.4 数据权利门

- 没有 `EraseAuthorization` 就没有 hard erase；
- authorization 不能由模型、自动任务或插件创建；
- preview scope 与 commit scope 必须相同；
- propagation 只沿 active support/derive 依赖；
- 未受影响集合有显式回归断言；
- 缓存、embedding、prompt 和尚未发送上下文全部失效；
- 已发送给外部模型的历史事实只能在 export 中如实说明，不能伪称可远程擦回。

### 13.5 仓库门

每个波次至少运行受影响 package 的 typecheck/test；退出 Wave 8 前运行：

~~~bash
pnpm run typecheck
pnpm run test
pnpm run hygiene
pnpm run smoke
pnpm run check
~~~

命令通过只证明对应门禁，不自动证明认知行为正确。长程评估场景和真实 Host smoke 是独立证据。

## 14. 精确执行顺序

实施者按下列顺序领取任务，不可为了先展示 UI 或向量检索跳过基础语义：

1. M0-01 → M0-04；
2. M1-01 → M1-02 → M1-03 → M1-04 → M1-05 → M1-06；
3. M2-01 → M2-02 → M2-03 → M2-04 → M2-05 → M2-06；
4. M3-01 → M3-02 → M3-03 → M3-04 → M3-05 → M3-06 → M3-07；
5. M4-01 → M4-02 → M4-03 → M4-04 → M4-05 → M4-06；
6. M5-01、M5-02、M5-03 在共同模型稳定后可并行，随后 M5-04 → M5-07；
7. M6-01 → M6-02，M6-03 可并行，随后 M6-04 → M6-05；
8. M7-01 → M7-02 → M7-03 → M7-04 → M7-05 → M7-06，M7-07 在接口稳定后执行；
9. M8-01 → M8-07。

允许的并行只发生在共享不变量和事务格式已完成之后。不得同时维护 v1/v2 两套写路径来换取
表面并行。

## 15. 完成定义

只有同时满足以下条件，才能把“Rin 统一记忆系统”标为 implemented：

- 八种表示形态在同一状态、事件和事务模型中运行；
- scene 可跨 session，session 不再被错误当作情节单元；
- recall 生成 coalition 并保留冲突、不确定性和开放回路；
- 巩固与重巩固具有可执行转移，不是离线摘要脚本；
- self/person/relationship/disposition/prospect 不存在第二套 canonical store；
- 行动和延迟反馈会改变后续召回及行为选择；
- 任意模型可见记忆影响可重建；
- 自动过程不能硬擦除；
- owner 授权擦除只传播到确定的认知依赖；
- 所有可丢弃投影能从 canonical state 重建；
- v1 generic catalog/CRUD 已删除，不靠兼容层隐藏；
- E-01 至 E-20、领域门、重放门、数据权利门和全仓门禁全部通过。

本文不提供人周估算，也不以迁移难度降低目标。进度以任务依赖、退出门和新鲜运行证据记录，
不以文件数、代码行数或“已接入某候选项目”计算。
