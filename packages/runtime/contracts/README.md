# @rin/contracts

Pure, stable DTOs and event contracts shared by application surfaces and runtime or domain packages.

## Public API

The package currently exports canonical-memory DTOs, lifecycle enums, manifest fields, and export records. It contains no persistence or transport implementation.

## Known Limitations and Deferred Work

- Only the canonical-memory API has been extracted; the remaining HTTP DTOs will move here as their routes are migrated.
