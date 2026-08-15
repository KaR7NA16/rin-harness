# @rin/agent-migration

rin agent-migration — the **external-agent scan** behind the desktop
AgentMigration page. It reports which external agent config directories exist
under the host home, so the UI can show what is available to import.

This package only scans; it does not convert or write anything.

## What it scans

Each known external agent has one or more home-relative config roots. The scan
reports an agent only when at least one of its roots exists, and reads that
root's <code>agents/</code> and <code>skills/</code> subdirectories to tell
whether it holds any entries.

| id           | name          | config roots                      |
| ------------ | ------------- | --------------------------------- |
| claude-code  | Claude Code   | ~/.claude                         |
| codex        | Codex         | ~/.codex, ~/.agents               |
| cursor       | Cursor        | ~/.cursor                         |
| openclaw     | OpenClaw      | ~/.openclaw                       |
| hermes-agent | Hermes Agent  | ~/.hermes                         |
| deepseek-tui | DeepSeek TUI  | ~/.codewhale, ~/.deepseek         |

## Service API

The Cordis plugin is named <code>agent-migration</code>, injects nothing, and
registers a <code>FileAgentMigrationService</code> on
<code>ctx.agentMigration</code>. Its config has two keys:

- <code>homeDir</code> — directory to scan; defaults to the OS home.
- <code>targetAgentId</code> — destination agent id reported by
  <code>scan()</code>; defaults to <code>claude-code</code>.

~~~
import type { Context } from '@deepseek-ai/cordis'

// ctx.agentMigration.scan() // AgentMigrationScan
~~~

<code>scan()</code> returns <code>{ scannedAt, targetAgentId, agents }</code>,
where each agent is <code>{ id, name, source, status }</code>:

- <code>source</code> — absolute path of the first existing config root.
- <code>status</code> — <code>detected</code> when the root holds agents/skills
  entries, <code>empty</code> when the root exists but has none. A missing root
  is omitted, so a home with no external-agent directories yields
  <code>agents: []</code>.

The scan core (<code>scanAgentMigration</code>) is exported from the package
root and runs independently of cordis.

## Known Limitations

- **Scan-only.** This package detects external agent config; it does not
  implement import, conversion, or write-back of agents/skills. Those are
  deferred to a later milestone.
- **Fixed root conventions.** It only looks at the home-relative directories
  listed above and their <code>agents/</code>/<code>skills/</code>
  subdirectories; environment-variable overrides (e.g.
  <code>CLAUDE_CONFIG_DIR</code>, <code>CODEX_HOME</code>) and per-profile roots
  (e.g. Hermes profiles) are not yet honoured.
- **No executable detection.** Unlike the legacy service, it does not resolve
  the agent's binary, so an installed agent with no config directory is not
  reported.
