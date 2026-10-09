# Delegated Coding And Relay Safety Rule

## Summary

The main model owns intent, scope, plan, and verification. Pure explanation,
planning, and bounded reads stay in the main session unless explicitly delegated.
Choose direct execution or delegation from the current instruction, task
coupling, context-transfer cost and independently verifiable deliverables.
Without a delegation mandate, a short closed loop or tightly coupled change
may stay in the main session. Delegate when it offers concrete parallel value,
independent review, or a bounded handoff worth its coordination cost.
Once delegation is chosen, default to one Herdr worker and use `orchestrate`
for dependencies, review, recovery and successors.
A standing Herdr preference authorizes this bounded execution route, but does
not authorize new scope, external publication, destructive work, or a
provider/model substitution.

The main model may read bounded evidence, inspect worker results and diffs,
administer orchestration policy, and communicate
decisions. Integration still requires reviewing how results fit together.
Policy administration does not permit unrelated product edits. Pure discussion
or planning requires no artificial worker.

Default to one bounded worker, serially when dependencies exist. Reassess task
partitioning as capabilities improve, without weakening evidence or permission
boundaries. A failure requires bounded recovery or explicit route reassessment,
not a silent provider switch. Honor an existing instruction to let the main
model continue after a worker budget is exhausted; reclaim ownership first.
Never present direct work as delegated evidence.

For delegated execution, use Herdr rather than ordinary platform-native
subagent/spawn tools. In this workflow, implementer, researcher, reviewer,
fixer, worker, and subagent are roles fulfilled by Herdr-managed agents, not
permission to choose another backend. An alternative backend requires an
explicit current user instruction or a higher-priority host requirement.
Load `multi-model-agent` and its `references/herdr-claude.md`. Use the current
task or user-selected model exactly and never silently substitute a route. A
model configuration, worker startup, or idle status is lifecycle evidence, not
project completion evidence.

## Trigger

- A task is a bounded implementation fix, large, independent, mechanical, or
  explicitly requests a worker route.
- A worker is about to be dispatched, continued, checked, or integrated.
- A checkpoint/session split must preserve the task and worker state.
- A relay-backed route is selected or unavailable.

Pure questions, planning, bounded checking, and orchestration-policy
administration remain main-model work unless explicitly delegated. Explicit
delegation requirements still bind small fixes. When no route is mandated,
direct execution is a valid initial choice; worker unavailability requires
recording the failure and a deliberate continuation decision.

## Priority

explicit user instruction > repository hard rules / specs > current local
evidence > active IMO learning digest > generic agent training defaults.

This rule does not bypass host restrictions, permissions, or the Relay
personal-coding boundary.

## Required Local Evidence

- Requested scope, worker acceptance criteria, read/write ownership, and
  dependencies.
- Applicable project rules and existing dirty work.
- Effective provider/model evidence when a worker route is requested.
- Actual worker result, diff/artifact, and necessary verification evidence.

Do not pass full conversation history or credentials to workers.

## Habits To Suppress

- Delegating a read-only or purely explanatory task only to satisfy a generic policy.
- Asking for delegation authorization already granted for the current scope.
- Treating worker startup, idle status, or configuration as completion.
- Duplicate workers, overlapping write ownership, or recursive delegation.
- Silently changing model/provider/runner or falling back to an official
  subscription.
- Using native subagent tools as the default or fallback for Herdr execution.
- Forcing delegation without a useful boundary, or bypassing an explicit Herdr mandate.
- Confusing accumulated reservations, reported usage and unknown in-flight spend.
- Unbounded retries, full-history prompts, raw logs, or credential disclosure.
- Relay use for evaluation, benchmarking, batch work, or live traffic.

## Implementation Behavior

1. Main defines the goal, bounded task, ownership, dependencies, and real
   end-to-end acceptance. Choose direct or delegated execution as above;
   when delegated, read `multi-model-agent` for the route and use `orchestrate`
   even for one worker. Shared contracts have one owner; no substitute peer
   implementations merely to make isolated modules or tests pass.
2. When delegating, include the resolved canonical path and allowed cwd; the
   worker verifies `pwd` before reading or writing and stops on mismatch.
3. Dispatch one bounded worker with an explicit current model, exact file
   boundaries, compact context, no recursion, summary-only return, and a
   verified return channel to the coordinator.
4. The coordinator wakes the main session on every lifecycle change, including
   `idle`, `done`, `blocked`, `unknown`, and process exit. Main reads the result
   and focused evidence, checks acceptance, and delegates missing verification
   or corrections. Never count self-reported success alone, but never wait for
   an artifact before waking and intervening.
5. Record route decisions, actual execution backend, reasons for exceptions,
   completed/blocked state, and available artifacts at phase boundaries.
   Apply `.imo/runtime/observability/herdr-telemetry.md`; a native subagent
   invocation must never count as Herdr usage. Continue existing work rather
   than duplicate dispatch.
6. On failure, inspect evidence and re-plan or narrow the worker task. At most
   three failures of the same strategy; then report the blocker.
7. Keep Relay use within personal coding and return compact summaries plus
   local paths for large evidence.
8. Inherit the existing budget ledger. Distinguish settled usage, outstanding
   reservations, unknown usage and historical totals. Do not reset a cap by
   restarting a worker; unknown calls retain a conservative charge. Use the
   budget and takeover protocol in `orchestrate`.

## Allowed Exceptions

- User explicitly asks the main model to execute directly for the stated scope.
- User explicitly selects a different execution backend for the stated scope,
  or a higher-priority host requirement mandates it; record that exception.
- Planning, bounded evidence reading, reviewing results, and dispatch
  or orchestration-policy administration do not require a worker.
- Without a mandatory route, the main model may handle a short or tightly
  coupled implementation after an explicit task-shape assessment. If a worker
  already owns the files, stop/recover it and reclaim ownership before handoff.
- An already authorized budget-exhaustion takeover needs no repeated approval.

There is no silent route fallback. If Herdr is unavailable, report
`herdr_unavailable`; if no verified return channel exists, report
`no_return_channel`. Keep coordination active for bounded recovery, or use an
allowed, recorded direct-execution handoff. If the mandated route remains
unavailable, report the blocker. Do not claim background execution or silently
substitute native subagents.

## Review Questions

- Was routing chosen from task shape and current user instruction?
- If delegated, was the effective provider/model verified?
- Was the actual execution backend Herdr, or was an explicit override recorded?
- Did the chosen route reduce useful work rather than merely add roles?
- Were budget reservation and actual usage distinguished and the original cap preserved?
- Were ownership, dirty work, context bounds, and retry limits respected?
- Was completion proved with a result, artifact, and verification evidence?
- Did any worker route silently expand scope or change provider?

## Non-Goals

- Do not force delegation or parallelism for its own sake.
- Do not expand task scope, bypass permissions, or fake runner availability.
- Do not make a model or provider name a permanent global default when the user
  has not selected it for the current task.
