# @rin/web-server

rin web-server — a Cordis host plugin that runs an independent node:http server
on its own port, exposing a JSON API over the optional @rin services and
serving the static frontend from the package's static/ directory. It does not
touch the dsh Web UI; it is rin's own Web surface.

The HTTP core (server + routes + helpers) carries **zero external runtime
dependencies** — only node: builtins plus local modules. Every @rin import is
type-only (devDependencies), so the strip-types smoke test runs without any
workspace build or node_modules resolution.

## Config

All fields are optional and validated by the Config schema:

| Field | Default | Meaning |
|---|---|---|
| port | 8320 | Listen port (non-negative integer, ≤ 65535). |
| host | 127.0.0.1 | Listen host (loopback or all-interfaces literal). |
| enabled | true | When false, the service is still mounted (health reports it) but no listener starts. This is the coexistence switch that keeps the dsh Web UI (3080) independent: close only the rin 8320 surface. |
| authToken | — | Optional bearer token. When set, every /api/* request must present it via `Authorization: Bearer <token>` or `?token=` (the latter for the static frontend); wrong or missing → 401. Static files stay open. |
| repositoryRoot | — | Default repository root for endpoints that accept ?root=. |
| staticRoot | <package>/static | Static frontend directory. |
| knowledgeDbPath | — | Default knowledge database; knowledge endpoints accept ?db= to override. |
| skillMemoryRoots | — | { globalConfigRoot, projectConfigRoot? } for /api/skill-memory/overview. |

The plugin reads the optional @rin services through ctx.get() at request time,
so it loads whether or not they are mounted. The health endpoint reports which
are present.

## JSON API (v1)

Base: http://<host>:<port>. All responses are application/json; errors are
4xx/5xx with body {"error":"<message>"}. GET/HEAD serve the API and static
files; POST is accepted for /api/* write endpoints (JSON body ≤ 1 MiB).

- GET /api/health → {"ok":true,"name":"rin-web","version":"0.1.0","services":{...}},
  where services reports repository, environment, smartPruning, knowledge,
  sessionSearch, promptMemory, evolution, skillMemory, agents, notes,
  sandboxes, and tokenOptimization as booleans.
- GET /api/repository?root=<abs> → the full AssetRepository JSON. root is
  optional when Config.repositoryRoot is set; missing root → 400, read failure
  → 500.
- GET /api/environment/plan?profile=<id>&root=<abs>&platform=&apt=&python=&pip=&r=&npm=&tlmgr=
  → the full ResolvedEnvironmentPlan JSON. profile is required; platform
  defaults to process.platform; runtime booleans default false. Missing or
  unknown profile → 400.
- GET /api/smart-pruning/status → {"mounted":true,"enabled":bool,"level":string,"mode":string}
  or {"mounted":false}. mode passes through SmartPruningStatus (e.g. "deterministic").
- POST /api/smart-pruning/set → body {"enabled"?:bool,"level"?:string}; at
  least one field required. level must be conservative|balanced|aggressive
  (invalid → 400). Returns {"mounted":true,"enabled":bool,"level":string,"mode":string}.

## JSON API (v2) — service endpoints

Unified envelope: unmounted service → 200 {"mounted":false}; mounted but missing
a required parameter → 400 {"error":"..."}; otherwise → 200 {"mounted":true,
...result}.

### agents

- GET /api/agents?root=<abs> → {"mounted":true,"agents":[RepositoryAgentRecord...]}.
  root falls back to Config.repositoryRoot, then the store's own default.
- GET /api/agents/runtime → {"mounted":true,"agents":[RuntimeAgentDefinition...]}.
- POST /api/agents → body {"root"?:string,"input":RepositoryAgentInput}
  (input requires name, description, systemPrompt) →
  {"mounted":true,"agent":RepositoryAgentRecord} (includes revision).
- POST /api/agents/{name}/update → body {"root"?:string,"input":RepositoryAgentUpdateInput}
  (input has no name; description + systemPrompt required) →
  {"mounted":true,"agent":RepositoryAgentRecord}.
- POST /api/agents/{name}/delete → body {"root"?:string} →
  {"mounted":true,"deleted":true}.
- POST /api/agents/project → body {"root"?:string,"presetRoot"?:string} →
  {"mounted":true,"ids":[...]}.
- POST /api/agents/propose → body {"root"?:string,"instructions":string} →
  {"mounted":true,"proposal":AgentProposal}. Requires a real LLM adapter; a
  missing adapter → 500 {"error":"..."}.

### notes

The vault root is owned by the @rin/notes Config; routes never pass a path.

- GET /api/notes → {"mounted":true,"notes":[NoteMeta...]}.
- GET /api/notes/read?path=<note.md> → {"mounted":true,"note":NoteDocument};
  missing note → 404.
- GET /api/notes/search?query= → {"mounted":true,"results":[NoteSearchResult...]}.
- GET /api/notes/graph → {"mounted":true,"graph":{nodes,edges}}.
- GET /api/notes/todos → {"mounted":true,"todos":[NoteTodo...]}.
- GET /api/notes/templates → {"mounted":true,"templates":[NoteTemplate...]}.
- POST /api/notes/write → body {"path":string,"content":string} →
  {"mounted":true,"note":NoteDocument}.
- POST /api/notes/delete → body {"path":string} → {"mounted":true,"deleted":true}.
- POST /api/notes/backup → body {"title":string,"content":string} →
  {"mounted":true,"note":NoteDocument} (a session exported under backups/).

### sandboxes

- GET /api/sandboxes → {"mounted":true,"sandboxes":[SandboxProfile...]}.
- POST /api/sandboxes → body SandboxProfileInput (name + type required) →
  {"mounted":true,"sandbox":SandboxProfile}.
- POST /api/sandboxes/{id}/update → body SandboxProfilePatch →
  {"mounted":true,"sandbox":SandboxProfile}.
- POST /api/sandboxes/{id}/remove → {"mounted":true,"removed":bool}.
- POST /api/sandboxes/{id}/default → {"mounted":true,"sandbox":SandboxProfile}.
- POST /api/sandboxes/{id}/probe → {"mounted":true,"capabilities":ResolverCapabilities}.
- POST /api/sandboxes/execute → body {"profileId","repositoryId","environmentProfileId","root"?}
  → probes the profile's capabilities, calls ctx.environment.plan(root,
  environmentProfileId, capabilities), then executeEnvironmentPlan →
  {"mounted":true,"run":InstallRun} (status + per-stage logs).

### token-optimization

- GET /api/token-optimization/status → {"mounted":true,"responseStyle":string,"cleanPrompt":bool}
  or {"mounted":false}.
- POST /api/token-optimization/set → body {"responseStyle"?:string,"cleanPrompt"?:bool};
  at least one field required. responseStyle must be off|caveman|ponytail
  (invalid → 400). Returns {"mounted":true,"responseStyle":string,"cleanPrompt":bool}.

### read-only services (unchanged)

- GET /api/knowledge/sources?db= → {"mounted":true,"sources":[...]}.
- GET /api/knowledge/documents?db=&sourceId=&limit= → {"mounted":true,"documents":[...]}.
- GET /api/knowledge/search?db=&query=&limit= → {"mounted":true,"results":[...]}; query required.
- GET /api/knowledge/stats?db= → {"mounted":true,...}.
- GET /api/sessions/browse?limit= → {"mounted":true,"success":true,"mode":"browse",...}.
- GET /api/sessions/discover?query=&limit= → {"mounted":true,"success":true,"mode":"discover",...}.
- GET /api/sessions/read?key=<sessionId> → {"mounted":true,...}; 404 when not indexed.
- GET /api/prompt-memory/status → {"mounted":true,"files":{soul,brief,user}}.
- GET /api/prompt-memory/file?target=user|brief → {"mounted":true,...}.
- GET /api/prompt-memory/review-logs?limit= → {"mounted":true,"logs":[...]}.
- GET /api/evolution/overview → {"mounted":true,"config":...,"pendingCandidates":[...],...}.
- GET /api/skill-memory/overview → {"mounted":true,"skills":[...]}. Requires Config.skillMemoryRoots.

Static: GET / serves static/index.html; GET /<path> serves files under the static
root with path-traversal protection; anything else is 404. The static/ directory
is owned by the frontend package.

## Terminal WebSocket

Endpoint: `/ws/terminal/<terminalId>` where terminalId is the frontend tab's
session id (e.g. `__terminal__1`). JSON text frames both ways; one connection
owns one spawned session and the session dies with the connection.

Client → server:

- `{"type":"spawn","argv"?:string[],"cwd"?:string,"cols"?:number,"rows"?:number}`
  — sent first, once. argv defaults to the login shell (`$SHELL`, fallback
  `/bin/bash`); cwd defaults to `process.cwd()`; geometry defaults to 80×24.
- `{"type":"input","text":string}` — raw text to the PTY (no implicit newline).
- `{"type":"signal","signal":"SIGINT"|"SIGTERM"|"SIGKILL"|"SIGTSTP"|"SIGHUP"}`
  — signals the foreground process group.
- `{"type":"close"}` — terminates the session.
- `{"type":"ping"}` — health.

Server → client:

- `{"type":"ready","terminalId":string,"pid":number}` — spawn succeeded.
- `{"type":"data","text":string}` — PTY output delta.
- `{"type":"exit","exitCode":number|null,"signal":string|null}` — PTY exited.
- `{"type":"error","message":string,"code":string}` — code is
  SPAWN_FAILED | SUBPROCESS_UNAVAILABLE | NOT_SPAWNED | INTERNAL.
- `{"type":"pong"}`.

Sessions are spawned through the dsh subprocess provider
(`ctx.subprocess`); when that service is absent, spawn reports
SUBPROCESS_UNAVAILABLE. The server close path terminates every live session, so
no PTY outlives the web-server.

## Request guards

The server applies layered request guards at the single HTTP entry point and at
every WebSocket upgrade (legacy and terminal), regardless of `authToken`:

- **Host**: the `Host` header must name a loopback host (`127.0.0.1`,
  `localhost`, or `::1`) on the bound port (or with no port); anything else →
  403. This blocks DNS-rebinding.
- **Origin**: when a request carries an `Origin` header, it must be same-origin
  (http, matching host + port) as the request Host; cross-origin → 403.
- **Token**: when `authToken` is set, every `/api/*` request and the WebSocket
  handshake must present it; wrong or missing → 401.

The default (`authToken` unset) keeps the existing tokenless behavior for the
static frontend: no UI change is required.

## Known Limitations and Deferred Work

- /api/agents/propose requires a composed dsh llm seam (its default adapter
  resolves the first provider/model at runtime); without one it returns a clear
  error. Real-machine verification required.
- /api/sandboxes/execute and /api/sandboxes/{id}/probe run real capability
  probing and environment-plan execution; they require a real sandbox provider
  (local/container/remote) and are exercised by the smoke test with an injected
  fake. Real-machine verification required.
- The static/ directory is owned by a separate frontend package; this plugin only
  reads it and returns 404 for missing files.
- Listen failures are logged rather than failing the plugin fiber.
- The skill-memory overview enumerates the skill-memory directory and reads
  STATS.json/SUMMARY.md directly, because the store's read methods are per-skill
  (ref-scoped) and expose no global enumeration. Its layout helpers are inlined
  here to keep the server core zero-runtime-dep.
- Terminal sessions are POSIX-only: the login-shell default ($SHELL /
  /bin/bash) is a POSIX concept, so spawn fails loud with SPAWN_FAILED on
  win32. Explicit argv does not bypass this guard in v1.
- Terminal resize is NOT implemented: SubprocessTerminalHandle has no resize
  method, so every session spawns at a fixed 80x24 and the client's cols/rows
  only set the initial geometry. A future seam with resize support is required
  before geometry changes can work.
- A terminal session is v1-ephemeral: it dies when its socket closes or the
  server closes, and there is no resume protocol; a reconnect must spawn fresh.
