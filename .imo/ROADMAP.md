# IMO Roadmap

This roadmap records the current repo-owned IMO framework status and the next
work items. Detailed task reasoning stays in `.trellis/tasks/`; this file is the
durable repo-facing summary.

## Current State

### Done

- `.imo/` is the canonical workspace for future framework-owned assets.
- `.imo/product/scripts/` owns the current canonical script implementations:
  - `imo.sh`
  - `check-langchain-runtime-deps.py`
  - `task-audit.py`
  - `task-bootstrap.sh`
  - `audit_runtime_links_core.py`
  - `audit_managed_ownership.py`
- Root `scripts/` entries are compatibility wrappers for the migrated script
  surface.
- `.imo/product/skills/` owns the migrated framework skill families listed in
  `.imo/product/skills/CONTRACT.md`.
- Root `skills/` entries for migrated families are compatibility projections.
- `.imo/runtime/` owns shared runtime helpers and shared runtime dependencies.
- Root `skills/migrated/shared_runtime/*` remains only as a compatibility
  projection to `.imo/runtime/shared/*`.

### Guarded

- `.imo/adapters/` documents host-specific boundaries for Claude and Codex.
- `.imo/adapters/claude/manifest.json` and `.imo/adapters/codex/manifest.json`
  remain empty for Trellis-owned host targets.
- `bash scripts/imo.sh audit all` is the current guardrail that detects manifest
  overlap with Trellis-tracked host outputs.

### Blocked

- Host-output cutover is blocked on upstream Trellis ownership removal.
- Do not reopen adapter manifest entries while target paths still appear in
  `.trellis/.template-hashes.json`.
- Do not hand-edit `.trellis/.template-hashes.json` to simulate handoff.

### Deferred

- Claude command projection under `.imo/adapters/claude/commands`.
- Claude skill projection under `.imo/adapters/claude/skills`.
- Codex skill projection under `.imo/adapters/codex/skills`.
- Promotion-gate surfaces.
- Shared config merge behavior beyond the explicit Wave 3 plan.

## Next Work

### 1. Keep The Guardrail Green

- Run `bash scripts/imo.sh audit all` before and after any adapter manifest
  change.
- Treat any overlap with `.trellis/.template-hashes.json` as an unfinished
  ownership handoff, not as a byte-level drift issue.

### 2. Add A Unified Verification Entry

- `scripts/imo.sh verify` runs the current IMO guardrail, wrapper smoke checks,
  compile checks, and runtime compatibility imports.
- Keep that verification read-only.
- Prefer root compatibility entrypoints for user-facing smokes.

### 3. Host Output Cutover

Follow `.imo/adapters/HOST_OUTPUT_CUTOVER.md`:

1. Wave 1: Claude + Codex agent family.
2. Wave 2: Claude + Codex hooks.
3. Wave 3: Claude settings and Codex config / hook registry.

Each wave is dual-platform atomic and upstream-first.

### 4. Adapter Skill And Command Projection

Open a separate task before projecting commands or skills into host adapter
surfaces. Those surfaces are not part of the current active host-output cutover
roadmap.

## Non-Goals

- Do not turn `.imo/.runtime/` into a tracked source-of-truth surface.
- Do not restore host-output `sync` or `generate` behavior locally while
  Trellis still owns the targets.
- Do not treat root compatibility wrappers as long-term canonical logic.
- Do not broaden a product/runtime migration task into host-output cutover work.
