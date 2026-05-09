# Claude Adapter Boundary

This subtree describes how `.imo/` source assets will eventually materialize into a generated `.claude/` host surface.

## Contract

- `.imo/adapters/claude/` stores adapter templates, mapping rules, and host-specific contracts.
- Generated `.claude/` files are outputs and should not become a second source-of-truth.
- Phase 2 now includes file-level templates for the minimal managed-output loop:
  - `agents/trellis-*.md`
  - `hooks/session-start.py`
  - `hooks/inject-subagent-context.py`
  - `hooks/inject-workflow-state.py`
  - `settings/managed-settings.json`
- Skills and commands remain deferred in this adapter until their product-side truth is migrated into `.imo`.
