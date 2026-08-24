# @rin/memory/skill

rin Skill Memory — the deterministic skill decisions and durable memory store
for agent skills.

It owns four capabilities: the skill creation gate (`gate.ts`) that decides
whether a proposed skill reuses, merges with, or stays distinct from existing
skills; the lifecycle policy (`lifecycle.ts`) that ages a skill from active
to stale or archived; the storage identities (`paths.ts`) that derive stable
ids and on-disk layout from injected config roots; and the store (`store.ts`)
that owns file locking, atomic writes, usage/stats consistency, summaries, and
bounded pending/evidence retention. The Cordis plugin entry (`index.ts`)
exposes the `ctx['skill-memory']` service with a
`createStore(roots, options)` method, and the seam projection (`seam.ts` +
`catalog.ts`) registers a `ctx.skills` provider that exposes each remembered
skill's `SUMMARY.md` as a `skill-memory-*` skill.

## Service API

```ts
import type { Context } from '@deepseek-ai/cordis'
// ctx['skill-memory'].createStore(roots, options) => SkillMemoryStore
// gate / lifecycle / paths / store are pure exports on the package root
```

## Model Experience

### Request context and condition

#### What the model sees

Through the skills seam: when config roots are provided, each remembered skill
with a non-empty, non-archived `SUMMARY.md` is advertised as a
`skill-memory-<name>` skill in the skill catalog, and loading it returns the
distilled memory body. Without config roots the provider contributes an empty
catalog, so the service remains a host-side library.

#### Token effect

Bounded by the skill catalog: the provider adds one routing description per
remembered skill, and a loaded memory injects its `SUMMARY.md` body (capped at
2,500 characters by the store).

#### KV Cache effect

Independent — no interaction with the model prefix.

## Known Limitations and Deferred Work

- **No runtime adapters.** Command mapping, prompt formatting, fire-and-forget
  logging, lifecycle scheduling, and model-driven review stay outside this
  package; this port ships only the deterministic core and the store.
- **File-backed only.** The store persists to JSON/JSONL sidecars; there is no
  SQLite or network backend, and no cross-process coordination beyond the
  on-disk lock file.
- **Lifecycle is evaluated, not scheduled.** `evaluateSkillLifecycleStatus`
  is pure; nothing in this package timers or triggers re-evaluation.
