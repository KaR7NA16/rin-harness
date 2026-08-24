# @rin/workspace/agents

rin agents — the **repository agent bridge**. It owns two durable agent stores
and the projection that turns repository assets into runnable dsh agents:

1. **Repository agents** — `RepositoryAgentConfiguration` (v2) records under a
   repository's `agents/` root, each returned with a content revision.
2. **Runtime agent definitions** — `AgentDefinition`-shaped records under the
   rin agents home (default `~/.rin/agents/`, configurable), so a definition
   can live outside any repository.
3. **Projection** — materialises each repository agent as a dsh agent-presets
   user preset (`<presetRoot>/<id>/agent.cordis.yml`).
4. **AI proposal** — drafts a new agent record from user instructions through
   an injected text-to-configuration adapter.

The package reads the repository's agent files the same way `@rin/assets`
does (one `<name>.agent.yaml` per record, `version: 2`,
`kind: AgentConfiguration`) and writes them with the `yaml` dependency, so
records it authors round-trip through the repository reader unchanged.

## Service API

The Cordis plugin is named `agents`, injects nothing, and registers a
`FileAgentStore` on `ctx.agents`. Its config has three keys:

- `agentsHome` — runtime-definition root; `~` expands. Default `~/.rin/agents`.
- `defaultRepositoryRoot` — repository root used when a caller names none;
  empty means pass one explicitly.
- `autoProject` — listen for the dsh `agent/created` event and project the
  configured repository's agents into the user preset root whenever their
  content changed since the last projection. Default `true`; set `false` to
  keep projection manual-only (`projectRepositoryAgents`).

```ts
import type { Context } from '@deepseek-ai/cordis'

// ctx.agents.listRepositoryAgents(root?)       // RepositoryAgentRecord[]
// ctx.agents.getRepositoryAgent(root?, id)     // RepositoryAgentRecord | undefined
// ctx.agents.createRepositoryAgent(root?, in)  // RepositoryAgentRecord
// ctx.agents.updateRepositoryAgent(root?, id, in) // RepositoryAgentRecord
// ctx.agents.deleteRepositoryAgent(root?, id)  // void

// ctx.agents.listRuntimeAgents()               // RuntimeAgentDefinition[]
// ctx.agents.getRuntimeAgent(name)             // RuntimeAgentDefinition | undefined
// ctx.agents.createRuntimeAgent(input)         // RuntimeAgentDefinition
// ctx.agents.updateRuntimeAgent(name, input)   // RuntimeAgentDefinition
// ctx.agents.deleteRuntimeAgent(name)          // void

// ctx.agents.projectRepositoryAgents(root?, { presetRoot? }) // { ids: string[] }
// ctx.agents.proposeAgent(instructions, generate?)           // AgentProposal
```

With `autoProject` (the default) the plugin registers an `agent/created`
listener that re-projects only when the repository's agent content changed —
computed as a `name:revision` fingerprint — so a burst of agent creation does
not rewrite the preset root. Projection still refuses to overwrite a preset
whose file differs, so a diverged preset fails loud as a logged error instead
of blocking the agent that triggered it.

Every repository record carries a `revision`: the first 12 hex digits of its
file's SHA-256 digest, so a caller can tell whether a record changed without
re-reading it. `createRepositoryAgent` refuses to overwrite an existing
record; `updateRepositoryAgent`/`deleteRepositoryAgent` fail loud on a
missing id.

The same functions are exported from the package root for direct use (for
example from a web-server route or a test): `listRepositoryAgents`,
`createRepositoryAgent`, `projectRepositoryAgents`, `proposeAgent`, and
their runtime-definition counterparts.

## Model Experience

### What the model sees

- **Projected persona.** `renderAgentCordisYaml` turns a repository agent's
  `systemPrompt` into a `@deepseek-ai/dsh-persona` row with `complete: true`
  and `includeRuntimeContext: false`, matching the shipped `minimal` preset's
  identity row. That text is the agent's whole system prompt, so the
  repository author's wording is exactly what the model runs under. `tools`
  become `@deepseek-ai/dsh-tool-<id>` rows.
- **Proposal prompt.** `buildAgentProposalPrompt` is model-visible; it asks
  for one JSON object with `name`/`description`/`systemPrompt`/`tools` plus
  optional `model` and `permissionMode`, and instructs the model to keep the
  system prompt self-contained and imperative. The wording is original to
  this package.

### Token effect

Projection and proposal add no token cost to an agent conversation: a
projected persona is the agent's own prompt (not an extra section), and
proposals run as a separate model call through the injected adapter.

### KV Cache effect

Independent — no interaction with the model prefix beyond the projected
persona itself, which is the agent's stable system prompt.

## Known Limitations and Deferred Work

- **The default proposal adapter needs real-machine verification.**
  `proposeAgent` is pure over an injected `generate` adapter; the built-in
  default wraps the dsh llm seam (`ctx.get('llm')`) by resolving the first
  registered provider and model and collecting text deltas from a one-shot
  stream. That exact seam surface (provider/model resolution) must be
  confirmed against a real `@deepseek-ai/dsh-llm` runtime.
- **Projection target-root resolution needs real-machine confirmation.** The
  default preset root is `$DSH_HOME/.agent-presets` (or `~/.dsh/.agent-presets`),
  resolved through `@deepseek-ai/dsh-agent-presets` `writableRoot`; an
  explicit `presetRoot` option bypasses it. Confirm that the assembled
  runtime composes the same user root the dsh agent-presets plugin discovers.
- **Auto-projection surfaces divergence as an error, not an overwrite.** The
  `agent/created` trigger re-projects only when repository content changed,
  but projection never overwrites a differing preset (hand-edit protection),
  so editing a projected repository agent logs an error on the next agent
  creation and leaves the preset untouched; reconcile the preset or re-project
  manually.
- **`model` and `permissionMode` are comments, not rows.** The shipped
  agent.cordis.yml presets expose no stable agent-plane row for either —
  `model` resolves per session/route (`{{model}}`) and permission mode lives
  behind the host-plane permission-presets service — so the projection
  records both as YAML comments and leaves their row mapping to a later,
  verified milestone.
- **Tool ids are author-chosen.** A repository `tools` entry is mapped to
  `@deepseek-ai/dsh-tool-<id>` verbatim; whether that plugin exists is not
  checked here, and mismatched ids surface only when the preset mounts.
- **Markdown definitions are read-only.** Runtime `.md` files with YAML
  frontmatter join `listRuntimeAgents`, but the service writes `.agent.yaml`
  files only.
