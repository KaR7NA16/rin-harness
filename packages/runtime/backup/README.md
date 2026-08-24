# @rin/backup

`ctx.sessionBackup` owns session-only compatibility endpoints plus portable RIN_HOME archives. A complete archive contains the RIN memory catalog, prompt-memory files, notes, derived stores, and the integrated dsh state under `RIN_HOME/dsh` when the default home boundary is used.

Archives are gzip envelopes with a versioned `rin-archive` manifest. Secret-like files and the backup directory are excluded by default. Imports are additive and never overwrite an existing user file.
The default boundary is resolved as `RIN_HOME` → `RIN_HOME/dsh` for dsh state.
`DSH_HOME` can replace the dsh root, and `RIN_SESSION_ROOT` can replace only
the JSONL session root; the launcher also supports explicit settings and credentials file paths.
When `DSH_HOME`, `RIN_SESSION_ROOT`, or the DSH settings path resolves outside
`RIN_HOME`, the archive records those configured sources under portable
`dsh/` or `external/settings/` prefixes and restores them to the current
configured roots. Credentials are always excluded by default; the archive
does not silently broaden its secret boundary.
Archive operations are serialized within the service, and the configured
archive-preparation hook runs before export so mutable stores can flush their
on-disk state (including SQLite WAL data).

## API

- `exportSessions()` / `importSessions(buffer)` — session-only compatibility format
- `exportArchive()` / `importArchive(buffer)` — complete RIN archive
- `runBackup()` / `listBackups()` / `restoreBackup(name)` — rolling complete archives
- `getSettings()` / `updateSettings(settings)`

## Known Limitations and Deferred Work

- Import skips existing sessions instead of remapping session ids to avoid conflicts.
- The automatic backup scheduler (intervalDays) is not ported; backups run on demand.
