# @rin/memory/prompt

rin prompt memory — file-backed **identity and prompt memory** persistence.

It owns deterministic character budgets, provenance-aware insight projection,
file layout, configuration, seed identity, serialized entry mutations, and
atomic writes. Memory lives under an injected configuration root: a `SOUL.md`
identity file at the root and a `prompt-memory/` directory holding `BRIEF.md`,
`USER.md`, `config.json`, and the `AUTO_REVIEW_LOG.jsonl` audit log. The
Cordis plugin entry (`index.ts`) exposes `ctx.promptMemory` with a service
bound to one configuration root, and projects the memory into the system
prompt as an ordered `rin:prompt-memory` section.

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
yet exist). Both fail loud at load when missing. Three optional switches control
the system prompt projection: `injectPromptMemory` (master, default true),
`injectSoul` (include `SOUL.md`, default true), and `injectBrief` (include
`BRIEF.md`, default true).

## Model Experience

### What the model sees

One ordered `rin:prompt-memory` section, refreshed from the store on every
prompt assembly. It renders the `SOUL.md` identity, the `BRIEF.md` working
brief, and the `USER.md` user memory under `# Identity`, `# Working brief`,
and `# User memory` headings. `SOUL.md` is bounded to its own character
limit, and `BRIEF.md`/`USER.md` share the combined prompt-memory budget;
over-limit content is truncated with an explicit `[Truncated …]` notice.
Empty components are omitted, so an empty store contributes nothing.

### Token effect

Up to `SOUL_CHAR_LIMIT` (3000) plus `PROMPT_MEMORY_TOTAL_CHAR_LIMIT` (3575)
characters of model-visible prose, depending on the populated files.

### KV Cache effect

Varies with the memory content — the section joins the system prompt prefix,
so changes to the memory files shift the prefix and its cached state.

## Known Limitations and Deferred Work

- **No automatic model review.** The review log is written and read by callers;
  automatic model-driven review and REPL hooks are deferred.
- **File-backed only.** Memory is persisted as markdown and JSONL files; there
  is no SQLite or other database backing yet.
