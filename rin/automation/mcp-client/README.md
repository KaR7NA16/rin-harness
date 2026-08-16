# @rin/mcp-client

rin mcp-client — the MCP client bridge on the dsh seam. It connects rin's
file-backed MCP server configuration store (`@rin/mcp`, config-only by
design) to the real MCP protocol client (`@deepseek-ai/dsh-mcp-client`): one
dsh-mcp-client instance per configured non-disabled server, so each server's
tools are published to the model as `mcp__<server>__<tool>`.

## Placement

This package is deliberately separate from `@rin/mcp` (one capability per
package): `@rin/mcp` stays a pure config-CRUD store with no protocol
dependency or dsh import, while this package owns every protocol-facing
concern — the transport mapping, the per-server instance lifecycle, and the
store-change hot reload. `@rin/mcp` only gained a small change-notification
(`ctx.mcp.onChange`) so the bridge can subscribe without reaching into the
store's file layer.

## Mapping

The bridge maps each non-disabled `McpServerConfig` onto the
`@deepseek-ai/dsh-mcp-client` plugin config:

- `transport: 'stdio'` → `{ transport: 'stdio', serverName: cfg.name,
  command: cfg.command, args: cfg.args, env: cfg.env, cwd: '' }`
- `transport: 'http' | 'sse'` → `{ transport: 'streamable-http',
  serverName: cfg.name, url: cfg.url ?? '', headers: cfg.headers ?? {} }`
- `toolCallTimeoutMs` defaults to 60000 (the dsh default; overridable via
  plugin config); `failOnStartupError` is fixed at `false` — a server whose
  initial connection fails must log and retry, never take down the host.
- `status: 'disabled'` servers are skipped. A server whose name fails the dsh
  serverName pattern (`/^[A-Za-z0-9_-]{1,32}$/`) or whose transport-required
  field (command / url) is empty is rejected per server with a logged error —
  fail loud per server, never crash the host.

## Hot reload

The bridge subscribes to `ctx.mcp.onChange(...)` and re-syncs after every
successful create/update/remove: removed or now-unloadable servers are
disposed, changed servers are disposed and reloaded (fingerprint comparison
over the mapped config), new servers are loaded. Re-syncs are serialized; a
store read failure is logged and the subscription keeps listening.

## Usage

Mount the plugin in the rin assembly (the @rin/bundle cordis.yml row):

```yaml
- id: mcp-client
  name: '@rin/mcp-client'
  config:
    toolCallTimeoutMs: 120000   # optional; default 60000
```

The bridge exposes no `ctx.*` service; it mounts the client instances and
registers their tools on the shared `ctx.tools` registry.

## Model Experience

### What the model sees

The tools of every connected MCP server, published under the dsh-mcp-client
naming contract as `mcp__<server>__<tool>`. Tool schemas come from each
server's `tools/list`; the bridge contributes no prompt prose of its own.

### Token effect

The tool schemas of every connected server join prompt assembly (each
`mcp__<server>__<tool>` schema is model-visible). No other token effect.

### KV Cache effect

Independent — no interaction with the model prefix beyond the tool schemas.

## Known Limitations and Deferred Work

- **`needs-auth` is treated like any other non-disabled server.** Auth flows
  are out of scope for this MVP: a server whose stored status is
  `needs-auth` is loaded and connected like any other non-disabled server,
  and `status` is never derived from a live handshake. Deferred: a
  needs-auth gating path and live status reflection.
- **Per-server reload is a full disconnect + reconnect.** A config change to
  one server disposes and remounts that server's instance; there is no
  incremental in-place config update, and unrelated servers are untouched.
- **Change notifications carry no payload.** `ctx.mcp.onChange` fires
  without arguments; the bridge re-reads the whole store on every change, so
  a high-frequency writer pays one full `list()` per mutation.
- **Asynchronous tool availability.** The bridge mounts each client
  fire-and-forget and never awaits a server connection: tools appear as each
  server's initial connection settles, and a failing server retries per the
  dsh reconnect policy without blocking the host.
