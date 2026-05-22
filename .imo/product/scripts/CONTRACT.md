# Product Scripts Contract

`product/scripts/` is reserved for framework-owned helper scripts and generators.

## Contract

- Scripts here will become the canonical automation surface once migration from root `scripts/` is approved.
- Adapter or runtime entrypoints may call into these scripts, but should not duplicate their logic elsewhere.
- `.imo/product/scripts/imo.sh` is now the canonical repo-local shell entry for the current IMO guardrail surface.
- Root `./imo` is the primary repo-root direct-run command and must remain a thin wrapper into `.imo/product/scripts/imo.sh`.
- Root `bin/imo.js` is the optional Node package bin wrapper for local
  `npm link` testing. It must forward into root `./imo` and must not duplicate
  command dispatch or framework behavior.
- `.imo/product/scripts/install.py` is now the canonical repo-local framework
  lifecycle installer. It installs, updates, and uninstalls the IMO direct-run
  profile in target repositories without treating Python packaging as the
  framework install boundary.
- `.imo/product/scripts/check-langchain-runtime-deps.py` is now the canonical runtime-dependency check entry for migrated framework runtimes.
- `.imo/product/scripts/task-audit.py` is now the canonical task-audit implementation.
- `.imo/product/scripts/task-bootstrap.sh` is now the canonical task-bootstrap implementation.
- `.imo/product/scripts/audit_runtime_links_core.py` is now the canonical runtime-link analysis helper.
- `.imo/product/scripts/verify.py` is now the canonical read-only IMO verification suite.
- `.imo/product/scripts/defensive_audit.py` is now the canonical read-only
  advisory report for defensive-programming guardrails and cleanup candidates.
- `.imo/product/scripts/codex_context.py` emits repo-local IMO context for experimental Codex hook injection without mutating host files; when learning events are enabled, it may append a compact digest-injection event to ignored runtime state.
- `.imo/product/scripts/root_resolver.py` is the shared source/global/project
  root resolver. Scripts must use it when behavior depends on the current
  project rather than the IMO source package root.
- `.imo/product/scripts/global_config.py` manages global IMO shim status,
  install, migrate, and uninstall. Write operations are dry-run unless
  `--apply` is explicit.
- `.imo/product/scripts/project_profile.py` manages local project convention snapshots under `.imo/.runtime/project-profile/`.
- `.imo/product/scripts/observability_events.py` owns compact unified
  observability event writes under ignored `.imo/.runtime/observability/events/`.
- `.imo/product/scripts/metrics.py` reads unified observability state and
  bridges existing learning counters without mutating observability state.
- `.imo/product/scripts/check_module_metadata.py` validates machine-readable IMO skill module metadata without mutating source.
- `.imo/product/scripts/check_rule_contracts.py` validates IMO product rule metadata and rule-document sections without mutating source.
- `.imo/product/scripts/check_observability_contracts.py` validates the stable
  observability contract and schema without mutating runtime state.
- `.imo/product/scripts/check_project_profile_contracts.py` validates the stable project-profile contract and schema without mutating runtime state.
- `.imo/product/scripts/check_learning_contracts.py` validates learning-plane policy contracts without writing learning state.
- `.imo/product/scripts/check_provider_contracts.py` validates optional provider registry contracts without discovering or invoking providers.
- `.imo/product/scripts/check_root_surfaces.py` validates root `scripts/`, root `skills/`, and `.gitignore` compatibility-surface declarations without mutating source.
- `.imo/product/scripts/learning_events.py` owns compact local learning event
  writes and summaries under ignored `.imo/.runtime/learning/events.jsonl`.
- `.imo/product/scripts/learning.py` exposes learning signal, candidate,
  activity, review, and digest commands with explicit write boundaries.
- `.imo/product/scripts/task_graph.py` exposes the IMO task graph overlay for
  current-project Trellis task references. `graph`, `show`, `read`, and `plan`
  are read-only; explicit `run` may write summaries only under the current
  project's `.imo/.runtime/task-graph/runs/` after file-ownership and
  dependency gates pass.
- `.imo/product/scripts/check_task_graph_contracts.py` validates the stable task
  graph contract and schema without mutating runtime state.
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
- `./imo --help`, `./imo audit all`, `./imo defensive audit`,
  `./imo learning list`, `./imo metrics status`, `./imo metrics summary`, and
  `./imo verify` are the direct-run acceptance surface for this repo.
- `verify` may smoke `./imo --help`, but must not call `./imo verify` internally because that would recursively invoke itself.
- Static/syntax checks remain useful, but they are supporting evidence only and must not be the sole acceptance signal.
- `./imo verify` is the primary repo-local aggregate check. It must stay read-only and must not project or mutate host outputs.
- `./imo defensive audit` is advisory: findings do not fail the command, and
  source cleanup requires a separate explicit task.
- `./imo verify` includes the module metadata, learning contract, project-profile contract, and provider registry checkers before compile/import smoke checks.
- `./imo verify` includes the rule contract checker so product rules cannot stay prose-only or lose required sections.
- `./imo verify` includes the root compatibility-surface checker so root `scripts/` and `skills/` cannot drift back into ambiguous source-of-truth surfaces.
- `./imo verify` includes observability contract and smoke checks. Runtime-write
  observability smokes must back up and restore `.imo/.runtime/observability/`.
- `./imo verify` includes a global/project scope smoke. The smoke must validate
  merged project/global learning context, global shim writes under a temporary
  global root, and absence of global task-graph runtime writes.
- `./imo verify` includes a package-wrapper smoke. The smoke must validate the
  `package.json` bin mapping, run `node bin/imo.js --help` when Node is
  available, and dry-run package packing when npm is available. Direct-run
  installed targets that do not include `package.json` or `bin/imo.js` may skip
  this package-only smoke.
- `./imo verify` includes an install lifecycle smoke. The smoke must install
  into a temporary target, verify the installed target with recursive install
  smoke disabled, exercise update preserve-local, strict refusal, force
  overwrite, runtime preservation, and uninstall with cleanup.
- `./imo learning list` reads `.imo/.runtime/learning/digest.json` when present and reports a clean empty state when it is absent.
- `./imo learning list --scope project|global|merged` must read only project,
  only global, or merged digest state respectively. Merged output must not write
  runtime state.
- `./imo learning inspect <id>` prints one digest item by id and exits non-zero when the item does not exist.
- `./imo learning activity status` reads `.imo/.runtime/session/activity.json`
  when present and must not create runtime state.
- `./imo learning review prepare` may write candidate state only, and must skip
  unknown or active activity unless the command is explicitly forced.
- `./imo learning review approve <candidate-id>` must require review and
  rollback metadata before mutating active digest state.
- `./imo learning metrics summary` reads `.imo/.runtime/learning/events.jsonl`
  when present and must not create runtime state.
- Learning event writes are observational only. Event write failures must not
  turn an otherwise successful learning command into a failed command.
- Learning event writes can be disabled with `IMO_DISABLE_LEARNING_EVENTS=1`
  for read-only verification paths.
- Top-level non-metrics `./imo` command dispatch may append compact command
  lifecycle observability events. Event write failures must not turn an
  otherwise successful command into a failed command.
- `./imo metrics status`, `./imo metrics summary`, `./imo metrics timeline`, and
  `./imo metrics failures` are read-only over `.imo/.runtime/observability/` and
  must not create observability runtime state when it is absent.
- Observability event writes can be disabled with `IMO_DISABLE_EVENTS=1` for
  verification paths that assert read-only behavior.
- `./imo profile status` and `./imo profile inspect` must not create runtime state when a profile is absent.
- `./imo profile refresh` is the explicit low-frequency command that writes `.imo/.runtime/project-profile/`.
- `./imo profile clear` removes local project-profile runtime state only.
- `./imo task graph`, `./imo task graph show`, `./imo task graph read`, and
  `./imo task graph plan` read current-project `.trellis/tasks/*` as external
  source objects and must not create `.imo/.runtime/task-graph/` or mutate
  Trellis task JSON.
- `./imo task graph run <task-id-or-dir>` is explicit, gated, and may write only
  current-project `.imo/.runtime/task-graph/runs/` summaries after file
  ownership, dependency, and writable-conflict validation pass. It must not
  write task graph runtime state under the global IMO root.
- Top-level `./imo graph`, `./imo show`, `./imo read`, and `./imo plan` are
  compatibility aliases for the same task graph reader.
- `./imo codex context` emits hook JSON containing a short `<imo-context>` block. It tells Codex to prefer current repo `.imo/` and `./imo` for IMO-related questions, but remains informational only and must not override user instructions, parent-agent instructions, or Trellis workflow state. It must not mutate host files, profiles, digests, candidates, raw signals, or Trellis state; compact learning-event append is the only allowed runtime side effect when events are enabled.
- `scripts/imo.sh ...` must keep behaving as a compatibility form of the same commands.
- `./imo init/update/uninstall` must preserve the managed-file contract:
  unchanged managed files may be replaced or removed, user-modified managed
  files are preserved by default during update, `update --strict` refuses when
  user-modified managed files exist, `--force` overwrites/removes them, and
  installed hashes live under target-local
  `.imo/.runtime/install/managed-hashes.json`.
- `./imo global install/migrate/uninstall` must preserve the same managed-file
  safety for global shim files: dry-run by default, refuse unmanaged existing
  shim files unless `--force` is explicit, and record managed hashes under the
  selected global root.
