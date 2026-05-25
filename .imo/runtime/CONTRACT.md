# Runtime Contract

`runtime/` stores stable runtime logic contracts for the IMO framework.

## Contract

- In-repo content here defines stable bootstrap expectations, protocol boundaries, and future runtime schemas.
- Shared runtime helpers and typed protocol fragments belong under `.imo/runtime/shared/`.
- Defensive audit behavior contracts belong under `.imo/runtime/defensive-audit/`.
- Unified observability contracts belong under `.imo/runtime/observability/`;
  generated observability events belong under `.imo/.runtime/observability/`.
- Project convention profile contracts belong under `.imo/runtime/project-profile/`; generated profile state belongs under `.imo/.runtime/project-profile/`.
- Shared runtime dependency entrypoints belong under `.imo/runtime/requirements.txt`.
- High-churn runtime state never lives here; it belongs under `.imo/.runtime/`.
- Adapter or product code may depend on these contracts, but must not embed competing runtime truth elsewhere.
- Root `skills/migrated/*` compatibility surfaces may project into `.imo/runtime/*`, but they are not the long-term source-of-truth once a runtime surface is migrated here.
- In the current repo state, no IMO runtime may write Trellis-owned host targets; that restriction does not change `runtime/` as part of the active IMO framework workspace.
