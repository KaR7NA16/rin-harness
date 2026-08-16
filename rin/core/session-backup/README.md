# @rin/session-backup

Gzip session export/import and rolling backups over the dsh session home, exposed as ctx.sessionBackup.

Ported from the legacy desktop sessionBackupService, re-encoded as gzip of raw session files (sessions may be zstd-compressed) instead of fflate zip of parsed JSONL.

## API

- exportSessions() / importSessions(buffer)
- runBackup() / listBackups() / restoreBackup(name)
- getSettings() / updateSettings(settings)

## Known Limitations and Deferred Work

- Import skips existing sessions instead of remapping session ids to avoid conflicts.
- The automatic backup scheduler (intervalDays) is not ported; backups run on demand.
