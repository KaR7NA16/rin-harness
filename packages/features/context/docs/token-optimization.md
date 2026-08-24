# @rin/context

rin token-optimization — the slim knob set for the token-saving family.

Two switches today, both system-prompt layer and both session-log-free:

- responseStyle (off | caveman | ponytail): installs a response-compression prompt
  as an ordered system-prompt section.
- cleanPrompt (boolean): installs an assemble-waterfall listener that normalizes
  section text (line endings, trailing whitespace, blank runs).

Both are live-switchable at runtime through ctx.tokenOptimization.

## Service API

Config: responseStyle (default off) + cleanPrompt (default false). An invalid
responseStyle fails loud at load.

ctx.tokenOptimization (TokenOptimizationStore):

- getStatus(): { responseStyle, cleanPrompt }.
- setResponseStyle(style): applies the section swap immediately; throws on an
  unknown style.
- setCleanPrompt(enabled): applies the cleaner swap immediately.

The effect swapping lives in store-core.ts (TokenOptimizationCore) over a
structural seam, keeping the swap logic smoke-testable without Cordis.

## Model Experience

### What the model sees

Depending on the switch: an extra response-compression section, and/or
whitespace-normalized section text. No tool schema or tool-result change.

### Token effect

The response style saves response tokens; the cleaner removes trailing
whitespace and redundant blank lines.

### KV Cache effect

Both are deterministic and prefix-stable for a given config.

## Known Limitations and Deferred Work

- smartPruning (tool-result dedupe/supersede) and rtk (shell I/O compression) are
  deferred knobs; dsh already ships a basic tool-result pruner.
- The cleaner does not preserve fenced code blocks verbatim (blank-run collapsing
  applies inside them); fence preservation is deferred.
- responseStyle is a single global section; no per-agent override yet.
- A style change does not rewrite already-assembled prompts mid-request; it
  applies from the next assembly.
