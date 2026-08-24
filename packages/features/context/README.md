# @rin/context

@rin/context groups the context-budget capabilities that operate around the
model input lifecycle:

- smart-pruning: deterministic tool-result deduplication and truncation.
- token-optimization: prompt cleaning through the system-prompt waterfall.
- codegraph: per-project SQLite indexing and architecture summaries.

The source modules remain isolated under src/smart-pruning/, src/token-optimization/,
and src/codegraph/. Grammar WASM assets live in grammars/.

## Registration

The aggregate Cordis plugin is exported as apply(ctx, config). It installs all
three modules; smartPruning and tokenOptimization can be configured independently.

    import { apply } from '@rin/context'

    apply(ctx, { smartPruning: { level: 'balanced' }, tokenOptimization: { cleanPrompt: true } })

## Known Limitations and Deferred Work

- Codegraph indexing is deliberately a pragmatic symbol/import subset and is
  not a complete language server or whole-program semantic index.
