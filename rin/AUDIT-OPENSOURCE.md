# 开源级别全方位审计报告（rin-harness）

> 6 维度并行审计（许可证/安全/依赖/发布/文档/仓库卫生），全部只读核实。生成时间 2026-08-16。
> 这是「发布前阻断清单」；详细证据见各维度子代理报告。

## 总评级：🔴 需整改（Not ready）

| 维度 | 评级 | 阻断项 | 一句话 |
|---|---|---|---|
| 许可证与法律 | 🟢 基本就绪 | 0 | 无 copyleft 污染，仅 1 条 LGPL 未披露 |
| 安全 | 🔴 需整改 | 2 | 无认证 web-server + 命令执行/任意文件读 |
| 依赖卫生 | 🔴 需整改 | 1 | 7 条运行时 HIGH 漏洞随发布包下发 |
| 发布就绪 | 🔴 需整改 | 2 | manifest 入口全指向不存在产物 + 发布策略未声明 |
| 文档完整性 | 🔴 需整改 | 6 | 治理文档缺失 + 敏感路径 + 去品牌未完成 |
| 仓库卫生 | 🔴 需整改 | 2 | CI 分支 master≠main + 治理文档缺失 |

## 🔴 阻断清单（发布前必须解决，约 13 项）

### 安全（2）
1. web-server 无认证（默认 127.0.0.1:8320，无令牌/Host/Origin/CSRF 校验），却暴露 /api/sandboxes/execute（命令执行，自动 approve + shell:true）与 /api/knowledge?db=、addSources、/api/repository?root=（任意本地文件读）。CSRF/DNS-rebinding 可触发。
2. verify.commands 弱校验进 shell（只拦长度/控制符不拦 shell 元字符）+ ?db=/?root=/addSources 无路径 containment（可索引 /etc、~/.ssh）。

### 依赖（1）
3. 7 条运行时 HIGH 漏洞：fast-uri(SSRF)×2、ip-address(SSRF)、brace-expansion(DoS)×3、undici(信息泄露)——经 @modelcontextprotocol/sdk / e2b / pi-ai 随已发布的 dsh-mcp-client / dsh-llm-pi-ai / dsh-e2b 包下发。修复：升 sdk→1.30.0、e2b→2.39.0、pi-ai→0.84.2 + pnpm overrides 强制修复版。

### 发布就绪（2）
4. 22 个 rin 包 manifest 入口全指向不存在产物：main/exports.default/files/bin 写 lib/index.js、lib/bin.js，但 tsc 实际产出到 lib/types/（实测 lib/index.js 全仓零命中；files 白名单连真实 lib/types/**/*.js 都没列）。npm pack 或绕过 paths 解析即炸。
5. 发布策略未声明：22 包全 private + 无 release 家族（families.ts 硬编码 @deepseek-ai/ 前缀）+ release.yml 不含 rin。策略（内部 workspace 不发布）只写在 rin/AGENTS.md，未反映到发布面。

### 文档（6）
6. SECURITY.md 缺失（无安全上报渠道）。
7. CODE_OF_CONDUCT.md 缺失。
8. CHANGELOG.md 缺失（+ 无版本/发布记录机制）。
9. 内部规划文档含敏感信息：MIGRATION.md 的 E 盘/旧项目路径、/mnt/e/、D 盘路径、旧配置目录、CC 反编译表述；LEGACY-D-SPEC/AUDIT-REPORT/TECH-DEBT-PLAN 的子代理编排/决策过程。发布前须归档或清洗。
10. 根 README 是 dsh 的不是 rin 的（npx dsh web 3080、clone deepseek-harness，全文无 rin/8320/@rin）。
11. 去品牌已完成：repository API 版本对齐 rin.dev/v1；旧 oauth 路由/store 已取消；旧品牌 PNG 资产已删除；测试夹具中的个人路径已中性化。

### 仓库卫生（2）
12. CI 分支名 master≠main：7 个 workflow push 触发写 branches:[master]，本地默认分支是 main → push 到 main 不触发任何 CI。
13. .d.ts.map 无 .gitignore 规则（历史已误提交一次，会复发）。

## 🟠 高优先级（其次）

- 许可证：libvips（LGPL-3.0-or-later）运行时分发但 THIRD_PARTY_NOTICES 未披露（sharp optionalDependency，需落实 LGPL 通知/重链接/源码可得性）。
- 依赖：website 的 vite 5.4.21 HIGH（^5.4.14 到不了修复版 ≥6.4.3）；dev-only 的 js-yaml/nanoid/postcss/brace-expansion HIGH；dompurify 3.4.11 moderate（用于净化 agent 输出，实践影响高于评级）。
- 发布：rin.yml 不构建/不 typecheck web-ui 与 gui；ci.yml 的 all-checks-passed 不含 rin job（rin 失败可能不阻断 PR）。
- 文档：页面数 4 处矛盾（8/11/17，实为 17）；rin 文档非双语；PHASE4-STANDALONE API 契约过时。
- 仓库卫生：.gitignore 缺 *.pem/.env.*；rin.yml 仅 ubuntu（gui Tauri 零跨平台）。

## 🟡/⚪ 中低（收尾）

- 依赖过时（react 18→19 等 major）；无 SBOM；CI 无 pnpm audit 门禁。
- @rin 版权归属未显式声明；8 个 workspace 包缺 license 字段；khroma 缺 license override。
- 缺 CODEOWNERS；CONTRIBUTING 声明「不接受外部 PR」；根 package.json 元数据仍是 dsh；重复字体 blob。
- coverage 阈值 CI 不跑；web-ui TS ^5.9.3 vs 其余 ^6.0.3。

## 已验证干净（正面结论）

- 无强 copyleft（GPL/AGPL/SSPL）污染；根 LICENSE 标准 MIT；22 @rin 包 license 一致；vendor 合规；THIRD_PARTY_NOTICES 机制健全。
- 无硬编码密钥、.env 未跟踪、git 历史无密钥、误提交产物 0、大文件仅 2 个 woff2。
- 路径穿越防护（notes/repository/static/tasks）到位；SQL 全预编译。
- 单一 pnpm-lock、无锁文件漂移、pnpm 严格模式、@rin 依赖声明完整。

## 修复顺序建议

1. 安全 + 依赖（最高）：web-server 鉴权 + 路径 containment + 7 条 HIGH 漏洞升级（不能公开的硬伤）。
2. 发布就绪：manifest 入口修复（或删）+ 发布策略声明（决定能否发布）。
3. 文档 + 治理：SECURITY/CoC/CHANGELOG + 敏感路径清洗 + 去品牌 + 根 README 重写。
4. 仓库卫生：CI 分支名 + .gitignore + CODEOWNERS + 平台矩阵。

## 修复收口项（批次1 产生的待办）

1. **knowledgeSourcesRoots 默认值**（F1b fail-closed 安全默认导致默认部署下 POST /api/knowledge/sources 400）：需在 bundle cordis.yml 声明默认允许根（如 rinHome('knowledge/sources')），否则知识库写入功能默认不可用。
2. **web-server/tests/smoke.ts 破损**（notes/agents 段断言过期，B1/F1b 均确认）：应删除（已被 legacy-wire + 各写路由 smoke 覆盖）或修复。
3. **/api/environment/plan?root= 与 sandboxes-execute body root**（F1b 范围外，走同一 readAssetRepository 向量）：后续补 containment。
4. **knowledge dbPath containment 已做**（?db= resolve 到 knowledgeDbPath 目录内）。

## 发布策略决策（用户确认 2026-08-16）

**rin 将发布三种包体**：
1. **npm 包**：22 个 @rin/* 库包（含 @rin/cli 的 bin）——需配套：去 private（改 verify-rin-structure 门禁）、版本机制（changesets 或复用 dsh bump）、release 家族（families.ts 加 rin）、publint 覆盖 rin、manifest 入口自洽（F2a' 在做）。
2. **Tauri Windows exe**：rin/gui 的 tauri build（nsis）。
3. **Tauri Linux deb**：rin/gui 的 tauri build（deb）。

（之前『不发布 npm』的推断已撤销，F2a 删字段方向已还原并改派修复方向。）
