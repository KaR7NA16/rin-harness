# @rin/computer-use

rin computer use — file-backed **computer-use state and approval management** for
the desktop computer-use surface.

It owns the enabled master switch, the per-app allowlist, optional grant flags,
and a serialized approval queue, all persisted in one `state.json` under an
injected configuration root (default `~/.rin/computer-use`). The Cordis plugin
entry (`index.ts`) exposes `ctx.computerUse` with a service bound to that root.

## Service API

```ts
import type { Context } from '@deepseek-ai/cordis'
// ctx.computerUse.getStatus()                 => Promise<ComputerUseStatus>
// ctx.computerUse.setEnabled(enabled)         => Promise<ComputerUseStatus>
// ctx.computerUse.listAuthorizedApps()        => Promise<AuthorizedApp[]>
// ctx.computerUse.isAppAuthorized(bundleId)   => Promise<boolean>
// ctx.computerUse.authorizeApp(app)           => Promise<AuthorizedApp[]>
// ctx.computerUse.revokeApp(bundleId)         => Promise<AuthorizedApp[]>
// ctx.computerUse.replaceAuthorizedApps(apps) => Promise<AuthorizedApp[]>
// ctx.computerUse.getGrantFlags()             => Promise<GrantFlags>
// ctx.computerUse.updateGrantFlags(flags)     => Promise<GrantFlags>
// ctx.computerUse.enqueueApproval(request)    => Promise<PendingApproval>
// ctx.computerUse.getApprovalQueue()          => Promise<PendingApproval[]>
// ctx.computerUse.getPendingApprovals()       => Promise<PendingApproval[]>
// ctx.computerUse.resolveApproval(id, res)    => Promise<PendingApproval | null>
// ctx.computerUse.supersedeApproval(id)       => Promise<PendingApproval | null>
// ctx.computerUse.clearResolvedApprovals()    => Promise<void>
```

The plugin config accepts an optional `configRoot` (defaults to
`~/.rin/computer-use`); an explicitly blank value fails loud at load.

## State

`state.json` holds:

```json
{
  "version": 1,
  "enabled": false,
  "grantFlags": { "clipboardRead": false, "clipboardWrite": false, "systemKeyCombos": false },
  "authorizedApps": [],
  "approvalQueue": [],
  "updatedAt": "..."
}
```

Reads merge the file with the default state; writes are atomic (temp file plus
rename) and every read-modify-write mutation runs under a file lock.

## Testing

From the package directory:

```sh
node --experimental-strip-types tests/computer-use.smoke.ts
```

## Known Limitations and Deferred Work

- **No GUI automation.** Screenshots, input injection, click/type/key dispatch,
  and the macOS/Windows helper runtime are not implemented here — this package
  owns state and approval management only.
- **No environment detection.** The legacy `/api/computer-use/status` Python,
  venv, dependency, and OS-permission probes are out of scope; `getStatus`
  reports the stored `enabled` switch and queue-derived aggregates.
- **Single-app requests.** The approval queue models one `appBundleId` per
  request, not the old multi-app resolved-request dialog.
- **File-backed only.** State is a single JSON file; there is no SQLite backing.
