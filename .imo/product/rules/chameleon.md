# Chameleon Rule

## Summary

When developing a new module inside a mature project, behave like the project
you are inside. Learn the local conventions first, then implement in that style.

This rule exists to override generic agent training habits when they conflict
with an established codebase.

## Trigger

Apply this rule when all of these are true:

- the project already has working modules, tests, docs, or conventions
- the task adds or changes implementation code
- nearby code shows an established style for structure, naming, validation,
  error handling, state flow, testing, or dependency usage

Also apply it when the user explicitly asks for work in an existing or mature
project.

## Priority

Use this priority order:

```text
explicit user instruction
> repository hard rules / specs
> local neighboring implementation patterns
> active IMO learning digest
> generic agent training defaults
```

Generic model defaults lose when local evidence is clear.

## Required Local Evidence

Before coding, inspect enough local evidence to answer:

- Where does this kind of module live?
- How are similar modules named?
- How are inputs validated or trusted?
- How are errors represented and surfaced?
- What helper APIs or wrappers already exist?
- How are tests structured for the same layer?
- What level of abstraction is typical here?
- What style does the nearest working code use?

Prefer neighboring files and existing tests over general best practices.

## Habits To Suppress

Suppress these common generic-agent habits unless local evidence or the user
explicitly requires them:

- heavy defensive programming around inputs already validated by the local
  boundary
- broad fallback paths that hide errors the project normally exposes
- new abstractions before local repetition proves they are needed
- generic helper layers that duplicate existing local helpers
- large rewrites when a narrow extension preserves the architecture
- verbose comments explaining obvious code
- inconsistent naming just because it is common in other ecosystems
- extra configuration, feature flags, or compatibility branches without a
  current integration need
- over-normalizing data in a layer where the project preserves raw domain
  shapes
- adding broad try/catch or warning behavior when local code lets failures
  propagate

## Implementation Behavior

When applying the rule:

1. Identify the closest local precedent.
2. Reuse existing helpers, schemas, fixtures, and naming patterns.
3. Match the layer boundary already present in the project.
4. Keep changes scoped to the task.
5. Add abstraction only when it removes real local duplication or matches an
   established pattern.
6. Validate with the project's existing test or verification style.

## Allowed Exceptions

You may depart from local convention only when at least one is true:

- explicit user instruction requires it
- local convention is demonstrably broken for the current case
- a security, correctness, or data-loss risk requires stronger handling
- the project has no relevant precedent
- a task or spec explicitly establishes a new pattern

When departing, state the reason and keep the departure narrow.

## Review Questions

Before finalizing, ask:

- Does this look like code the existing maintainers would have written?
- Did I use local examples instead of generic memory?
- Did I add defensive code where the project normally trusts a boundary?
- Did I create a helper where an existing helper or inline pattern was enough?
- Did I widen scope or rewrite structure beyond the task?
- Did the tests follow local test style?

If any answer exposes drift, revise before reporting completion.

## Non-Goals

- Do not freeze a bad local pattern forever; use an explicit task to improve it.
- Do not ignore user instructions in the name of consistency.
- Do not use this rule to block necessary correctness or safety checks.
- Do not apply conventions from global `~/.claude` when current repo evidence
  says otherwise.
