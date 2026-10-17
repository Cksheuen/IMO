---
name: eat
description: Reads outside material (articles, papers, repos, docs, messages, transcripts) and turns it into project decisions. Use when the user asks to learn from material, digest it, or find what is useful for this project.
---

# Eat

Outside material proposes; local code, tests and the user decide.

1. Get the full source, its link, version and date. Say how old it is;
   mark an unknown date as not checked.
2. Map the problem, main claims, their locations and the kind of evidence
   behind each claim (experiment, implementation, observation or opinion).
3. Label each finding **source says (location)**, **we infer**, or
   **not checked**. Look for limits and counter-evidence; a fluent summary
   is not the stopping point.
4. Search this project's rules, skills, docs and code for the same topic.
   Mark each finding **new**, **already have**, or **conflicts with X**,
   with a local path when available.
5. Return a short **adopt / maybe / reject** table. Each row contains the
   labelled finding, local comparison, one recommended verdict, why and
   where it would go. If Icarus is available, present the rows as a decision
   block with `multiple: true` so the user can tick rows.
6. Apply only rows the user confirms. Re-read each edited target. Keep no
   separate summary file; rejected and unconfirmed rows stay in the reply.

| Adopted finding | Target |
| --- | --- |
| One-line rule used often | Project `AGENTS.md` or `CLAUDE.md` |
| Procedure used sometimes | Existing or new skill |
| Stable project or user fact | Memory |
| One-off detail | Nothing |

Read [long-reads.md](references/long-reads.md) only when the material is too
long for one session.

## Example

Input: "Learn from this blog post on prompt caching."
Illustrative output; replace these locations and checks with actual evidence:

| Finding and comparison | Verdict | Why | Target |
| --- | --- | --- | --- |
| Source says (section 2): put stable text first; new | Adopt | Local cache test confirms a benefit | Project `AGENTS.md` |
| We infer: batch similar requests; new | Maybe | Latency impact not checked | Existing API skill, after a test |
| Source says (section 4): use its provider's cache flag; conflicts with our client | Reject | Our client has no such option | Nothing |
