# Runtime Contract

`runtime/` stores stable runtime logic contracts for the IMO framework.

## Contract

- In-repo content here defines stable bootstrap expectations, protocol boundaries, and future runtime schemas.
- High-churn runtime state never lives here; it belongs under `.imo/.runtime/`.
- Adapter or product code may depend on these contracts, but must not embed competing runtime truth elsewhere.
- Phase 2 still keeps executable state out of `runtime/`, but adapter sync now records managed file hashes under `.imo/.runtime/managed-hashes.json`.
