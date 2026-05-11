# Product Scripts Contract

`product/scripts/` is reserved for framework-owned helper scripts and generators.

## Contract

- Scripts here will become the canonical automation surface once migration from root `scripts/` is approved.
- Adapter or runtime entrypoints may call into these scripts, but should not duplicate their logic elsewhere.
- In the current repo state, `audit_managed_ownership.py` is the only script wired to the Trellis host-ownership boundary; it is a read-only guardrail against reintroducing Trellis-owned host-surface management into IMO manifests.
- `scripts/imo.sh` currently forwards that guardrail command, but it is not a statement that IMO as a framework is limited to guardrail behavior.
