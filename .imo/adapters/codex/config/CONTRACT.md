# Codex Config Contract

This directory will own templates or mapping rules for generated Codex config artifacts.

## Contract

- Generated targets may include `.codex/config.toml`, `hooks.json`, or related managed fragments.
- Config outputs are adapter artifacts derived from `.imo/` contracts and must not become a second source-of-truth.
- For the Trellis-owned Codex config surface, this directory is a boundary contract rather than an active projection source in the current repo state. Do not store copied Trellis config fragments here while Trellis remains the active owner of that surface.
- Non-IMO keys in shared config targets must be preserved.
