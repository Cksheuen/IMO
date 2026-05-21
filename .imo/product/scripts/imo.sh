#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

print_placeholder() {
cat <<'EOF'
imo: repo-local IMO command surface

Source of truth lives under `.imo/`.

Usage:
  ./imo audit [claude|codex|all]
  ./imo learning list
  ./imo learning inspect <id>
  ./imo learning signal list
  ./imo learning signal add --summary <text>
  ./imo learning candidate build
  ./imo learning candidate list
  ./imo learning digest promote <candidate-id> --review-ref <ref> --rollback-id <id>
  ./imo codex context
  ./imo verify

Compatibility:
  scripts/imo.sh forwards to the same canonical implementation.

Common commands:
  - `audit` is read-only and checks whether IMO reintroduces Trellis-owned
    Claude/Codex host-surface management.
  - `learning list` and `learning inspect` read active learning digest state
    without creating or mutating digest data.
  - `learning signal list` reads raw signal state, and `learning signal add`
    writes raw signals only under `.imo/.runtime/learning/`.
  - `learning candidate build/list/inspect/reject` manages candidate lessons
    under `.imo/.runtime/learning/` without mutating active digest state.
  - `learning digest promote/disable/reset` manages reviewed active digest
    entries and requires rollback metadata for promotion.
  - `verify` runs the current read-only IMO guardrail, wrapper, and runtime
    compatibility checks, including rule, module, learning, and provider
    contracts.
  - `codex context` emits a small repo-local IMO context block for experimental
    Codex hook injection.

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

case "${1}" in
  -h|--help|help)
    print_placeholder
    exit 0
    ;;
  audit)
    exec python3 "$REPO_ROOT/.imo/product/scripts/audit_managed_ownership.py" "${@:2}"
    ;;
  learning)
    exec python3 "$REPO_ROOT/.imo/product/scripts/learning.py" "${@:2}"
    ;;
  codex)
    case "${2:-}" in
      context)
        exec python3 "$REPO_ROOT/.imo/product/scripts/codex_context.py" "${@:3}"
        ;;
      *)
        print_placeholder >&2
        printf '\nUnsupported imo codex command: %s\n' "${2:-}" >&2
        exit 64
        ;;
    esac
    ;;
  verify)
    exec python3 "$REPO_ROOT/.imo/product/scripts/verify.py" "${@:2}"
    ;;
  *)
    print_placeholder >&2
    printf '\nUnsupported imo command: %s\n' "${1}" >&2
    exit 64
    ;;
esac
