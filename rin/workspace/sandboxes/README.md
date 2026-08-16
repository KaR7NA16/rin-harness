# @rin/sandboxes

rin sandboxes — the sandbox-profile store and environment-plan executor on the
dsh seam. It owns named sandbox profiles (local-sandbox / container / remote)
persisted to a versioned YAML document, repository mounting into containers,
capability probing, and dispatching a resolved @rin/environment install plan
through the per-type provider or, when the dsh shell seam is mounted, through
`ctx.shell` (see `seam.ts`).

It owns the domain model (`types.ts`), profile construction/migration
(`profile.ts`), the file codec (`yaml.ts`), capability probing
(`probe.ts`), the per-type providers (`providers.ts`), the install-run
wiring (`exec.ts`), the shell-seam projection (`seam.ts`), the file-backed
store (`store.ts`), and the Cordis entry (`index.ts`) exposing
`ctx.sandboxes`. This package never imports a dsh source graph at load time:
`exec.ts` loads @rin/environment lazily, so the pure modules (including the
structural shell-seam adapters in `seam.ts`) run under plain
`node --experimental-strip-types`.

Profiles live at `~/.rin/sandbox.yaml` (schema version 2). A legacy
`sandboxes.json` sibling is migrated on first read and preserved as
`.bak`.

## Service API

```ts
import type { Context } from '@deepseek-ai/cordis'
// const sandboxes = ctx.sandboxes
// await sandboxes.list()                          // SandboxProfile[]
// await sandboxes.get(id)                         // SandboxProfile | null
// await sandboxes.create({ name, type, ... })     // SandboxProfile
// await sandboxes.update(id, patch)               // SandboxProfile
// await sandboxes.remove(id)                      // boolean
// await sandboxes.setDefault(id)                  // SandboxProfile
// await sandboxes.probeCapabilities(profile)      // ResolverCapabilities
// await sandboxes.exec(id, command)               // { code, stdout, stderr }
// await sandboxes.executeEnvironmentPlan(profile, repositoryId, environmentProfileId, plan) // InstallRun
```

The service never spawns a process itself for `list/get/create/update/remove/
setDefault`; probing delegates to the provider selected by the profile's
`type`, `exec(id, command)` runs one command through that same provider
(`runCommand`, which `LocalProvider`/`ContainerProvider` implement and
`RemoteProvider` stubs with `not implemented (P3)`), while environment-plan
execution runs stage commands through the dsh `ctx.shell` seam when one is
mounted. The install-run state machine (blocked → resolved →
approved → provisioning/verifying → ready | failed) lives in @rin/environment; this
package supplies the executor. Execution fails loud when `ctx.shell` is
unavailable unless `dryRun` is set. The host resolves its configuration home
and injects the resulting store path via the `profilesPath` config; the
default is `defaultSandboxProfilesPath()`.

## Model Experience

### What the model sees

None directly. This plugin contributes no model-visible prose, tool schemas,
or prompt sections in its current form; it is a host-side service. A later
milestone may surface sandbox selection or install-run progress through a tool
whose schema then joins prompt assembly.

### Token effect

Zero direct token effect.

### KV Cache effect

Independent — no interaction with the model prefix.

## Known Limitations and Deferred Work

- **Container and remote providers are unverified on real machines.** The
  docker/podman exec argv construction and capability-probe parsing are pure
  and unit-tested, but no end-to-end container run has been exercised here;
  runtime detection (`docker --version` / `podman --version`) and exec are
  exercised only on a real host with a container CLI.
- **Remote execution is an explicit stub (P3).** `RemoteProvider` throws
  `not implemented (P3)` for both probing and execution; SSH transport and
  optional docker-on-remote are deferred.
- **Install execution is not exercised end-to-end here.** `executeEnvironmentPlan`
  wires create → approve → execute over @rin/environment, routing stage commands
  through `ctx.shell` (fail-loud without a shell unless `dryRun`), but a full
  run against a real repository root and a real machine awaits the assembled
  harness.
- **One executor per stage, not per command.** `buildStageExecutor` runs each
  command in a stage sequentially and folds their output into a single stage
  result; @rin/environment records one audit-log entry per stage.
- **The shell seam routes install commands, not capability probing.**
  `probeCapabilities` still uses the per-type provider (`execFile` / container
  exec); the `ctx.shell` projection covers stage-command execution only.
