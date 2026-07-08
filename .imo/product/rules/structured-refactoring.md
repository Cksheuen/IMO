# Structured Development and Refactoring Rule

## Summary

When developing or refactoring an established codebase, keep modules
responsibility-focused, bounded in size, locally owned, and compatible with
existing public surfaces.

This rule makes structure a normal development constraint. Refactoring is the
repair and optimization loop for code that already drifted from that
development standard.

## Trigger

Apply this rule when any of these are true:

- implementation, tests, scripts, schemas, pages, hooks, adapters, commands, or
  helpers are being added or changed in a mature codebase
- a source, script, test, schema, or page file is larger than 300 lines
- a change would push an existing file near or beyond 300 lines
- a file mixes types, normalization, rendering, orchestration, IO, validation,
  fixtures, or test harness setup
- the user asks for structural refactoring, modularization, code structure
  cleanup, large-file decomposition, or development-standard review
- an IMO-owned command, adapter, rule, script, or runtime helper is being split

Also apply it when reviewing a proposed implementation or refactor for
placement, compatibility, or verification risk.

## Priority

Use this priority order:

```text
explicit user instruction
> repository hard rules / specs
> local neighboring implementation patterns
> active IMO learning digest
> generic agent training defaults
```

Compatibility and local evidence beat generic refactor recipes.

## Required Local Evidence

Before adding, expanding, or splitting code, inspect enough local evidence to
answer:

- What imports, route paths, command paths, or generated surfaces currently
  depend on this module?
- Is there an existing module with the same responsibility?
- Is the code domain-specific, or is it already repeated across independent
  modules?
- Will this change grow an existing file past a structural review threshold?
- Which pieces are types, constants, normalization, rendering, orchestration,
  IO, or tests?
- What validation command proves the implementation or split stayed correct?
- Does the target surface belong to IMO-owned source, target-project source,
  or external Trellis / host projection?

Prefer current repo evidence over assumptions from another project.

## Habits To Suppress

Suppress these habits unless the user explicitly requests them:

- moving callers to new import paths during a compatibility refactor
- rewriting behavior while claiming the change is structural
- treating structure rules as cleanup-only instead of development-time guidance
- growing an already mixed module because a dedicated refactor task was not
  requested
- extracting tiny single-use helpers into global shared utilities
- splitting a file into many props-heavy or interface-heavy layers that exceed
  the growth budget
- creating a new module location before searching for an existing owner
- editing generated host outputs instead of the IMO-owned source of truth
- using line-count slicing instead of responsibility-based extraction
- skipping validation because "only imports moved"

## Implementation Behavior

When applying the rule:

1. Choose the owning module before writing new code. Search for nearby owners,
   existing helpers, and package conventions before creating new locations.
2. Prefer adding a focused child module over growing an already mixed or
   threshold-sized file.
3. Keep the old public file or command path as a thin facade, re-export barrel,
   or tiny launcher unless the task explicitly authorizes caller migration.
4. Split by responsibility: types/schema, constants, normalization, UI sections,
   controller hooks, IO adapters, process state, tests, and local helpers should
   have clear ownership.
5. Keep extracted code beside the original owner first. Promote to shared
   utilities only after search confirms repeated cross-module use.
6. Use these budgets as guardrails:
   - files above 300 lines should be reviewed for decomposition
   - total source after structural movement should stay within 115% of the
     original unless documented structure or tests justify the growth
   - import blocks should stay compact, ideally below 30 lines
   - use barrels when a directory has 3+ files or 5+ named exports
   - move interface groups longer than 5 lines out of mixed behavior files
7. Prefer breadth-first extraction by major responsibility, then refine the
   largest remaining child file.
8. Validate with the nearest meaningful checks:
   - `git diff --check` for changed paths
   - owning package type-check
   - nearest tests when behavior-bearing code moved
   - syntax plus harmless `help`, `status`, or `--dry-run` for scripts
   - frontend type-check and build when route/page imports changed
9. Commit one coherent module family at a time, without unrelated cleanup.

## Allowed Exceptions

You may exceed a budget or migrate callers only when at least one is true:

- explicit user instruction requires the broader migration
- the old public path is intentionally deprecated by the task
- compatibility creates a real correctness or security risk
- generated code or tooling constraints require a different entrypoint
- the refactor includes tests or interfaces whose added lines are the smallest
  safe way to preserve behavior

When departing, state the reason and keep the departure narrow.

## Review Questions

Before finalizing, ask:

- Do existing imports, routes, commands, and generated-surface ownership still
  work?
- Did I place new code where future changes can stay local?
- Did I split or grow by responsibility rather than by line ranges?
- Did I search for existing modules before creating a new shared helper?
- Did total source growth stay within budget or have a clear reason?
- Did the old file become a facade or barrel where compatibility matters?
- Did validation prove behavior stayed stable or the new behavior works?
- Did I avoid mixing behavior changes into a refactor commit?
- Am I applying this as a development standard, not only as a later cleanup?

If any answer exposes drift, revise before reporting completion.

## Non-Goals

- Do not use this rule to force every 300-line file to split immediately.
- Do not block small, cohesive changes solely because a file is near a budget.
- Do not wait for a dedicated refactor task before applying structure rules.
- Do not move project-private facts into IMO product rules.
- Do not replace Chameleon; local conventions still decide the exact shape.
- Do not treat Trellis projection files as IMO product source.
