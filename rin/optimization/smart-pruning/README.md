# @rin/smart-pruning

rin smart-pruning — the host-side **deterministic tool-result optimizer**. It
rewrites a message list in place (newest first) to:

- **deduplicate** repeated tool results — an older copy of a result already seen
  is replaced with a short omission marker;
- **omit superseded reads** — an older read of a file that a newer read already
  covers is replaced with a short omission marker;
- **truncate over-budget results** — an older result longer than the level's
  budget is shortened to a bounded head + marker + tail.

It complements the dsh compaction tool-result pruner, which only truncates
without deduplicating. This plugin owns the dedupe + superseded-read policy and
the three-level budgets; the core module (`core.ts`) is pure and
deterministic, with no cordis dependency.

The seam module (`seam.ts`) projects that policy into the dsh session surface:
on each `agent/pre-step` boundary it rewrites older duplicate results and
superseded reads to a one-line omission marker (single-node surface replaces
with the dsh shadow-price protocol), leaving over-budget truncation to the
dsh pruner. The level and enabled flag are read live from the store, so
`setLevel`/`setEnabled` hot-apply.

## Service API

The plugin entry (`index.ts`) exposes `ctx.smartPruning` (a
`SmartPruningStore`):

```ts
import type { Context } from '@deepseek-ai/cordis'
// ctx.smartPruning.getStatus()               // { enabled, level, mode }
// ctx.smartPruning.setEnabled(true)          // enable/disable
// ctx.smartPruning.setLevel('aggressive')    // change policy (throws on unknown)
// ctx.smartPruning.optimizeMessages(messages) // { messages, stats }
// ctx.smartPruning.resetForTesting()          // restore constructor config
```

The standalone core exports the same behavior without cordis:

```ts
import { SmartPruningService, pruneMessagesForAPI, isSmartPruningLevel } from '@rin/smart-pruning'
```

## Session seam

The seam (`registerSeam` in `seam.ts`) listens for the dsh `agent/pre-step`
event and runs one deterministic pass over that agent's session surface.
Only deduplication and superseded-read folding run there; truncation stays
with the dsh compaction tool-result pruner, so the two never redo each other.
The seam is structural (no Cordis import) and optional-shadow-prices each
replacement through `ctx.tokenMeter` when it is available.

## Config

`enabled` (default `false`) and `level` (default `balanced`). An unknown
level fails loud at construction or `setLevel`.

| Level | recentMessageCount | maxToolResultChars | retainedChars |
|---|---|---|---|
| conservative | 20 | 32 000 | 16 000 |
| balanced | 14 | 16 000 | 8 000 |
| aggressive | 8 | 6 000 | 2 400 |

The `recentMessageCount` newest messages are never touched;
`maxToolResultChars` triggers truncation; `retainedChars` bounds the
truncated head + marker + tail.

## Model Experience

### What the model sees

When enabled, older redundant results become a one-line omission marker
(`[Smart pruning: omitted older duplicate output ...]` or
`... superseded file read ...]`), and older over-budget results become a
bounded head + marker + tail. Failed results (`is_error` or an error-looking
prefix) are never pruned.

### Token effect

Reduces retained tool-result tokens for repeated and oversized results; no
model call is made.

### KV Cache effect

The rewrite is deterministic for a given message list and level, so it is
prefix-stable until the first rewritten token.

## Known Limitations and Deferred Work

- **In-memory only.** `setEnabled`/`setLevel` mutate session state and are
  not persisted; persistence is deferred.
- **Syntactic.** Deduplication is a content fingerprint and superseded-read
  detection is path-based; it does not interpret semantic equivalence.
- **Step-boundary trigger.** A result is pruned on the next
  `agent/pre-step` once it ages out of the level's recent-message window;
  over-budget truncation is the dsh pruner's job, not this seam's.
