# @rin/agent-migration

@rin/agent-migration is the host-side discovery and import service behind the
AgentMigration page. It exposes one shared DTO contract to the Web client and
the Host route, so scanning, previewing, and importing cannot drift into
different wire formats.

## Supported sources

| id | name | config roots |
| --- | --- | --- |
| claude-code | Claude Code | ~/.claude |
| codex | Codex | ~/.codex, ~/.agents |
| cursor | Cursor | ~/.cursor |
| openclaw | OpenClaw | ~/.openclaw |
| hermes-agent | Hermes Agent | ~/.hermes |
| deepseek-tui | DeepSeek TUI | ~/.codewhale, ~/.deepseek |

The scanner reports detected roots and normalizes skill and instruction files
into `AgentMigrationItem` records. Each item carries its source agent id,
relative path, format, scope, destination path, byte size, modification time,
and a preview-safe selection flag.

## Service API

The Cordis service is `ctx.agentMigration`.

- `scan(targetAgentId?)` returns `AgentMigrationScan`.
- `listItems(agentId)` returns the normalized selectable inventory.
- `preview(agentId, itemId)` returns `AgentMigrationPreview` with source content
  and the proposed destination.
- `migrate(request)` accepts `AgentMigrationRequest` and returns
  `AgentMigrationResult`.

The request preserves `agentId`, optional `targetAgentId`, `itemIds`,
`projectIds`, and `allRecommended` end to end. The Web route uses the same
types from this package; it does not maintain a second DTO definition.

## Storage behavior

Skill files are imported into the configured RIN skills root and instruction
files are imported into the configured RIN rules root. Existing destination
files are not overwritten: the service reports them as skipped. Files larger
than 2 MiB are previewable but not selectable. The operation returns per-item
status and error text so a partial migration is auditable.

## Known limitations and deferred work

- Project registration is not implemented yet. Non-empty `projectIds` are
  rejected explicitly rather than silently ignored.
- Memory migration, executable detection, environment-variable root overrides,
  and native-format conversion are deferred.
- The source table uses fixed home-relative roots; profile-specific roots are
  not yet resolved.
- Migration is file-backed and has no cross-process transaction or rollback.
