---
name: learn-from-history
description: Reads past Claude Code and Codex sessions to find user corrections, preferences and repeated requests. Use when the user asks to learn from history, review past sessions, or make agents fit their working style better.
---

# Learn from history

Exec runs (unless `--include-exec`) and sessions whose first human message starts with `[delegated]` are skipped.

1. Ask for the time window and scope (all projects or one). Default to since
   the last run: read `~/.imo/history-last-run.json`, shaped as
   `{"last_run": "YYYY-MM-DD"}`. If missing, ask for a start date. Record
   this run's start date for later; do not advance it for a partial review.
2. Run the bundled script, replacing `<skill-dir>` and the date:

   ```bash
   python3 <skill-dir>/scripts/extract_user_messages.py --source both --since YYYY-MM-DD
   ```

   Add `--project <cwd-substring>` for one project. `--max-chars 400` is the
   default; increase it if a correction is cut short. `--out <file>` writes
   JSONL for chunked reading. Use a private temporary output, read it in
   chunks and remove it after review. The script never edits history.
3. Find explicit corrections ("no", "don't", "I said", "wrong"), stated
   preferences and frustration. Weight corrections or requests repeated in
   more than one session highest; duplicate transcript records are not
   independent evidence. Never paste secrets or tokens found in history.
4. Return at most 15 candidates. Each has a one-line rule, evidence (date,
   session and short quote, translated to English if needed), scope
   (**all projects** / **project X**) and certainty. Label the evidence
   **source says (location)**; label a derived rule **we infer** and missing
   checks **not checked**. A one-project observation does not establish a
   preference for all projects.
5. Save only confirmed candidates where the user says. Suggest
   `AGENTS.md` / `CLAUDE.md` for rules for both agents; for project decisions,
   use `icarus remember add "<line>" --confirmed` if Icarus is present.
   Check for an existing entry and update it instead of duplicating it.
   Re-read edits. With user confirmation, store the run's start date as
   `last_run` only after the full agreed window and scope were reviewed.
   Keep the prior date for a partial/project-only run if advancing it would
   skip unreviewed projects next time. Never delete session history.

## Example

Input: "Review last week's sessions for project piano."
Illustrative candidates (session IDs stand for actual evidence):

| Candidate | Evidence | Scope | Certainty |
| --- | --- | --- | --- |
| We infer: preserve my dirty edits | Source says (Oct 10, s1): "Don't revert my edits"; repeated in s2 | Project piano | High |
| We infer: keep reports short | Source says (Oct 12, s3): "Just the result, please" | Project piano | Medium |
| We infer: use pnpm | Source says (Oct 13, s4): "I said pnpm"; current config not checked | Project piano | Low |
