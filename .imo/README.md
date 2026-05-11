# IMO Framework Source of Truth

This directory is the source-of-truth workspace for the IMO framework.

## Principles

- `.imo/` is the only intended source of truth for future framework-owned assets.
- Generated `.claude/` and `.codex/` content are adapter outputs, not truth.
- Stable runtime contracts live in-repo under `.imo/runtime/`.
- High-churn runtime state stays local under `.imo/.runtime/` and is ignored.
- Existing root `skills/`, `scripts/`, `.agents/`, `.claude/`, and `.codex/` remain legacy/reference until each surface is explicitly migrated behind IMO-managed outputs.

## Layout

- `product/`: reusable framework assets that will eventually replace legacy root sources.
- `adapters/`: host-specific template boundaries for Claude Code and Codex outputs.
- `runtime/`: stable runtime contracts, schemas, and bootstrap expectations.

## Current Status

- Phase 1 built directory and contract scaffolding only.
- This task adds a repo-local ownership audit guardrail for Trellis-owned host surfaces.
- IMO does not project Trellis-owned Claude/Codex host files in this repo state.
- `scripts/imo.sh audit [claude|codex|all]` verifies that IMO manifests do not claim host outputs still owned by Trellis.
- Skills, commands, and broader product migration remain deferred until the first output loop is stable.

## Runtime State

- In the current repo state, Trellis remains the active owner of the Trellis Claude/Codex host surfaces.
- IMO remains the framework source-of-truth workspace for its own contracts, scripts, and future migrations; only projection into Trellis-owned host targets is disabled here.
