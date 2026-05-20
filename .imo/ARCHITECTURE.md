# IMO Architecture Plan

## Summary

IMO is not a proxy for Trellis.

The long-term architecture has three primary planes:

```text
Trellis Task Plane
  task / PRD / spec / workflow

IMO Capability Plane
  IMO-owned skills / rules / metrics / feedback / runtime helpers

IMO Learning Plane
  shared learning signals / candidates / digests / user preference adaptation
```

External providers and host outputs are integration planes around those primary
planes, not the center of the architecture.

## Plane Responsibilities

### Trellis Task Plane

Owned by Trellis.

Responsibilities:

- task lifecycle
- PRD and status files
- spec injection
- workflow phase guidance
- Trellis implement/check/research agent flow

IMO does not own this plane and should not patch Trellis internals.

### IMO Capability Plane

Owned by IMO.

Responsibilities:

- IMO-native skills
- IMO-owned rules and contracts
- metrics, feedback, lessons, promotion workflows
- runtime helpers
- host adapter contracts
- IMO verification

This plane is useful even when Trellis is not installed or not involved in the
current workflow.

### IMO Learning Plane

Owned by IMO.

Responsibilities:

- collect raw learning signals
- aggregate candidate lessons
- publish active learning digests
- coordinate Hermes-like self-iteration outputs
- make user adaptation available to public agents

The learning plane is the shared adaptation layer. It prevents Trellis-side
agents, IMO skills, Codex agents, Claude agents, and Hermes-like loops from
learning separate and conflicting user models.

### External Provider Plane

Owned by each provider.

Examples:

- Trellis
- Claude Code plugins
- Codex plugins
- downloaded skills
- LiteLLM or model gateways
- local LangGraph-based systems

Provider integration is optional. Provider source stays outside IMO by default.

### Host Output Plane

Owned by the host adapter or the current source owner.

Examples:

- `.claude/**`
- `.codex/**`
- future host-visible directories

Host outputs are generated/projected surfaces. They are never the durable IMO
source-of-truth.

## Default Usage

Normal use is independent:

```text
Use Trellis for tasks.
Use IMO for capabilities and learning.
```

Examples:

```text
trellis-start
imo verify
imo learning list
imo skill run <skill>
```

IMO-managed provider calls and Trellis callbacks are advanced integration modes.
They are not the default path.

## Long-Term Implementation Plan

### Phase 0: Architecture Freeze

- Keep Trellis and IMO as independent planes.
- Document ownership and update-stability boundaries.
- Rewrite provider integration as optional, not default.

### Phase 1: Capability Plane Inventory

- Classify current `.imo/product/skills/*` modules.
- Add machine-readable module metadata.
- Teach `imo verify` to check classification consistency.

### Phase 2: Learning Plane Protocol

- Define signal, candidate, digest, and hard-rule promotion contracts.
- Add local and global learning storage boundaries.
- Add user-visible inspect/disable/reject/reset controls before automated
  promotion.

### Phase 3: Public Agent Learning Integration

- Define how public agents read learning digests.
- Define how public agents write raw signals.
- Keep promotion gated.
- Keep provider internals untouched.

### Phase 4: Optional Provider Discovery

- Add read-only discovery and health checks.
- Do not invoke providers until side-effect metadata is explicit.
- Missing or broken providers must degrade cleanly.

### Phase 5: Optional Callback / Invocation

- Add callbacks or managed invocations only for explicit use cases.
- Default to observe/advise modes.
- Gate modes require explicit user opt-in.

### Phase 6: Host Adapter Projection

- Project only IMO-owned capabilities.
- Keep ownership gates and dry-run/diff checks.
- Do not claim Trellis-owned host files.

### Phase 7: Hermes-Like Self-Iteration

- Produce candidates from learning signals.
- Evaluate candidate changes.
- Require review before active digest, rule, or skill updates.
- Preserve rollback paths for every promoted learning item.

## Maintenance Risks And Controls

| Risk | Control |
| --- | --- |
| Learning pollution | TTL, confidence, source tracking, review gates |
| Self-iteration drift | candidates-only loop, regression checks, rollback ids |
| Provider compatibility burden | read-only discovery first, health checks, clean degradation |
| Module classification drift | machine-readable metadata checked by `imo verify` |
| Host ownership conflict | ownership audit, dry-run diff, adapter manifests gated |
| Runtime log growth | rotation, summaries, debug-only full payloads |
| Privacy leakage | project/global scope split, opt-out, user-visible review |

## Non-Goals

- Do not proxy Trellis by default.
- Do not require Trellis to call IMO during normal task flow.
- Do not patch Trellis internals.
- Do not vendor external provider source into IMO without an adoption task.
- Do not let self-iteration directly mutate active rules or skills.
