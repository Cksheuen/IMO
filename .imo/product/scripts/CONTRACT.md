# Product Scripts Contract

`product/scripts/` is reserved for framework-owned helper scripts and generators.

## Contract

- Scripts here will become the canonical automation surface once migration from root `scripts/` is approved.
- Adapter or runtime entrypoints may call into these scripts, but should not duplicate their logic elsewhere.
- Phase 2 adds `sync_managed_outputs.py` as the canonical repo-local generator for the minimal managed-output loop.
- `scripts/imo.sh` is now a thin entrypoint that delegates to scripts in this directory.
