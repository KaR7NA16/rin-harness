# Rin 统一记忆系统蓝图

> 状态：Architecture definition — target authority for Rin memory cognition
>
> 日期：2026-08-26
>
> 实施边界：本文定义目标认知语义，不声称这些能力已经存在。当前事实仍以
> [CURRENT.md](CURRENT.md) 为准。本文不冻结 package 数量、数据库选型、迁移路线、
> 兼容层或候选项目接入方式。

## 1. 核心结论

Rin 的记忆不是保存文本并在下一轮检索文本的服务。它是 Rin 在时间中保持连续、形成
理解、修正自身并改变行为的内部系统。

目标系统只有一个逻辑记忆连续体。情景、语义、自我、他人、关系、程序和未来模拟不是
平行仓库，而是经历在同一记忆场中的不同组织状态。它们共享身份、时间、关联、激活、
修正、遗忘和影响控制；任何物理分区都不得破坏这条逻辑连续性。

完整循环是：

~~~text
环境与交互事件
      │
      ▼
场景形成 ──► 评价与预测误差 ──► 当前工作空间 ──► 解释、预测与行动
      │                                  ▲                  │
      ▼                                  │                  ▼
情景痕迹 ──► 关联、重放与巩固 ──► 记忆场激活 ◄── 行动结果与反馈
      │                  │                                   │
      │                  ├─► 世界结构                       │
      │                  ├─► 自我与他人模型                 │
      │                  ├─► 关系模型                       │
      │                  ├─► 行为倾向                       │
      │                  └─► 未来假设                       │
      │                                                      │
      └──────── 重巩固、抑制、衰减、归档与擦除 ◄───────────┘
~~~

记忆的目标不是尽可能多地保存，也不是尽可能快地返回相似文本，而是在当前情境中激活
对理解和行动真正有用的过去，同时维持时间、身份、关系和事实的连续性。

## 2. 设计原则

1. **基本形态是场景，不是原子文本。** 场景保留参与者、环境、时间、目标、情绪、
   行动、结果、解释和预测误差。事实、偏好、关系判断和技能从场景形成，但不能取代场景。
2. **记忆状态是多维向量。** 同一记忆可以持久、低激活、尚未整合、存在争议，并被禁止
   影响某类行为；不能压成一个生命周期枚举。
3. **激活、真实性和行为影响分离。** 重复召回提高可访问性，不自动提高真实性；情绪
   强度提高注意，不自动提高置信度。
4. **经历、推断和想象分离。** 未来模拟可以改变注意与计划，但不能因重复生成而变成
   “发生过的事实”。
5. **记忆形成与行为学习是同一循环。** 行动结果必须返回记忆系统，更新情景、模型和
   行为倾向；单向的写入—检索—注入不是完整记忆。
6. **类脑只采用计算原则。** 快速情景学习、缓慢结构学习、工作空间竞争、扩散激活、
   重放、重巩固、抑制和遗忘可以进入设计；脑区或睡眠阶段名称不能证明实现正确。
7. **当前代码和迁移成本不裁剪目标。** 现有 `MemoryItem`、Prompt Memory、Session
   Search、Knowledge Graph 和 Evolution 是当前能力，不是目标认知模型的边界。

## 3. 统一记忆场

### 3.1 形式定义

时刻 `t` 的记忆场定义为：

~~~text
Mₜ = (Vₜ, Lₜ, Dₜ, Πₜ)
~~~

- `Vₜ`：具有整体意义的表示，包括场景、结构、模型、行为倾向和未来假设；
- `Lₜ`：表示间的时间、参与、因果、语义、情绪、支持、冲突、预测和行动结果关联；
- `Dₜ`：每个表示和关联随时间变化的动态状态；
- `Πₜ`：控制形成、激活、召回、巩固、修正、遗忘和行为影响的认知策略。

工作空间 `Wₜ` 是记忆场在当前时刻形成的有限激活联盟：

~~~text
Wₜ ⊂ activation(Mₜ, perceptionₜ, goalsₜ, affectₜ, relationₜ)

Mₜ₊₁ = T(Mₜ, eventₜ, Wₜ, actionₜ, outcomeₜ, predictionErrorₜ, controlₜ)
~~~

`T` 不是一次模型生成。它包含确定性的状态约束、模型参与的解释与归纳、持久化事务以及
删除和影响控制。

### 3.2 表示形态

| 形态 | 内容 | 形成方式 | 认知作用 |
|---|---|---|---|
| 场景 `Scene` | 共同时间、参与者、目标和结果组成的经历 | 从连续事件绑定 | 回忆具体经历、解释当前情境 |
| 结构 `Structure` | 实体、关系、概念、时间和因果模式 | 多个场景关联和归纳 | 理解世界、完成推理 |
| 自我模型 `SelfModel` | Rin 的能力、价值、倾向、历史和变化 | 行为结果与长期模式整合 | 身份连续、自我校正 |
| 他人模型 `PersonModel` | 对一个人的状态、表达、偏好和变化的理解 | 对方陈述与共同经历整合 | 个体化理解和预测 |
| 关系模型 `RelationshipModel` | 共同历史、边界、承诺、距离、冲突和预期 | 双方事件与反馈累积 | 调整关系中的表达和行动 |
| 行为倾向 `Disposition` | 情境—行动—结果—限制结构 | 从成功、失败和纠正学习 | 选择策略、避免重复失败 |
| 开放回路 `OpenLoop` | 未解决的问题、目标、承诺和张力 | 场景未闭合或后果未确定 | 主动注意、后续追踪 |
| 未来假设 `Prospect` | 预测、计划、反事实和想象场景 | 从当前模型模拟 | 计划、预防和探索 |

这些形态不是互斥记录类型。一个场景可以同时改变他人、关系、行为和未来模型；每次改变
通过关联保留其认知路径。

### 3.3 关联语义

| 关联族 | 必须表达的含义 |
|---|---|
| 时间 | 先于、后于、同时、持续、有效于、结束于 |
| 场景 | 同一经历、延续、回应、重现、解决 |
| 参与 | 谁说、谁做、谁受影响、谁观察 |
| 语义 | 同一对象、相似、组成、概括、实例化 |
| 因果 | 导致、促成、阻止、解释、反事实替代 |
| 认识 | 支持、反驳、修正、取代、仍待验证 |
| 关系 | 共同经历、承诺、边界、信任变化、冲突、修复 |
| 行为 | 情境触发、采取行动、产生结果、收到反馈 |
| 情绪 | 引发、缓解、强化、情绪相似或相反 |
| 预测 | 预计、实现、未实现、超出预期 |

向量相似度只是产生候选关联的一种信号，不拥有最终关联语义。

### 3.4 动态维度

| 维度 | 回答的问题 |
|---|---|
| 激活 `activation` | 当前有多接近工作空间 |
| 可访问性 `accessibility` | 在合适线索下多容易重新激活 |
| 显著性 `salience` | 对目标、身份、关系或情绪有多重要 |
| 稳定性 `stability` | 多能抵抗改写和衰减 |
| 置信度 `confidence` | 当前证据支持程度 |
| 整合度 `integration` | 是否与相关场景和模型形成结构 |
| 新颖度 `novelty` | 相比已有结构提供多少新信息 |
| 预测误差 `surprise` | 实际与预期偏离多大 |
| 情绪 `affect` | 价性、唤醒和掌控感如何影响注意与回忆 |
| 有效时间 `validity` | 在什么时间和情境内成立 |
| 行为效用 `utility` | 在何种目标下帮助或损害行动 |
| 抑制 `inhibition` | 为什么当前不应激活或影响行为 |
| 影响许可 `influence` | 可影响哪些认知、表达或行动表面 |

这些维度不得折叠成一个“重要性分数”或隐藏的“亲密度分数”。

## 4. 当前场与工作空间

当前场是 Rin 对正在发生之事的结构化理解：

~~~text
CurrentFieldₜ = {
  scene, participants, goals, affect,
  predictions, predictionErrors,
  activeOpenLoops, candidateActions, candidateActionSources,
  activeMemoryCoalition, uncertainty
}

candidateActionSources = [{
  action, sourceMemoryIds,
  utility, inhibition, selectionValue, reasons
}]
~~~

它接受消息、工具结果、环境变化和用户纠正，也接受目标冲突、未完成承诺、情绪变化、
预测失败和记忆自发激活。

场景边界由时间间隔、参与者变化、目标变化、环境变化、行动阶段、情绪转折或问题闭合
共同决定。一次会话可包含多个场景，一个场景也可跨越多次会话；session 是传输单位，
scene 才是经历单位。

工作空间容量有限。感知解释、记忆、目标、情绪、开放回路和候选行动竞争进入当前认知。
胜出的不是单条记忆，而是能够共同解释当前情境的联盟。它负责广播当前内容、比较冲突
解释、维持目标与开放回路，并决定本轮经历对哪些长期结构产生学习压力。

## 5. 状态转移模型

### 5.1 正交状态轴

| 状态轴 | 状态 |
|---|---|
| 持久化 | `transient → encoded → durable → archived → erased` |
| 激活 | `dormant ↔ primed ↔ active ↔ workspace` |
| 整合 | `raw → linked → consolidating → integrated` |
| 认识 | `observed / inferred / hypothesized / contested / superseded / rejected` |
| 影响 | `permitted / restricted / blocked / revoked` |

`erased` 是终态；其身份只能作为删除传播标记存在，内容和派生影响不得继续被读取或注入。
其他状态都允许在新经历下重新开放。

### 5.2 主要转移

~~~text
事件到达
  └─► transient
        ├─ 无认知价值 ─► 会话归档，不进入可影响记忆
        └─ 形成场景 ─► encoded/raw
                         └─ 场景闭合 ─► durable/linked
                                          └─ 重放 ─► consolidating
                                                       └─ 整合 ─► integrated

dormant ──线索预激活──► primed ──竞争胜出──► active ──广播──► workspace
   ▲                                                        │
   └────────────── 冷却、抑制或任务结束 ◄───────────────────┘

active/workspace ──实际使用──► labile
labile + 新证据 ──► reinforce / revise / split / contest / supersede

低访问、低效用或长期被抑制 ──► archived
记忆所有者明确授权的擦除命令 ──► erased + 授权范围内的派生影响重算
~~~

`labile` 是短暂的重巩固窗口，不是另一条长期状态轴。

### 5.3 转移不变量

- 模型输出只能提出解释、关联、归纳和状态变化，不能把自身生成内容确认为观察事实；
- `hypothesized` 不能仅因重复召回转为 `observed`；
- 置信度只因新证据、证据失效或解释变化而变化，不能因激活次数变化；
- `superseded` 保留时间意义，不参与当前事实回答，但可用于历史问题；
- `revoked` 立即停止影响；`erased` 只能由记忆所有者明确授权，并必须在授权范围内
  传播到实际依赖它的派生结构和缓存；
- 关系和自我模型的高影响变化不能由单次模糊推断直接稳定化；
- 梦境、反事实和未来模拟始终为 `hypothesized`，不得写回真实经历链。

## 6. 记忆形成

Rin 应保留完整运行事件流，使模型可见输入和行为结果能够被重建。事件流回答“发生过
什么”，记忆形成回答“哪些经历开始影响未来认知”；两者不可互相替代。

事件进入认知记忆时先形成或更新场景，再由场景产生结构变化。系统不得先把每条消息抽成
孤立事实，再尝试事后拼接经历。

形成压力是多维向量：

~~~text
Appraisal = {
  novelty, predictionError, goalConsequence,
  relationshipConsequence, identityConsequence,
  affectiveIntensity, recurrence,
  unfinishedness, futureUsefulness
}
~~~

一次强预测失败可能形成高分辨率情景；反复但单次不显著的模式可以缓慢改变他人模型；
未完成承诺即使情绪平静，也保持开放回路。

场景必须保留参与者、时间、环境、目标、观察与解释的区别、行动、结果、情绪和关系背景、
当时预测及误差，以及与旧场景的延续或冲突。场景允许缺失，未知内容保持未知。

形成结果可以是：仅留在事件流、更新当前场景、形成持久情景、激活但不修改旧结构、增加
支持或冲突、创建开放回路、提出待验证假设，或触发立即/后台巩固。

## 7. 召回动力学

### 7.1 候选激活

召回是当前场对整个记忆场施加激活后形成工作空间联盟的过程。文本、向量、全文索引、
图遍历和时间查询只是候选发现机制，任何单一机制都不拥有召回结果。

~~~text
seedᵢ = cueMatchᵢ + goalRelevanceᵢ + participantRelevanceᵢ
      + temporalFitᵢ + affectiveFitᵢ + openLoopPressureᵢ
      + expectedDecisionValueᵢ + baseAccessibilityᵢ
~~~

各项保持独立。召回策略可按任务调整权重，但不得永久折叠成单一存储分数。

### 7.2 扩散与抑制

~~~text
aᵢᵏ⁺¹ = λᵢaᵢᵏ + seedᵢ + Σⱼ(wⱼᵢ · gateⱼᵢ · φ(aⱼᵏ))
          - competitionᵢ - suppressionᵢ - policyBlockᵢ
~~~

- `λ` 控制激活保持；
- `w` 是学习形成的关联强度；
- `gate` 根据目标、时间、关系和认识状态开关关联；
- `competition` 抑制竞争解释；
- `suppression` 表达暂时认知抑制；
- `policyBlock` 执行明确影响限制。

传播必须有能量、步数或时间上限。高扇出泛化节点降权，具体场景和因果路径在需要解释时
优先。

### 7.3 联盟选择

~~~text
C* = argmax_C [
  Σ utility(i) + coherence(C) + coverage(C) + causalSupport(C)
  - redundancy(C) - unresolvedConflictRisk(C)
]
~~~

联盟应组合核心场景、相关模型、时间或因果路径、行为倾向、开放回路、冲突和认识状态。
它不是若干摘要的 prompt 拼接。

召回输出为：

~~~text
MemoryCoalition = {
  focalScenes, activeStructures,
  selfAndRelationshipState,
  applicableDispositions, openLoops,
  conflicts, uncertainty,
  predictedUse, influenceDecision
}
~~~

进入模型上下文的是工作空间对联盟的表达；recall workspace 同时携带同一 materialized version
的 CurrentField，因此候选行动与记忆联盟沿同一 hash 进入模型。candidateActionSources 在同一
CurrentField 内记录每个行动的来源、目标效用、抑制、竞争值和解释；候选行动按竞争值确定性排序，
但排序仍是 Rin 的工作空间偏置，不等于模型已经执行。显式场景 goal 优先使用匹配 goal 的 utility；
场景尚未结构化 goal 时，只有已经通过 triggering context 进入候选的 disposition 才使用其
contextual utility，不能把无关目标的 utility 泛化到所有情境。召回只是候选激活，只有绑定到实际
model-input 记录的 canonical workspace 才形成 use trace，并记录实际影响了哪次决策。

开放回路、重复预测失败、关系事件、相似情境和未解决冲突可以产生自发预激活；它仍需
通过工作空间竞争和影响控制，不能绕过当前目标直接生成主动行为。

## 8. 巩固机制

### 8.1 多时间尺度

| 时间尺度 | 触发 | 主要工作 |
|---|---|---|
| 即时整合 | 明显预测误差或用户纠正 | 更新当前场景和解释 |
| 场景闭合 | 目标、参与者或问题阶段结束 | 固化场景、结果和开放回路 |
| 会话后整合 | 交互退出工作空间 | 连接场景、识别重复和冲突 |
| 空闲重放 | 有未整合、高误差或高影响经历 | 形成世界、自我、关系和行为结构 |
| 长周期重组 | 模型冲突、过时结构或长期模式积累 | 重构关联、弱化旧模式、形成新抽象 |

调度由记忆场状态驱动，而不是由一个固定脚本是否运行定义。

重放优先处理高预测误差、未解决后果、长期目标/身份/关系影响、跨场景模式、模型冲突、
反复行动失败和未整合经历。重复且稳定、没有新信息的经历降低优先级，但不因此变得不真实。

一次巩固可以连接场景、强化独立支持、形成概念或行为模式、按情境拆分过宽模型、保留
竞争解释、更新自我/他人/关系轨迹、形成开放回路、生成未来模拟或弱化失去适用情境的关联。

具体场景允许一次经历快速形成；稳定世界结构、自我、关系和行为倾向默认缓慢变化。明确
高影响事件可快速改变当前状态，但长期判断仍需后续经历验证。

### 8.2 巩固事务

生成模型提出场景解释、模式和结构变化；认知控制器负责：

1. 验证认识状态和允许的转移；
2. 检查是否把推断或想象冒充成观察；
3. 计算受影响的关联和派生结构；
4. 以一个原子事务提交场景、模型和行为倾向的共同变化；
5. 记录变化对后续召回和行为的实际影响。

不能让模型分别修改多个文件或独立记忆库，再依赖后续任务修补一致性。

## 9. 重巩固与冲突

进入工作空间并实际参与解释或行动的场景或模型进入短暂 `labile` 状态。新经历可执行：

- `reinforce`：新经历与已有结构一致；
- `revise`：局部属性或适用时间变化；
- `split`：原模型实际对应多个情境；
- `contest`：出现暂时无法判定的冲突；
- `supersede`：旧判断已被新判断取代；
- `reject`：原推断缺乏支持或已被证伪。

系统必须区分时间变化、情境差异、来源矛盾、Rin 理解错误、用户明确纠正和推断与观察
冲突。时间变化使用有效区间，情境差异使用条件化结构，真正矛盾进入 `contested`；最近
内容不自动获胜。

回忆产生当前重构，不改写原始场景。新的理解形成后续解释关系，使 Rin 能同时表达
“当时我是这样理解的”和“后来我发现理解错了”。

## 10. 遗忘、抑制与擦除

硬擦除不属于 Rin 的自动认知动力学。只有记忆所有者发出的明确命令才能授权擦除；模型、
巩固过程、定时任务、安全策略和系统维护都只能降低激活、抑制、归档、提出修正或请求
授权，不能自行升级为擦除。授权必须给出确定范围，传播只能清除该范围产生的派生影响，
不能扩展到没有认知依赖的场景或模型。这里的“所有者”指对该记忆空间拥有数据权利的
用户或由其明确委托的主体，不是模型、插件或后台任务。

| 机制 | 含义 | 删除内容 |
|---|---|---|
| 激活衰减 | 不再占用工作空间 | 否 |
| 可访问性衰减 | 普通线索更难激活 | 否 |
| 竞争性抑制 | 更相关结构暂时压制 | 否 |
| 归档 | 退出普通召回，仅在历史需求下恢复 | 否 |
| 授权擦除 | 授权内容及实际依赖它的派生影响停止存在 | 是 |

`superseded` 是时间取代，`revoked` 是停止影响，都不等于擦除。

衰减主要作用于可访问性和关联强度，不直接作用于真实性。多结构支持、长期目标/身份/关系
价值、可验证行为价值、未解决后果和跨时间重复支持减缓衰减；长期无适用情境、持续错误
召回、已被更精确结构解释、孤立噪声或长期无用/有害会加速衰减或归档。

执行经记忆所有者明确授权且范围确定的场景擦除时，必须重新计算由该范围支持的世界判断、
他人和关系模型、行为倾向、摘要、索引、embedding、召回缓存、未来模拟、开放回路和
尚未发送的模型上下文。若模型仍有独立支持，可保留但降低支持度；若所有支持被擦除，
它不能继续影响行为。

## 11. 自我、他人与关系模型

自我模型包含长期价值、表达倾向、能力边界、过去行为与结果、反复错误、正在学习的能力、
不同关系中的位置、当前目标/情绪/冲突和未来变化假设。静态人格文件可以作为初始条件或
展示投影，不能成为自我模型本体。

他人模型区分对方明确表达、多次行为模式、当前暂时解释、未验证预测和已过时理解。偏好、
情绪、边界和目标都有时间与情境，不能压成永久 profile 字段。

关系模型是双方共同历史的动态结构，至少包含共同场景、承诺、边界、互动和修复模式、
信任变化依据、未解决冲突、未来预期和当前距离/亲近/不确定性。关系变化必须来自可解释
事件和模式；系统不得用一个不可见总分驱动亲密、主动联系、排他表达、增长或付费。

当前行为由自我、他人、关系和目标共同决定：用户偏好不自动成为关系边界，关系历史不
覆盖用户当前表达，Rin 的人格倾向不证明行动合适，强烈情绪不能越过明确边界，旧策略在
新情境仍需重新评估。

## 12. 程序记忆与行为倾向

~~~text
Disposition = {
  triggeringContext, intendedGoal, actionPattern,
  expectedOutcome, observedOutcomes,
  applicabilityConditions, failureModes,
  confidence, utilityByGoal, lastRevisedAt
}
~~~

同一行动可以在任务目标上有效、在关系目标上有害，因此效用不能压成单一 reward。

行为倾向来自完整结果链：

~~~text
当前场 → 召回联盟 → 预测 → 行动 → 可观察结果 → 用户反馈 → 延迟后果
~~~

模型自评不能证明策略有效。用户纠正、工具结果、环境变化和后续互动都可以推翻当时判断。
可导出的 skill 是程序记忆的一种表达，不是程序记忆本体；程序记忆还包括无需生成技能
文件的注意方式、提问顺序、错误规避、工具选择和互动调整。

## 13. 未来模拟

未来模拟组合当前场、长期结构和行为倾向，用于比较行动、预见边界/安全/关系风险、发现
缺失信息、生成反事实、判断询问或暂缓行动，以及为开放回路选择关注时机。

模拟始终保持 `hypothesized`。真实事件到来后，预测才转化为命中、部分命中或预测误差，
并参与行为学习。

## 14. 行为反馈模型

~~~text
感知 → 当前场 → 召回联盟 → 解释与未来模拟 → 选择行动并记录预期
     → 执行语言/工具/环境行动 → 观察即时与延迟结果
     → 多维反馈与预测误差 → 更新情景、模型、行为倾向和注意策略
~~~

反馈向量为：

~~~text
Feedback = {
  taskOutcome, actionCost, factualCorrection, predictionAccuracy,
  userResponse, relationshipConsequence,
  boundaryRespect, autonomyEffect,
  safetyEffect, delayedConsequence
}
~~~

`actionCost` 进入当前 `intendedGoal` 的 `utilityByGoal` 样本，并对可访问性/抑制施加小幅
动力学影响；它不覆盖事实、关系、安全和边界反馈，也不被提升为跨目标的单一奖励。

反馈不能合成为单一长期奖励。聊天时长、回应频率、自我披露或付费行为不能作为关系或
记忆系统的正向学习目标。

| 反馈 | 主要更新对象 |
|---|---|
| 事实纠正 | 场景解释、世界结构、置信度和冲突状态 |
| 预测命中/失败 | 预测模型、关联强度和注意先验 |
| 工具成功/失败 | 行为倾向、适用条件和失败模式 |
| 用户接受、拒绝或不适 | 当前场、他人模型、关系模型和表达策略 |
| 边界改变 | 影响许可、关系模型和主动行为条件 |
| 延迟后果 | 原行动场景、策略效用和长期模型 |
| Rin 发现自身错误 | 自我模型、元记忆和询问/拒答策略 |

记忆可影响感知、解释、表达、工具选择、主动行为和巩固优先级，但不同表面有不同许可。
允许帮助理解，不代表允许触发主动联系或改变关系模式。影响控制是认知状态，不是外部
适配层。

## 15. 元记忆

元记忆维护 Rin 对自身记忆能力的判断：当前是否有足够信息；召回失败源于没有经历、
线索不足还是抑制；哪些结构高激活但低可靠；哪些结论有冲突；哪些行为从未被结果验证；
哪些自我或关系判断由单次事件过度形成；哪些模型正在快速变化；何时应询问、承认不知道、
延迟行动或重新检查。

元记忆必须阻止“有内容可说”被误当成“有足够根据回答”。

## 16. 运行时语义

Rin 同时维护三条时间线：

1. **发生时间线**：环境和交互中实际发生的事件；
2. **认识时间线**：Rin 何时形成、修改或放弃某个理解；
3. **影响时间线**：某段记忆何时进入工作空间并实际影响行为。

三者使系统能够重建“发生了什么、当时如何理解、为什么采取该行动”。这属于记忆运行
语义，不需要为每个外部项目生成来源文件。

所有长期变化通过同一认知事务提交：

~~~text
interpretation proposal
  → transition validation
  → dependency impact calculation
  → atomic commit
  → projection refresh
  → future influence audit
~~~

模型不能直接写数据库、静态人格文件或关系状态。它提出具有认识状态的变化，领域逻辑
验证和提交。

模型上下文是工作空间的临时表达，不是记忆本体。它应包含当前场、记忆联盟、冲突与
不确定性、行为倾向、影响限制和本轮待验证预测。每次模型可见输入都进入 session event；
不能用“系统曾检索到”替代“模型实际看到了”。

## 17. 与当前实现的关系

| 当前实现 | 已有作用 | 蓝图判断 |
|---|---|---|
| dsh session event / JSONL | 保存会话与模型可见事件 | 可作发生时间线底座，但 session 不是场景 |
| `@rin/memory` SQLite catalog | 统一 ID、版本、来源、可见性、撤回、删除和注入记录 | 是身份与数据权利底座，不是认知记忆场 |
| `MemoryItem.kind` | 粗粒度内容分类 | 继续扩展枚举不能表达完整记忆状态 |
| Prompt Memory `SOUL/BRIEF/USER` | 有预算的模型可见文本投影 | 不是自我、他人或关系模型 |
| Session Search | FTS/LIKE 会话检索和上下文窗口 | 是候选发现机制，不是召回动力学 |
| `@rin/knowledge` | 文档索引和跨来源只读图 | 可贡献结构候选，不拥有记忆形成和行为学习 |
| `@rin/evolution` | 技能候选、评审、批准和持久化 | 是窄范围程序学习原型，不是完整程序记忆 |
| injection audit | 记录进入模型表面的版本 | 可成为影响时间线一部分，需扩展到工作空间和行为结果 |
| tombstone | 阻止普通投影重新激活 | 可作擦除传播基础，尚不具备认知依赖重算 |

当前 `active/revoked/deleted`、`kind/content/source` 和 projection manifest 继续描述当前
事实，但目标实现不以兼容这些字段为约束。实现设计应从完整状态向量和事件语义反推新的
领域模型。

## 18. 本文暂不决定的实现问题

- 物理上使用一个还是多个数据库；
- 采用 SQLite、图数据库、向量索引或混合引擎；
- 将职责放在现有 package，还是整体合并或重组；
- 如何迁移当前 `MemoryItem` 和 Prompt Memory 数据；
- 采用哪个外部项目、库或协议；
- 哪些时间点运行后台巩固；
- 每个动力学参数的默认值。

这些问题必须从本文的认知语义和运行不变量推导，不能反向改变记忆连续体。

## 19. 研究吸收

本文不是从单一项目改写而来。以下材料用于确认机制和设计冲突，不构成候选排序或运行时
证明。

| 方向 | 材料 | 吸收内容 |
|---|---|---|
| 认知架构 | [CoALA](https://arxiv.org/abs/2309.02427)、[ACT-R](https://act-r.psy.cmu.edu/)、[Global Workspace / IDA](https://www.sciencedirect.com/science/article/pii/S089360800700161X) | 记忆、工作空间、行动和决策同属一个系统；激活竞争参与行为 |
| 快慢学习与重放 | [Complementary Learning Systems](https://pubmed.ncbi.nlm.nih.gov/9668656/)、[hippocampal-neocortical interactions](https://www.annualreviews.org/content/journals/10.1146/annurev.psych.093008.100523) | 快速形成场景、缓慢形成结构，重放负责整合而非复制 |
| 反思与规划 | [Generative Agents](https://arxiv.org/abs/2304.03442)、[Reflexion](https://arxiv.org/abs/2303.11366)、[MemGPT](https://arxiv.org/abs/2310.08560) | 经历、反思、规划和行为反馈闭合；主动控制上下文 |
| 关联召回 | [SYNAPSE](https://github.com/hq0709/synapse)、[HippoRAG](https://github.com/OSU-NLP-Group/HippoRAG)、[A-MEM](https://github.com/agiresearch/A-mem) | 多关系传播、竞争抑制、图结构与语义检索协同 |
| 时间与修正 | [Midas](https://github.com/vornicx/Midas)、[memharness](https://github.com/las7/memharness)、[Memento](https://github.com/shane-farkas/memento-memory)、[Graphiti](https://github.com/getzep/graphiti)、[OpenGraphMemory](https://github.com/ardiannurcahya/open-graph-memory) | 发生时间、认识时间、有效区间、冲突、取代和回溯独立 |
| 巩固与遗忘 | [mnemos](https://github.com/anthony-maio/mnemos)、[companion-emergence](https://github.com/hanamorix/companion-emergence)、[sovyx](https://github.com/sovyx-ai/sovyx)、[Anda Brain](https://github.com/ldclabs/anda-brain)、[Engram](https://github.com/engram-agents/engram)、[MemHop](https://github.com/qyiun666/MemHop) | 惊奇门控、离线重放、结构强化、抑制、衰减和梦境重组 |
| 多形态记忆 | [OpenMemory](https://github.com/peter-j-thompson/openmemory)、[MIRIX](https://github.com/Mirix-AI/MIRIX)、[MemoryOS](https://github.com/BAI-LAB/MemoryOS)、[Hindsight](https://github.com/vectorize-io/hindsight)、[MemOS](https://github.com/MemTensor/MemOS) | 不同表示有不同变化规律，但不退化成隔离仓库 |
| 身份与关系 | [Mira](https://github.com/kernelx30/Mira)、[ZifaMem](https://github.com/zifacorp/zifamem)、[RelationsOS](https://github.com/connectos-ai/relationsos)、[Eros Engine](https://github.com/etherfunlab/eros-engine)、[resonant](https://github.com/codependentai/resonant) | 自我、他人和双方关系是不同但相互作用的动态模型 |
| 程序学习 | [ReMe](https://github.com/agentscope-ai/ReMe)、[MemU](https://github.com/NevaMind-AI/memU)、[Letta Code](https://github.com/letta-ai/letta-code)、[SimpleMem](https://github.com/aiming-lab/SimpleMem) | 技能、行为倾向、反思和自我演化由实际结果修正 |
| 长期评估 | [LongMemEval](https://arxiv.org/abs/2410.10813)、[LongMemEval-V2](https://arxiv.org/abs/2605.12493) | 最终验证跨会话、时间变化、更新、拒答、工作流经验和前提识别 |

项目 README 和论文证明其公开设计主张，不证明 Rin 已实现相应能力，也不证明其生物学
解释、长期效果或产品质量。蓝图吸收机制问题，不保留外部项目的目录和命名。

## 20. 蓝图完整性条件

后续领域模型只有同时回答以下问题，才算遵守本文：

1. 连续交互如何形成跨会话场景，而不是消息碎片？
2. 经历如何改变世界、自我、他人、关系、行为和未来模型？
3. 激活、真实性、稳定性、置信度和行为许可如何独立？
4. 目标、情绪、参与者和开放回路如何共同驱动召回？
5. 多条记忆如何经扩散、抑制和联盟选择进入工作空间？
6. 召回如何触发重巩固而不改写原始历史？
7. 巩固如何跨时间尺度重放、抽象、拆分、修正和弱化结构？
8. 预测和梦境如何影响行动但不冒充经历？
9. 行动的即时与延迟结果如何返回程序、自我和关系学习？
10. 抑制、归档、撤回和擦除如何产生不同结果？
11. 擦除如何使全部派生结构和未来影响重新计算？
12. 模型实际看到什么、为何行动、结果如何，能否从事件重建？

任何只回答存储 schema、检索接口、向量排名或 prompt 拼装的设计，都没有覆盖 Rin 的
完整记忆系统。
