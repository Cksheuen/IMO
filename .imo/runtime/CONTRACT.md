# Runtime Contract

`runtime/` stores stable runtime logic contracts for the IMO framework.

## Contract

- In-repo content here defines stable bootstrap expectations, protocol boundaries, and future runtime schemas.
- High-churn runtime state never lives here; it belongs under `.imo/.runtime/`.
- Adapter or product code may depend on these contracts, but must not embed competing runtime truth elsewhere.
- In the current repo state, no IMO runtime may write Trellis-owned host targets; that restriction does not change `runtime/` as part of the active IMO framework workspace.
