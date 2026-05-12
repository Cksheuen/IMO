# Shared Runtime Contract

`runtime/shared/` stores reusable runtime helpers and typed protocol fragments that are consumed by multiple migrated runtime families.

## Contract

- Files here are canonical shared runtime source-of-truth, not user-facing skill families.
- Content here may define typed state fragments, reviewer/implementer handoff payloads, graph compile helpers, and similar cross-family runtime contracts.
- Product-family runtimes may depend on this subtree, but family-specific logic must stay in the owning product family.
- Root compatibility surfaces under `skills/migrated/shared_runtime/*` may remain as projections while imports still depend on that legacy path.
