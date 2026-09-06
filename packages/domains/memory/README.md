# @rin/memory

`@rin/memory` is the canonical memory cognition owner for rin. It does not
replace Notes, Knowledge, Session Search, or dsh session persistence; those own
their derived indexes and projections. This package owns the unified cognitive
state: scenes, representations, links, behavior records, recall, consolidation,
and the owner data-rights commands. Notes, Knowledge, and Session Search no
longer mirror into a memory catalog; the manifest records the canonical SQLite
journal, every supported projection, portable session/settings/credentials
paths, external-root aliases, and the archive secret policy.

The SQLite cognition journal and its manifest are rooted by the bundle's
`RIN_HOME` configuration. Manifest storage paths are archive-relative; external
settings/credential files use explicit `external/...` aliases. Projections
remain disposable and rebuildable; the cognition journal is the single
authority for memory identity, lifecycle, provenance, influence, and erasure.

The journal database, WAL, and shared-memory files are restricted to the owning
user. The unified cognition model is exported from src/model.ts and the
command/event/transaction protocol from src/events.ts. MemoryCognitionDatabase
persists the validated transaction stream in the same SQLite file with an
explicit cognition schema marker, global event sequence, atomic commit, and
projection checkpoint state. MemoryMaterializer provides deterministic replay;
prepareForArchive() checkpoints the WAL before a portable archive is read;
exportCognitionJournal() exports the committed transaction stream in order, and
restoreCognitionJournal() rebuilds an empty store from that export.

Owner data rights run through owner-only intent commands: correctUnderstanding
(in-place revision with journal history), restrictInfluence, revokeInfluence,
and the erase preview → authorize → commit flow whose scope is bound by a
deterministic scope hash and a one-time, expiring authorization. Prompt Memory
is generated from the canonical cognition workspace and refuses stale
checkpoints; static prompt files are no longer a model-input source.

## Known Limitations and Deferred Work

- The generic v1 catalog (MemoryItem, memory_items tables, generic CRUD routes)
  was removed in M8-01; this runtime owns no compatibility path for old catalog
  databases and rejects unversioned or newer cognition journals.
- Model proposal, formation, consolidation, and maintenance transitions keep
  candidates transient/raw/blocked until an owner-only permitInfluence grants
  influence; corrections reset a standing permit on the revised content.
- Erase propagation follows active supports/derives edges only; dependents
  survive as blocked representations and unrelated memories are preserved.
- Embedding-based retrieval has a source contract but no concrete vector
  provider or index; recall without embeddings relies on lexical, link, and
  field cues.
- The §12-mandated Host smokes cover E-01/E-10 (memory-runtime.smoke.ts) and
  E-13/E-16/E-18 (memory-lifecycle.smoke.ts); the remaining E-scenarios hold
  domain-level evidence only.
- `pnpm run bench:memory` records the single-machine performance baseline; the
  numbers are not a production-hardware claim.
