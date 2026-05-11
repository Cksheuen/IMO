# Runtime Ignore Boundary

The runtime model follows the Trellis-style hybrid split:

- Stable logic, schemas, and documented contracts stay versioned under `.imo/runtime/`.
- High-churn local state stays under `.imo/.runtime/`.
- `.imo/.gitignore` ignores `.imo/.runtime/` so session pointers, caches, locks, and other local state do not enter source control.
- The current repo does not allow IMO runtime state to drive Trellis-owned host projection. If future IMO-native runtime state appears under `.imo/.runtime/`, it must remain ignored and non-authoritative.
