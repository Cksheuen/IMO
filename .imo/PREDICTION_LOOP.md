# IMO Prediction And Optimization Loop

This document records the architecture prediction loop for the IMO three-plane
design.

The loop format is:

```text
prediction -> optimization -> prediction
```

The loop stops only when the remaining risks have explicit controls, detection
points, and deferred implementation gates.

## Baseline Architecture

The expected completed architecture is:

- Trellis Task Plane remains independent.
- IMO Capability Plane owns IMO-native skills, rules, metrics, feedback,
  runtime helpers, and adapter contracts.
- IMO Learning Plane owns shared learning signals, candidates, digests, user
  preference adaptation, and Hermes-like self-iteration outputs.
- External provider integration is optional.
- Host adapter projection is gated by ownership and dry-run/diff checks.

## Cycle 1: Prediction

### Predicted Pain Points

| Risk | Failure shape | Early signal |
| --- | --- | --- |
| Learning noise pool | raw signals become too numerous to interpret | growing `signals.jsonl`, repeated near-duplicate records |
| Preference overfitting | temporary instruction becomes global behavior | agents apply a preference outside the original scope |
| Self-iteration drift | Hermes-like loop reinforces its own incorrect candidates | candidate lineage mostly cites self-generated evidence |
| Digest inconsistency | public agents read different digest versions | agent behavior differs without an explicit task reason |
| Module classification drift | `native`, `provider-backed`, and `extension-candidate` labels stop matching dependencies | provider calls appear in native modules without metadata |
| Provider optionality regression | optional provider integration becomes expected path | docs or scripts imply Trellis must go through IMO |
| Host ownership conflict | `.claude/` / `.codex/` outputs are claimed by multiple owners | IMO manifest target overlaps Trellis template hashes |
| Global learning leakage | project-private facts enter `~/.imo/learning` | global digest contains project names, paths, or business facts |
| CLI sprawl | users cannot tell which IMO command is normal vs advanced | command docs mix learning/provider/adapter flows together |
| Maintenance paralysis | contributors fear editing because every plane appears coupled | small changes require reasoning across all planes |

## Cycle 1: Optimization

### Added Controls

| Risk | Control |
| --- | --- |
| Learning noise pool | require dedupe, TTL, confidence, source agent, scope, and promotion thresholds before automated promotion |
| Preference overfitting | enforce priority: current user instruction > project rules > active digest > candidates > raw signals |
| Self-iteration drift | Hermes-like loop may produce candidates only; active digest/rule updates require review |
| Digest inconsistency | require digest id, version, scope, and `last_updated` before public-agent integration |
| Module classification drift | require future machine-readable module metadata checked by `imo verify` |
| Provider optionality regression | document Trellis and provider integration as optional advanced modes |
| Host ownership conflict | keep ownership audit, dry-run/diff, rollback, and dual-platform cutover requirements |
| Global learning leakage | forbid project-private facts in global learning state by default |
| CLI sprawl | separate common IMO commands from advanced provider/adapter commands |
| Maintenance paralysis | preserve the plane decision rule: task -> Trellis, capability -> IMO, learning -> IMO Learning, external tool -> optional provider, host file -> adapter |

## Cycle 2: Prediction

After Cycle 1 controls, the main residual risks shift from architecture shape to
enforcement quality.

| Residual risk | Why it remains |
| --- | --- |
| Controls stay prose-only | documentation can be ignored unless `imo verify` enforces it |
| Digest quality is hard to evaluate | a digest can be valid structurally but still unhelpful |
| Signal privacy review is subjective | project-private vs general user preference can be ambiguous |
| Module metadata can lag code | contributors may update code and forget metadata |
| Provider health checks can become noisy | many optional providers may be missing by design |
| Host adapter dry-runs can be trusted too much | a clean diff does not prove runtime behavior is safe |

## Cycle 2: Optimization

### Implementation Gates

Do not implement later phases until their gates exist.

| Gate | Required before | Required controls |
| --- | --- | --- |
| Learning write gate | any command writes raw signals | schema validation, source agent, scope, TTL, privacy level |
| Digest read gate | public agents read active digest | digest id, version, scope, `last_updated`, max length, disable list |
| Promotion gate | candidates become active digest or hard rule | source lineage, confidence, review decision, rollback id |
| Module metadata gate | new IMO skill/module migrations | metadata file, classification, owner, side effects, external dependencies |
| Provider discovery gate | provider discovery command ships | read-only behavior, health severity levels, missing-provider degradation |
| Provider invocation gate | provider invocation ships | explicit side effects, risk level, dry-run support, user confirmation policy |
| Host adapter gate | adapter writes host output | ownership audit, dry-run diff, rollback plan, dual-platform atomicity |

### Verification Backlog

Future `imo verify` should grow in this order:

1. Check module metadata exists for each `.imo/product/skills/*` module.
2. Check metadata classification matches allowed dependency patterns.
3. Check learning schemas and promotion policy files exist before learning write
   commands are enabled.
4. Check provider discovery is read-only.
5. Check host adapter manifests do not overlap Trellis ownership.
6. Check runtime logs have rotation or size controls.

## Cycle 3: Prediction

After adding implementation gates, remaining risks are acceptable if they are
handled as operating practices rather than architecture blockers.

| Remaining risk | Treatment |
| --- | --- |
| Users may ignore advanced docs | keep default docs minimal and keep advanced provider/adapter docs separate |
| Learning may still overfit | require reviewable digest items and rollback ids |
| Provider versions may drift | treat drift as provider-adapter maintenance, not IMO core failure |
| Host adapters remain risky | keep host projection late in the roadmap |
| Architecture feels large | keep each phase independently useful and verifiable |

## Cycle 3: Optimization

### Operating Rules

These rules turn the remaining risks into review checklists:

| Area | Rule |
| --- | --- |
| Digest quality | active digest items must be scoped, evidence-backed, short, non-duplicative, and actionable |
| Privacy | ambiguous facts stay project-local; global learning stores user behavior preferences, not project facts |
| Advanced docs | provider and adapter docs stay separate from common IMO usage docs |
| Review fatigue | promotion batches should be small and rejectable item-by-item |
| Independence | test Trellis direct flow and IMO native verify separately before adding integrations |
| Red-team cadence | rerun this prediction loop before learning writes, provider invocation, or host adapter writes ship |

### Digest Quality Rubric

Before a candidate enters an active digest, it should pass:

- scoped: applies to session, task, project, or global behavior explicitly
- current: not contradicted by newer user instructions
- evidence-backed: references source signals or review decision
- actionable: tells an agent what to do differently
- compact: short enough for repeated context injection
- reversible: has disable and rollback path
- non-secret: does not reveal project-private facts in global scope

### Privacy Classification Rule

Global learning may store:

- stable user communication preferences
- stable workflow preferences
- tool-use preferences that are not project-specific

Global learning must not store:

- project paths
- project names when sensitive
- business logic or implementation facts
- customer/domain data
- credentials, tokens, or environment-specific secrets

If scope is ambiguous, keep the item project-local.

## Cycle 4: Prediction

After Cycle 3 optimization, remaining risks are mostly process risks.

| Remaining process risk | Current treatment |
| --- | --- |
| Human review may be skipped under time pressure | gates require review before promotion or write behavior |
| Metadata may still lag | `imo verify` backlog must enforce metadata once implemented |
| Advanced provider features may attract premature usage | roadmap keeps provider invocation after learning/module contracts |
| Digest usefulness may vary by task | digest items are scoped and reversible |
| Privacy classification may still need judgment | ambiguous items stay local by default |

No remaining risk currently requires changing the core three-plane architecture.

## Stop Condition

The current design is sufficiently complete when these conditions hold:

- Trellis can run without IMO.
- IMO native verification can run without Trellis provider integration.
- Learning influence is inspectable, disableable, and reversible.
- Hermes-like self-iteration cannot mutate active rules or skill source directly.
- External providers remain optional and degrade cleanly.
- Host writes remain gated by ownership, dry-run/diff, and rollback.
- Module classification has a path from prose to machine-checkable metadata.
- Active digest quality and privacy classification have review rubrics.

If a future prediction loop finds a risk that violates one of these conditions,
open a new architecture task before implementation continues.
