---
name: metrics-daily
description: Aggregate local CC/Codex hook metrics into a daily summary and print the text daily report. Use when the user asks for `/metrics-daily`, wants today's hook runtime usage report, asks which hooks ran or blocked today, or needs to generate/update the local daily metrics report under `~/.claude/metrics/`.
---

# Metrics Daily

Run the local daily metrics pipeline for the personal hook observability system.

## Workflow

1. Run daily aggregation:

```bash
python3 ~/.claude/hooks/metrics/aggregate.py --daily
```

2. Render the text daily report:

```bash
python3 ~/.claude/hooks/metrics/report.py --daily
```

3. Report the key output paths:

- `~/.claude/metrics/daily/YYYY-MM-DD.json`
- `~/.claude/metrics/reports/latest-daily.txt`
- `~/.claude/metrics/reports/snapshots/YYYY-MM-DD.txt`

## Expectations

- Treat missing event files as “no events today”, not as a failure.
- Keep the response focused on sessions, total events, top hooks, failures, and gate blocks.
- Do not mention weekly metrics or Phase 2 features unless the user explicitly asks.
