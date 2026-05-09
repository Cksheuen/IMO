# Runtime Ignore Boundary

The runtime model follows the Trellis-style hybrid split:

- Stable logic, schemas, and documented contracts stay versioned under `.imo/runtime/`.
- High-churn local state stays under `.imo/.runtime/`.
- `.imo/.gitignore` ignores `.imo/.runtime/` so session pointers, caches, locks, and other local state do not enter source control.
- Phase 2 uses `.imo/.runtime/managed-hashes.json` for generated-output drift detection; this file is local state and must remain ignored.

Phase 2 may create `.imo/.runtime/` content during sync, but that content never becomes source-of-truth.
