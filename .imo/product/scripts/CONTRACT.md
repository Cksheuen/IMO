# Product Scripts Contract

`product/scripts/` is reserved for framework-owned helper scripts and generators.

## Contract

- Scripts here will become the canonical automation surface once migration from root `scripts/` is approved.
- Adapter or runtime entrypoints may call into these scripts, but should not duplicate their logic elsewhere.
- `.imo/product/scripts/imo.sh` is now the canonical repo-local shell entry for the current IMO guardrail surface.
- `.imo/product/scripts/check-langchain-runtime-deps.py` is now the canonical runtime-dependency check entry for migrated framework runtimes.
- `.imo/product/scripts/task-audit.py` is now the canonical task-audit implementation.
- `.imo/product/scripts/task-bootstrap.sh` is now the canonical task-bootstrap implementation.
- `.imo/product/scripts/audit_runtime_links_core.py` is now the canonical runtime-link analysis helper.
- In the current repo state, `audit_managed_ownership.py` is the only script wired to the Trellis host-ownership boundary; it is a read-only guardrail against reintroducing Trellis-owned host-surface management into IMO manifests.
- Root `scripts/imo.sh` now acts only as a compatibility wrapper that forwards into `.imo/product/scripts/imo.sh`; it is not a statement that IMO as a framework is limited to guardrail behavior.
- Root `scripts/check-langchain-runtime-deps.py` now acts only as a compatibility wrapper that forwards into the canonical `.imo/product/scripts/` implementation.
- Root `scripts/task-audit.py` now acts only as a compatibility wrapper that forwards into the canonical `.imo/product/scripts/` implementation.
- Root `scripts/task-bootstrap.sh` now acts only as a compatibility wrapper that forwards into the canonical `.imo/product/scripts/` implementation.
- Root `scripts/audit_runtime_links_core.py` now acts only as a compatibility wrapper that re-exports the canonical `.imo/product/scripts/` module surface.

## Validation Rule

- Script migration is not complete with only `bash -n`, `py_compile`, import checks, or `--help` output.
- Each migrated script family must include at least one recorded runnable behavior check that exercises the real script path after migration.
- Prefer validating through the root compatibility entrypoint when one exists; canonical-path validation is additional evidence, not a substitute for all user-facing execution.
- Static/syntax checks remain useful, but they are supporting evidence only and must not be the sole acceptance signal.
