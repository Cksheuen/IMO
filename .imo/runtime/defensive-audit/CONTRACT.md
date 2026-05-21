# Defensive Audit Contract

`defensive-audit/` records the stable behavior contract for IMO defensive
programming reports.

## Command

```bash
./imo defensive audit
./imo defensive audit --json
```

## Contract

- The command is read-only and advisory.
- It must not write source files, runtime files, host outputs, or Trellis files.
- Findings are not failures; only command errors or invalid output shape fail.
- The scan scope is bounded to IMO-owned docs/scripts/runtime contracts plus
  the Trellis IMO backend spec.
- JSON output must include:
  - `schema_version`
  - `scan_scope`
  - `summary.by_category`
  - `summary.by_severity`
  - `findings`
  - `follow_ups`
- Category ids are stable:
  - `keep`
  - `simplify`
  - `replace-with-contract`
  - `remove`

## Interpretation

- `keep` means the guardrail has a concrete boundary, runtime-state, or
  optional-provider reason.
- `simplify` means the behavior is valid but repeated or too broad.
- `replace-with-contract` means prose or fallback should become schema,
  metadata, checker, or command smoke.
- `remove` means a blanket fallback pattern should not be used without local
  evidence.
