# Product Skills Contract

`product/skills/` is reserved for framework-owned skill source files.

## Contract

- Files here become the canonical skill source once migration from root `skills/` is approved.
- Adapter layers may project these skills into host-specific surfaces, but must not redefine them as source-of-truth.
- Phase 1 keeps this directory at contract-only granularity; no legacy skill content is moved yet.

