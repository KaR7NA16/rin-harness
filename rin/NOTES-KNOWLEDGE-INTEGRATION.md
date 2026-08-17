# rin 笔记 × 知识图谱 × 仓库 × 文件一体化方案

## 执行进度

- **Phase 0（已完成）**
  - ✅ `@rin/filesystem` 增加 `stat / readText / readBinary`（路径收容 + MIME）。
  - ✅ web-server 增加 `/api/filesystem/stat|text|file`，二进制文件支持 inline/attachment。
  - ✅ web-ui 新增 `FileExplorer` 与 `AssetPreviewModal`（PDF/图片/文本/音频/视频/下载回退）。
  - ✅ Files 工作区入口接入 IconRail / ContentRouter。
  - ✅ 文件根挂载：Home、当前 Workspace、Notes Vault、Knowledge 文件夹源、Repository 连接。
  - ✅ Notes 服务暴露 `vaultRoot()`，`GET /api/notes/root` 支持 Files 根解析。
- **Phase 1（已完成）**
  - ✅ `NotesIndex`：`<vault>/.index/notes.db`，索引 note / heading / block / task / tag / wikilink + FTS5。
  - ✅ `NotesVault.search / graph / todos` 已切换到索引查询；mtime 变化自动重建。
  - ✅ frontmatter properties 读写 API + PropertiesPanel UI；`title` 属性参与标题解析。
  - ✅ MarkdownRenderer 支持 Obsidian callout（`> [!note|warning|tip|todo]`）。
  - ✅ transclusion `![[note]]` 在预览中展开为目标笔记 callout。
  - ✅ heading/block 引用解析：`[[note#heading]]` 跳转标题，`[[note^block]]` 跳转块锚点。
  - ✅ 200 篇笔记索引规模测试。
- **Phase 2–5**：尚未开始。

> 目标：把 `@rin/notes` 从“Obsidian 风格 markdown vault”升级为 rin 的统一本地知识面，
> 同时把知识库、代码图谱、资产仓库和文件浏览投影进同一张图，而不是做四套孤立系统。
>
> 本方案基于对 GitHub 项目的联网调研与源码浅克隆，许可证只采用 MIT / Apache-2.0 参考源。

## 1. 调研结论

| 参考项目 | License | 在本方案中的角色 |
|---|---|---|
| `jackyzha0/quartz` v5 | MIT | Obsidian 语法与功能地图：backlinks / graph / search / tag-page / content-index / breadcrumbs / callouts / transclusion / note-properties |
| `silverbulletmd/silverbullet` | MIT | 笔记索引对象模型：page / header / link / tag / task / paragraph / table / anchor / frontmatter |
| `blacksmithgu/obsidian-dataview` | MIT | frontmatter 与行内字段、query/expression engine、markdown importer |
| `obsidian-tasks-group/obsidian-tasks` | MIT | 任务状态机、日期字段、优先级、重复任务、Filter/Query DSL |
| `dendronhq/dendron` | Apache-2.0 | 层级 lookup、引用解析概念参考 |
| Logseq / SiYuan / Joplin / mdSilo | AGPL 或混合 | 仅参考功能清单，不复制代码 |

**核心判断：**

1. 不能整体迁移某个项目；rin 的 Cordis host、文件 vault、node: 内置依赖架构必须保留。
2. 最需要复制的是“索引与对象化”思想：把 markdown 和各类本地资产变成可查询的实体和关系。
3. Obsidian 的体验价值主要来自：properties、wikilink/backlink、callouts、transclusion、tag page、活查询和统一图谱。

## 2. 现状盘点

| 子系统 | 已具备 | 缺口 |
|---|---|---|
| `@rin/notes` | vault I/O、wikilink/tag/frontmatter 解析、线性 search、graph、todos、templates、snapshots、assets、PDF 预览 | 无增量索引；无 properties UI；无 callouts/transclusion/block ref；无 live query；线性搜索 |
| `@rin/knowledge` | SQLite sources/documents/chunks + FTS5 | 只有 source→document→chunk 层级，不暴露实体和关系 |
| `@rin/codegraph` | 每项目 SQLite 代码 graph，file/symbol/call/reference 数据 | 数据独立，不与 notes/repository 关联 |
| `@rin/repository` | 文件仓库 reader，environments/agents 已种子化 | 其余七类资产根为空；浏览器只能按目录查看 |
| `@rin/filesystem` | `browse()` 路径收容目录浏览 | 无 `read()` / `stat()` / MIME / 通用文件预览 URL |
| web-ui | Notes 页（edit/graph/todos）、KnowledgeSpace（graph/files/search）、RepositoryWorkspace、CodeGraphVisualization | 三个图/浏览面各自为政，没有统一文件面板和图谱 |
| web-server | 各子系统独立 `/api/*` 路由 | 无统一 graph API，无 `/api/filesystem/file`（当前图片路径预览已引用未实现路由） |

## 3. 目标形态

### 3.1 一张图

所有本地知识实体最终投影到一个 **Knowledge Graph**：

```text
note ──wikilink──> note
note ──tag──> tag
heading ──contains──> note
block ──contains──> note
note ──embed──> asset
note ──mentions──> repository_asset
knowledge_chunk ──cites──> note
knowledge_document ──source──> file
code_symbol ──defined_in──> file
code_symbol ──references──> code_symbol
file ──child──> file
session_note ──derived_from──> session
```

### 3.2 一个文件显示层

把“文件”作为统一入口：

```text
侧栏 Files
├── Notes Vault (~/.rin/notes)
├── Knowledge Sources
├── Repository (builtin / user)
├── Workspace / Project
└── Recent & Pinned

内容区
├── Markdown 文件 → NoteEditor
├── PDF → PdfPreviewModal（已实现）
├── 图片 → 大图预览
├── 代码 → CodeViewer / Code Graph 入口
├── CSV/JSON/YAML → 表格/文本预览
└── 未知二进制 → 下载/十六进制占位
```

### 3.3 一张统一图谱画布

现有的 `NoteGraphView`、KnowledgeSpace graph、`CodeGraphVisualization` 收敛为一个共享的
`UnifiedGraphCanvas`：

- 节点按类型着色和分组：note / tag / heading / block / asset / knowledge / repository / code_symbol / file。
- 边按类型显示不同线型：wikilink / backlink / tag / embed / repo_ref / code_ref / cite / contains。
- 过滤面板：类型、路径根、标签、项目、最近修改、关联深度。
- 点击节点打开对应上下文：笔记编辑器、知识文档、仓库资产、代码符号、文件预览。

## 4. 新增包建议：`@rin/knowledge-graph`

目录建议：

```text
rin/memory/knowledge-graph/
├── src/
│   ├── types.ts        # GraphNode / GraphEdge / GraphFilter / GraphQuery
│   ├── store.ts        # node:sqlite 投影存储
│   ├── providers.ts    # notes / knowledge / codegraph / repository / filesystem providers
│   ├── query.ts        # related / shortest-path / neighborhood / stats
│   ├── seam.ts         # dsh tool registration: atlas_search / atlas_graph
│   └── index.ts        # Cordis plugin: ctx.knowledgeGraph
└── tests/
```

设计约束：

- **只读投影**：knowledge-graph 不写回 notes、knowledge、repository。
- **按需物化**：默认只在 UI/工具请求时刷新；不常驻后台索引。
- **provider 插件化**：每个数据源实现 `GraphProvider`，方便后续加 session-search、sandbox、teams。
- **host 零新外部运行时依赖**：仅 `node:sqlite` 和已有 workspace 依赖。

## 5. 数据模型

### 5.1 节点

```ts
interface GraphNode {
  id: string                // 稳定 URI，如 `note:work/ideas.md`
  kind: GraphNodeKind       // note|heading|block|tag|asset|knowledge_document|
                            // knowledge_chunk|repository_asset|code_file|code_symbol|file|session
  label: string
  path: string | null       // 本地文件路径
  source: string            // notes|knowledge|codegraph|repository|filesystem|session
  metadata: Record<string, unknown>
  modifiedAt: string | null
}
```

### 5.2 边

```ts
interface GraphEdge {
  from: string
  to: string
  kind: 'wikilink' | 'backlink' | 'tag' | 'contains' | 'embed' | 'mentions' |
        'cites' | 'repo_ref' | 'code_ref' | 'child' | 'derived_from'
  confidence: number        // 1 = 显式结构，<1 = 相似度/命名推断
  provenance: string        // 解析来源说明
}
```

### 5.3 索引表

```sql
CREATE TABLE graph_nodes(
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  path TEXT,
  source TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  modified_at TEXT
);

CREATE TABLE graph_edges(
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1,
  provenance TEXT NOT NULL,
  PRIMARY KEY(from_id, to_id, kind)
);

CREATE VIRTUAL TABLE graph_nodes_fts USING fts5(id, label, path, content='graph_nodes');
```

## 6. 各子系统改造

### 6.1 `@rin/notes`：成为真正的 notes engine

按调研的 SilverBullet / Quartz 思路，分四步：

1. **NotesIndex**
   - 新增 `src/indexer.ts`，基于 `node:sqlite`。
   - 索引 page、heading、block、tag、link、task、frontmatter、alias、asset。
   - 以文件 mtime + content hash 判断增量；`write()` 后同步更新。
   - `search()`、`graph()`、`backlinks()`、`todos()` 改为查索引。
   - 索引损坏时从 vault 全量重建。

2. **Obsidian 语法**
   - frontmatter：支持 `title / tags / aliases / created / modified`。
   - wikilink：支持 `[[note]]`、`[[note|alias]]`、`[[note#heading]]`、`[[note^block]]`。
   - callouts：`> [!note|warning|todo|tip]` 渲染。
   - transclusion：`![[note]]`、`![[note#heading]]`。
   - 块引用：`^block-id` 锚点。
   - 相对路径、`assets/`、PDF/图片嵌入统一解析。

3. **Properties 面板**
   - NoteEditor 侧栏增加 frontmatter 编辑。
   - 只改 YAML frontmatter，正文不动。

4. **Tag 页与活查询**
   - Tag 列表、Tag 详情页。
   - `dataview` / `tasks` 的最小查询子集，见 Phase 4。

### 6.2 `@rin/knowledge`：暴露实体关系

- 增加 `KnowledgeEntity` 投影：source、document、chunk 都有稳定 `knowledge:` URI。
- 对 markdown 文档解析标题和 wikilink，生成 note-like 实体。
- 允许注册 Notes Vault 作为知识 source（可选，避免重复索引时关闭 FTS，仅生成图谱投影）。
- `knowledge_search` 结果增加 `nodeId` 和 `links`。

### 6.3 `@rin/codegraph`：代码实体入图

- `code_file` 与 `code_symbol` 暴露为 GraphNode。
- 增加 path 归一化，使同一文件在不同图里的 URI 一致。
- 代码符号可关联：
  - `repository_ref`：由仓库资产里的 tool/workflow 定义推断。
  - `note_ref`：笔记 wikilink 提到文件名/符号名时产生低 confidence 边。

### 6.4 `@rin/repository`：资产实体入图

- 每个资产生成 `repository_asset` 节点。
- 关系：
  - `agent -> environmentProfile`
  - `environmentProfile -> package`
  - `workflow/tool -> knowledge_document/note/code_file`
- repository 根路径进入 File Explorer。

### 6.5 `@rin/filesystem`：补齐文件显示能力

最小扩展：

```ts
interface FilesystemService {
  browse(input: BrowseInput): Promise<BrowseResult>
  stat(path: string): Promise<FileStat>            // { size, mtime, mime, kind }
  readText(path: string, maxBytes?: number): Promise<{ content, truncated }>
  readBinary(path: string): Promise<Buffer>        // 或仅由 web-server 直读
}
```

新增路由：

```text
GET  /api/filesystem/stat?path=
GET  /api/filesystem/file?path=            # inline / attachment，MIME 自动识别
GET  /api/filesystem/text?path=&maxBytes=
```

这些路由继续走现有路径收容策略（home / temp / workspace / repository / notes）。

### 6.6 `@rin/web-server`：统一图谱 API

```text
GET  /api/graph/query?roots=notes,knowledge,repository,codegraph&depth=1
POST /api/graph/query              # 复杂过滤
GET  /api/graph/node?id=
GET  /api/graph/related?node=&kinds=
GET  /api/graph/stats?roots=
```

所有响应为：

```json
{
  "nodes": [{ "id": "note:work/ideas.md", "kind": "note", "label": "ideas", ... }],
  "edges": [{ "from": "...", "to": "...", "kind": "wikilink", ... }]
}
```

## 7. Web UI 一体化

### 7.1 工作区入口调整

建议把现有 workspace 入口整理为：

```text
Notes           → 笔记编辑、Graph、Todos、Tags、Properties
Files           → 统一文件浏览与预览（新）
Knowledge       → 知识 sources、FTS search、图谱过滤
Repository      → 仓库资产与配置
Atlas           → 统一知识图谱（可替代 KnowledgeSpace graph）
Monitor/Agents/Sandboxes 不变
```

### 7.2 共享组件

- `UnifiedGraphCanvas`：合并 NoteGraphView、CodeGraphVisualization。
- `FileExplorer`：合并 filesystem browse、notes list、knowledge sources、repository roots。
- `AssetPreviewModal`：把 PdfPreviewModal 泛化为 image/pdf/text/code/csv/audio/video 预览。
- `PropertiesPanel`：frontmatter 编辑器。
- `Callout`、`Transclusion`、`TagBadge`：MarkdownRenderer 扩展。

### 7.3 文件显示优先级

1. `.md` → NoteEditor
2. `.pdf` → PdfPreviewModal（已实现）
3. 图片 → ImageGalleryModal
4. 代码文件 → CodeViewer；若该项目 codegraph 已启用，显示 “View in Graph”
5. CSV/JSON/YAML → 表格/树形预览
6. 音频/视频 → 原生 `<audio>/<video>`
7. 未知 → 下载按钮 + 元信息

## 8. 分阶段路线

### Phase 0 — 文件地基（建议最先做）

- `@rin/filesystem` 增加 `stat / readText / readBinary / mime`。
- web-server 增加 `/api/filesystem/file|stat|text`。
- 新增 `FileExplorer` 与 `AssetPreviewModal`。
- 把 Notes、Knowledge、Repository 根接入 Files。
- 验收：任意受控路径文件可按类型打开或下载；所有旧路由不回归。

### Phase 1 — Notes 引擎化

- 实现 NotesIndex（node:sqlite）。
- `search / graph / backlinks / todos` 切到索引。
- 增加 frontmatter properties UI。
- callouts、transclusion、block ref、alias。
- 验收：1000 篇笔记搜索 < 50ms；graph 秒开；现有 notes 测试全绿。

### Phase 2 — Knowledge 实体化 + 初步图投影

- knowledge 暴露实体与关系。
- Notes Vault 可注册为 knowledge source（FTS 可关闭，图谱仍生成）。
- 新包 `@rin/knowledge-graph` 第一版：notes + knowledge providers。
- UI 增加 `Atlas` 页或升级 KnowledgeSpace graph。
- 验收：note ↔ knowledge_document 路径可追溯，图谱过滤器可用。

### Phase 3 — Repository 与 Code Graph 入图

- repository assets 生成节点/边。
- codegraph 暴露 code_file / code_symbol 节点。
- 路径归一化后与 notes/repository 建立低 confidence 关系。
- 验收：从 repo agent 出发可看到 environment、package、相关 notes、相关代码符号。

### Phase 4 — Obsidian 活查询

参考 Dataview + Tasks：

- 行内字段解析 `key:: value`。
- 查询块：

```markdown
```query
FROM #project
WHERE due < date(today)
SORT due ASC
```
```

- 任务字段：`due / scheduled / start / priority / recurrence / status`。
- 渲染为 React 表格/列表，只读为主，点击跳转原文。
- 验收：查询 DSL 有 parser 测试；模型可见快照更新。

### Phase 5 — 模型工具与记忆闭环

- 新工具：`atlas_search`、`atlas_graph`。
- `notes` 工具结果附 `nodeId` 与关系。
- session-search 投影 session→note/asset 关系。
- Agent 在会话中可通过图谱跳转 notes、knowledge、repository、code。
- 验收：模型工具冒烟、快照、hygiene 通过。

## 9. 门禁与测试

- 每个 provider 必须有 fixture-based 单测，不允许直接依赖真实用户 home。
- 图谱规模测试：1000 notes / 2000 chunks / 500 code symbols 内存与查询时间。
- 索引一致性测试：文件变更后 1 秒内 graph 查询反映新状态。
- snapshot：模型可见的 `atlas_search / atlas_graph / notes` 输出必须进 snapshot。
- 许可证：若复制 Quartz / SilverBullet / Dataview / Tasks 代码，在
  `THIRD_PARTY_NOTICES.md` 和文件头标注来源与 license。

## 10. 风险与对策

| 风险 | 对策 |
|---|---|
| SQLite 多包并发写入 | knowledge-graph 只读；notes/knowledge 各自一个写者；WAL + busy_timeout |
| 图谱节点爆炸 | 默认 depth=1、limit=300；block/chunk 节点按需展开 |
| 索引过时 | mtime + content hash；写路径同步更新；启动时校验 |
| 路径不一致 | 所有 provider 使用 realpath 归一化，URI 由 source+relativePath 生成 |
| Tauri/WebView 文件权限 | 继续沿用 filesystem 路径收容；二进制预览走 HTTP，不暴露 file:// |
| 许可证污染 | 只合并 MIT/Apache-2.0 参考实现；AGPL 项目只做功能参考 |

## 11. 下一步建议

按依赖顺序先启动：

1. **Phase 0**：文件读取与统一预览，工程量最小，立刻提升体验。
2. **Phase 1**：NotesIndex，为后续一切图查询打地基。
3. 之后并行：Knowledge 实体化 与 Repository/Codegraph provider。
