#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
OBSERVABILITY_SCRIPT="$REPO_ROOT/.imo/product/scripts/observability_events.py"

print_placeholder() {
cat <<'EOF'
imo: repo-local IMO command surface

Source of truth lives under `.imo/`.

Usage:
  ./imo audit [claude|codex|all]
  ./imo defensive audit [--json]
  ./imo learning list
  ./imo learning inspect <id>
  ./imo learning signal list
  ./imo learning signal add --summary <text>
  ./imo learning candidate build
  ./imo learning candidate list
  ./imo learning activity status
  ./imo learning review inbox
  ./imo learning review prepare [--force]
  ./imo learning metrics summary [--json]
  ./imo learning digest promote <candidate-id> --review-ref <ref> --rollback-id <id>
  ./imo metrics status
  ./imo metrics summary [--since <duration>] [--json]
  ./imo metrics timeline --trace <trace-id> [--json]
  ./imo metrics failures [--since <duration>] [--json]
  ./imo global status
  ./imo global install [--apply] [--force]
  ./imo global migrate [--apply] [--force]
  ./imo global uninstall [--apply] [--force]
  ./imo profile refresh
  ./imo profile status
  ./imo profile inspect
  ./imo profile clear
  ./imo init [target] [--force] [--dry-run]
  ./imo update [target] [--force] [--dry-run]
  ./imo uninstall [target] [--force] [--dry-run]
  ./imo task graph [--json]
  ./imo task graph show <task-id-or-dir> [--json]
  ./imo task graph read <task-id-or-dir> [--json]
  ./imo task graph plan [--json]
  ./imo task graph run <task-id-or-dir> [--json]
  ./imo graph [--json]
  ./imo show <task-id-or-dir>
  ./imo read <task-id-or-dir>
  ./imo plan [--json]
  ./imo codex context
  ./imo verify

Compatibility:
  scripts/imo.sh forwards to the same canonical implementation.

Common commands:
  - `audit` is read-only and checks whether IMO reintroduces Trellis-owned
    Claude/Codex host-surface management.
  - `defensive audit` is read-only and separates necessary boundary guardrails
    from fallback code that should be simplified, contracted, or removed.
  - `learning list` and `learning inspect` read active learning digest state
    without creating or mutating digest data.
  - `learning signal list` reads raw signal state, and `learning signal add`
    writes raw signals only under `.imo/.runtime/learning/`.
  - `learning candidate build/list/inspect/reject` manages candidate lessons
    under `.imo/.runtime/learning/` without mutating active digest state.
  - `learning activity status/mark` manages ignored runtime activity state under
    `.imo/.runtime/session/` so background preparation does not guess task
    completion from conversation text.
  - `learning review prepare/inbox/inspect/approve/reject` provides an explicit
    deferred review inbox. Prepare may build candidates only; approve still
    requires review and rollback metadata before active digest mutation.
  - `learning metrics summary` reads compact local learning events and reports
    effectiveness counters without mutating learning state.
  - `learning digest promote/disable/reset` manages reviewed active digest
    entries and requires rollback metadata for promotion.
  - `metrics status/summary/timeline/failures` reads the unified local
    observability stream and bridges existing learning counters without
    mutating observability state.
  - `global status/install/migrate/uninstall` manages the global IMO shim and
    shared runtime root. Install and migrate are dry-run unless `--apply` is
    explicit; project task graph state remains project-local.
  - `profile refresh/status/inspect/clear` manages local project convention
    snapshots under `.imo/.runtime/project-profile/`; prompt-time context reads
    the cache and never refreshes it.
  - `init/update/uninstall` manage the project-local IMO direct-run profile in
    a target repository. They install `.imo/`, root `imo`, root compatibility
    surfaces, and managed hashes without using Python package installation as
    the framework boundary.
  - `task graph`, `graph`, `show`, `read`, and `plan` inspect Trellis task
    references through the IMO task graph overlay without mutating Trellis task
    JSON or creating task graph runtime state.
  - `task graph run` is explicit and gated by file ownership, dependency
    validation, and conflict checks before any task graph run summary is written.
  - `verify` runs the current read-only IMO guardrail, wrapper, and runtime
    compatibility checks, including rule, module, learning, observability,
    project-profile, and provider contracts.
  - `codex context` emits a small repo-local IMO context block for experimental
    Codex hook injection. Active digest injection may append compact ignored
    learning telemetry.

Architecture:
  - IMO does not proxy Trellis by default. Use Trellis directly for Trellis
    task flow, and use IMO directly for IMO-owned capabilities and learning.
  - External frameworks, plugins, and skills stay outside `.imo/product/*` by
    default.

Advanced concepts:
  - Provider discovery/invocation is optional and disabled by default until a
    task adds explicit ownership and side-effect metadata.
  - Host adapter projection remains blocked while Trellis owns the target host
    output surfaces.
  - `sync` / `generate` are intentionally not exposed in this repo because
    Trellis remains the active owner of that host projection layer.
EOF
}

if [[ $# -eq 0 ]]; then
  print_placeholder
  exit 0
fi

new_trace_id() {
  python3 "$OBSERVABILITY_SCRIPT" trace-id 2>/dev/null || printf 'trace-unavailable'
}

now_ms() {
  python3 "$OBSERVABILITY_SCRIPT" now-ms 2>/dev/null || printf '0'
}

emit_observability_event() {
  python3 "$OBSERVABILITY_SCRIPT" emit "$@" >/dev/null 2>&1 || true
}

run_observed() {
  local operation="$1"
  shift
  local trace_id="${IMO_TRACE_ID:-$(new_trace_id)}"
  local start_ms end_ms duration status outcome
  local error_args=()

  start_ms="$(now_ms)"
  emit_observability_event \
    --event-type command_start \
    --trace-id "$trace_id" \
    --plane command \
    --component imo-cli \
    --operation "$operation" \
    --phase start \
    --outcome ok \
    --privacy project_private \
    --command "$operation"

  set +e
  IMO_TRACE_ID="$trace_id" "$@"
  status=$?
  set -e

  end_ms="$(now_ms)"
  duration=0
  if [[ "$start_ms" =~ ^[0-9]+$ && "$end_ms" =~ ^[0-9]+$ && "$end_ms" -ge "$start_ms" ]]; then
    duration=$((end_ms - start_ms))
  fi

  outcome=ok
  if [[ "$status" -ne 0 ]]; then
    outcome=error
    error_args=(--error-kind nonzero_exit)
  fi

  if [[ "${#error_args[@]}" -gt 0 ]]; then
    emit_observability_event \
      --event-type command_end \
      --trace-id "$trace_id" \
      --plane command \
      --component imo-cli \
      --operation "$operation" \
      --phase end \
      --outcome "$outcome" \
      --privacy project_private \
      --command "$operation" \
      --exit-code "$status" \
      --duration-ms "$duration" \
      "${error_args[@]}"
  else
    emit_observability_event \
      --event-type command_end \
      --trace-id "$trace_id" \
      --plane command \
      --component imo-cli \
      --operation "$operation" \
      --phase end \
      --outcome "$outcome" \
      --privacy project_private \
      --command "$operation" \
      --exit-code "$status" \
      --duration-ms "$duration"
  fi

  exit "$status"
}

case "${1}" in
  -h|--help|help)
    print_placeholder
    exit 0
    ;;
  audit)
    run_observed audit python3 "$REPO_ROOT/.imo/product/scripts/audit_managed_ownership.py" "${@:2}"
    ;;
  defensive)
    run_observed defensive python3 "$REPO_ROOT/.imo/product/scripts/defensive_audit.py" "${@:2}"
    ;;
  learning)
    run_observed learning python3 "$REPO_ROOT/.imo/product/scripts/learning.py" "${@:2}"
    ;;
  global)
    run_observed global python3 "$REPO_ROOT/.imo/product/scripts/global_config.py" "${@:2}"
    ;;
  metrics)
    exec python3 "$REPO_ROOT/.imo/product/scripts/metrics.py" "${@:2}"
    ;;
  profile)
    run_observed profile python3 "$REPO_ROOT/.imo/product/scripts/project_profile.py" "${@:2}"
    ;;
  init|update|uninstall)
    run_observed "install_${1}" python3 "$REPO_ROOT/.imo/product/scripts/install.py" "$@"
    ;;
  task)
    case "${2:-}" in
      graph)
        run_observed task_graph python3 "$REPO_ROOT/.imo/product/scripts/task_graph.py" "${@:3}"
        ;;
      *)
        print_placeholder >&2
        printf '\nUnsupported imo task command: %s\n' "${2:-}" >&2
        exit 64
        ;;
    esac
    ;;
  # Contract marker: graph|show|read|plan aliases share task_graph.py.
  graph)
    run_observed task_graph python3 "$REPO_ROOT/.imo/product/scripts/task_graph.py" "${@:2}"
    ;;
  show|read|plan)
    run_observed task_graph python3 "$REPO_ROOT/.imo/product/scripts/task_graph.py" "$@"
    ;;
  codex)
    case "${2:-}" in
      context)
        run_observed codex_context python3 "$REPO_ROOT/.imo/product/scripts/codex_context.py" "${@:3}"
        ;;
      *)
        print_placeholder >&2
        printf '\nUnsupported imo codex command: %s\n' "${2:-}" >&2
        exit 64
        ;;
    esac
    ;;
  verify)
    run_observed verify python3 "$REPO_ROOT/.imo/product/scripts/verify.py" "${@:2}"
    ;;
  *)
    print_placeholder >&2
    printf '\nUnsupported imo command: %s\n' "${1}" >&2
    exit 64
    ;;
esac
