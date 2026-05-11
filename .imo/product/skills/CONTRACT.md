# Product Skills Contract

`product/skills/` is reserved for framework-owned skill source files.

## Contract

- Files here become the canonical skill source once migration from root `skills/` is approved.
- Adapter layers may project these skills into host-specific surfaces, but must not redefine them as source-of-truth.
- Phase 1 started the first skill-family pilot by moving `cc-to-framework-migration` into this subtree as the canonical source family.
- Phase 1 expanded the pilot with `architecture-health`, including its skill-local support scripts.
- Root `skills/` may remain as compatibility projections while migration is in progress, but they should no longer be treated as the long-term source-of-truth for migrated families.
