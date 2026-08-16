# @rin/mcp

rin mcp — the file-backed MCP server configuration store on the dsh seam. It
owns named MCP server configs (name / command / args / env / transport /
status) persisted to a versioned JSON document, aligned with the legacy
desktop McpSettings surface. This package is configuration management only:
it owns the domain model (`types.ts`), the file-backed store (`store.ts`),
and the Cordis entry (`index.ts`) exposing `ctx.mcp`.

Servers live at `~/.rin/mcp/servers.json` (schema version 1). The host
resolves its configuration home and injects the store root via the
`storeRoot` config; the default is `defaultMcpStoreRoot()`.

## Service API

```ts
import type { Context } from '@deepseek-ai/cordis'
// const mcp = ctx.mcp
// await mcp.list()                 // McpServerConfig[] (sorted by name)
// await mcp.get(name)              // McpServerConfig | null
// await mcp.create(input)          // McpServerConfig
// await mcp.update(name, patch)    // McpServerConfig
// await mcp.remove(name)           // boolean
// mcp.onChange(listener)           // () => void (disposer)
```

`onChange(listener)` subscribes to store mutations: it fires synchronously
and without a payload after every successful `create` / `update` / `remove`
(the returned disposer unsubscribes). Subscribers re-read the store (for
example via `list()`) to observe the new state; the payload-free contract
keeps the notification race-free against concurrent mutations. The bridge
package `@rin/mcp-client` consumes this to hot-apply config edits.

`name` is the immutable key. `stdio` servers require `command` and carry
`args` / `env`; `http` / `sse` servers require `url` and carry optional
`headers`. A new server defaults to `transport: 'stdio'` and
`status: 'checking'`. Validation fails loud at the durable-file boundary
(name required, transport/status in the accepted enum, and the
transport-specific required field present).

## Model Experience

### What the model sees

None directly. This plugin contributes no model-visible prose, tool schemas,
or prompt sections in its current form; it is a host-side service backing the
desktop McpSettings page. A later milestone may surface server selection
through a tool whose schema then joins prompt assembly.

### Token effect

Zero direct token effect.

### KV Cache effect

Independent — no interaction with the model prefix.

## Known Limitations and Deferred Work

- **Configuration management only — no MCP protocol connection or tool
  forwarding.** This package stores and validates server configs; it does not
  open an MCP connection, list tools/resources, or forward tool calls. The
  `status` field records a stored lifecycle value and is not derived from a
  live handshake (`connected`, `needs-auth`, and `failed` are reserved for a
  later connection layer).
- **No MCP SDK dependency.** Connecting to real servers would use
  `@modelcontextprotocol/sdk`, but that dependency is intentionally not
  introduced here; the pure store runs under plain
  `node --experimental-strip-types`.
- **Single flat store, no scoping.** The legacy project layered local / user /
  project / enterprise scopes and a separate disabled-server list. This
  minimal version keeps one flat `servers.json` and folds `disabled` into the
  `status` field.
- **No host preflight or live reconnect.** The legacy API probed the host
  command and reconnected on toggle. Those runtime behaviors are deferred
  alongside the connection layer. The connection layer itself (protocol
  client + tool forwarding) now lives in `@rin/mcp-client`, which subscribes
  through the `onChange` notification added for it.
