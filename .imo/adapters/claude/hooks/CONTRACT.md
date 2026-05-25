# Claude Hooks Contract

This directory will own templates or mapping rules for generated `.claude/hooks/` content.

## Contract

- Hook scripts are adapter outputs derived from `.imo/` source assets and runtime contracts.
- Host output may include Python or shell hook files, but generated `.claude/hooks/` remains non-authoritative.
- For the Trellis-owned Claude hook surface, this directory is a boundary contract rather than an active projection source in the current repo state. Do not store copied Trellis hook templates here while Trellis remains the active owner of that surface.
- Other hook files under the legacy host surface remain deferred until explicitly migrated.
- Future Claude hook projections must use namespaced non-overlapping targets or
  explicit non-conflicting registration points; same-path Trellis hook takeover
  is intentionally abandoned.
