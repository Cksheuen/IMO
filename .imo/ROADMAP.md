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
- `./imo` is the preferred repo-root direct-run entrypoint and forwards into
  `.imo/product/scripts/imo.sh`.
- `.imo/product/skills/` owns the migrated framework skill families listed in
  `.imo/product/skills/CONTRACT.md`.
- Root `skills/` entries for migrated families are compatibility projections.
- `.imo/runtime/` owns shared runtime helpers and shared runtime dependencies.
- Root `skills/migrated/shared_runtime/*` remains only as a compatibility
  projection to `.imo/runtime/shared/*`.
- `.imo/ARCHITECTURE.md` records the long-term three-plane architecture.
- `.imo/PREDICTION_LOOP.md` records the prediction -> optimization -> prediction
  loop and the implementation gates that came out of it.
- `.imo/learning/CONTRACT.md` records the shared learning-plane contract.
- `.imo/product/skills/MODULE_CLASSIFICATION.md` records the current skill module
  ownership classification.
- `.imo/product/skills/modules.json` records machine-readable module metadata.
- `.imo/learning/policy.json` records machine-readable learning policy gates.
- `.imo/providers/registry.json` records machine-readable provider contract and
  health metadata.
- `.imo/providers/root_surfaces.json` records machine-readable root
  compatibility and external-provider surface declarations.
- `.imo/ORCHESTRATION.md` records the worker observability gate for future
  delegated implementation.
- `.imo/RUNBOOK.md` records the final direct-run acceptance sequence.

### Guarded

- `.imo/adapters/` documents host-specific boundaries for Claude and Codex.
- `.imo/adapters/claude/manifest.json` and `.imo/adapters/codex/manifest.json`
  remain empty for Trellis-owned host targets.
- `bash scripts/imo.sh audit all` is the current guardrail that detects manifest
  overlap with Trellis-tracked host outputs.
- `./imo audit all` is the preferred direct-run form of the same guardrail.
- `./imo verify` now validates module metadata, learning policy,
  provider registry contracts, and root compatibility surfaces before
  compile/import smoke checks.
- `./imo learning list` and `./imo learning inspect <id>` are
  read-only learning digest commands.
- `./imo codex context` is available as a repo-local experimental context hook
  for Codex; it does not replace Trellis workflow injection.
- Root `scripts/`, root `skills/`, and `.gitignore` whitelist decisions are now
  covered by `.imo/providers/root_surfaces.json`.
- `.imo/BOUNDARY.md` defines the owned-core and external-provider boundary.
- `.imo/providers/` defines optional provider integration contracts.

### Architecture Direction

- Trellis remains the task plane.
- IMO owns the capability plane and learning plane.
- Trellis and IMO are independent in normal use; IMO does not proxy Trellis by
  default.
- External providers are optional integration points, not the main architecture.
- Shared learning digests prevent public agents from adapting to the user in
  isolated and conflicting ways.

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

### 1.5. Keep Delegation Observable

- Follow `.imo/ORCHESTRATION.md` before starting worker-based implementation.
- Treat a running worker without status artifact, final summary, or diff as only
  launched, not productive.
- Close or restart workers that produce no observable artifact within the
  configured timeout.

### 2. Keep The Direct-Run Entry Green

- `./imo --help`, `./imo audit all`, `./imo learning list`, and `./imo verify`
  are the current repo-root acceptance commands.
- `./imo codex context` may be used for local Codex context-injection
  experiments, but it must stay informational and non-mutating.
- Keep `.imo/providers/root_surfaces.json` current whenever a root script,
  root skill, or root whitelist rule changes.
- `scripts/imo.sh verify` remains a compatibility form of the same aggregate
  check.
- The aggregate verification runs the current IMO guardrail, wrapper smoke checks,
  compile checks, and runtime compatibility imports.
- Keep that verification read-only.
- Prefer root compatibility entrypoints for user-facing smokes.

### 3. Root Compatibility Surface Closure

- Root `scripts/` entries must remain thin compatibility wrappers.
- Root `skills/` entries must remain `.imo/product/skills` projections,
  `.imo/runtime` projections, or declared external-provider surfaces.
- `skills/pencil-design`, `skills/impeccable`, and `skills/xmind` are external
  provider surfaces unless a future adoption task changes ownership.
- `.gitignore` may whitelist root `scripts/**` and `skills/**` only under this
  audited compatibility rationale.

### 4. Stabilize The Three-Plane Architecture

Follow `.imo/ARCHITECTURE.md`, `.imo/BOUNDARY.md`, and
`.imo/learning/CONTRACT.md`:

1. Keep Trellis task management independent.
2. Keep IMO-owned skills/rules/metrics/runtime under the IMO capability plane.
3. Add learning-plane signal, candidate, digest, and promotion contracts before
   automated self-iteration.
4. Keep provider discovery/invocation optional and read-only first.
5. Keep machine-readable module metadata passing before expanding migrations.
6. Keep learning and provider policy gates passing before adding write behavior.

### 5. Learning Plane Implementation

Implement only after the contracts above are stable:

1. `imo learning list` and `imo learning inspect <id>` are present as read-only
   commands.
2. raw signal write path
3. candidate aggregation
4. active digest generation
5. user-visible disable/reject/reset controls
6. Hermes-like candidates-only self-iteration loop

### 6. Optional Provider Discovery

- Add executable read-only provider discovery and health checks only after the
  registry contract remains stable.
- Provider failures must degrade cleanly and must not break IMO native
  capabilities or Trellis native task flow.
- Provider invocation remains out of scope until side-effect metadata is stable.

### 7. Host Output Cutover

Follow `.imo/adapters/HOST_OUTPUT_CUTOVER.md`, but keep this after the
three-plane architecture stabilizes:

1. Wave 1: Claude + Codex agent family.
2. Wave 2: Claude + Codex hooks.
3. Wave 3: Claude settings and Codex config / hook registry.

Each wave is dual-platform atomic and upstream-first.

### 8. Adapter Skill And Command Projection

Open a separate task before projecting commands or skills into host adapter
surfaces. Those surfaces are not part of the current active host-output cutover
roadmap.

## Non-Goals

- Do not turn `.imo/.runtime/` into a tracked source-of-truth surface.
- Do not restore host-output `sync` or `generate` behavior locally while
  Trellis still owns the targets.
- Do not treat root compatibility wrappers as long-term canonical logic.
- Do not broaden a product/runtime migration task into host-output cutover work.
- Do not vendor external providers into `.imo/product/*` just because they are
  discoverable or useful to IMO.
- Do not proxy Trellis or add Trellis callbacks as a default requirement for the
  plane architecture.
- Do not let Hermes-like self-iteration directly mutate active digests, hard
  rules, skill source, or provider source.
- Do not move project-private facts into global learning state.
