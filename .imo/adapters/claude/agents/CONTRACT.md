# Claude Agents Contract

This directory will own templates or mapping rules for generated `.claude/agents/` content.

## Contract

- Source data originates in `.imo/`, not in generated host files.
- Host output shape is expected to mirror Claude agent entry files (for example `*.md` descriptors).
- Phase 2 promotes the copied `trellis-*.md` files in this directory to the canonical source for generated `.claude/agents/trellis-*.md` outputs.
