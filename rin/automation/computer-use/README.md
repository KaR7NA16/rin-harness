# @rin/computer-use

rin computer use — file-backed **computer-use state and approval management** for
the desktop computer-use surface, plus the python **runtime setup** that powers
it.

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
// ctx.computerUse.installRuntime()            => Promise<RuntimeInstallResult>
// ctx.computerUse.getRuntimeStatus()          => Promise<RuntimeStatus>
```

The plugin config accepts an optional `configRoot` (defaults to
`~/.rin/computer-use`); an explicitly blank value fails loud at load.

## Runtime setup

`src/runtime.ts` owns the python runtime lifecycle: it detects a system python,
creates a venv under `<configRoot>/runtime/venv`, bootstraps pip, installs the
requirements (guarded by a sha256 stamp written to
`<configRoot>/runtime/requirements.sha256`), and — on macOS/Windows with a ready
venv — runs the permission preflight through the migrated helper script.

- `installRuntime()` runs the setup steps and returns
  `{ success, steps, status }`; `getRuntimeStatus()` is a read-only snapshot
  (`python`, `venv`, `dependencies`, `preflight` fields).
- The python helper scripts and requirements files ship as package assets under
  `runtime/` (migrated from the legacy desktop project) and are copied
  into the runtime root on install.
- `createRuntimeModule({ configRoot })` binds both operations to one root;
  `FileComputerUseService` exposes them on `ctx.computerUse`.
- Command execution uses `node:child_process` `execFile` (never Bun); tests
  inject a fake python runner via `RuntimeSetupOptions.runCommand`.
- Platform honesty: permission preflight is only defined for macOS/Windows.
  On other platforms `getRuntimeStatus()` reports `preflight.status ===
  'unsupported'` and install never blocks on it; on macOS/Windows with a venv
  that is not ready it reports `'skipped'`.

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
node --experimental-strip-types tests/runtime.smoke.ts
```

The runtime smoke test drives `installRuntime()` / `getRuntimeStatus()` against
a fake venv directory with a mocked python runner, so it needs no real python.

## Known Limitations and Deferred Work

- **No GUI automation.** Screenshots, input injection, and click/type/key
  dispatch are not implemented here — this package owns state/approval
  management plus runtime setup; the migrated macOS/Windows helper scripts
  (`runtime/mac_helper.py`, `runtime/win_helper.py`) are installed as assets but
  the automation service that would drive them is out of scope.
- **Preflight is macOS/Windows only and untested headless.** Permission
  preflight shells out to the helper's `check_permissions` command; the code
  path is exercised in the smoke test with a mocked runner, but a real macOS
  permission grant has not been verified in this environment.
- **Single-app requests.** The approval queue models one `appBundleId` per
  request, not the old multi-app resolved-request dialog.
- **File-backed only.** State is a single JSON file; there is no SQLite backing.
