# Update Handoff Rule

## Summary

When changing IMO update, install, release, runtime-state, or verification
mechanics, keep the tracked cross-device update handoff current.

This rule exists so an agent on another device can perform the smallest safe IMO
refresh without reverse-engineering the latest release.

## Trigger

Apply this rule when a task changes any of these surfaces:

- Git remote, default branch, history-reset, archive, or release strategy
- `./imo init`, `./imo update`, `./imo uninstall`, or managed-file behavior
- `./imo global install`, `global migrate`, `global uninstall`, or global shim behavior
- project or global runtime-state layout under `.imo/.runtime/` or
  `~/.imo/runtime/`
- Codex context hook install, dedupe, or invocation behavior
- verification commands required for source checkouts or installed targets
- manual cross-device update steps for agents or users

Also apply it when the user asks how another device should update IMO.

## Priority

Use this priority order:

```text
explicit user instruction
> repository hard rules / specs
> .imo/UPDATE.md
> current local source evidence
> generic agent training defaults
```

The tracked update handoff is the product-facing release guide. Generic memory
about prior update steps loses when `.imo/UPDATE.md` says otherwise.

## Required Local Evidence

Before finalizing an affected change, inspect enough local evidence to answer:

- Did the task change update mechanics or only implementation internals?
- Does `.imo/UPDATE.md` still describe the minimal safe update path?
- Do `./imo init`, `./imo update`, `./imo uninstall`, and global commands still
  match the documented safety rules?
- Did the expected branch, remote, archive, or history strategy change?
- Did verification requirements change for source checkouts or target projects?
- Are runtime state directories still preserved during normal updates?
- Does the README still point agents to the right update handoff?

Prefer executable command behavior and tracked source docs over assumptions from
older sessions.

## Habits To Suppress

Suppress these drift-prone habits unless the user explicitly requires them:

- changing update behavior without updating the cross-device handoff
- relying on conversation history as the only update instruction
- publishing a release summary that omits whether update mechanics changed
- using destructive update commands before checking local dirty state
- treating runtime state as disposable source files
- documenting a manual step that is broader than the minimum safe update
- hiding unmanaged global shim conflicts behind automatic force behavior

## Implementation Behavior

When applying the rule:

1. Read `.imo/UPDATE.md` before finishing the release or migration task.
2. If update mechanics changed, edit `.imo/UPDATE.md` in the same change.
3. If a new safety condition appears, add it to the handoff before release.
4. If mechanics did not change, say in the release summary that the update
   method was reviewed and remains unchanged.
5. Keep update steps minimal: preflight, safe command, verification, and stop
   conditions.
6. Verify with `./imo verify` after updating product rules or handoff docs.

## Allowed Exceptions

You may leave `.imo/UPDATE.md` unchanged only when all of these are true:

- the task does not affect update, install, release, runtime-state, hook, or
  verification behavior
- the current handoff already describes the safe cross-device path
- the final summary explicitly says the update method was reviewed unchanged

When uncertain, update the handoff narrowly rather than relying on memory.

## Review Questions

Before finalizing, ask:

- Could an agent on another device update IMO by reading only `.imo/UPDATE.md`?
- Did I preserve user and runtime state by default?
- Did I document when to stop instead of forcing an overwrite?
- Did I avoid unnecessary commands in the minimal update path?
- Did I mention the update-method review result in the final summary?
- Did `./imo verify` pass after rule or handoff changes?

If any answer exposes drift, revise before reporting completion.

## Non-Goals

- Do not turn `.imo/UPDATE.md` into a full release changelog.
- Do not document every internal implementation detail.
- Do not replace proper migration commands with ad hoc shell recipes.
- Do not use this rule to justify destructive updates without user approval.
