# rin-harness 当前架构

> 状态：Current implementation snapshot — Wave 7（owner 意图 API、授权擦除、Memory Center）与 Wave 8（v1 删除、场景集、基准、门禁）已落地；§12 要求进入 Host smoke 的 E-01/E-10/E-13/E-16/E-18 全部具备真实 Host smoke 证据
>
> 日期：2026-09-06

本文只记录已存在于代码、manifest 或已执行门禁中的当前事实。目标架构见
[TARGET.md](TARGET.md)，记忆实施任务见
[MEMORY-IMPLEMENTATION.md](../roadmap/MEMORY-IMPLEMENTATION.md)，工程与发布的旧路线及
证据边界见 [ACTIVE.md](../roadmap/ACTIVE.md)。历史迁移材料统一位于
[docs/archive/](../archive/)，不承担当前结构、命令或完成状态的权威性。

目标记忆认知语义见 [MEMORY-BLUEPRINT.md](MEMORY-BLUEPRINT.md)。其中的记忆场、
工作空间、状态转移、召回动力学、巩固和行为反馈均是目标定义；除非本文另有当前实现
证据，不得把蓝图内容报告为已实现能力。

## 根级权威

根级 `package.json`、`pnpm-workspace.yaml`、`tsconfig.base.json`、
`tsconfig.json`、`vitest.config.ts`、`.oxlintrc.json` 与 `tooling/`
是唯一工程入口。当前仓库不维护 dsh 源码副本；dsh 基座由 registry
dependencies 解析。`patches/` 只保存有明确来源和决策记录的第三方依赖补丁。

## 当前目录与 package census

当前 canonical workspace 共有 21 个 package manifest：3 个应用入口和 18 个
可复用包。物理上的 `rin/` 过渡外壳已经移除；新的 package 只能出现在下表的
`apps/<name>/` 或 `packages/<role>/<name>/`。

| 层 | 目录 | package |
|---|---|---|
| apps | `apps/` | `@rin/cli`、`@rin/web`、`@rin/desktop` |
| runtime | `packages/runtime/` | `@rin/host`、`@rin/contracts`、`@rin/health`、`@rin/backup` |
| domains | `packages/domains/` | `@rin/assets`、`@rin/workspace`、`@rin/memory`、`@rin/knowledge`、`@rin/notes`、`@rin/automation`、`@rin/collaboration` |
| features | `packages/features/` | `@rin/authoring`、`@rin/evolution`、`@rin/context`、`@rin/computer-use`、`@rin/agent-migration` |
| integrations | `packages/integrations/` | `@rin/mcp`、`@rin/providers` |

合并包的公开子路径保持能力边界，但不再拥有独立 workspace manifest：

- `@rin/workspace/environment`、`filesystem`、`agents`、
  `plugins`、`sandboxes`；
- `@rin/memory/prompt`、`skill`、`session-search`；
- `@rin/knowledge/graph`；
- `@rin/health/doctor`、`monitor`；
- `@rin/authoring/brief`、`review`；
- `@rin/context/token-optimization`、`smart-pruning`、`codegraph`；
- `@rin/mcp/client`；
- `@rin/host/web-server`。

## Host 与应用入口

- `apps/cli` 是薄启动器，解析默认命令或 `web` 别名并调用
  `@rin/host/launcher`。
- `packages/runtime/host` 是唯一 composition root，持有 Cordis 装配、provider
  roster、路径 helper、Host start/stop 生命周期以及 `web-server`。
- `apps/web` 是独立 React SPA；共享 memory DTO 已抽到纯
  `@rin/contracts`，不从领域包导入运行时实现。
- `apps/desktop` 是 Tauri 2 壳；frontendDist 指向 `apps/web/dist`，
  builtin assets 指向 `packages/domains/assets/builtin`。开发态通过
  `rin web` 启动 host，发布态通过 `rin-sidecar web` 启动 sidecar；
  Cargo 构建、安装和四平台干净机器 E2E 已有原生 GitHub runner 证据；签名、公证和真实升级仍需独立发布证据。
- `@rin/host/web-server` 是 `@rin/host` 的公开子路径，不是独立 package；
  默认服务 8320，并与 `apps/web` 的静态产物共用 host。

Host 的 Cordis 文件位于
`packages/runtime/host/src/cordis.yml`，patch 位于
`packages/runtime/host/cordis.patch.yml`。Cordis 门禁验证配置行解析、
Host manifest 依赖闭包、roster 顺序、JS helpers 与 dsh patch 一致性。

## 数据与恢复边界

`@rin/memory` 拥有 canonical memory store；prompt、skill 和 session-search 是
同一包内的投影/检索模块。审计与 DTO 位于 `@rin/contracts`，不实现存储或
Cordis 装配。v1 `MemoryItem` 目录（memory_items/memory_injections 表）、generic
catalog CRUD 与 projections 目录镜像已在 Wave 8 删除；唯一记忆写路径是认知命令。

`@rin/knowledge` 负责知识索引，`@rin/knowledge/graph` 是跨来源的只读
graph read model。它可以读取 memory、notes、assets 与 codegraph 的公开投影，
但不替代各自的写入所有者。knowledge/notes/session-search 不再向 memory 目录镜像。

## Wave 7–8 当前实现事实（owner 控制与替换收口）

截至 2026-09-06：

- owner 意图命令已接入同一 cognition journal：correctUnderstanding（原地修订，
  旧版本留在 journal、permitted 影响重置为 blocked）、restrictInfluence、
  revokeInfluence（revoked 终态）。全部 owner-only，model/plugin/background
  在协议层被拒。
- 授权擦除闭环：requestErasePreview 确定性计算擦除集合、被撤回边、supports/derives
  依赖与 unaffected 集合并输出 scopeHash；authorizeErase 持久化 scopeHash 与
  expiresAt；commitAuthorizedErase 原子执行删除/撤边/行为引用擦除，并拒绝未知、
  已消费、过期与 scope 漂移授权。提交后全部投影 checkpoint 标记 dirty。
- Web/HTTP 面：意图路由 corrections、influence/restrict、influence/revoke、
  erase/{preview,authorize,commit} 与认知查询路由 field、manifest、scenes、
  representations/:id、recall[/:cycleId]、journal[/restore] 已上线；generic
  catalog 路由已删除。apps/web 的 Memory Center 页面提供当前场、场景、召回解释、
  owner 纠正（加载表征 → JSON 编辑 → 提交）与 preview→authorize→commit 控制。
  意图路由具备真实 HTTP 端到端证据：memory-intent-http.smoke.ts 在启用
  web-server 的真实 Host 上经 HTTP 完成 erase/correct/restrict/revoke 并断言
  journal 导出与重放拒绝。
- journal 导出与恢复（M7-07）：GET /api/memory/journal 导出按提交顺序的事务流；
  restoreCognitionJournal 仅接受空库并按确定性重放恢复，重放结果与源 store 一致。
  2026-09-12：批量重放在调用内复用 Map/Set，仅在返回时生成不可变快照；
  普通记忆写入仅协调变动场景的预测误差，行为记录或其排序改变时重建误差索引。
  CurrentField 仍逐事务推进；分页通过首事件序号范围查询读取完整事务。
  性能与等价验证见 [回放性能记录](../audits/2026-09-12-MEMORY-REPLAY-PERFORMANCE.md)。
- 长程行为场景集 E-01 至 E-20（§12）已有领域级可执行断言；其中 E-01、E-10 由
  memory-runtime.smoke.ts、E-13（授权擦除只清除授权范围）、E-16（投影更新崩溃
  回滚且过期投影不进入模型输入）与 E-18（给定回复 cycle 重建实际模型输入顺序与
  hash）由 memory-lifecycle.smoke.ts 在真实 Host 装配上覆盖；性能基线由
  `pnpm run bench:memory` 输出（journal append、全量重放、recall、状态 hash、
  数据库体积），数字记录于 ACTIVE.md。


## Wave 3–6 当前实现事实

截至 2026-08-30，`@rin/memory` 已把以下链路接入同一认知状态：

- `MemoryRecallEngine` 从 current field、词汇线索、typed links、动态压力以及已注册的 session-search、embedding、external source 产生候选；每个候选保留可解释评分分量和 recall trace。
- coalition 选择在统一预算内处理抑制、重复去垄断和冲突保留，输出 typed workspace；workspace 保留 epistemic、influence、confidence、uncertainty、selection reason 和关系边。
- Prompt seam 在最终 assembly 阶段执行一次 workspace recall；`llm/stream` 记录实际模型输入的稳定快照、hash、session、cycle 和序列到 cognition store。
- session-search 现在是统一 recall 的候选源；其模型可见工具输出只给索引候选元数据，不直接注入原始 transcript。

当前 Wave3 边界：代码提供 embedding source contract，但仓库尚无具体向量索引或 embedding provider。

Wave5 已接入同一 cognition journal：

- 场景、self/person/relationship/disposition/prospect 的形成候选保持 transient/raw/blocked；只有显式 controller 事务才能沿统一状态轴继续推进，候选不会自动获得行为影响。
- deriveRepresentationFormation() 已从同一 canonical evidence stream 派生 disposition，以及受证据形状约束的 self/person/relationship/prospect 候选；self 只读取 Rin 行为结果，person 只读取主体重复行为，relationship 只接受稳定参与者的共享场景，prospect 只接受显式 prediction。候选仍是 transient/raw/blocked，不自动进入行为影响。
- self 形成要求支持场景中存在可观察的 observation 或 action/result 轨迹；person 形成要求同一主体在至少两个支持场景中被重复观察；relationship 形成要求双方重复共现并有 commitment/boundary/conflict/expectation 或共享场景等显式关系信号，单纯 interpretation 不足以稳定化。
- relationship 候选现在消费同一 canonical feedback 中明确的 boundaryRespect 与负向 relationshipConsequence，将其写入候选的 boundaries/conflicts，并把反馈所属 session/action/outcome 纳入形成证据；候选仍保持 transient/raw/blocked。
- prospect 不能通过 observe command/event 进入 observed history；simulates 只允许从 prospect 指向其 relatedMemoryIds 声明的记忆，仍停留在 transient/raw/hypothesized/blocked 边界。
- disposition 候选必须有 canonical action 及其 outcome 或 feedback 证据；只有跨场景重复 action、没有结果反馈的轨迹不会形成倾向候选。
- disposition 形成还会校验 action→outcome→feedback 的 canonical 归属：支持 action 必须覆盖声明的 source scene，outcome 必须属于支持 action，feedback 必须绑定支持 action 或 outcome；仅有相同 ID 但关系不相干的记录不能拼成候选。
- 未解决的 transient/blocked open-loop 会沿 `relatedMemoryIds` 给相关 scene 增加 recall pressure；resolved、archived、erased、revoked 状态不再施加该压力，且该压力不会成为 action-selection 许可。
- FileMemoryStore.commitConsolidationDecision() 将 controller 决策绑定到精确的 memory version、persisted use trace 和 labile window；runCognitionMaintenance() 返回 disposition learning、representation formation 与 consolidation schedule，但不自动固化。
- formation proposal 将 sourceSceneIds 作为同一 candidate 的 sourceMemoryIds 写入 `memory-proposed`；materializer 确定性生成版本绑定的 `scene → candidate` supports 边。授权擦除源场景会撤回该边，候选保持 blocked，且不能通过 owner 许可或 permitted consolidation 重新获得影响力。
- `commitRepresentationFormation()` 只接受 cognition journal 中已持久化、证据形状达到 ready 的 model proposal，并以单一 `memory-formed` controller 事务验证 encode → durable → link → consolidate → integrate 的状态序列，重建当前版本的 supports 边；形成后仍是 durable/integrated/blocked，必须再经 owner-only `permitInfluence()` 才能进入行为影响。
- `commitRepresentationFormation()` 还要求提案时生成的 active supports 边仍与当前 source scene version 一致；场景在提案后延展会使旧提案失效，不会仅因重新计算得到 ready 就接受新版本证据。
- CurrentField 的 `activeMemoryCoalition` 现在由当前 scene 加上其当前版本上的 active links 所连接的表征组成，覆盖 self/person/relationship/disposition 等已物化形式；archived/erased 记忆、retracted 边和任一端版本过期的边不会进入当前协同域，recall 的 neighborhood 与最终 workspace coalition links 复用同一版本判定。
- 候选行动的链接适用性另行收窄：只有当前版本的 `supports`/`derives` 边能激活 disposition，`contradicts` 与普通上下文边仍可作为 coalition/冲突证据，但不授予 action-selection 适用性。
- recall 的 `utilityByGoal` 只读取当前显式 query goal；没有显式 query goal 时读取 CurrentField 的 active goals；若两者均为空，仅对已进入 `candidateActionSources` 的 disposition 回退到自身 `intendedGoal`，其他记忆 utility 为零，不再用所有目标中的最大 utility 污染当前召回动力学。
- CurrentField 仍保留 canonical coalition 的完整状态，但 recall seed 先经过 `isRecallable()`；blocked/revoked 表征不能通过 typed-link 邻域间接进入模型输入，prompt projection 继续使用独立的 model-input 许可门。
- person-model 的 `contextConditions`/`stateByContext` 现在由同一 model 层判定：当前 scene 的 environment、observations 和 interpretations 必须命中条件，才可进入 CurrentField coalition、current recall 或 fallback prompt model-input；history 模式仍可显式回看，空条件保持向后兼容。
- person-model 形成阶段也复用同一情境语义：`currentState` 只有在没有任何 `contextConditions` 或非空 `stateByContext` 承载时才保持不稳定；已显式情境化的当前状态可在满足重复场景与独立证据后进入长期化候选，空 `stateByContext` 不再被误当作已记录情境。
- disposition learning 从 action、outcome、feedback 重放并要求独立证据；skill 只是同一 disposition 版本的受控投影，不是第二 canonical store。
- `recordMemoryUse()` 在写入 use trace 前复核当前 memory version 在 `usedAt` 时刻的 validity interval；过期、尚未生效或无效时间边界的使用不会进入 cognition journal，也不会成为后续重巩固证据。
- `assistant/message` 可携带显式的 `relationshipExpression` 输出标注，其中必须同时给出 `cycleId`、`workspaceHash` 和 `memoryIds`；runtime mapper 与行为记录先验证它和本轮行为 workspace 完全一致，`recordRelationshipExpression()` 再校验 workspace 成员、memory version、`relationship-expression` 许可和 validity 后写入同一 `memory-used` journal。系统不会因为“检索到关系模型”就自动宣称表达受其影响，也不会按 session 最近一次 recall 猜测表达来源。

Wave6 已接入 Host 行为反馈链：

- Host runtime seam 将 assistant/tool action、prediction、tool outcome 和显式 user feedback 写入同一 cognition journal；correlation key 支持跨 session 回连原 action/cycle/scene。
- 同一运行时事件产生的行为事实会打包为一个 `record-behavior` 原子事务：`tool/call` 内按 prediction → action 排序，`tool/result`/`turn/end` 内写入 outcome，显式反馈写入 feedback；跨时间事件不被伪装成同一 SQL 事务，而是通过 action/prediction/outcome/feedback id、cycle 和 scene 关系连续回放。
- DSH 原生 `tool/result` 事件的回连键位于 `message.content[*].toolCallId`，结果文本位于块级 `content`；runtime mapper 在只有一个唯一回连键时将其绑定到原 action，多结果块保持未绑定，不按位置猜测。
- canonical journal replay 现在进一步校验 feedback 的 action↔prediction、action↔outcome 与 prediction↔outcome 绑定；直接写入 journal 的路径不能绕过 Host seam 的关系语义。
- `outcome-recorded` 在 materializer replay 中会依据已绑定的 prediction/action/outcome 向来源 scene 派生 `predictionErrors`；活动 scene 被构造成 CurrentField 后会暴露该信号。幅度目前是确定性的粗粒度信号（failed=1、unknown=0.75、partial=0.5、observed 且规范化文本完全相等=0，否则=0.5），不是语义真值评分，也没有新增第二份 canonical 存储。
- feedback 中若有明确 prediction 绑定的 `factualCorrection`，materializer 会生成 magnitude=1 的 correction error 并沿同一来源 scene 轴进入 recall/consolidation；没有 prediction 依据时只保留 canonical feedback，不虚构 expected。该派生状态同样随 source behavior 的 replay 与擦除而撤回。
- canonical MemoryFeedbackVector 现在以 taskOutcome 为主任务结果，并可携带 factualCorrection、predictionAccuracy、userResponse、relationshipConsequence、boundaryRespect、autonomyEffect、safetyEffect 和 delayedConsequence；runtime parser、journal validator 与 disposition polarity 共享同一范围校验。
- recall 的 behavior signal 现在按反馈维度进入不同动力学通道：负 predictionAccuracy 和 factual correction 增加纠正/矛盾压力，负 relationship/boundary 与 autonomy/safety 进入抑制，delayed feedback 增加相关性压力；这些是当前召回周期的可回放信号，不是单一 reward，也不自动改写长期表示。
- disposition maintenance 对只绑定 outcome、未重复携带 actionId 的 feedback 也会沿 outcome→action 回连；没有 action 或 outcome 归属的 feedback 不触发 disposition 学习。
- runtime feedback 若只携带显式 outcomeId，mapper 会先沿 canonical outcome→action 解析归属，再复用同一 action/outcome/prediction 校验；缺少该 outcome 或关系不一致时保持空 mutation。
- runtime 与 background maintenance 也支持明确指向 disposition、但不携带 actionId/outcomeId 的反馈；仅当该 disposition 通过 disposition.supportingActionIds 或 action.sourceMemoryIds 解析出唯一 supporting action 时才回连，歧义时保持空 mutation。
- outcome 或 feedback 会触发 disposition maintenance；实际 action 记录消费同一 CurrentField 的候选行动来源，命中时收窄 source memory ids，未命中时保留 workspace 级回退。
- evaluateRecallBehavior() 已提供召回—行动联合评估，并对 before/after 候选集合对称识别候选新增、撤回与行为来源变化；评估结果还标明阶段 top choice 是否在召回 workspace 中有真实来源，避免缺失来源的 0 分选择误通过。它仍是 evaluator，不是运行时 policy。真实 Host smoke 已证明 delayed outcome、blocked runtime scene，以及 permitted disposition → CurrentField → 多候选 action-selection → feedback → next recall/action 的运行链。
- MemoryStore.evaluatePersistedRecallBehavior() 现在从已持久化的 before/after recall、真实 model-input、action-selection use、action、outcome 和 feedback 重建 M6-05 评估；只有完整链条、版本推进、实际候选来源绑定且行为选择与阶段 top choice 一致时才判定通过。它仍是验证器，不授予运行时策略。
- 当前 runtime action 的 workspace fallback 仍保留在 action provenance；只有命中 CurrentField candidateActionSources 时，才登记对应的候选 action-selection use，避免把未命中行动窄化归因给某个候选。
- `FileMemoryStore.recordModelInput()` 在 Host 重启后会从持久化 recall 与 model-input 记录恢复唯一可判定的同 session workspace 绑定；若同 session 存在多个未绑定 recall，则保持 `unbound`，不按时间或 id 猜测。
- runtime 行为归属复用同一持久化关系：新 assistant/tool action 只有在同 session 存在唯一的 model-input-backed、尚未产生 action 的 recall 时才绑定；多个未决 recall 保持未绑定，已建立 action 的后续 tool call 才可沿原 action cycle 继续。缺少精确 cycle 的 delayed outcome/feedback 也不会回退到 session 最近一次 recall。
- runtime scene 现在允许 embedding application 通过 RuntimeSceneHint 或 MemoryPluginConfig.runtimeSceneDefaults 显式提供稳定的 user/rin participant id 与 scene goals；这些字段沿场景创建、跨 session 续接和行为 action record 传递。缺省时仍使用 session/scene scoped identity，系统不推断跨会话身份；同一场景中显式参与者或目标发生变化会拒绝续接。

owner 许可现在已有统一的 MemoryStore.permitInfluence() 入口：它在 cognition journal 中写入 owner-only、previous-version 绑定的 permit-influence / influence-permitted 事务，并由 materializer 确定性重放；runtime/background 通用 transition 不能再授予 influence。

当前 Wave6 多候选运行扩展已完成：真实 Host smoke 验证两条 permitted disposition 跨 Host 重启进入同一 CurrentField，候选按 selectionValue 排序，两个实际 tool action 分别命中各自 candidateActionSource 并登记 action-selection use；primary 被 reject 后其 inhibition 上升，alternative 在下一次 CurrentField recall 中升至第一，feedback 仍能产生 disposition 新版本并保持新 workspace hash。当前边界是 fixture 使用确定性 session event 与稳定 owner actor id；评估器已覆盖行为候选撤回、阶段首选来源存在性以及 store-level before/after phase persisted evaluation，但真实 provider 行为及更广泛 phase/policy/evaluator 覆盖仍未完成。
`@rin/backup` 的 rolling backup 以 `RIN_HOME` 为根。dsh 默认位于
`RIN_HOME/dsh`，也可由 `DSH_HOME` / `RIN_SESSION_ROOT` 独立迁移。
归档默认排除 credentials、`.env`、secrets 与 backups，不复制 manifest
之外的外部来源。

`packages/domains/assets/builtin/` 是内置 AssetRepository 数据，不是源码目录。

## 编译、解析与门禁链路

- `pnpm-workspace.yaml` 只发现 `apps/*` 与 `packages/*/*`；不存在
  `rin/*/*` workspace glob。
- `pnpm sync:references` 从 21 个 workspace manifest 生成 package project
  references、根 solution references 与 `tsconfig.base.json` paths。
- 结构门禁检查 21 个 package 的 census、根 references、paths、manifest entry、
  源码产物污染与 Cordis 依赖规则；`apps/cli` 和纯 contracts 包是明确的
  非 Cordis package。
- Vitest 的 Node lane 覆盖 canonical package paths，Web lane 只收集
  `apps/web/src`；smoke runner 也只发现 `apps/` 与 `packages/`。
- lint、readme、publint、依赖和 Cordis checks 均从根级 `tooling/` 入口运行。
- 跨 package import 使用 `@rin/*` 包名，package 内部使用相对 import。静态检查和
  测试通过 paths 解析到 `src/`；只有明确消费构建产物的检查读取 `lib/` 或
  `dist/`。

## 尚未证明

布局迁移本身已由 manifest census、`rin/` 缺失检查、references/path 同步以及
结构/Cordis/README/publint/dependency gates 证明。本轮还已实际通过完整
test、smoke、lint、Web build 与 coverage；最新数字和命令记录见
[ACTIVE.md](../roadmap/ACTIVE.md) 与
[REPOSITORY-LAYOUT-CLOSEOUT.md](../audits/REPOSITORY-LAYOUT-CLOSEOUT.md)。

以下项目仍必须以故障注入、对应平台或真实发布产物证明，不能从静态配置或 Linux
结果推断：

- coverage threshold 是否在故意降低覆盖率时确实阻断 CI；
- React 异步 warning 和 unhandled rejection 的治理；
- 真 provider、container、remote、install 生命周期；
- 跨平台签名/公证、真实 GitHub release updater 升级/回滚；
- Windows/macOS 的视觉交互、托盘动作和系统集成（原生 sidecar、安装与 clean-machine 启动已通过）；
- SBOM、构建 provenance 和 artifact attestation；
- Companion/Relationship 产品域、安全流程和消费者生命周期 UI。

## 文档权威

- [文档索引](../README.md)
- [目标架构](TARGET.md)
- [Seam 矩阵](SEAMS.md)
- [Web Client](WEB-CLIENT.md)
- [统一记忆实施主计划](../roadmap/MEMORY-IMPLEMENTATION.md)
- [旧版产品与发布路线](../roadmap/ACTIVE.md)
- [Backlog](../roadmap/BACKLOG.md)
- [ADR-0001](../decisions/ADR-0001-repository-layout.md)
- runtime feedback 若一个 action 绑定多个 prediction，则优先沿 outcome 的 prediction 回连；没有唯一可确定的 prediction 时保留 action/outcome 反馈但不虚构 prediction，避免错误生成 prediction error。
- runtime outcome 对多 prediction action 只有在事件显式携带 predictionId 时才绑定该 prediction；无显式绑定时仅在 action 只有一个 prediction 的情况下推断，materializer 采用同一规则。
- runtime outcome/feedback 在同一 cycle 或 correlation key 命中多个 action 时保持未绑定，不按时间或 id 猜测目标 action。
- runtime feedback 未显式携带 outcomeId 时，只有 action 关联唯一 outcome 才自动回连；多个 outcome 时保留 action-level feedback，不按最新时间猜测目标 outcome。
