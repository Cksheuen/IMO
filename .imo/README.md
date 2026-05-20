# IMO Framework Source Of Truth

This directory is the source-of-truth workspace for the IMO framework.

## Principles

- `.imo/` is the only intended source of truth for future framework-owned assets.
- IMO is not a default proxy for Trellis. Trellis task management and IMO
  capability/learning management are independent planes.
- Generated `.claude/` and `.codex/` content are adapter outputs, not truth.
- Stable runtime contracts live in-repo under `.imo/runtime/`.
- High-churn runtime state stays local under `.imo/.runtime/` and is ignored.
- Existing root `skills/`, `scripts/`, `.agents/`, `.claude/`, and `.codex/` remain legacy/reference until each surface is explicitly migrated behind IMO-managed outputs.
- External frameworks, downloaded plugins, and market skills stay outside the IMO owned core by default.
- Shared learning belongs to the IMO learning plane so public agents do not
  adapt to the user in isolated and conflicting ways.

## Layout

- `ARCHITECTURE.md`: long-term plane architecture and implementation plan.
- `BOUNDARY.md`: ownership, integration, learning, and maintenance guardrails.
- `ORCHESTRATION.md`: observable worker progress protocol for delegated work.
- `product/`: reusable framework assets that will eventually replace legacy root sources.
- `adapters/`: host-specific template boundaries for Claude Code and Codex outputs.
- `learning/`: shared learning-plane contracts and promotion policy.
- `providers/`: optional integration contracts for external frameworks, plugins,
  skills, and runtimes.
- `runtime/`: stable runtime contracts, schemas, and bootstrap expectations.
- `ROADMAP.md`: current migration state, next work, blocked/deferred surfaces.

## Current Status

- Product scripts, product skills, and shared runtime helpers now have canonical
  source surfaces under `.imo/`.
- Root `scripts/`, root `skills/`, and `skills/migrated/shared_runtime/` keep
  compatibility projections for migrated surfaces.
- The repo has a read-only ownership audit guardrail for Trellis-owned host
  surfaces.
- IMO does not project Trellis-owned Claude/Codex host files in this repo state.
- `scripts/imo.sh audit [claude|codex|all]` verifies that IMO manifests do not claim host outputs still owned by Trellis.
- `scripts/imo.sh verify` runs the current aggregate read-only IMO verification
  suite, including module metadata, learning policy, and provider registry
  contracts.
- Machine-readable contract gates now exist for:
  - `.imo/product/skills/modules.json`
  - `.imo/learning/policy.json`
  - `.imo/providers/registry.json`
- Delegated implementation now has a repo-local observability protocol in
  `.imo/ORCHESTRATION.md`.
- Adapter command/skill projection and host-output manifest takeover remain deferred.
- Future host-output handoff is planned in `adapters/HOST_OUTPUT_CUTOVER.md`; it requires upstream Trellis ownership removal before any adapter manifest entries are reopened.
- The current architecture direction is three-plane stabilization: Trellis task
  plane, IMO capability plane, and IMO learning plane, with read-only contract
  gates before write behavior.

## Runtime State

- In the current repo state, Trellis remains the active owner of the Trellis Claude/Codex host surfaces.
- IMO remains the framework source-of-truth workspace for its own contracts, scripts, and future migrations; only projection into Trellis-owned host targets is disabled here.
- Learning, provider discovery, and invocation state belongs under
  `.imo/.runtime/` or `~/.imo/` depending on scope, and must not become tracked
  source.
