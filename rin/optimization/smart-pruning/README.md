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
- **Not a dsh seam yet.** Projection into the dsh compaction surface is the
  next milestone.
