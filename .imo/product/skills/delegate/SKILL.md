---
name: delegate
description: Hands well-specified coding work (clear edits, mechanical changes, translations, read-only scans, a second-opinion review of a diff) to a Codex worker in a Herdr pane, then checks the result. Use to save the main agent's tokens and time when a task can be written down completely. Requires running inside Herdr.
---

# Delegate to a Codex worker

You stay responsible: you design, write the spec, check the result, and talk to the user. The worker only executes.

## Delegate or not

Delegate when the task fits in a short spec file, the files it may touch are clear, and the result can be checked (tests, a verify command, a diff). Keep it yourself when it needs this conversation's context, a design decision, the user's input, or edits tangled with your own.

## Start a worker

```bash
test "$HERDR_ENV" = 1 || echo "not inside Herdr"
herdr pane layout --pane "$HERDR_PANE_ID"            # pick direction: right if wide, down if narrow
herdr pane split --current --direction down --cwd <repo> --no-focus      # -> .result.pane.pane_id
herdr agent start <name> --kind codex --pane <pane_id> -- --profile imo-worker \
  -m gpt-6-astra -c model_reasoning_effort=medium -s workspace-write -a never
herdr agent send-keys <name> esc
```

- `gpt-6-astra` at medium effort is the user's chosen worker model. Use `-s read-only` for scans and reviews.
- `--profile imo-worker` (installed by `imo global install`) turns off plugins, memories and the skill list for the worker: startup measured 24,241 -> 7,966 tokens. Drop it if the profile is missing.
- The `esc` closes Codex's startup "hooks need review" screen if one appears (it otherwise swallows the first prompt) and is harmless if none does. Never approve hooks for the user.
- The sandbox blocks writes outside `<repo>`. If a check must write elsewhere, add `-c 'sandbox_workspace_write.writable_roots=["<dir>"]'`.
- For large or risky changes, give the worker a git worktree so the user's live files stay untouched.

## Hand off

Write the spec to a file: goal, files it may edit, files it must not touch, the check to run, "do not commit", and "end with a report of at most 15 lines". Then run in the background (you are woken when it ends):

```bash
herdr agent prompt <name> "[delegated] Read <spec-file> and carry it out exactly. End with the report." --wait --timeout 2400000
```

Start every prompt to a worker with `[delegated]`, so `learn-from-history` can tell agent-written sessions from the user's own.

Two workers at once only when their file sets do not overlap; say so in each prompt.

## Check

```bash
herdr agent read <name> --source recent-unwrapped --lines 40     # the report
```

The report is a claim, not proof. Check yourself: `git status`, `git diff --stat`, run the check, read the diff of the important files. Fix small things yourself; send bigger misses back to the same worker with the exact failure.

## Second-opinion review

Start a worker with `-s read-only` and prompt: "Review `git diff <base>` for bugs. List only actionable findings as file:line + why." Verify each finding before acting on it.

## Finish

Close the panes you created (`herdr pane close <pane_id>`); never close panes you did not create. If a worker stops at an approval or question, read it (`herdr agent read`) and ask the user before answering.

## Example

Spec `task-a.md`: "Delete skills X and Y from `.imo/product/skills/` and `skills/`, remove them from `modules.json` and verify, keep `./imo verify` green, do not commit, report in 15 lines." Worker finished in 2 minutes; coordinator checked `git status` (63 deleted, 5 modified), read the diffs of the 5 edited files, re-ran `./imo verify`, then reported to the user.
