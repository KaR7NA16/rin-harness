# @rin/mcp

The MCP integration owns the file-backed server configuration store and the
live dsh MCP client bridge. It exposes `ctx.mcp`, maps enabled servers to
`@deepseek-ai/dsh-mcp-client`, and publishes connected tools as
`mcp__<server>__<tool>`.

Server configuration is persisted under `~/.rin/mcp/servers.json` by default.
The public service supports list, get, create, update, remove, and change
subscriptions. Store changes are serialized through the internal client bridge:
changed instances are replaced, removed instances are disposed, and a broken
server is logged without blocking host activation.

## Configuration

- `storeRoot`: optional directory containing `servers.json`.
- `toolCallTimeoutMs`: per-tool-call timeout; defaults to 60000.

The single Cordis entry installs the configuration service before starting the
client bridge. Cross-package consumers import the store types and mapping APIs
from `@rin/mcp`; the bridge is an internal module of this package.

## Model Experience

Each connected server contributes the tool schemas returned by its MCP
`tools/list` response. This package contributes no additional prompt prose.
Disabled or invalid servers contribute no tools.

## Known Limitations and Deferred Work

- Stored status is not a live handshake result. `needs-auth` is currently
  loaded like any other non-disabled server; authentication orchestration and
  live status reflection remain deferred.
- Configuration changes replace the complete server client instance rather
  than mutating an active transport in place.
- Change notifications carry no payload, so the bridge re-reads the store after
  each mutation.
