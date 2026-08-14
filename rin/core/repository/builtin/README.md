# builtin — 内置 Asset Repository

@rin/repository 的出厂种子仓库：九类资产根 + 环境目录种子数据。

- environments/packages/：五个生态目录（system / python / r / node / latex），
  承自旧项目 environments 目录，schema 版本升级为 rin.dev/v1。
- environments/profiles/：scientific-base / bioinformatics-base /
  mathematical-modeling 三个环境 profile（含 verify 规格）。
- agents/rin-base.agent.yaml：starter agent，引用 scientific-base 环境，
  由 @rin/agents 投影到 dsh agent-presets。
- 其余根（skills / workflows / tools / knowledge / policies / outputs /
  bundles）为 .gitkeep 占位，等待各自域种子。

数据修正（相对旧仓库）：python 目录补入 python-biopython（旧
bioinformatics-base profile 引用了该包但目录缺失，属断引用）；node 目录
删除 '@anthropic-ai/claude-code'（CC 产品残余）。

本目录是仓库数据而非包代码：reader 只读、投影不回写；用户仓库可复制
本目录作为起点（mutable: true）。
