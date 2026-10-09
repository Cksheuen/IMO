# IMO Orchestration Reliability Protocol

This file records the repo-local protocol for worker-based implementation.

It exists because worker orchestration can appear active while the parent
session receives no lifecycle change or recoverable result. Future work must
therefore be observable through a durable event inbox and a verified return
channel, not only from an agent mailbox.

## Scope

This protocol applies when an IMO task uses worker agents, external agent
hosts, worktrees, or any other delegated implementation runner.

It does not replace the repository or platform's task workflow.

## Observability Rule

A worker is considered started when Herdr acknowledges the worker and the
coordinator records its task, pane, ownership, and return channel. A status
artifact, diff, or final summary is productivity and acceptance evidence; it is
not a prerequisite for waking the parent or handling a failure.

## Startup Gate

Before starting workers, the parent task must define:

- worker name
- file ownership
- allowed reads
- forbidden paths
- expected first lifecycle event
- coordinator and return channel
- first-check timeout
- fallback action

Recommended defaults:

```text
first_check_timeout: 2 minutes
no_diff_timeout: 5 minutes
max_wait_without_artifact: 10 minutes
fallback: close_worker_then_serial_worker_or_report_blocked
```

Pure explanation, planning, and bounded reads remain in the main session.
Choose direct work or delegation by current authorization, coupling and total
coordination cost; a short closed loop need not start a worker. Once delegated,
default to one Herdr worker and use `orchestrate`. Delegated roles use Herdr-managed agents, not
ordinary platform-native subagent tools, unless an explicit current user
instruction or higher-priority host requirement overrides the route. Herdr
failure does not authorize a silent backend change.

## File Ownership

Each writable file belongs to one worker at a time.

If two workers need the same file:

- merge the tasks, or
- run them serially, or
- create standalone outputs first and integrate in a later task.

Integration files such as aggregate verify commands should usually be handled
after parallel slices land.

## Worktree Rule

Worktree isolation is useful only if the parent can recover the result.

When using worktrees:

- create one branch/worktree per worker
- check each worktree with `git status --short --untracked-files=all`
- treat a clean worktree after the no-diff timeout as no progress
- remove unused clean worktrees and branches after fallback

## Main Agent Loop

The parent owns plan/manage/check/integrate and may directly execute when the
route policy permits. Selected implementation workers execute through Herdr.
Load `multi-model-agent` for the delegated execution route.
The parent must not infer completion from mailbox state alone, but every
lifecycle event must wake the parent for intervention.

Required coordination loop (Herdr details live in the multi-model-agent execution reference):

```text
reuse codex-use; one workspace per Codex conversation, one named tab per worker
start a persistent coordinator with a durable task state, event inbox, successor queue, and verified return channel
launch bounded Herdr workers with --permission-mode auto and the explicitly selected current model
forward working, idle, done, blocked, unknown, and process-exit changes to the coordinator
on each change: coordinator wakes parent, parent reads output and decides review, recovery, approval, or continuation
on completion signal: coordinator reviews; artifacts and verification are acceptance evidence, not wake-up prerequisites
on findings: dispatch bounded fixes, verify and accept/reject that individual result
advance independent successors immediately; wait only on dependencies/shared write locks
on no progress or missing return channel: emit structured blocker and do not claim background execution
cleanup owned completed tabs/workspaces; retain codex-use and other conversations
```

The coordinator must prove `Herdr state change → coordinator event → parent wake`
before claiming background execution. A bounded wait or background shell log is
not a return channel. If the parent cannot be woken, keep the coordination turn
active or return `no_return_channel` instead of silently waiting.

## Herdr Effectiveness Checks

The [Herdr telemetry design](runtime/observability/herdr-telemetry.md) defines
route coverage, lifecycle correlation, independently emitted parent receipts,
intervention, successor dispatch, and missing-event audits. Include eligible
tasks that were never dispatched and lifecycle events without artifacts.
Report design readiness, instrumentation wiring, real parent wake-up, and real
continuation separately; local logs and fixture tests prove neither receipt nor
automatic progress.

## Failure Classification

| Symptom | Meaning | Action |
| --- | --- | --- |
| worker returns final summary and diff exists | acceptance evidence | review and integrate |
| worker returns blocked summary | intervention signal | read blocker and answer/recover |
| worker is `done`/`idle` without artifact | intervention signal | read output; classify success, interruption, or retry |
| worker is `unknown` or exits unexpectedly | interruption | inspect pane/error evidence and recover or report |
| worktree clean after timeout | no useful result | remove worktree and fallback |
| multiple workers touch same file | orchestration error | stop and resolve ownership |

## Required Record

When orchestration falls back, record:

- task id
- workers started
- observable result
- fallback decision
- final verification command

This keeps failed delegation from disappearing into chat history.

## Current Known Failure

During `05-20-imo-contract-metadata-verification-gates`, two worker batches were
started. Workers either disappeared from the live list or remained `running`,
but no worktree or repository diff appeared. The task was completed only after
workers were closed and implementation moved back to the main thread. This is
historical behavior. Current handoffs must follow explicit authorization and
task-shape assessment, preserve the original budget and reclaim write ownership;
they cannot silently bypass a mandated worker route.

Future IMO orchestration should treat this as the baseline failure mode and use
the startup gate above.
