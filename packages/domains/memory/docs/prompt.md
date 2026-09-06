# @rin/memory/prompt

rin prompt memory — editable prompt-memory files plus Rin's canonical
materialized cognition projection.

It owns deterministic character budgets, provenance-aware insight projection,
file layout, configuration, seed identity, serialized entry mutations, and
atomic writes. Memory lives under an injected configuration root: a `SOUL.md`
identity file at the root and a `prompt-memory/` directory holding `BRIEF.md`,
`USER.md`, `config.json`, and the `AUTO_REVIEW_LOG.jsonl` audit log. The
Cordis plugin entry (`index.ts`) exposes `ctx.promptMemory` with a service
bound to one configuration root, and projects the memory into the system
prompt as an ordered rin:prompt-memory section. When ctx.memory exposes the
canonical cognition surface, this section is generated from replayed Rin state;
the files are not model-input authority.

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

One ordered rin:prompt-memory section, refreshed from Rin's materialized
cognition state on every prompt assembly. Eligible self, current-field, scene,
person, relationship, disposition, structure, and open-loop representations
are rendered with epistemic state, confidence, and model-input influence
boundary. Blocked, archived, erased, superseded, rejected, or non-model-input
representations are omitted. The projection is bounded by
PROMPT_MEMORY_TOTAL_CHAR_LIMIT; an empty eligible state contributes nothing.
Contexts without the canonical surface retain the file-backed builder as an
explicit fallback for structural compatibility.

### Token effect

Up to PROMPT_MEMORY_TOTAL_CHAR_LIMIT (3575) characters of canonical
model-visible prose, depending on the eligible cognition state.

### KV Cache effect

Varies with the eligible cognition state — the section joins the system prompt
prefix, so changes to canonical state shift the prefix and its cached state.

## Known Limitations and Deferred Work

- **No automatic model review.** The review log is written and read by callers;
  automatic model-driven review and REPL hooks are deferred.
- **Canonical projection is not full recall.** Prompt projection currently
  consumes the materialized state directly; multi-cue retrieval, coalition
  optimization, and use-trace driven consolidation remain later wave work.
- **Editable files remain a fallback surface.** The canonical Host path does
