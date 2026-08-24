# @rin/collaboration

rin teams — a file-backed named-team store. It owns team configuration
(create/list/get/update/delete) plus members with roles, exposed on the shared
context as `ctx.teams`. It backs the legacy desktop `/api/collaboration` surface
(currently an empty `{ teams: [] }` placeholder in the web-server).

Module ownership:

- `types.ts` — the pure domain model (teams, members, roles, inputs, config).
- `storage.ts` — `TeamsStore`, the pure file engine (path containment, JSON persistence, member normalization). `node:` builtins only.
- `index.ts` — the Cordis plugin: `TeamStore` (Service abstraction) + `FileTeamStore`.

There are no runtime dependencies beyond `node:` builtins; `@deepseek-ai/cordis`
is a peer dependency.

## Storage layout

One directory per team under the store root, each holding a single
`config.json`:

```jsonc
// {root}/{team-name}/config.json
{
  "name": "frontend-crew",
  "description": "Build the desktop UI",
  "createdAt": 1720000000000,
  "updatedAt": 1720000000000,
  "leadAgentId": "lead-1",
  "members": [
    { "agentId": "lead-1", "name": "lead", "role": "lead", "status": "idle", "joinedAt": 1720000000000, "cwd": "/work" }
  ]
}
```

Team names must be a single safe path segment (no separators, no `..`); the
`memberCount`/`activeMemberCount` summary fields are derived on read, never
stored.

## Service API

`ctx.teams` is a `TeamStore`; the file-backed `FileTeamStore` is registered
when the plugin loads.

```ts
// ctx.teams.list()                        -> TeamSummary[]   (sorted by name)
// ctx.teams.get(name)                     -> TeamDetail      (summary + members)
// ctx.teams.create(input)                 -> TeamDetail
// ctx.teams.update(name, input)           -> TeamDetail      (description | leadAgentId)
// ctx.teams.delete(name)                  -> void            (idempotent)
// ctx.teams.addMember(name, input)        -> TeamDetail
// ctx.teams.removeMember(name, agentId)   -> TeamDetail
// ctx.teams.listMembers(name)             -> TeamMember[]
```

`Config` has one optional field, `teamsHome` (absolute or cwd-relative); it
defaults to `~/.rin/collaboration`.

Role and lead semantics:

- Each member has a `role` (`lead` | `member`); `leadAgentId` is the team's lead pointer.
- `create` derives `leadAgentId` from an explicit value, the first `lead`-role member, else the first member; that member's role defaults to `lead`.
- `update({ leadAgentId })` re-points the lead and re-syncs roles (new lead becomes `lead`, any other `lead` becomes `member`).
- `removeMember` of the lead re-points `leadAgentId` to the first remaining member and promotes it.

Guards: team names and member `agentId`/`name` are validated; a missing team,
duplicate team, duplicate member, or missing member fails loud.

## Testing

Run the smoke test from the package directory:

```sh
node --experimental-strip-types tests/collaboration.smoke.ts
```

It drives a temporary directory through the full CRUD plus member management
without loading the Cordis runtime.

## Known Limitations and Deferred Work

- **Configuration only — no orchestration.** This milestone manages team and
  member configuration. It does not bind the dsh multi-agent orchestration
  (spawning agents from a team, member transcripts, mailbox/teammate messaging,
  or live status). Orchestration is deferred to a later milestone.
- **No per-member transcript or messaging.** The old teamService's
  `getMemberTranscript` and `sendMemberMessage` are out of scope; members
  store only their configuration here.
- **Single JSON file per team, whole-file rewrites.** `config.json` is read
  and rewritten in full on every mutation; there is no locking, so concurrent
  writers can lose updates. Fine for the single-user desktop path, not for
  multi-process coordination.
- **Team name is the identity.** There is no rename: callers compose a rename
  from `get`/`create`/`delete`.
- **No schema-versioned migration.** On-disk records are parsed leniently
  (missing fields default), but there is no version field or forward-compat
  promise yet.
