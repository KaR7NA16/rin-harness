# @rin/computer-use runtime assets

Migrated from the legacy desktop project
(`src/server/api/computer-use-python.ts` + `server/api/computer-use.ts` used them
via Bun text imports) so the node-based `src/runtime.ts` can copy them into the
runtime root at install time:

- `requirements.txt` / `requirements-win.txt` — pip dependencies for macOS and
  Windows helper runtimes.
- `mac_helper.py` / `win_helper.py` — the helper scripts. The setup module only
  calls their `check_permissions` command (preflight); the rest of the helper
  protocol (screenshot, input, key dispatch) is not wired to any rin service yet.
- `test_helpers.py` — cross-platform pytest checks for the helper scripts, kept
  as provenance; run with `python -m pytest runtime/test_helpers.py`.
