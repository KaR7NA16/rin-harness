# @rin/workspace/filesystem

Path-contained directory browsing exposed as ctx.filesystem.

Ported from the legacy desktop filesystem browse; every path resolves under the host home or system temp.

## API

- browse(input) — list a directory (dirs first), optional includeFiles/search/maxResults.

## Known Limitations and Deferred Work

- Only directory listing is ported; the image file-serving endpoint (/api/filesystem/file) is not.
- Allowed roots are fixed to home + temp; a configurable allowlist is deferred.
