# Claude Adapter Boundary

This subtree describes how `.imo/` source assets will eventually materialize into a generated `.claude/` host surface.

## Contract

- `.imo/adapters/claude/` stores adapter templates, mapping rules, and host-specific contracts.
- Generated `.claude/` files are outputs and should not become a second source-of-truth.
- In this repo's current integration mode, the manifest stays empty for Trellis-owned Claude host targets.
- Keep this subtree as adapter-boundary documentation unless the project explicitly decides IMO should take ownership of those Claude outputs.
- Skills and commands remain deferred in this adapter until their product-side truth is migrated into `.imo`.
- Future host-output projection must follow `../HOST_OUTPUT_CUTOVER.md`; Claude
  targets use namespaced non-overlapping paths and must not claim Trellis-owned
  same-path outputs.
