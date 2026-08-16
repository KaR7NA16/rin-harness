# @rin/doctor

Host self-diagnostic service (ctx.doctor), the model-facing `doctor` tool,
and the `GET /api/doctor` web-server route. The old project's Doctor was a
self-diagnostic; this re-implementation is a REAL, honest diagnostic report
— no stubs and no fabricated "healthy" answers. Every check reads real
state, and any source that is not mounted or not readable is reported as
such.

## DoctorReport shape

`ctx.doctor.runDiagnostics()` resolves one `DoctorReport`:

```ts
interface DoctorReport {
  at: string                 // ISO timestamp of the report
  runtime: {
    nodeVersion: string      // process.version
    platform: string         // process.platform
    arch: string             // process.arch
    uptimeSec: number        // process.uptime()
  },
  config: {
    home: string             // RIN_HOME, else ~/.rin
    exists: boolean          // node:fs access(F_OK)
    writable: boolean        // node:fs access(W_OK), only when exists
    detail?: string          // fs error message when the W_OK check failed
  },
  host: {                    // always present; minimal when monitor is absent
    monitorAvailable: boolean,
    cpuPercent?: number,     // below only when monitorAvailable
    memTotalMb?: number,
    memUsedMb?: number,
    memPercent?: number,
    loadAvg?: number[],
    diskTotalGb?: number,
    diskUsedGb?: number,
    diskPercent?: number,
    uptimeSec?: number,
    platform?: string,
  },
  llm: {
    mounted: boolean,        // false when the llm service is not mounted
    providers: Array<{ id: string; name: string }>,
    anyConfigured: boolean,  // true when at least one provider is registered
  },
  services: Array<{ name: string; mounted: boolean }>,
}
```

The optional `host?` section of the brief is implemented as always-present
with `monitorAvailable: false` and no metric fields when the monitor service
is unmounted — consumers get one stable key instead of an absent one.

## API

- `ctx.doctor.runDiagnostics()` — one full diagnostic report (runtime +
  config home + host metrics + llm + service audit).
- `doctor` tool — the model-facing view of the same report: structured JSON
  plus a short text render. It never makes an inference call; the llm
  section only lists registered providers.
- `GET /api/doctor` — the same report over HTTP; returns 501 when the
  doctor service is not mounted.

## Checks are real

- Runtime: process.version / platform / arch / uptime().
- Config: `access(RIN_HOME || ~/.rin)` for existence and `access(..., W_OK)`
  for writability (node:fs).
- Host: reuses `ctx.monitor` (via `ctx.get('monitor')`) for cpu/mem/load/
  disk; an unmounted monitor reports `monitorAvailable: false` honestly.
- LLM: reads `ctx.get('llm')` and lists `listProviders()`; "configured"
  means at least one provider route is registered. No paid inference call.
- Services: audits the 25 known @rin capabilities — 23 service plugins
  via `ctx.get(<serviceName>)` (the `super(ctx, <name>)` service name,
  which is camelCase for several and `rinAgents` for agents) and the
  brief / review function plugins via `ctx.tools.get(<toolName>)` — and
  reports mounted/absent per label.

## Known Limitations and Deferred Work

- "Configured" for LLM providers means a registered route exists
  (`listProviders()` non-empty); the harness keeps no neutral public way to
  distinguish a registered route with a missing credential from one that
  works, and probing would require a paid call, which this tool deliberately
  never makes.
- The host metrics are a point-in-time snapshot; a CPU percent of 0.0 is the
  monitor's honest first-sample neutral, not a doctor fabrication.
- `@rin/mcp-client` is a dynamic bridge with no stable `ctx` service or
  tool name (its tools are `mcp__<server>__<tool>`), so it is deliberately
  omitted from the service/tool audit; its config store (`mcp`) is still
  audited.
- The service audit keys are the actual `super(ctx, <name>)` service names
  (not the kebab package names); a service mounted under a non-standard key
  would be reported absent even though its capability exists.
- The writability probe checks the process's effective permissions only
  (node:fs access); it does not test an actual write or disk quota.
