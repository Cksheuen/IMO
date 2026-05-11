# Claude Settings Contract

This directory will own templates or mapping rules for generated Claude settings artifacts.

## Contract

- Generated targets may include `.claude/settings.json` or related managed fragments.
- Settings outputs are adapter artifacts derived from `.imo/` contracts and must not become a second source-of-truth.
- For the Trellis-owned Claude settings surface, this directory is a boundary contract rather than an active projection source in the current repo state. Do not store copied Trellis settings fragments here while Trellis remains the active owner of that surface.
- Non-IMO keys in the target file must be preserved.
