# @rin/review

rin review — a capability that reviews a provided artifact (code, diff, or
file content) through the dsh llm seam. The model-visible `review_artifact`
tool and the `/review` / `/security-review` slash commands review the
artifact with a general or security-focused lens. The output is a markdown
review — Summary, Issues grouped by severity (critical/high/medium/low) with
file/line references when present, and Recommendations — byte-bounded to
`maxResultBytes`.

The `/security-review` command (and `kind: "security"`) uses a
security-focused review prompt that actively hunts risks: injection
(shell/SQL/path/command), secrets and credentials, unsafe patterns (eval,
unsafe deserialization, missing input validation), authentication flaws, and
data exposure.

## Registration

The Cordis plugin entry (`index.ts`) is a thin `apply()` that calls
`registerSeam()`; the seam (`seam.ts`) adapts the real Context to the
structural `ReviewSeam` (tools/commands registries + the llm seam) and
constructs `ReviewCore`. All prompt building and result shaping live in the
dependency-free core (`core.ts`), so the strip-types smoke and unit tests
never touch the Cordis/dsh import graph.

The seam reads the llm through `ctx.get('llm')` and fails loud at load when
the seam is absent or no provider is registered.

## Configuration

All fields optional; defaults shown:

| Field | Default | Meaning |
|---|---|---|
| `provider` / `model` | first registered provider / `deepseek-v4-flash` | Explicit llm route; must be set together |
| `maxInputBytes` | 64 KiB | UTF-8 bound for the artifact text |
| `maxResultBytes` | 16 KiB | UTF-8 bound for the produced review markdown |
| `maxOutputTokens` | 2048 | Output-token cap for the generation call |

## Model Experience

### What the model sees

- `review_artifact` — parameters `text` (required artifact content) and
  `kind` (optional, `general` | `security`, default `general`). Returns
  `{ markdown, kind, truncated }`; the rendered content is the markdown
  review.
- `/review` — slash command; the text after the command is the artifact.
  Runs the general lens.
- `/security-review` — slash command; the text after the command is the
  artifact. Runs the security lens.

### Token effect

One auxiliary llm call per invocation. Input is the bounded artifact
(`maxInputBytes`); output is bounded to `maxResultBytes` and
`maxOutputTokens`. The tool schema/description join the ordinary tool-set
prompt prefix.

### KV Cache effect

Independent beyond the ordinary tool-set assembly: the schema enters the
prompt prefix and changes only when the tool set does; each generation is a
fresh one-shot call.

## Known Limitations and Deferred Work

- **Single-pass, single-model review.** There is no multi-model cross-check,
  no second-pass verification of reported issues, and no severity
  calibration against a policy; a future revision may add iterative
  review-and-verify.
- **Artifact framing is delimiter-based.** The artifact is framed as plain
  text after a header line; adversarial artifacts that mimic the framing
  could confuse section boundaries (the system prompt instructs the model to
  treat everything as data).
- **No structured issue extraction.** The review is free-form markdown;
  machine-readable issue records (id, severity, file/line, category) are
  deferred.
- **Provider/model discovery is first-registered only.** `listProviders()`
  picks the first route; explicit `provider`/`model` config is the
  supported override.
