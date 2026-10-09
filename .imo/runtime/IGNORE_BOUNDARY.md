# Runtime Ignore Boundary

The runtime model uses a source/state split:

- Stable logic, schemas, and documented contracts stay versioned under `.imo/runtime/`.
- Source-checkout verification fixtures may use ignored `.imo/.runtime/`.
- Normal operation stores project state under
  `~/.imo/projects/<project-id>/runtime/`, so consumer repositories stay clean.
- Runtime state must remain ignored, rebuildable where possible, and non-authoritative for versioned product behavior.
