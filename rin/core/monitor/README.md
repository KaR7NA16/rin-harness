# @rin/monitor

Host performance snapshot service (ctx.monitor) and the model-facing
`monitor_snapshot` tool. Ported from the web-server's in-package monitor
module (legacy desktop MonitorTool lineage): it reads real Linux sources only
(node: builtins; no stubs or fakes) — /proc/stat (CPU jiffies, sampled twice
for a real percent over time), /proc/meminfo, /proc/loadavg, /proc/uptime, a
spawned `df -P -k /`, a scan of /proc/<pid> for the top processes by RSS, and
`docker stats` / `podman stats` for containers. On a non-Linux platform the
snapshot still assembles (memory falls back to node:os) while the web-server
route reports 501 via isMonitorSupported(); the /proc reads themselves are
Linux-only.

Degradation is honest: when a /proc source is unreadable or malformed its
metric degrades to 0 / [0, 0, 0] / empty, and when no container CLI is
available the containers array is empty. Nothing is fabricated.

## API

- `ctx.monitor.snapshot()` — one full host snapshot (host + processes +
  containers).
- `monitor_snapshot` tool — the model-facing view of the same snapshot:
  host metrics (cpu/mem/load/disk/uptime/platform) plus the top processes;
  containers are deliberately omitted.

## Known Limitations and Deferred Work

- The service is Linux-first: /proc parsing assumes the Linux /proc layout
  (including the df POSIX output format); non-Linux hosts degrade memory to
  node:os and report empty process/disk data rather than failing.
- Container stats depend on a locally installed docker or podman CLI with a
  reachable daemon; when neither is present the containers array is empty and
  the container fields keep the CLI's raw text when present.
- The CPU percent needs two /proc/stat samples, so the first snapshot after
  service start reports 0.0% (neutral) until a real delta exists; an
  unreadable sample resets the cache.
- The legacy desktop MonitorTool's historical per-session metric history and
  trend charting are not ported; the tool and route return point-in-time
  snapshots only.
