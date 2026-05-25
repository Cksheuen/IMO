# Host Output Coexistence Plan

This document records the current policy for `.claude/` and `.codex` host
outputs after reviewing the upstream Trellis update mechanism.

The current direction is coexistence, not same-path takeover.

## Decision

Trellis remains the owner of Trellis-generated host outputs:

- `.claude/agents/trellis-*.md`
- `.codex/agents/trellis-*.toml`
- `.claude/hooks/*.py`
- `.codex/hooks/*.py`
- `.claude/settings.json`
- `.codex/hooks.json`
- `.codex/config.toml`

IMO must not reopen adapter manifest entries for those paths while Trellis still
tracks them in `.trellis/.template-hashes.json`.

Do not hand-edit `.trellis/.template-hashes.json` to simulate release. That file
is evidence of current Trellis ownership, not the source of an ownership
decision.

## Why Not Same-Path Takeover

Upstream Trellis uses `.trellis/.template-hashes.json` as a generated-template
tracking file. During `trellis update`, Trellis compares the stored hash, the
current generated template, and the user's local file. For modified local files,
Trellis supports explicit conflict handling:

1. overwrite with the new Trellis template
2. skip the update
3. create a `.new` copy for manual merge

That mechanism is useful. It lets local customizations coexist with upstream
Trellis improvements. A blanket local takeover would hide upstream changes and
turn Trellis update into a permanent conflict source.

## Current Model

Use a coexistence/manual-merge model:

1. Trellis keeps owning Trellis-named agents, hooks, and shared config files.
2. Project-local edits to Trellis-owned files are customization patches, not IMO
   managed outputs.
3. During `trellis update`, choose the `.new` copy path for locally customized
   Trellis-owned files when upstream changed.
4. Agent/human review manually merges useful upstream changes into the local
   customized file.
5. IMO host outputs, if needed later, use namespaced non-overlapping targets such
   as `.claude/agents/imo-*.md` or `.codex/agents/imo-*.toml`.

## Trellis Update Merge Runbook

When a future `trellis update` reports a modified Trellis-owned host file:

1. Let Trellis create the `.new` copy.
2. Compare the local file, the `.new` file, and the current task requirement.
3. Merge upstream improvements that still fit the local project policy.
4. Keep project-specific customizations only when they remain intentional.
5. Remove the `.new` file after the merge decision is recorded.
6. Run `./imo audit all` and `./imo verify`.

This is a manual merge step. Do not solve it by broad permanent `update.skip`
entries unless a task explicitly decides that a specific file should stop
receiving Trellis update review.

## Allowed Future IMO Host Outputs

Future IMO adapter projections may target host files only when the path is
clearly outside Trellis ownership. Examples:

- `.claude/agents/imo-*.md`
- `.codex/agents/imo-*.toml`
- `.claude/commands/imo/*`
- `.claude/skills/imo-*`
- `.codex/skills/imo-*`

Every future manifest entry must pass `./imo audit all`.

## Abandoned Cutover Waves

The previous wave plan is abandoned:

- same-path `trellis-*` agent takeover
- same-path hook takeover
- same-path shared config takeover

Those waves are not blocked work items anymore. They are intentionally not part
of the roadmap because they conflict with Trellis update semantics.

## Validation

For the current repo state:

- `.imo/adapters/claude/manifest.json` and
  `.imo/adapters/codex/manifest.json` remain empty for Trellis-owned host
  targets.
- `./imo audit all` reports zero overlap.
- `./imo verify` remains green.
- Future manifest entries use namespaced non-overlapping targets.

## Rollback

If an IMO manifest accidentally claims a Trellis-owned host path:

1. Remove the manifest entry.
2. Restore the host file to the intended Trellis/local-customized state.
3. Run `./imo audit all`.
4. Run `./imo verify`.

Do not patch `.trellis/.template-hashes.json` as rollback.
