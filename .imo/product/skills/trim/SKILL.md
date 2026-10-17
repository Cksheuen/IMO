---
name: trim
description: Finds and cuts bloat in agent context to save tokens and remove distractions. Use when the user asks to slim down, clean up, or audit rules, skills, CLAUDE.md, AGENTS.md, or context cost.
---

# Trim

1. Measure with `imo budget audit [--json] [path]` (`./imo` in its checkout)
   and `wc -c <files>`. Separate always-loaded instructions, skill names and
   descriptions, hook context (`imo codex context --stats`), and memory indexes
   from loaded-on-use skill bodies and references. Report bytes from `wc -c`;
   estimate tokens from character counts / 4, not UTF-8 bytes / 4.
2. Judge purpose and content, never use frequency: does the agent already know
   this? Did it fix a real problem? Do paths, commands and dependencies work?
   Is it duplicated? Does it belong always-on or on demand? Useful but broken
   content (bad path, missing dependency, trigger only in another language)
   gets **fix**, not cut.
3. Propose the table below. Mark every finding **source says** (location),
   **we infer**, or **not checked**. Savings are estimates; moving a reference
   saves always-on tokens, not total stored content.
4. Apply only rows the user confirms, then repeat the same measurements and
   report before/after. Do not change rules, skills, memory or config otherwise.

## Surfaces

- Claude Code: optional [audit targets](references/claude-audit-targets.md).
- Codex: `~/.codex/AGENTS.md`, project `AGENTS.md`, `~/.codex/skills/`,
  `~/.codex/hooks.json`; sessions
  `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (`session_meta.payload.cwd`).
- IMO: `~/.imo/`, budget audit and hook context commands above.
  Inspect actual loading before classifying rules or indexes as always-on;
  transcripts are evidence, not automatically loaded context.

Example input: "Trim my context." Illustrative proposal (characters):

| Item | Size | Always-on? | Verdict | Reason | Tokens saved |
|---|---:|---|---|---|---:|
| build rule | 120 | yes | keep | source says: rule.md:2 fixes wrong build | 0 |
| generic advice | 400 | yes | cut | we infer: already known | 100 |
| duplicate rule | 200 | yes | merge into build rule | source says: duplicate.md:1 repeats it | 50 |
| API guide | 800 | yes | move to a reference | we infer: task-specific | ~200 |
| tool skill | 600 | no | fix | source says: SKILL.md:8 has broken path | 0 |
