# @rin/workspace/environment

rin environment — the projector that resolves an EnvironmentProfile against the
asset repository's package catalogs and emits a dependency-ordered install plan.

It owns the plan schema (types.ts), the resolver and topological planner
(plan.ts), the install-run orchestration (exec.ts: create/approve/execute with
per-stage audit logs), and the Cordis plugin entry (index.ts) exposing
ctx.environment with a plan(rootPath, profileId) service. The sandbox executor
is injected by @rin/workspace/sandboxes; this package never spawns processes itself.

## Service API

ctx.environment.plan(rootPath, profileId) returns Promise<EnvironmentInstallPlan>.
It reads the repository at rootPath, resolves the named profile's packages, and
returns ordered install steps plus the profile's verify block.

## Model Experience

### What the model sees

None directly. This plugin contributes no model-visible prose in its current
form; it is a host-side service. Later milestones will surface the plan through
a tool whose schema then joins prompt assembly.

### Token effect

Zero direct token effect.

### KV Cache effect

Independent — no interaction with the model prefix.

## Known Limitations and Deferred Work

- No bundled executor. exec.ts orchestrates runs but the InstallExecutor must be
  injected; @rin/workspace/sandboxes supplies it through the dsh `ctx.shell` seam, so a
  full run awaits the assembled harness on a real machine.
- One audit-log entry per stage: stage.commands are joined with ' && ' in the
  log; per-command granularity is not recorded.
- No cross-repository version solving. dependencies are package-id edges within
  one repository; version-range solving and lock resolution are deferred.
- No ecosystem installers. Steps name packages and ecosystems but carry no
  install commands; per-ecosystem installers (uv/pip, npm, apt) are deferred.
