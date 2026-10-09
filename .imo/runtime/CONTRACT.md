# Runtime Contract

`runtime/` stores stable runtime logic contracts for the IMO framework.

## Contract

- In-repo content here defines stable bootstrap expectations, protocol boundaries, and future runtime schemas.
- Shared runtime helpers and typed protocol fragments belong under `.imo/runtime/shared/`.
- Defensive audit behavior contracts belong under `.imo/runtime/defensive-audit/`.
- Unified observability contracts belong under `.imo/runtime/observability/`;
  generated events belong under `~/.imo/projects/<project-id>/runtime/observability/`.
- Project convention profile contracts belong under `.imo/runtime/project-profile/`;
  generated state belongs under `~/.imo/projects/<project-id>/runtime/project-profile/`.
- Shared runtime dependency entrypoints belong under `.imo/runtime/requirements.txt`.
- High-churn runtime state never lives here or in consumer repositories.
- Adapter or product code may depend on these contracts, but must not embed competing runtime truth elsewhere.
- Root `skills/migrated/*` compatibility surfaces may project into `.imo/runtime/*`, but they are not the long-term source-of-truth once a runtime surface is migrated here.
- IMO runtime may write only explicitly declared runtime targets; host outputs and external provider state remain outside this contract.
