# @rin/token-optimization

rin token-optimization — one minimal switch for the token-saving family.

Two knobs today, both system-prompt layer and both session-log-free:

- responseStyle (off | caveman | ponytail): installs a response-compression prompt
  as an ordered system-prompt section.
- cleanPrompt (boolean): installs an assemble-waterfall listener that normalizes
  section text (line endings, trailing whitespace, blank runs).

## Service API

Config: responseStyle (default off) + cleanPrompt (default false). An invalid
responseStyle fails loud at load.

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
