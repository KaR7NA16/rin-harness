# @rin/prompt-memory

rin prompt memory — file-backed **identity and prompt memory** persistence.

It owns deterministic character budgets, provenance-aware insight projection,
file layout, configuration, seed identity, serialized entry mutations, and
atomic writes. Memory lives under an injected configuration root: a `SOUL.md`
identity file at the root and a `prompt-memory/` directory holding `BRIEF.md`,
`USER.md`, `config.json`, and the `AUTO_REVIEW_LOG.jsonl` audit log. The
Cordis plugin entry (`index.ts`) exposes `ctx.promptMemory` with a service
bound to one configuration root.

## Service API

```ts
import type { Context } from '@deepseek-ai/cordis'
// ctx.promptMemory.readFile(target)      => Promise<PromptMemoryFile>
// ctx.promptMemory.writeFile(target, c)  => Promise<PromptMemoryFile>
// ctx.promptMemory.getStatus()           => Promise<PromptMemoryStatus>
// ctx.promptMemory.addEntry(target, c)   => Promise<PromptMemoryMutationResult>
// ctx.promptMemory.replaceEntry(t, old, c)
// ctx.promptMemory.removeEntry(t, old)
// ctx.promptMemory.getConfig()           => Promise<PromptMemoryConfig>
// ctx.promptMemory.updateConfig({ injectEvolutionMemory })
// ctx.promptMemory.appendReviewLogs(entries)
// ctx.promptMemory.readReviewLogs(limit?)
```

The plugin config requires `configRoot` (the directory memory files are rooted
under) and `initialSoul` (the identity written to `SOUL.md` when it does not
yet exist). Both fail loud at load when missing.

## Model Experience

### What the model sees

None directly. This plugin contributes no model-visible prose in its current
form; it is a host-side service. The budget binders (`boundPromptMemoryPair`)
and insight projection (`buildPromptMemoryInsights`) are the building blocks a
later prompt-assembly milestone will surface.

### Token effect

Zero direct token effect.

### KV Cache effect

Independent — no interaction with the model prefix.

## Known Limitations and Deferred Work

- **No prompt-assembly projection.** Memory is persisted and projected into
  insights, but it is not yet injected into the system prompt; that is the next
  milestone.
- **No automatic model review.** The review log is written and read by callers;
  automatic model-driven review and REPL hooks are deferred.
- **File-backed only.** Memory is persisted as markdown and JSONL files; there
  is no SQLite or other database backing yet.
