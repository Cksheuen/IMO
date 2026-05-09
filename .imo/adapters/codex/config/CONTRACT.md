# Codex Config Contract

This directory will own templates or mapping rules for generated Codex config artifacts.

## Contract

- Generated targets may include `.codex/config.toml`, `hooks.json`, or related managed fragments.
- Config outputs are adapter artifacts derived from `.imo/` contracts and must not become a second source-of-truth.
- Phase 2 uses:
  - `managed-hooks.json` as the canonical JSON fragment merged into `.codex/hooks.json`
  - `managed-config.toml` as the canonical managed block inserted into `.codex/config.toml`
- Non-IMO keys in shared config targets must be preserved.
