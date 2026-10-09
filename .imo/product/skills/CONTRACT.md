# Product Skills Contract

`.imo/product/skills/` is the canonical source for IMO-owned skill families.
Root `skills/` entries are source-checkout compatibility projections. Global
Codex entries under `~/.codex/skills/` are managed symlinks to this canonical
source and must not become a second implementation source.

## Ownership

- `modules.json` is the machine-readable source for module classification,
  lifecycle, dependencies, integration modes, and learning access.
- `MODULE_CLASSIFICATION.md` explains the classification model without
  duplicating the registry.
- Framework-owned policy may live here even when execution is provider-backed.
- Downloaded, marketplace, plugin-provided, or host-provided skills remain
  external unless an explicit adoption change assigns ownership.

## Lazy-loading contract

- `SKILL.md` is a compact trigger, decision, workflow, and boundary entrypoint.
- Long examples, mappings, templates, and volatile provider configuration live
  in `references/` and are read only when needed.
- Migrated runtime code, comparison reports, and fixtures are implementation or
  verification assets; they are never prompt-time context by default.
- A skill should not restate global tool behavior or generic model knowledge.
- Skill promotion must resolve the global manifest `source_root`; package-mode
  installs generate reviewable outbox proposals instead of editing projections.

## Validation

- `./imo verify` checks registry/source consistency and root projections.
- `check_skill_semantics.py` validates classification, maturity, integration
  mode, owner surface, and graceful optional-provider degradation; unavailable
  optional providers warn but do not fail native verification.
- A migrated family also needs a real user-facing behavior check appropriate
  to the capability; file equality alone is insufficient.
- Optional provider absence must not fail IMO-native verification.
