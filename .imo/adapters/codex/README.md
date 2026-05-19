# Codex Adapter Boundary

This subtree describes how `.imo/` source assets will eventually materialize into a generated `.codex/` host surface.

## Contract

- `.imo/adapters/codex/` stores adapter templates, mapping rules, and host-specific contracts.
- Generated `.codex/` files are outputs and should not become a second source-of-truth.
- In this repo's current integration mode, the manifest stays empty for Trellis-owned Codex host targets.
- Keep this subtree as adapter-boundary documentation unless the project explicitly decides IMO should take ownership of those Codex outputs.
- The real Codex skill surface is still shared `.agents/skills/`; this adapter does not yet project skills.
- Any future host-output handoff must follow `../HOST_OUTPUT_CUTOVER.md`; Codex targets are cut over atomically with their Claude counterparts.
