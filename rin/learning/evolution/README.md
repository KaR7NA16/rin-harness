# @rin/evolution

rin evolution — the **skill self-evolution closed loop**: propose a skill,
decide reuse/merge/create through the deterministic creation gate, review with
a model, approve, and persist. It orchestrates `@rin/skill-memory` (the gate
and store) and `@rin/prompt-memory` (insight projection) without reimplementing
either.

## The loop

1. **Propose.** A post-turn hook calls `executeReview` with the visible
   conversation messages and the existing skill catalog.
2. **Eligibility.** `evaluateSkillReviewEligibility` counts tool uses and
   correction signals, redacts secrets, and fingerprints the turn.
3. **Review.** `buildSkillLearningPrompt` frames the task; the injected
   `reviewModel` adapter returns a structured candidate or `<no_skill>`.
4. **Gate.** `evaluateSkillCreationCandidate` (skill memory) decides
   `reuse` / `merge` / `create` against the comparable catalog.
5. **Approve.** `approveCandidate` validates frontmatter and credentials,
   then writes `SKILL.md` atomically (with a backup on update).
6. **Persist.** The candidate and its events land in `state.json` under
   `<globalConfigRoot>/skill-learning/`.

## Service API

```ts
import type { Context } from '@deepseek-ai/cordis'
// ctx.evolution exposes readConfig/updateConfig/readState,
// getCandidate/approveCandidate/rejectCandidate, executeReview, and
// projectPromptMemoryInsights. apply() installs FileEvolutionService.
```

The plugin config requires `globalConfigRoot` and `reviewModel`; the model
adapter, catalog refresh, and notice callback are injected by the installing
runtime (see `EvolutionPluginConfig` in `src/index.ts`). The optional
`autoTrigger` flag (default off) opts into `registerEvolutionTriggers`, a
session-lifecycle trigger wiring point — see `src/seam.ts`.

## Cross-@rin wiring

The workspace @rin packages are not built (no `lib/`), so evolution imports
their source by relative path rather than package name:

- `../../../memory/skill-memory/src/gate.ts` — the deterministic creation gate.
- `../../../memory/skill-memory/src/paths.ts` — skill-memory layout for the overview.
- `../../../memory/prompt-memory/src/{insights,store,reviewLog}.ts` — insight projection.

## Model Experience

### Request context and condition

None directly. This plugin is a host-side service; review prompts reach a model
only through the injected `reviewModel` adapter, never through prompt assembly.

### Token effect

Zero direct token effect on the agent conversation; reviews run as separate,
non-streaming model calls.

### KV Cache effect

Independent — no interaction with the model prefix.

## Known Limitations and Deferred Work

- **Model adapter is injected.** There is no bundled LLM provider; the runtime
  supplies `reviewModel`.
- **Catalog refresh is an adapter.** `clearCatalog` is optional and called
  best-effort after approval.
- **Interactive skill generation and auto-consolidation are deferred.** The
  reviewer loop here is the automatic path only; the interactive skillify
  interview and the dream consolidation agent are not ported.
- **No automatic review trigger.** `executeReview` is entered manually (the
  web-server route reads the overview only). `registerEvolutionTriggers` is an
  opt-in wiring point that subscribes to a session lifecycle event but has no
  session→review mapping yet — enabling `autoTrigger` records a debug trace and
  does not run reviews.
