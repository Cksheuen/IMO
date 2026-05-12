# Product Skills Contract

`product/skills/` is reserved for framework-owned skill source files.

## Contract

- Files here become the canonical skill source once migration from root `skills/` is approved.
- Adapter layers may project these skills into host-specific surfaces, but must not redefine them as source-of-truth.
- Phase 1 started the first skill-family pilot by moving `cc-to-framework-migration` into this subtree as the canonical source family.
- Phase 1 expanded the pilot with `architecture-health`, including its skill-local support scripts.
- Phase 1 now also includes `pkg-dive` as a canonical skill family under this subtree.
- Phase 1 now also includes `locate` as a canonical skill family under this subtree.
- Root `skills/` may remain as compatibility projections while migration is in progress, but they should no longer be treated as the long-term source-of-truth for migrated families.

## Inclusion Rule

- Only framework-owned skill families belong under `product/skills/`.
- If a capability is expected to be delivered from a public market, it should stay external by default instead of being vendored into repo-owned `.imo/product/skills/*`.
- Current standing example: `pencil-*` families are treated as market-sourced and excluded from repo-owned migration unless a future task explicitly overrides that decision.

## Validation Rule

- Skill-family migration is not complete with only symlink checks, `cmp`, or file-content equality.
- Each migrated skill family must include at least one recorded live-usage validation against a real target relevant to that skill.
- The validation should prove that the root compatibility surface still works for an actual user-facing scenario after canonical migration.
- Structural projection checks are still useful, but they are supporting evidence only and must not be the sole acceptance signal.
