# IMO Orchestration Reliability Protocol

This file records the repo-local protocol for worker-based implementation.

It exists because worker orchestration can appear active while producing no
recoverable diff or completion result. Future parallel work must therefore be
observable from the repository, not only from an agent mailbox.

## Scope

This protocol applies when an IMO task uses worker agents, external agent
hosts, worktrees, or any other delegated implementation runner.

It does not replace Trellis task management and it does not make IMO a proxy for
Trellis.

## Observability Rule

A worker is considered started only after at least one of these is true:

- the worker creates or updates an agreed status artifact
- the worker creates a repository diff in its owned files
- the worker returns a final summary with explicit completed/blocked status

Agent runtime state alone is not enough. A worker listed as `running` without a
status artifact, diff, or final summary is only "launched", not "productive".

## Startup Gate

Before starting workers, the parent task must define:

- worker name
- file ownership
- allowed reads
- forbidden paths
- expected first observable artifact
- first-check timeout
- fallback action

Recommended defaults:

```text
first_check_timeout: 2 minutes
no_diff_timeout: 5 minutes
max_wait_without_artifact: 10 minutes
fallback: close_worker_then_serial_or_restart
```

For very small tasks, prefer direct implementation over delegation.

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

The parent agent should not wait indefinitely for mailbox updates.

Recommended loop:

```text
spawn workers
sleep briefly
check agent status
check repo/worktree diff
if no observable artifact by first_check_timeout:
  send one concise follow-up or close/restart the worker
if no diff by no_diff_timeout:
  close worker and downgrade to serial implementation
after completion:
  run verification from the parent
```

## Failure Classification

| Symptom | Meaning | Action |
| --- | --- | --- |
| worker returns final summary and diff exists | productive | review and integrate |
| worker returns blocked summary | blocked | use blocker as next context |
| worker running but no artifact/diff | unproductive launch | follow up or close |
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
workers were closed and implementation moved back to the main thread.

Future IMO orchestration should treat this as the baseline failure mode and use
the startup gate above.

