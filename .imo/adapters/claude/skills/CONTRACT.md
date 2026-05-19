# Claude Skills Contract

This directory will own templates or mapping rules for generated `.claude/skills/` content.

## Contract

- Skills exposed to Claude are projected from `.imo/` source assets, not edited as truth in generated host space.
- Host output shape may include skill folders, manifests, or injected references as needed by the adapter.
- Phase 1 keeps this category contract-only.
- Skills are not part of the active host-output cutover roadmap in `../../HOST_OUTPUT_CUTOVER.md`; schedule them in a separate task before adding manifest entries.
