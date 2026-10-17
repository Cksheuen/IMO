# Delegated Coding Rule

## Summary

The main model owns intent, scope, plan, verification and talking to the user.
Choose direct work or delegation from the current instruction, how tightly the
task is coupled to this conversation, and whether its result can be checked on
its own. Once delegation is chosen, load `delegate` for the Herdr/Codex
workflow. A standing Herdr preference authorizes that route, but not new
scope, publishing, destructive work, or a different model or provider.

## Trigger

- A bounded implementation fix, or a large, independent or mechanical task.
- The user asks for a worker.
- A worker is about to be started, prompted, checked or merged back.

Questions, planning and short reads stay with the main model unless the user
asks to delegate them. An explicit delegation request still binds small fixes.

## Priority

explicit user instruction > repository hard rules / specs > current local
evidence > active IMO learning digest > generic agent training defaults.

This rule does not bypass host restrictions or permissions.

## Required Local Evidence

- Scope, acceptance check, files the worker may write, and dependencies.
- Project rules and existing uncommitted work.
- The model the worker actually runs, when the user chose one.
- The worker's real diff or artifact, and the check result.

Never pass full conversation history or credentials to a worker.

## Habits To Suppress

- Delegating explanation or read-only work only to satisfy a policy.
- Asking again for delegation permission already given for this scope.
- Treating a started, idle or exited worker as finished work.
- Duplicate workers, overlapping write ownership, or workers starting workers.
- Silently changing the model, provider or runner.
- Using native subagent tools as the default or fallback for Herdr work.
- Unbounded retries, full-history prompts, or raw logs in context.

## Implementation Behavior

1. Write the goal, allowed files, dependencies and the end-to-end check in a
   spec file. Shared contracts have one owner.
2. Give the worker the absolute repo path; it checks `pwd` first and stops on
   a mismatch.
3. One worker per file set, with the chosen model, compact context, no
   recursion, and a short report at the end.
4. Read the full diff and run the check yourself before calling it done.
5. On failure, read the evidence and narrow the task. After three failures of
   the same approach, report the blocker.

## Allowed Exceptions

- The user asks the main model to do the work directly, or picks another
  backend; a higher-priority host rule requires another route. Say which.
- With no mandated route, a short or tightly coupled change may stay with the
  main model. If a worker already owns the files, stop it first.

If Herdr is unavailable, report `herdr_unavailable` and continue directly only
where allowed. Never claim background work that is not running.

## Review Questions

- Was the route chosen from the task shape and the user's instruction?
- Did the worker run through Herdr with the model the user chose?
- Did delegation save real work rather than add roles?
- Were file ownership, uncommitted work and retry limits respected?
- Was completion shown by a reviewed diff and a passing check?

## Non-Goals

- Forcing delegation or parallel work for its own sake.
- Widening scope, bypassing permissions, or faking that a runner is available.
- Making a model the global default when the user has not chosen it.
