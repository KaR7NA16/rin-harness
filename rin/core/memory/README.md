# @rin/memory

`@rin/memory` is the canonical local memory catalog for rin. It does not
replace Notes, Knowledge, Session Search, or dsh session persistence. Instead,
it records the stable memory item/source identity that those stores project.
The manifest records the canonical SQLite catalog, every supported projection,
portable session/settings/credentials paths, external-root aliases, and the archive secret policy.
It also audits which memory versions entered model-visible context.

The SQLite catalog and its manifest are rooted by the bundle's `RIN_HOME`
configuration. Manifest storage paths are archive-relative; external
settings/credential files use explicit `external/...` aliases. Derived indexes
remain disposable projections; the catalog is
the owner of memory identity, lifecycle, provenance, revocation, and deletion.

Notes are an editable source projection. Knowledge and Session Search are
rebuildable archival/search projections. Prompt Memory is the bounded
system-prompt projection. All four use the same source identity, content
version, visibility, and tombstone rules; the canonical catalog does not copy
their full derived SQLite indexes.

The catalog database, WAL, and shared-memory files are restricted to the owning
user. `prepareForArchive()` checkpoints the WAL before a portable archive is
read, and `exportData()` reads every lifecycle row and injection record rather
than applying the normal UI page limit.

## Known Limitations and Deferred Work

- New writes are synchronized into the catalog; automatic backfill of every historical record remains deferred.
- Embedding-based retrieval and relationship-specific consolidation are not part of this local catalog.
- Deleted or revoked IDs remain tombstones; ordinary projection upserts do not reactivate them.
