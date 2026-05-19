# Host Output Cutover Plan

This document defines the durable handoff plan for moving active `.claude/` and
`.codex` host outputs from Trellis ownership to IMO adapter ownership.

The current repo state remains guardrail-only: `.imo/adapters/*/manifest.json`
must stay empty for host targets that are still tracked by Trellis.

## Cutover Model

Use an upstream-first handoff model.

1. Trellis must stop generating and tracking the target host-output family.
2. The affected paths must no longer appear as Trellis-owned template outputs in
   `.trellis/.template-hashes.json` after the upstream update path runs.
3. Only then may the relevant `.imo/adapters/*/manifest.json` entries reopen for
   that family.
4. IMO adapter templates or mapping rules become the canonical source for the
   target files after the manifest entries are introduced.

Do not hand-edit `.trellis/.template-hashes.json` to simulate handoff. That file
is evidence of current Trellis ownership, not the source of the ownership
decision.

## Rollout Rule

Every cutover wave is dual-platform atomic:

- Claude and Codex release the matching family from Trellis ownership together.
- Claude and Codex introduce IMO manifest entries together.
- Single-platform cutover is not an accepted target state.

## Active Roadmap

### Wave 1: Agent Family

Targets:

- `.claude/agents/trellis-check.md`
- `.claude/agents/trellis-implement.md`
- `.claude/agents/trellis-research.md`
- `.codex/agents/trellis-check.toml`
- `.codex/agents/trellis-implement.toml`
- `.codex/agents/trellis-research.toml`

Reason:

- Passive whole-file outputs.
- No merge semantics.
- Lowest runtime risk.
- Large enough to prove a family-level ownership handoff.

### Wave 2: Hooks

Targets:

- `.claude/hooks/session-start.py`
- `.claude/hooks/inject-subagent-context.py`
- `.claude/hooks/inject-workflow-state.py`
- `.codex/hooks/session-start.py`
- `.codex/hooks/inject-workflow-state.py`

Reason:

- Still whole-file outputs.
- Adds executable runtime risk only after the passive agent handoff is proven.

### Wave 3: Shared Config

Targets:

- `.claude/settings.json`
- `.codex/hooks.json`
- `.codex/config.toml`

Reason:

- Shared config requires merge and preservation rules.
- It is intentionally last because it is not just a whole-file ownership
  transfer.

## Deferred Surfaces

The active roadmap does not include:

- `.claude/commands/trellis/*`
- `.claude/skills/trellis-*`
- `.codex/skills/**`
- promotion-gate surfaces

These require a separate task because they are either deferred adapter surfaces
or not part of the current active host-output cutover.

## Validation

Before reopening manifest entries for a wave:

- Confirm the target family is no longer Trellis-owned after the intended
  upstream update flow.
- Confirm the target paths do not overlap with `.trellis/.template-hashes.json`.
- Keep `bash scripts/imo.sh audit all` green before and after the change.

After reopening manifest entries for a wave:

- Run `bash scripts/imo.sh audit all`.
- Diff the generated host outputs against expected adapter output.
- For hooks and config waves, run platform-specific smoke checks before treating
  the wave as complete.

## Rollback

Rollback is wave-scoped:

1. Remove the new manifest entries for the affected wave.
2. Restore the previous host files from the last known-good state.
3. Re-run `bash scripts/imo.sh audit all`.
4. Do not roll back unrelated waves.

