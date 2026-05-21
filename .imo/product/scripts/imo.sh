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
  ./imo verify

Compatibility:
  scripts/imo.sh forwards to the same canonical implementation.

Common commands:
  - `audit` is read-only and checks whether IMO reintroduces Trellis-owned
    Claude/Codex host-surface management.
  - `learning list` and `learning inspect` read active learning digest state
    without creating or mutating learning data.
  - `verify` runs the current read-only IMO guardrail, wrapper, and runtime
    compatibility checks, including module, learning, and provider contracts.

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
  verify)
    exec python3 "$REPO_ROOT/.imo/product/scripts/verify.py" "${@:2}"
    ;;
  *)
    print_placeholder >&2
    printf '\nUnsupported imo command: %s\n' "${1}" >&2
    exit 64
    ;;
esac
