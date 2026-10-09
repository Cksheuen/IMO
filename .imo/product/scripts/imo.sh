#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
OBSERVABILITY_SCRIPT="$REPO_ROOT/.imo/product/scripts/observability_events.py"

print_placeholder() {
cat <<'EOF'
imo: global-first IMO command surface

Source of truth lives under `.imo/`.

Usage:
  ./imo budget audit [--json] [target-path]
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
  ./imo learning profile status
  ./imo learning profile inspect
  ./imo learning profile update --summary <text>
  ./imo learning profile export [--output <path>]
  ./imo learning profile import --input <path>
  ./imo learning metrics summary [--json]
  ./imo learning digest promote <candidate-id> --review-ref <ref> --rollback-id <id>
  ./imo metrics status
  ./imo metrics summary [--since <duration>] [--json]
  ./imo metrics timeline --trace <trace-id> [--json]
  ./imo metrics failures [--since <duration>] [--json]
  ./imo global status
  ./imo global doctor [--json]
  ./imo global install [--apply] [--force]
  ./imo global migrate [--apply] [--force]
  ./imo global uninstall [--apply] [--force]
  ./imo profile refresh
  ./imo profile status
  ./imo profile inspect
  ./imo profile clear
  ./imo veil gate
  ./imo veil context
  ./imo veil register
  ./imo veil run --task <handle> [-- <args>]
  ./imo veil run -- <generic-command> [args...]
  ./imo veil read --task <handle> [--rel <path>]
  ./imo veil read <generic-path>
  ./imo veil check (--command <text> | --path <path>)
  ./imo veil status [--reveal]
  ./imo veil policy (path|init|show)
  ./imo veil selftest
  ./imo veil install [--apply] [--gate-only] [--host both|claude|codex]
  ./imo veil uninstall [--apply] [--host both|claude|codex]
  ./imo init [target] [--force] [--dry-run]
  ./imo update [target] [--force] [--strict] [--dry-run]
  ./imo uninstall [target] [--force] [--dry-run]
  ./imo codex context [--mode compact|standard|full] [--stats]
  ./imo verify

Compatibility:
  scripts/imo.sh forwards to the same canonical implementation.

Common commands:
  - `budget audit` is read-only and measures visible local context slices such
    as instruction files, on-demand skills, and IMO context stats. It reports
    approximate token ranges plus threshold-based follow-up suggestions.
  - `defensive audit` is read-only and separates necessary boundary guardrails
    from fallback code that should be simplified, contracted, or removed.
  - `learning list` and `learning inspect` read active learning digest state
    without creating or mutating digest data.
  - `learning signal list` reads raw signal state, and `learning signal add`
    writes project-scoped signals under `~/.imo/projects/<project-id>/runtime/`.
  - `learning candidate build/list/inspect/reject` manages candidate lessons
    under the same project-scoped global runtime without mutating active digest.
  - `learning activity status/mark` manages project runtime activity state so
    background preparation does not guess task
    completion from conversation text.
  - `learning review prepare/inbox/inspect/approve/reject` provides an explicit
    deferred review inbox. Prepare may build candidates only; approve still
    requires review and rollback metadata before active digest mutation.
  - `learning profile status/inspect/update/enable/disable/export/import`
    manages a global, portable user profile under `~/.imo/runtime/learning/`
    for person-level preference and intent interpretation. It is separate from
    project profiles, active digest items, rules, and skills.
  - `learning metrics summary` reads compact local learning events and reports
    effectiveness counters without mutating learning state.
  - `learning digest promote/disable/reset` manages reviewed active digest
    entries and requires rollback metadata for promotion.
  - `metrics status/summary/timeline/failures` reads the unified local
    observability stream and bridges existing learning counters without
    mutating observability state.
  - `global status/doctor/install/migrate/uninstall` manages the global IMO runtime,
    Codex UserPromptSubmit hook, and lazy skill projections under `~/.codex/`.
    Install and migrate are dry-run unless `--apply` is explicit.
  - `profile refresh/status/inspect/clear` manages project convention snapshots
    under `~/.imo/projects/<project-id>/runtime/`; prompt-time context reads the
    cache and never refreshes it.
  - `veil` is the opt-in identity black box. `context` announces the available
    neutral handles to a session, `gate` is the PreToolUse hook entry, and
    `register` is an interactive local-only way to map a real CLI to a handle.
    `run`/`read` execute registered commands and files by neutral `--task`
    handle and return only graded, redacted envelopes that never carry the real
    name, path, argv, or opaque bytes (self-names in help output are replaced by
    the handle). Real mappings live only in the user policy, never in tracked
    source. `veil install --apply` registers one bounded PreToolUse gate plus a
    SessionStart announcement per selected host (`--gate-only` for just the
    gate) and is independent of `global install`; the veil never logs argv or
    raw output.
  - `init/update` only register projects under `~/.imo/projects/`; they write no
    framework files into repositories. `uninstall` also removes a legacy
    direct-run profile when its managed manifest exists, preserving knowledge.
  - `verify` runs the current read-only IMO guardrail, wrapper, and runtime
    compatibility checks, including rule, module, learning, observability,
    project-profile, and provider contracts.
  - `codex context` emits a budgeted repo-aware IMO context block for global
    Codex hook injection. Modes are `compact`, `standard`
    (default), and `full`; `--stats` reports read-only size and section data.
    Active digest injection may append compact ignored learning telemetry.

Architecture:
  - IMO owns capability, learning, runtime contracts, and its global CLI.
    Repository or platform-native task workflows remain independent.
  - External frameworks, plugins, and skills stay outside `.imo/product/*` by
    default.

Advanced concepts:
  - Provider discovery/invocation is optional and disabled by default until a
    task adds explicit ownership and side-effect metadata.
  - Host projections are managed adapters. Canonical skills remain under the
    recorded IMO source root and are loaded lazily by Codex.
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
  budget)
    case "${2:-}" in
      audit)
        exec python3 "$REPO_ROOT/.imo/product/scripts/budget_audit.py" "${@:3}"
        ;;
      *)
        print_placeholder >&2
        printf '\nUnsupported imo budget command: %s\n' "${2:-}" >&2
        exit 64
        ;;
    esac
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
  veil)
    run_observed veil python3 "$REPO_ROOT/.imo/product/scripts/identity_veil.py" "${@:2}"
    ;;
  init|update|uninstall)
    run_observed "install_${1}" python3 "$REPO_ROOT/.imo/product/scripts/install.py" "$@"
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
