# 记忆日志回放性能与语义验证

日期：2026-09-12。修改基线：`aecec99a1c19d367937dd056a4d38f2d63b95bbb`。
本记录是本地 Ubuntu/WSL、Vitest 4.1.8 的单机证据，不代表新提交已经通过远端 CI。

## 问题与实现

[CI #15](https://github.com/KaR7NA16/rin-harness/actions/runs/34696649895)
在 owner-intents 的日志边界测试中超过 120 秒。旧 `replay()` 对每笔事务调用
公开 `apply()`，反复重建完整 Map/Set、扫描已执行事务、协调所有场景并排序、
复制状态数组。新增加记忆的日志因而包含平方级累计工作。

现在的 `MaterializationDraft` 在一次回放内保留 Map/Set，最终才生成冻结快照。
公开 `apply()` 从传入快照创建独立 draft；异常不会修改原快照。重复事务仍被跳过。
每笔事务仍校验并应用全部事件，然后协调预测误差、推进 CurrentField 和版本。

预测误差按引用的 memory id 缓存。普通记忆事件仅协调变动场景；行为记录及其
排序发生变化时重建误差索引，并同时处理旧、新受影响的场景，确保擦除后清理
遗留误差。行为记录和链接在下一笔事务开始时恢复原有快照排序，保留延迟结果
与反馈的既有顺序。

分页查询从 `position = 0` 的首事件按 `event_seq` 范围读取，并关联完整事务 JSON。
事务协议要求事件 position 从零连续排列；固定 cutoff、limit + 1、多事件事务和
游标含义不变。没有新增 schema 或索引。

SQLite `EXPLAIN QUERY PLAN`：旧查询扫描 transactions、执行聚合并使用临时排序
B-tree；新查询使用 events 的 INTEGER PRIMARY KEY 范围查找，以及 transaction_id
索引查找。

## 本地性能

使用 owner-intents 现有 observed-scene 事务构造方式，分别测量生成、批量写入、
分页读取和内存回放；下表为 V8 覆盖率模式下内存回放时间。每格是一次测量，
用于说明该负载的增长趋势，不是统计置信区间或硬件无关预算。

| 事务数 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 1,000 | 0.382 秒 | 0.120 秒 |
| 2,000 | 1.273 秒 | 0.239 秒 |
| 4,000 | 4.643 秒 | 0.471 秒 |

原有 10,001 笔边界用例在单独 V8 覆盖率运行中从 35.232 秒降至 6.341 秒。
诊断配置只选取目标用例并关闭覆盖率阈值判定；它不替代下述正式覆盖率门禁。
测试中的 120 秒上限以及 999/1000/1001/10000/10001 边界均保留。

临时诊断配置、前后日志及旧实现副本保存在本地 `.artifacts/journal-diagnosis/`；
这些生成物不属于 Git 源码。长期性能基线仍可通过 `BENCH_SCENES=<数量> pnpm run bench:memory`
运行；该基准包含额外的 recall 和哈希阶段，其耗时不能直接冒充上表的测试诊断结果。

## 验证

- 记忆测试领域：20 个文件、239 个测试通过。诊断层额外将新旧实现的回放、单步
  应用及预期异常对照了 445 次，均一致；旧实现对照限定为最多 1,001 笔事务，
  大日志由原有完整性用例验证。
- 新增并扩展的回归检查覆盖逐前缀批量/单步状态一致、重复事务、失败后快照
  不变、延迟 outcome 的排序、擦除清理，以及场景切换/open-loop 的 CurrentField。
- 正式 `pnpm test:coverage`：203 个文件、1,876 个测试通过，耗时 34.39 秒；
  statements 63.70%、branches 57.98%、functions 61.12%、lines 66.10%。
  原有全局和分包覆盖率阈值未修改。
- `pnpm typecheck`、`pnpm lint`、`pnpm hygiene` 通过。
- 真实 Host 的 memory-runtime、memory-lifecycle、memory-intent-http、
  memory-journal-http 四条 keyless smoke 通过。

## 剩余成本

有活动场景时，CurrentField 推导仍检查现有记忆和链接；行为变化仍重建行为误差
索引。上面的规模改善适用于测量的 observed-scene 日志，不证明任意混合工作负载
都是线性耗时。公开单步 `apply()` 仍需要创建独立快照；本次优化主要消除完整日志
回放中不被外部观察的中间快照。
