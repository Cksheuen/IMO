# IMO Product Surfaces

This subtree holds IMO product-side source surfaces.

## Current Rule

- `.imo/product/` is for framework-owned source assets.
- Product-owned source should move here before any host-surface cutover is considered.
- Host-facing `.claude/` / `.codex/` outputs remain outside this subtree and stay Trellis-owned in the current repo state.
- External frameworks, downloaded plugins, and market skills do not belong here
  by default. They stay provider-owned unless a future task explicitly adopts
  them into IMO product ownership.
- Current skill module ownership is tracked in `skills/MODULE_CLASSIFICATION.md`;
  a future task should convert that planning table into machine-readable module
  metadata checked by `imo verify`.

## Current Product Surfaces

| Surface | Current status | Notes |
| --- | --- | --- |
| `scripts/` | active | `scripts/CONTRACT.md` lists the canonical script implementations and the `scripts/imo.sh verify` aggregate check. Root `scripts/` entries are compatibility wrappers. |
| `rules/` | active | `rules/CONTRACT.md` lists IMO-owned behavioral rules. Rule metadata is checked by `check_rule_contracts.py`. |
| `skills/` | active | `skills/CONTRACT.md` lists the migrated canonical skill families under `.imo/product/skills`. Root `skills/` entries are compatibility projections. Market-sourced families such as `pencil-*` stay excluded from this repo-owned surface by default. |


## Deferred Companion Surfaces

These surfaces are part of the overall migration story, but their future landing layers live under `.imo/adapters/`, not under `.imo/product/`.

| Deferred surface | Future landing layer |
| --- | --- |
| Claude agents | `.imo/adapters/claude/agents` |
| Codex agents | `.imo/adapters/codex/agents` |
| Claude commands | `.imo/adapters/claude/commands` |
| Claude hooks | `.imo/adapters/claude/hooks` |
| Codex hooks | `.imo/adapters/codex/hooks` |
| Claude settings | `.imo/adapters/claude/settings` |
| Codex config / hook registry | `.imo/adapters/codex/config` |

## Planning Reference

Current durable roadmap:

- `.imo/ROADMAP.md`

Historical planning for the migration baseline lives in:

- `.trellis/tasks/05-11-imo-product-source-migration-plan/prd.md`
- `.trellis/tasks/05-11-imo-product-source-migration-plan/research/surface-inventory.md`
- `.trellis/tasks/05-11-imo-product-source-migration-plan/research/ownership-matrix.md`
- `.trellis/tasks/05-11-imo-product-source-migration-plan/research/phase-plan.md`

Those task docs carry the detailed reasoning. This file is only the durable repo-facing placeholder for the current product-surface model.
