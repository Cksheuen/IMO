---
name: architecture-health
description: Measures project architecture and identifies files worth reviewing with concrete hints. Use for an architecture health check, architecture assessment, or asking whether to refactor.
---

# Architecture Health

Run, do not read, the scanner:

```sh
python3 <skill-dir>/scripts/scan.py --path <project> --domain general --format json
```

Domains: `general`, `frontend`, `backend`; omit for automatic selection.
Use `--format text` for a readable report. This is read-only analysis.
Confirm with the user before changing rules, skills, memory or config.

In Git, only `git ls-files --cached --others --exclude-standard` candidates
are scanned. Outside Git, generated/vendor folders use the built-in skip list.
Hidden source directories remain eligible; resolved paths deduplicate symlinks.

Output retains `schema_version`, flat `metrics`, `thresholds`,
`triggered_upgrades`, `recommendations`, and `current_stage`.
`top_files` lists five paths and values per metric; flagged files have hints.
Stages: `bootstrap`, `needs_growth`, `needs_structured`.
Repeated names count within a file only. JS counts are regex estimates;
counts alone cannot prove a design defect. Label findings **source says**
(path), **we infer**, or **not checked**.

Example: "Check this repo" -> source says: `src/app.py`, 920 lines, tops
`max_file_lines`; we infer: review its largest function for extraction into
a focused module. Not checked: whether that boundary fits runtime behavior.
