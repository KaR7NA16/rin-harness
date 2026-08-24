# @rin/authoring

rin brief — a capability that produces a structured, markdown session brief
from the current session log through the dsh llm seam. The model-visible
`brief` tool and the `/authoring` slash command both read the invoking agent's
session events (`agent.session.events`), trim them to a bounded recent
surface window, build a prompt, and call the first registered llm provider
with a default model (or an explicitly configured `provider`/`model` pair).
The result is a markdown brief with Goal, Progress, Decisions, Open
questions, and Next steps sections, byte-bounded to `maxResultBytes`.

## Registration

The Cordis plugin entry (`index.ts`) is a thin `apply()` that calls
`registerSeam()`; the seam (`seam.ts`) adapts the real Context to the
structural `BriefSeam` (tools/commands registries + the llm seam) and
constructs `BriefCore`. All prompt building, transcript rendering, and
result shaping live in the dependency-free core (`core.ts`), so the
strip-types smoke and unit tests never touch the Cordis/dsh import graph.

The seam reads the llm through `ctx.get('llm')` and fails loud at load when
the seam is absent or no provider is registered.

## Configuration

All fields optional; defaults shown:

| Field | Default | Meaning |
|---|---|---|
| `provider` / `model` | first registered provider / `deepseek-v4-flash` | Explicit llm route; must be set together |
| `maxEvents` | 120 | Recent surface events included in the transcript |
| `maxInputBytes` | 32 KiB | UTF-8 bound for the rendered transcript |
| `maxResultBytes` | 16 KiB | UTF-8 bound for the produced brief markdown |
| `maxOutputTokens` | 2048 | Output-token cap for the generation call |

## Model Experience

### What the model sees

- `brief` — optional parameter `focus` (a hint steering the brief). Returns
  `{ markdown, eventCount, truncated }`; the rendered content is the markdown
  brief.
- `/authoring` — slash command; the text after the command is the focus hint.
  Returns the brief markdown as the command result.

### Token effect

One auxiliary llm call per invocation. Input is the bounded transcript
(`maxInputBytes`); output is bounded to `maxResultBytes` and
`maxOutputTokens`. The tool schema/description join the ordinary tool-set
prompt prefix.

### KV Cache effect

Independent beyond the ordinary tool-set assembly: the schema enters the
prompt prefix and changes only when the tool set does; each generation is a
fresh one-shot call.

## Known Limitations and Deferred Work

- **Recent-window transcript only.** The brief summarizes only the bounded
  surface window (`maxEvents` recent user/assistant/tool events); earlier
  session work is summarized from the window alone, not re-read from storage.
- **Single one-shot generation.** There is no iterative refinement or
  multi-model cross-check of the brief; deferred to a future revision.
- **Provider/model discovery is first-registered only.** `listProviders()`
  picks the first route; explicit `provider`/`model` config is the
  supported override.
- **No persistence.** The brief is returned to the caller and logged via the
  tool/command result; it is not stored as a derived session artifact.
