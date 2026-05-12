# IMO Product Surfaces

This subtree holds IMO product-side source surfaces.

## Current Rule

- `.imo/product/` is for framework-owned source assets.
- Product-owned source should move here before any host-surface cutover is considered.
- Host-facing `.claude/` / `.codex/` outputs remain outside this subtree and stay Trellis-owned in the current repo state.

## Current Product Surfaces

| Surface | Current status | Notes |
| --- | --- | --- |
| `scripts/` | active pilot | `scripts/CONTRACT.md`, `audit_managed_ownership.py`, canonical `.imo/product/scripts/imo.sh`, and canonical `.imo/product/scripts/check-langchain-runtime-deps.py` now define the current product-side script pilot. |
| `skills/` | active pilot | `skills/CONTRACT.md` plus `cc-to-framework-migration/`, `architecture-health/`, `pkg-dive/`, and `locate/` now define the current migrated skill families under `.imo/product/skills`. Market-sourced families such as `pencil-*` stay excluded from this repo-owned surface by default. |


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

Detailed planning for the current migration baseline lives in:

- `.trellis/tasks/05-11-imo-product-source-migration-plan/prd.md`
- `.trellis/tasks/05-11-imo-product-source-migration-plan/research/surface-inventory.md`
- `.trellis/tasks/05-11-imo-product-source-migration-plan/research/ownership-matrix.md`
- `.trellis/tasks/05-11-imo-product-source-migration-plan/research/phase-plan.md`

Those task docs carry the detailed reasoning. This file is only the durable repo-facing placeholder for the current product-surface model.
