# Codex Adapter Boundary

This subtree describes how `.imo/` source assets will eventually materialize into a generated `.codex/` host surface.

## Contract

- `.imo/adapters/codex/` stores adapter templates, mapping rules, and host-specific contracts.
- Generated `.codex/` files are outputs and should not become a second source-of-truth.
- Phase 2 now includes file-level templates for the minimal managed-output loop:
  - `agents/trellis-*.toml`
  - `hooks/session-start.py`
  - `hooks/inject-workflow-state.py`
  - `config/managed-hooks.json`
  - `config/managed-config.toml`
- The real Codex skill surface is still shared `.agents/skills/`; this adapter does not yet project skills.
