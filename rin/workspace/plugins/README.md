# @rin/plugins

Markdown-based plugin directory listing exposed as ctx.plugins.

Each plugin is a directory under ~/.rin/plugins holding a plugin.md with YAML frontmatter
(name/description/version/author/id) followed by capability sections (Commands/Agents/Skills/
Hooks/McpServers/LspServers). Enable/disable toggles an id in disabled.json.

## API

- list() — summaries + capability counts.
- detail(id) — full capability entries.
- setEnabled(id, enabled) — toggle.

## Known Limitations and Deferred Work

- The marketplace/install/version/reconcile subsystem (20k lines) is not ported; only local directory listing.
- Capability sections are not wired into the composed dsh services (commands/agents/skills/mcp/lsp).
