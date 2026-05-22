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

## Direct Run

The current repo-local IMO command surface is:

```bash
./imo --help
./imo audit all
./imo defensive audit
./imo profile status
./imo profile refresh
./imo learning list
./imo learning signal list
./imo learning candidate list
./imo learning activity status
./imo learning review inbox
./imo learning metrics summary
./imo learning digest promote <candidate-id> --review-ref <ref> --rollback-id <id>
./imo metrics status
./imo metrics summary
./imo init <target>
./imo update <target>
./imo uninstall <target>
./imo codex context
./imo task graph
./imo task graph show 05-22-imo-task-graph-references
./imo task graph plan
./imo verify
```

`./imo` is the preferred repo-root user entrypoint. It forwards to the
canonical implementation at `.imo/product/scripts/imo.sh`. `scripts/imo.sh`
remains only as a compatibility wrapper for existing local calls.

## Local Package Link

IMO also has a thin Node package wrapper for Trellis-like local link testing:

```bash
npm link
imo --help
imo init /path/to/target-repo
```

The package wrapper exposes the `imo` bin from `bin/imo.js` and forwards into
the same root `./imo` entrypoint. It is an install convenience only; framework
behavior still lives in the repo-local direct-run assets under `.imo/`.

## Layout

- `ARCHITECTURE.md`: long-term plane architecture and implementation plan.
- `BOUNDARY.md`: ownership, integration, learning, and maintenance guardrails.
- `ORCHESTRATION.md`: observable worker progress protocol for delegated work.
- `RUNBOOK.md`: final direct-run acceptance sequence.
- `product/`: reusable framework assets that will eventually replace legacy root sources.
- `adapters/`: host-specific template boundaries for Claude Code and Codex outputs.
- `learning/`: shared learning-plane contracts and promotion policy.
- `providers/`: optional integration contracts for external frameworks, plugins,
  skills, and runtimes.
- `runtime/`: stable runtime contracts, schemas, and bootstrap expectations.
- `ROADMAP.md`: current migration state, next work, blocked/deferred surfaces.

## Current Status

- Product scripts, product rules, product skills, and shared runtime helpers now have canonical
  source surfaces under `.imo/`.
- The repo root has a direct `./imo` entrypoint for IMO-owned command surfaces.
- Root `scripts/`, root `skills/`, and `skills/migrated/shared_runtime/` keep
  compatibility projections for migrated surfaces.
- Root compatibility and external-provider surfaces are declared in
  `.imo/providers/root_surfaces.json` and checked by `./imo verify`.
- The repo has a read-only ownership audit guardrail for Trellis-owned host
  surfaces.
- IMO does not project Trellis-owned Claude/Codex host files in this repo state.
- `./imo audit [claude|codex|all]` verifies that IMO manifests do not claim host outputs still owned by Trellis.
- `./imo defensive audit` reports necessary guardrails, simplification
  candidates, prose-to-contract candidates, and blanket fallback anti-patterns
  without mutating source or runtime state.
- `./imo learning list` and `./imo learning inspect <id>`
  read active learning digest state without mutating learning data.
- `./imo learning signal list` reads raw signal state without mutating learning
  data, and `./imo learning signal add --summary <text>` appends project-local
  raw signals only.
- `./imo learning candidate build/list/inspect/reject` manages candidate
  lessons without mutating active digest state.
- `./imo learning activity status/mark` manages ignored runtime activity state
  under `.imo/.runtime/session/`. Activity state is an operational signal for
  background candidate preparation, not proof that the user wants a learning
  conversation.
- `./imo learning review prepare/inbox/inspect/approve/reject` provides an
  explicit deferred review inbox. `prepare` may build candidates only and skips
  active or unknown activity unless forced; `approve` reuses the reviewed digest
  promotion gate.
- `./imo learning metrics summary [--json]` reads compact local learning events
  under `.imo/.runtime/learning/events.jsonl` and reports effectiveness and
  safety counters without uploading data or changing learning state.
- `./imo learning digest promote/disable/reset` manages reviewed active digest
  entries with rollback metadata.
- `./imo metrics status/summary/timeline/failures` reads compact unified
  observability events under `.imo/.runtime/observability/events/`, bridges
  existing learning counters, and treats missing runtime state as a clean empty
  state.
- `./imo init <target>`, `./imo update <target>`, and
  `./imo uninstall <target>` manage the project-local IMO direct-run profile
  in another repository. They install `.imo/`, root `imo`, root compatibility
  surfaces, `.gitignore` whitelist markers, and managed hashes under
  `.imo/.runtime/install/` without using Python package installation as the
  framework boundary.
- `npm link` from this source repo exposes a global `imo` command for local
  package testing. The linked command is a thin Node bin wrapper over the same
  root `./imo` entrypoint.
- `./imo profile refresh/status/inspect/clear` manages a local project
  convention snapshot under `.imo/.runtime/project-profile/`. Context hooks may
  read the bounded summary but never refresh it automatically.
- `./imo task graph`, `./imo task graph show`, `./imo task graph read`, and
  `./imo task graph plan` inspect Trellis task references through an IMO-owned
  overlay. These commands are read-only: they do not mutate Trellis task JSON
  and do not create `.imo/.runtime/task-graph/`.
- `./imo task graph run <task-id-or-dir>` is explicit and gated by file
  ownership, dependency validation, and writable-file conflict checks before a
  local run summary may be written under `.imo/.runtime/task-graph/runs/`.
- `./imo codex context` emits a short repo-local IMO context block for
  experimental Codex hook injection, including active learning digest entries
  when present. It is informational and does not replace Trellis workflow state;
  active digest injection may append compact ignored telemetry.
- `./imo verify` runs the current aggregate read-only IMO verification
  suite, including rule contracts, module metadata, project-profile contracts,
  learning policy, and provider registry contracts, plus root
  compatibility-surface, package-wrapper, and install lifecycle checks.
- Machine-readable contract gates now exist for:
  - `.imo/product/rules/rules.json`
  - `.imo/runtime/project-profile/schema.json`
  - `.imo/product/skills/modules.json`
  - `.imo/learning/policy.json`
  - `.imo/learning/schemas/event.schema.json`
  - `.imo/providers/registry.json`
  - `.imo/runtime/observability/event.schema.json`
  - `.imo/runtime/task-graph/schema.json`
- `./imo defensive audit --json` provides a stable advisory report shape for
  defensive-programming review.
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
