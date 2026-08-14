# @rin/web-server

rin web-server — a Cordis host plugin that runs an independent node:http server
on its own port, exposing a JSON API over the optional @rin services and
serving the static frontend from the package's static/ directory. It does not
touch the dsh Web UI; it is rin's own Web surface.

## Config

All fields are optional and validated by the Config schema:

| Field | Default | Meaning |
|---|---|---|
| port | 8320 | Listen port (non-negative integer, ≤ 65535). |
| host | 127.0.0.1 | Listen host (loopback or all-interfaces literal). |
| repositoryRoot | — | Default repository root for endpoints that accept ?root=. |
| staticRoot | <package>/static | Static frontend directory. |

The plugin reads the optional @rin services through ctx.get() at request time,
so it loads whether or not they are mounted. The health endpoint reports which
are present.

## JSON API (v1)

Base: http://<host>:<port>. All responses are application/json; errors are
4xx/5xx with body {"error":"<message>"}.

- GET /api/health → {"ok":true,"name":"rin-web","version":"0.1.0","services":{"repository":bool,"environment":bool,"smartPruning":bool}}
- GET /api/repository?root=<abs> → the full AssetRepository JSON. root is
  optional when Config.repositoryRoot is set; missing root → 400, read failure
  → 500.
- GET /api/environment/plan?profile=<id>&root=<abs>&platform=&apt=&python=&pip=&r=&npm=&tlmgr=
  → the full ResolvedEnvironmentPlan JSON. profile is required; platform
  defaults to process.platform; runtime booleans default false. Missing or
  unknown profile → 400.
- GET /api/smart-pruning/status → {"mounted":true,"enabled":bool,"level":string,"mode":string}
  or {"mounted":false}. mode passes through SmartPruningStatus (e.g. "deterministic").

Static: GET / serves static/index.html; GET /<path> serves files under the static
root with path-traversal protection; anything else is 404. The static/ directory
is owned by the frontend package.

## Known Limitations and Deferred Work

- The static/ directory is owned by a separate frontend package; this plugin only
  reads it and returns 404 for missing files.
- Listen failures are logged rather than failing the plugin fiber.
- Deferred endpoints (next milestone, not implemented): /api/knowledge,
  /api/sessions, /api/prompt-memory, /api/evolution, /api/skill-memory.
