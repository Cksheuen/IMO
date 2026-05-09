# Claude Settings Contract

This directory will own templates or mapping rules for generated Claude settings artifacts.

## Contract

- Generated targets may include `.claude/settings.json` or related managed fragments.
- Settings outputs are adapter artifacts derived from `.imo/` contracts and must not become a second source-of-truth.
- Phase 2 uses `managed-settings.json` in this directory as the canonical JSON fragment that is merged into `.claude/settings.json`.
- Non-IMO keys in the target file must be preserved.
