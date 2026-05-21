# Product Scripts Contract

`product/scripts/` is reserved for framework-owned helper scripts and generators.

## Contract

- Scripts here will become the canonical automation surface once migration from root `scripts/` is approved.
- Adapter or runtime entrypoints may call into these scripts, but should not duplicate their logic elsewhere.
- `.imo/product/scripts/imo.sh` is now the canonical repo-local shell entry for the current IMO guardrail surface.
- Root `./imo` is the primary repo-root direct-run command and must remain a thin wrapper into `.imo/product/scripts/imo.sh`.
- `.imo/product/scripts/check-langchain-runtime-deps.py` is now the canonical runtime-dependency check entry for migrated framework runtimes.
- `.imo/product/scripts/task-audit.py` is now the canonical task-audit implementation.
- `.imo/product/scripts/task-bootstrap.sh` is now the canonical task-bootstrap implementation.
- `.imo/product/scripts/audit_runtime_links_core.py` is now the canonical runtime-link analysis helper.
- `.imo/product/scripts/verify.py` is now the canonical read-only IMO verification suite.
- `.imo/product/scripts/codex_context.py` emits repo-local IMO context for experimental Codex hook injection without mutating host files.
- `.imo/product/scripts/check_module_metadata.py` validates machine-readable IMO skill module metadata without mutating source.
- `.imo/product/scripts/check_learning_contracts.py` validates learning-plane policy contracts without writing learning state.
- `.imo/product/scripts/check_provider_contracts.py` validates optional provider registry contracts without discovering or invoking providers.
- `.imo/product/scripts/learning.py` exposes read-only learning digest commands and must not create or mutate learning state.
- In the current repo state, `audit_managed_ownership.py` is the only script wired to the Trellis host-ownership boundary; it is a read-only guardrail against reintroducing Trellis-owned host-surface management into IMO manifests.
- Root `scripts/imo.sh` now acts only as a compatibility wrapper that forwards into `.imo/product/scripts/imo.sh`; `./imo` is the preferred user-facing repo-root command. This is not a statement that IMO as a framework is limited to guardrail behavior.
- Root `scripts/check-langchain-runtime-deps.py` now acts only as a compatibility wrapper that forwards into the canonical `.imo/product/scripts/` implementation.
- Root `scripts/task-audit.py` now acts only as a compatibility wrapper that forwards into the canonical `.imo/product/scripts/` implementation.
- Root `scripts/task-bootstrap.sh` now acts only as a compatibility wrapper that forwards into the canonical `.imo/product/scripts/` implementation.
- Root `scripts/audit_runtime_links_core.py` now acts only as a compatibility wrapper that re-exports the canonical `.imo/product/scripts/` module surface.

## Validation Rule

- Script migration is not complete with only `bash -n`, `py_compile`, import checks, or `--help` output.
- Each migrated script family must include at least one recorded runnable behavior check that exercises the real script path after migration.
- Prefer validating through the root compatibility entrypoint when one exists; canonical-path validation is additional evidence, not a substitute for all user-facing execution.
- `./imo --help`, `./imo audit all`, `./imo learning list`, and `./imo verify` are the direct-run acceptance surface for this repo.
- `verify` may smoke `./imo --help`, but must not call `./imo verify` internally because that would recursively invoke itself.
- Static/syntax checks remain useful, but they are supporting evidence only and must not be the sole acceptance signal.
- `./imo verify` is the primary repo-local aggregate check. It must stay read-only and must not project or mutate host outputs.
- `./imo verify` includes the module metadata, learning contract, and provider registry checkers before compile/import smoke checks.
- `./imo learning list` reads `.imo/.runtime/learning/digest.json` when present and reports a clean empty state when it is absent.
- `./imo learning inspect <id>` prints one digest item by id and exits non-zero when the item does not exist.
- `./imo codex context` emits hook JSON containing a short `<imo-context>` block. It tells Codex to prefer current repo `.imo/` and `./imo` for IMO-related questions, but remains informational only and must not override user instructions, parent-agent instructions, or Trellis workflow state.
- `scripts/imo.sh ...` must keep behaving as a compatibility form of the same commands.
