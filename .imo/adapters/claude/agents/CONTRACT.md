# Claude Agents Contract

This directory will own templates or mapping rules for generated `.claude/agents/` content.

## Contract

- Source data originates in `.imo/`, not in generated host files.
- Host output shape is expected to mirror Claude agent entry files (for example `*.md` descriptors).
- For Trellis-owned Claude agent targets, this directory is a boundary contract rather than an active projection source in the current repo state. Do not store copied Trellis agent templates here while Trellis remains the active owner of `.claude/agents/trellis-*.md`.
